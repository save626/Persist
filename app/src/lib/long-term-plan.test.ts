import { describe, expect, it } from 'vitest'
import {
  activateLongTermPlan,
  activePlan,
  createLongTermPlan,
  deriveWeeklyAchievements,
  getWeekRange,
  isDateInWeek,
  isValidIsoDate,
  MAX_PER_WEEK,
  overallProgress,
  summarizeWeekProgress,
  type LongTermPlanDraft,
} from './long-term-plan'
import type { FitnessSessionState, LongTermPlan, StudyRecord } from '../types'

const NOW = new Date(2026, 9, 30, 15, 0, 0)

function draft(overrides: Partial<LongTermPlanDraft> = {}): LongTermPlanDraft {
  return {
    title: '减脂 12 周',
    goal: '体重降到 70kg',
    cadence: 'cycle',
    weeklyTargets: [
      { label: '力量训练', unit: '次', perWeek: 4, module: 'fitness' },
      { label: '有氧', unit: '分钟', perWeek: 150, module: 'fitness' },
      { label: '英语精听', unit: '篇', perWeek: 3, module: 'study' },
    ],
    ...overrides,
  }
}

function plan(overrides: Partial<LongTermPlan> = {}): LongTermPlan {
  const created = createLongTermPlan(draft({ weeklyTargets: [] }), NOW)
  return {
    id: 'plan-1',
    title: '减脂 12 周',
    goal: '体重降到 70kg',
    startDate: '2026-10-26',
    cadence: 'cycle',
    weeklyTargets: [
      { id: 'target-1', label: '力量训练', unit: '次', perWeek: 4, module: 'fitness' },
      { id: 'target-2', label: '英语精听', unit: '篇', perWeek: 3, module: 'study' },
    ],
    status: 'active',
    source: 'ai-chat',
    createdAt: created?.createdAt ?? NOW.toISOString(),
    ...overrides,
  }
}

describe('createLongTermPlan', () => {
  it('把合法提案归一化成可落库结构', () => {
    const result = createLongTermPlan(draft(), NOW)
    expect(result).not.toBeNull()
    expect(result?.title).toBe('减脂 12 周')
    expect(result?.cadence).toBe('cycle')
    expect(result?.status).toBe('draft')
    expect(result?.source).toBe('manual')
    expect(result?.startDate).toBe('2026-10-30')
    expect(result?.weeklyTargets).toHaveLength(3)
    expect(result?.weeklyTargets[0]).toEqual({
      id: 'target-1',
      label: '力量训练',
      unit: '次',
      perWeek: 4,
      module: 'fitness',
    })
  })

  it('标题为空或没有合法目标时整份提案作废', () => {
    expect(createLongTermPlan(draft({ title: '   ' }), NOW)).toBeNull()
    expect(createLongTermPlan(draft({ weeklyTargets: [] }), NOW)).toBeNull()
    expect(
      createLongTermPlan(draft({ weeklyTargets: [{ label: '', unit: '次', perWeek: 4 }] }), NOW),
    ).toBeNull()
  })

  it('过滤非法目标但保留合法目标', () => {
    const result = createLongTermPlan(
      draft({
        weeklyTargets: [
          { label: '力量训练', unit: '次', perWeek: 4, module: 'fitness' },
          { label: '错误单位', unit: '公斤' as never, perWeek: 4 },
          { label: '零次', unit: '次', perWeek: 0 },
          { label: '负数', unit: '次', perWeek: -3 },
          { label: 'NaN', unit: '次', perWeek: Number.NaN },
        ],
      }),
      NOW,
    )
    expect(result?.weeklyTargets).toHaveLength(1)
    expect(result?.weeklyTargets[0].label).toBe('力量训练')
  })

  it('次数取整且不超过上限', () => {
    const result = createLongTermPlan(
      draft({
        weeklyTargets: [
          { label: '四舍五入', unit: '次', perWeek: 3.6 },
          { label: '超大值', unit: '次', perWeek: 5000 },
        ],
      }),
      NOW,
    )
    expect(result?.weeklyTargets[0].perWeek).toBe(4)
    expect(result?.weeklyTargets[1].perWeek).toBe(MAX_PER_WEEK)
  })

  it('结束日期早于开始日期时丢弃', () => {
    const result = createLongTermPlan(
      draft({ startDate: '2026-11-01', endDate: '2026-10-01' }),
      NOW,
    )
    expect(result?.startDate).toBe('2026-11-01')
    expect(result?.endDate).toBeUndefined()
  })
})

