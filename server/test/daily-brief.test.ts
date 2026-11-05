import { describe, expect, it } from 'vitest'
import type { Db } from '../src/db/driver.js'
import { openDatabase } from '../src/db/driver.js'
import { migrate } from '../src/db/migrations.js'
import { loadConfig } from '../src/config.js'
import type { ServerConfig } from '../src/config.js'
import { findJobRun, listReports } from '../src/db/repositories/reports.js'
import {
  DAILY_BRIEF_JOB,
  runDailyBrief,
  startDailyBriefScheduler,
} from '../src/jobs/daily-brief.js'
import {
  NOW,
  USER,
  contentJson,
  fakeAi,
  seedRecords,
  seedSettings,
  seedUser,
  validContent,
} from './helpers/analysis-fixtures.js'
import type { FakeAi } from './helpers/analysis-fixtures.js'

/**
 * 每日简报任务测试（P4 §8.6）。
 *
 * 覆盖：无用户 / 开关关闭 / 未到点 / 到点生成 / 同日去重 / 设置页优先于环境变量 /
 * 契约违规后当天重试 / 零记录不算重试风暴 / 进程内调度器立即补跑。
 * 时钟固定在 2026-11-05 21:00（Asia/Shanghai）。
 */

const NOT_DUE_NOW = Date.UTC(2026, 10, 5, 12, 0, 0) // 上海时间 20:00

function makeDb(seed = true): Db {
  const db = openDatabase({ path: ':memory:' })
  migrate(db)
  seedUser(db)
  if (seed) seedRecords(db, USER)
  return db
}

function config(env: Record<string, string> = {}): ServerConfig {
  return loadConfig({
    DEEPSEEK_API_KEY: 'test-key',
    DAILY_BRIEF_ENABLED: 'true',
    DAILY_BRIEF_AT: '21:00',
    ...env,
  } as unknown as NodeJS.ProcessEnv)
}

function deps(db: Db, ai: FakeAi, overrides: { now?: number; env?: Record<string, string> } = {}) {
  return {
    db,
    ai,
    config: config(overrides.env ?? {}),
    now: () => overrides.now ?? NOW,
  }
}

describe('runDailyBrief：跳过条件', () => {
  it('没有任何用户：skipped no-user', async () => {
    const db = openDatabase({ path: ':memory:' })
    try {
      migrate(db)
      const outcome = await runDailyBrief(deps(db, fakeAi([contentJson()])))
      expect(outcome).toEqual({ status: 'skipped', reason: 'no-user' })
      expect(findJobRun(db, DAILY_BRIEF_JOB, '2026-11-05')).toBeNull()
    } finally {
      db.close()
    }
  })

  it('环境变量关闭：skipped disabled，不抢锁也不调模型', async () => {
    const db = makeDb()
    const ai = fakeAi([contentJson()])
    try {
      const outcome = await runDailyBrief(deps(db, ai, { env: { DAILY_BRIEF_ENABLED: 'false' } }))
      expect(outcome).toEqual({ status: 'skipped', reason: 'disabled' })
      expect(ai.calls).toBe(0)
      expect(findJobRun(db, DAILY_BRIEF_JOB, '2026-11-05')).toBeNull()
    } finally {
      db.close()
    }
  })

  it('未到点：skipped not-due（20:00 < 21:00）', async () => {
    const db = makeDb()
    const ai = fakeAi([contentJson()])
    try {
      const outcome = await runDailyBrief(deps(db, ai, { now: NOT_DUE_NOW }))
      expect(outcome).toEqual({ status: 'skipped', reason: 'not-due' })
      expect(ai.calls).toBe(0)
    } finally {
      db.close()
    }
  })
})

