import { describe, expect, it } from 'vitest'
import type { Db } from '../src/db/driver.js'
import { openDatabase } from '../src/db/driver.js'
import { migrate } from '../src/db/migrations.js'
import { currentRev } from '../src/db/repositories/sync-seq.js'
import { buildAnalysisFacts, isAiConsentOff, readConsent } from '../src/analysis/facts.js'
import {
  NOW,
  TODAY,
  USER,
  seedPlan,
  seedProfile,
  seedRecords,
  seedSettings,
  seedUser,
} from './helpers/analysis-fixtures.js'

/**
 * 服务端事实聚合测试（P4 §8.1）。
 *
 * 重点不是「SQL 能跑」，而是三条口径：
 * 1. 数字来自列聚合，窗口外记录不进来；
 * 2. 未授权模块整体为 null（不是 0），模型不可能把「没授权」写成「没记录」；
 * 3. 90 天只给周汇总，逐日才能算的均值放到 totals。
 */

function freshDb(options: { records?: boolean; empty?: boolean } = {}): Db {
  const db = openDatabase({ path: ':memory:' })
  migrate(db)
  seedUser(db)
  seedProfile(db, USER, {
    aiConsent: true,
    age: 30,
    height: 175,
    weight: 70,
    targetWeight: 65,
    goal: '减脂',
    experience: 'beginner',
    frequency: '3 次/周',
  })
  seedRecords(db, USER, {
    empty: options.empty === true,
    withPreviousWindow: options.records !== false && options.empty !== true,
  })
  return db
}

describe('buildAnalysisFacts：7 天窗口', () => {
  it('逐日聚合：窗口边界正确，totals / coverage 与记录一致', () => {
    const db = freshDb()
    try {
      const facts = buildAnalysisFacts(db, USER, { rangeDays: 7, now: NOW })
      expect(facts.version).toBe(2)
      expect(facts.type).toBe('综合分析')
      expect(facts.granularity).toBe('day')
      expect(facts.range).toEqual({ days: 7, start: '2026-10-30', end: TODAY })
      expect(facts.dataRev).toBe(currentRev(db))
      expect(facts.consent).toEqual({ profile: true, fitness: true, diet: true, study: true })

      // 只有当天有记录；前一个窗口的训练不进来。
      expect(facts.days).toHaveLength(1)
      expect(facts.days[0]).toMatchObject({
        date: TODAY,
        fitness: { sessions: 1, sets: 1, volumeKg: 300 },
        study: { minutes: 45, byCategory: { english: 45, math: 0 } },
        diet: { calories: 600, protein: 40, carbs: 60, fat: 12, meals: 1 },
        waterMl: 250,
        plan: { total: 1, done: 1 },
      })

      expect(facts.totals).toMatchObject({
        fitnessSessions: 1,
        studyMinutes: 45,
        waterAvgMl: 250,
        planRate: 100,
        daysWithAnyRecord: 1,
        daysMissing: 6,
        dietAvgCalories: 600,
        dietAvgProtein: 40,
        studyEnglishMinutes: 45,
        studyMathMinutes: 0,
      })
      expect(facts.coverage).toEqual({
        fitnessDays: 1,
        studyDays: 1,
        dietDays: 1,
        waterDays: 1,
      })
      expect(facts.profile).toMatchObject({ age: 30, weight: 70, goal: '减脂' })
      // 7 天窗口不额外给周汇总，避免同一份数字出现两遍。
      expect(facts.weekly).toEqual([])
    } finally {
      db.close()
    }
  })

  it('trend 与上一个等长窗口对比：训练次数从 2 次降到 1 次', () => {
    const db = freshDb()
    try {
      const facts = buildAnalysisFacts(db, USER, { rangeDays: 7, now: NOW })
      expect(facts.trend.previousRange).toEqual({ start: '2026-10-23', end: '2026-10-29' })
      expect(facts.trend.fitnessSessionsChangePct).toBe(-50)
      // 上一窗口没有学习记录，前值为 0 时不给百分比（不能除零，也不编「+∞」）。
      expect(facts.trend.studyMinutesChangePct).toBeNull()
      expect(facts.trend.planRateChangePct).toBeNull()
    } finally {
      db.close()
    }
  })

  it('空窗口：没有记录也不补参考值，trend 整体为 null', () => {
    const db = freshDb({ empty: true })
    try {
      const facts = buildAnalysisFacts(db, USER, { rangeDays: 7, now: NOW })
      expect(facts.days).toEqual([])
      expect(facts.weekly).toEqual([])
      expect(facts.totals.daysWithAnyRecord).toBe(0)
      expect(facts.totals.daysMissing).toBe(7)
      expect(facts.totals.fitnessSessions).toBe(0)
      expect(facts.totals.waterAvgMl).toBeNull()
      expect(facts.totals.dietAvgCalories).toBeNull()
      expect(facts.trend.previousRange).toBeNull()
      expect(facts.trend.fitnessSessionsChangePct).toBeNull()
    } finally {
      db.close()
    }
  })
})