describe('getWeekRange', () => {
  it('以周一为起点', () => {
    const week = getWeekRange(new Date(2026, 9, 30, 15, 0, 0))
    expect(week.startIso).toBe('2026-10-26')
    expect(week.endIso).toBe('2026-11-01')
    expect(week.label).toBe('10月26日 – 11月1日')
  })

  it('周一当天仍属于当周', () => {
    const week = getWeekRange(new Date(2026, 9, 26, 9, 0, 0))
    expect(week.startIso).toBe('2026-10-26')
    expect(isDateInWeek('2026-10-26', week)).toBe(true)
    expect(isDateInWeek('2026-11-02', week)).toBe(false)
    expect(isDateInWeek('not-a-date', week)).toBe(false)
  })
})

describe('summarizeWeekProgress', () => {
  it('ratio 封顶 1 并标记完成与估算', () => {
    const rows = summarizeWeekProgress(plan(), { 'target-1': 5, 'target-2': 1 }, ['study'])
    expect(rows[0].ratio).toBe(1)
    expect(rows[0].done).toBe(true)
    expect(rows[0].estimated).toBe(false)
    expect(rows[1].ratio).toBeCloseTo(1 / 3)
    expect(rows[1].done).toBe(false)
    expect(rows[1].estimated).toBe(true)
  })

  it('缺失或非法完成量按 0 处理', () => {
    const rows = summarizeWeekProgress(plan(), { 'target-1': Number.NaN, 'target-2': -5 })
    expect(rows.every((row) => row.achieved === 0)).toBe(true)
    expect(overallProgress(rows)).toBe(0)
  })

  it('整体进度取各目标比例均值', () => {
    const rows = summarizeWeekProgress(plan(), { 'target-1': 2, 'target-2': 3 })
    expect(overallProgress(rows)).toBe(75)
  })
})

describe('deriveWeeklyAchievements', () => {
  const records: StudyRecord[] = [
    {
      id: 's-1',
      category: 'english',
      source: 'Mock',
      date: '2026-10-27',
      startTime: '20:00',
      duration: 40,
      note: '',
    },
    {
      id: 's-2',
      category: 'math',
      source: 'Mock',
      date: '2026-10-29',
      startTime: '21:00',
      duration: 30,
      note: '',
    },
    {
      id: 's-3',
      category: 'english',
      source: 'Mock',
      date: '2026-10-20',
      startTime: '20:00',
      duration: 50,
      note: '',
    },
  ]

  it('只统计本周记录，并按单位换算', () => {
    const result = deriveWeeklyAchievements(
      plan({
        weeklyTargets: [
          { id: 'target-1', label: '学习时长', unit: '分钟', perWeek: 200, module: 'study' },
          { id: 'target-2', label: '学习次数', unit: '次', perWeek: 5, module: 'study' },
        ],
      }),
      { studyRecords: records, fitnessSession: null, now: NOW },
    )
    expect(result.achieved['target-1']).toBe(70)
    expect(result.achieved['target-2']).toBe(2)
    expect(result.estimatedModules).toContain('study')
  })

  it('健身会话未完成时不计入，完成后按分钟换算', () => {
    const base: FitnessSessionState = {
      activeTemplateId: 'tpl-1',
      exercises: [],
      sessionStatus: 'active',
      elapsedSeconds: 2700,
    }
    const active = deriveWeeklyAchievements(
      plan({
        weeklyTargets: [
          { id: 'target-1', label: '力量训练', unit: '次', perWeek: 4, module: 'fitness' },
          { id: 'target-2', label: '训练分钟', unit: '分钟', perWeek: 180, module: 'fitness' },
        ],
      }),
      { studyRecords: [], fitnessSession: base, now: NOW },
    )
    expect(active.achieved['target-1']).toBe(0)
    expect(active.achieved['target-2']).toBe(0)

    const done = deriveWeeklyAchievements(
      plan({
        weeklyTargets: [
          { id: 'target-1', label: '力量训练', unit: '次', perWeek: 4, module: 'fitness' },
          { id: 'target-2', label: '训练分钟', unit: '分钟', perWeek: 180, module: 'fitness' },
        ],
      }),
      { studyRecords: [], fitnessSession: { ...base, sessionStatus: 'completed' }, now: NOW },
    )
    expect(done.achieved['target-1']).toBe(1)
    expect(done.achieved['target-2']).toBe(45)
  })

  it('未归属模块的目标不会自动累计', () => {
    const result = deriveWeeklyAchievements(
      plan({
        weeklyTargets: [
          { id: 'target-1', label: '冥想', unit: '次', perWeek: 7, module: 'other' },
          { id: 'target-2', label: '未知', unit: '次', perWeek: 7 },
        ],
      }),
      { studyRecords: records, fitnessSession: null, now: NOW },
    )
    expect(result.achieved['target-1']).toBe(0)
    expect(result.achieved['target-2']).toBe(0)
  })
})