describe('runDailyBrief：生成与去重', () => {
  it('到点生成 7 天综合分析，记 job_runs ok；同一天再跑直接 already-ran', async () => {
    const db = makeDb()
    const ai = fakeAi([contentJson()])
    try {
      const outcome = await runDailyBrief(deps(db, ai))
      expect(outcome).toMatchObject({ status: 'generated', origin: 'ai', cached: false })
      expect(ai.calls).toBe(1)
      expect(findJobRun(db, DAILY_BRIEF_JOB, '2026-11-05')).toMatchObject({
        status: 'ok',
        userId: USER,
      })
      const reports = listReports(db, USER).reports
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({ rangeDays: 7, origin: 'ai' })

      const again = await runDailyBrief(deps(db, ai))
      expect(again).toEqual({ status: 'skipped', reason: 'already-ran' })
      expect(ai.calls).toBe(1)
    } finally {
      db.close()
    }
  })

  it('设置页开关优先于环境变量：环境变量关闭但设置开启时照常生成', async () => {
    const db = makeDb()
    seedSettings(db, USER, { dailyBrief: { enabled: true, at: '08:00' } })
    const ai = fakeAi([contentJson()])
    try {
      const outcome = await runDailyBrief(
        deps(db, ai, { env: { DAILY_BRIEF_ENABLED: 'false', DAILY_BRIEF_AT: '23:30' } }),
      )
      expect(outcome.status).toBe('generated')
      expect(ai.calls).toBe(1)
    } finally {
      db.close()
    }
  })

  it('设置页显式关闭：即使环境变量开启也不生成', async () => {
    const db = makeDb()
    seedSettings(db, USER, { dailyBrief: { enabled: false, at: '21:00' } })
    const ai = fakeAi([contentJson()])
    try {
      expect(await runDailyBrief(deps(db, ai))).toEqual({ status: 'skipped', reason: 'disabled' })
      expect(ai.calls).toBe(0)
    } finally {
      db.close()
    }
  })
})

describe('runDailyBrief：失败路径', () => {
  it('模型两次都写错数字：记 failed 且只调两次模型；当天换好模型可重试成功', async () => {
    const db = makeDb()
    const badContent = contentJson({
      ...validContent(),
      summary: `${validContent().summary} 折合 1234 千卡。`,
    })
    const badAi = fakeAi([badContent])
    try {
      const outcome = await runDailyBrief(deps(db, badAi))
      expect(outcome).toEqual({ status: 'failed', error: 'invalid_response' })
      expect(badAi.calls).toBe(2)
      expect(findJobRun(db, DAILY_BRIEF_JOB, '2026-11-05')).toMatchObject({
        status: 'failed',
        error: 'invalid_response',
      })
      expect(listReports(db, USER).reports).toEqual([])

      const goodAi = fakeAi([contentJson()])
      const retried = await runDailyBrief(deps(db, goodAi))
      expect(retried.status).toBe('generated')
      expect(goodAi.calls).toBe(1)
      expect(findJobRun(db, DAILY_BRIEF_JOB, '2026-11-05')?.status).toBe('ok')
    } finally {
      db.close()
    }
  })

  it('零记录：记 failed insufficient_data，不调模型，也不重试第二次', async () => {
    const db = makeDb(false)
    const ai = fakeAi([contentJson()])
    try {
      const outcome = await runDailyBrief(deps(db, ai))
      expect(outcome).toEqual({ status: 'failed', error: 'insufficient_data' })
      expect(ai.calls).toBe(0)

      // 用户当天补了记录：下一个 tick 重新抢锁即可生成。
      seedRecords(db, USER)
      const retried = await runDailyBrief(deps(db, ai))
      expect(retried.status).toBe('generated')
      expect(ai.calls).toBe(1)
    } finally {
      db.close()
    }
  })
})

describe('startDailyBriefScheduler：进程内调度', () => {
  it('启动立即补跑一次，stop() 之后不再计时', async () => {
    const db = makeDb()
    const ai = fakeAi([contentJson()])
    try {
      const scheduler = startDailyBriefScheduler({
        ...deps(db, ai),
        intervalMs: 60_000,
      })
      // tick 是异步的：等它跑完再断言。
      await new Promise((resolve) => setTimeout(resolve, 50))
      scheduler.stop()
      expect(ai.calls).toBe(1)
      expect(findJobRun(db, DAILY_BRIEF_JOB, '2026-11-05')?.status).toBe('ok')
    } finally {
      db.close()
    }
  })
})