describe('buildAnalysisFacts：授权口径', () => {
  it('显式关掉某几个数据源：模块整体为 null，不是 0', () => {
    const db = freshDb()
    try {
      seedSettings(db, USER, { sources: { fitness: false, diet: false } })
      const facts = buildAnalysisFacts(db, USER, { rangeDays: 7, now: NOW })
      expect(facts.consent).toEqual({ profile: true, fitness: false, diet: false, study: true })

      expect(facts.days[0]).toMatchObject({
        date: TODAY,
        fitness: null,
        diet: null,
        waterMl: null,
        study: { minutes: 45 },
        // 计划模块在「训练或学习任一授权」时可见。
        plan: { total: 1, done: 1 },
      })
      expect(facts.totals.fitnessSessions).toBeNull()
      expect(facts.totals.waterAvgMl).toBeNull()
      expect(facts.totals.dietAvgCalories).toBeNull()
      expect(facts.totals.studyMinutes).toBe(45)
      // coverage 只统计真正参与聚合的模块。
      expect(facts.coverage).toMatchObject({
        fitnessDays: 0,
        dietDays: 0,
        waterDays: 0,
        studyDays: 1,
      })
    } finally {
      db.close()
    }
  })

  it('档案页 AI 总开关关闭：四个模块全关，事实包里没有任何个人数据', () => {
    const db = freshDb()
    try {
      seedProfile(
        db,
        USER,
        {
          aiConsent: false,
          age: 30,
          height: 175,
          weight: 70,
          targetWeight: 65,
          goal: '减脂',
          experience: 'beginner',
          frequency: '3 次/周',
        },
        2_000,
      )
      expect(isAiConsentOff(db, USER)).toBe(true)
      expect(readConsent(db, USER)).toEqual({
        profile: false,
        fitness: false,
        diet: false,
        study: false,
      })

      const facts = buildAnalysisFacts(db, USER, { rangeDays: 7, now: NOW })
      expect(facts.profile).toBeNull()
      expect(facts.plan).toBeNull()
      expect(facts.days).toEqual([])
      expect(facts.totals.daysWithAnyRecord).toBe(0)
      expect(facts.totals.fitnessSessions).toBeNull()
      expect(facts.totals.studyMinutes).toBeNull()
    } finally {
      db.close()
    }
  })

  it('没有任何档案 / 设置时默认全授权（用户 2026-11-05 的明确要求）', () => {
    const db = openDatabase({ path: ':memory:' })
    try {
      migrate(db)
      seedUser(db)
      seedRecords(db, USER)
      expect(readConsent(db, USER)).toEqual({
        profile: true,
        fitness: true,
        diet: true,
        study: true,
      })
      expect(isAiConsentOff(db, USER)).toBe(false)
    } finally {
      db.close()
    }
  })
})

describe('buildAnalysisFacts：窗口与计划', () => {
  it('90 天窗口只给周汇总，逐日聚合放到 totals', () => {
    const db = freshDb()
    try {
      const facts = buildAnalysisFacts(db, USER, { rangeDays: 90, now: NOW })
      expect(facts.granularity).toBe('week')
      expect(facts.range.start).toBe('2026-08-08')
      expect(facts.days).toEqual([])
      // 10-24 属于 10-19 那周，10-26 是下周一，当天记录属于 11-02 那周。
      expect(facts.weekly).toHaveLength(3)
      expect(facts.weekly[0]).toMatchObject({
        weekStart: '2026-10-19',
        fitnessSessions: 1,
      })
      expect(facts.weekly[1]).toMatchObject({
        weekStart: '2026-10-26',
        fitnessSessions: 1,
      })
      expect(facts.weekly[2]).toMatchObject({
        weekStart: '2026-11-02',
        fitnessSessions: 1,
        studyMinutes: 45,
        avgWaterMl: 250,
        planRate: 100,
      })
      expect(facts.totals.fitnessSessions).toBe(3)
      // 90 天没有逐日数组，指标卡需要的均值必须由 totals 提供。
      expect(facts.totals.dietAvgCalories).toBe(600)
      expect(facts.totals.studyEnglishMinutes).toBe(45)
    } finally {
      db.close()
    }
  })

  it('30 天窗口同时给逐日与周汇总', () => {
    const db = freshDb()
    try {
      const facts = buildAnalysisFacts(db, USER, { rangeDays: 30, now: NOW })
      expect(facts.granularity).toBe('day')
      expect(facts.days).toHaveLength(3)
      expect(facts.days.map((day) => day.date)).toEqual(['2026-10-24', '2026-10-26', TODAY])
      expect(facts.weekly).toHaveLength(3)
    } finally {
      db.close()
    }
  })

  it('当前长线计划：标题、周目标、计划项完成率', () => {
    const db = freshDb()
    try {
      seedPlan(db, USER, {
        id: 'plan_long',
        title: '减脂 12 周',
        goal: '体脂降到 18%',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        cadence: 'weekly',
        status: 'active',
        source: 'manual',
        createdAt: 1_000,
        weeklyTargets: [{ id: 't1', label: '训练', unit: '次', perWeek: 3, module: 'fitness' }],
      })
      const facts = buildAnalysisFacts(db, USER, { rangeDays: 7, now: NOW })
      expect(facts.plan).toEqual({
        title: '减脂 12 周',
        weeklyTargets: [{ label: '训练', unit: '次', perWeek: 3 }],
        progressPct: 100,
      })
    } finally {
      db.close()
    }
  })
})