describe('plan source', () => {
  it('默认标记为 manual，避免把手工计划说成 AI 生成', () => {
    expect(createLongTermPlan(draft(), NOW)?.source).toBe('manual')
  })

  it('AI 对话确认的草案显式标记 ai-chat', () => {
    expect(createLongTermPlan(draft({ source: 'ai-chat' }), NOW)?.source).toBe('ai-chat')
  })
})

describe('activePlan', () => {
  it('只把 active 当作当前计划，草案不会被当成为准', () => {
    expect(activePlan([plan({ id: 'draft-1', status: 'draft' })])).toBeNull()
    expect(activePlan([plan({ id: 'archived-1', status: 'archived' })])).toBeNull()
  })

  it('有 active 时返回 active', () => {
    const current = plan({ id: 'active-1', status: 'active' })
    expect(activePlan([plan({ id: 'draft-1', status: 'draft' }), current])?.id).toBe('active-1')
  })
})

describe('activateLongTermPlan', () => {
  it('把目标计划设为 active，并把原来的 active 归档', () => {
    const plans = [
      plan({ id: 'old', status: 'active' }),
      plan({ id: 'next', status: 'draft' }),
      plan({ id: 'done', status: 'archived' }),
    ]
    const next = activateLongTermPlan(plans, 'next')
    expect(next.find((item) => item.id === 'next')?.status).toBe('active')
    expect(next.find((item) => item.id === 'old')?.status).toBe('archived')
    expect(next.find((item) => item.id === 'done')?.status).toBe('archived')
  })

  it('是纯函数：不修改入参数组和元素', () => {
    const plans = [plan({ id: 'old', status: 'active' }), plan({ id: 'next', status: 'draft' })]
    const next = activateLongTermPlan(plans, 'next')
    expect(next).not.toBe(plans)
    expect(plans[0].status).toBe('active')
    expect(plans[1].status).toBe('draft')
  })

  it('目标不存在时原样返回', () => {
    const plans = [plan({ id: 'old', status: 'active' })]
    expect(activateLongTermPlan(plans, 'missing')).toBe(plans)
  })
})

describe('isValidIsoDate', () => {
  it('只接受真实的 YYYY-MM-DD 日期', () => {
    expect(isValidIsoDate('2026-10-30')).toBe(true)
    expect(isValidIsoDate('2026-13-01')).toBe(false)
    expect(isValidIsoDate('2026-1-1')).toBe(false)
    expect(isValidIsoDate('今天')).toBe(false)
  })

  it('拒绝不存在的日历日，不会像 Date.parse 那样滚到下一月', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false)
    expect(isValidIsoDate('2026-04-31')).toBe(false)
    expect(isValidIsoDate('2026-00-10')).toBe(false)
    expect(isValidIsoDate('2026-02-29')).toBe(false)
  })

  it('闰年的 2 月 29 日是合法日期', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(isValidIsoDate('2026-12-31')).toBe(true)
  })
})
