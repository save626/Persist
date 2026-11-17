import { describe, expect, it } from 'vitest'
import { migrate } from '../src/db/migrations.js'
import { openDatabase, type Db } from '../src/db/driver.js'
import { pruneAiCalls, recordAiCall } from '../src/ai/ai-audit.js'
import {
  AI_AUDIT_PRUNE_JOB,
  runAiAuditPrune,
  startAiAuditPruneScheduler,
} from '../src/jobs/ai-audit-prune.js'

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' })
  migrate(db)
  return db
}

/**
 * 北京时间某天某点的时间戳。Asia/Shanghai 恒为 UTC+8（无夏令时），
 * 所以直接按 UTC 偏移构造，不依赖运行机器的时区——否则在 UTC 机器上
 * 「04:00 之前不该跑」这类断言会静默失效。
 */
function shanghai(year: number, month: number, day: number, hour = 5): number {
  return Date.UTC(year, month - 1, day, hour - 8, 0, 0, 0)
}

const DAY_MS = 86_400_000

function seed(db: Db, at: number, keyId = 'k1'): void {
  recordAiCall(db, {
    keyId,
    route: '/api/chat',
    result: 'ok',
    httpStatus: 200,
    model: 'deepseek-chat',
    now: () => at,
  })
}

function countRows(db: Db, table: 'ai_calls' | 'ai_usage' | 'job_runs'): number {
  return Number(
    db.prepare<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total,
  )
}

describe('pruneAiCalls', () => {
  it('只删 cutoff 之前的行，返回删除条数', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      seed(db, now - 40 * DAY_MS)
      seed(db, now - 30 * DAY_MS)
      seed(db, now - 1 * DAY_MS)

      const deleted = pruneAiCalls(db, now - 30 * DAY_MS)
      expect(deleted).toBe(1)
      expect(countRows(db, 'ai_calls')).toBe(2)
    } finally {
      db.close()
    }
  })

  it('恰好等于 cutoff 的行不算过期（边界用严格小于）', () => {
    const db = fresh()
    try {
      const cutoff = shanghai(2026, 10, 18)
      seed(db, cutoff)
      expect(pruneAiCalls(db, cutoff)).toBe(0)
      expect(countRows(db, 'ai_calls')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('超过一批时循环删完（不是只删一批就收工）', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      const old = now - 60 * DAY_MS
      db.transaction(() => {
        for (let i = 0; i < 1_200; i += 1) seed(db, old)
      })
      seed(db, now)
      // 批大小刻意设小，验证「循环直到删空」而不是依赖一次删完。
      expect(pruneAiCalls(db, now - 30 * DAY_MS, 100)).toBe(1_200)
      expect(countRows(db, 'ai_calls')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('不碰 ai_usage：按天汇总是历史成本曲线，不属于审计明细', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      db.prepare(
        `INSERT INTO ai_usage (key_id, day, requests, prompt_tokens, completion_tokens, updated_at)
         VALUES ('k1', '2026-09-01', 3, 100, 20, ?)`,
      ).run(now - 80 * DAY_MS)
      seed(db, now - 80 * DAY_MS)
      pruneAiCalls(db, now - 30 * DAY_MS)
      expect(countRows(db, 'ai_calls')).toBe(0)
      expect(countRows(db, 'ai_usage')).toBe(1)
    } finally {
      db.close()
    }
  })
})

describe('runAiAuditPrune', () => {
  it('keepDays 为 0 时跳过，且不在 job_runs 留噪声行', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      seed(db, now - 400 * DAY_MS)
      const outcome = runAiAuditPrune({ db, config: { aiAuditKeepDays: 0 }, now: () => now })
      expect(outcome).toEqual({ status: 'skipped', reason: 'disabled' })
      expect(countRows(db, 'ai_calls')).toBe(1)
      expect(countRows(db, 'job_runs')).toBe(0)
    } finally {
      db.close()
    }
  })

  it('04:00 之前不跑，避免和 03:00 的库快照抢写锁', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17, 3)
      seed(db, now - 40 * DAY_MS)
      const outcome = runAiAuditPrune({ db, config: { aiAuditKeepDays: 30 }, now: () => now })
      expect(outcome).toEqual({ status: 'skipped', reason: 'not-due' })
      expect(countRows(db, 'ai_calls')).toBe(1)
      expect(countRows(db, 'job_runs')).toBe(0)
    } finally {
      db.close()
    }
  })

  it('到点后按保留天数删除，并留下 ok 的执行记录', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17, 5)
      seed(db, now - 31 * DAY_MS)
      seed(db, now - 30 * DAY_MS)
      seed(db, now - 29 * DAY_MS)

      const outcome = runAiAuditPrune({ db, config: { aiAuditKeepDays: 30 }, now: () => now })
      expect(outcome).toMatchObject({ status: 'pruned', deleted: 1, keepDays: 30 })
      expect((outcome as { cutoff: number }).cutoff).toBe(now - 30 * DAY_MS)
      expect(countRows(db, 'ai_calls')).toBe(2)

      const run = db
        .prepare<{ name: string; run_key: string; status: string; user_id: string | null }>(
          'SELECT name, run_key, status, user_id FROM job_runs',
        )
        .get()
      expect(run).toEqual({
        name: AI_AUDIT_PRUNE_JOB,
        run_key: '2026-11-17',
        status: 'ok',
        user_id: null,
      })
    } finally {
      db.close()
    }
  })

  it('同一天重复调用不重复删（靠 job_runs 去重，不是靠内存）', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17, 5)
      seed(db, now - 31 * DAY_MS)
      expect(
        runAiAuditPrune({ db, config: { aiAuditKeepDays: 30 }, now: () => now }),
      ).toMatchObject({
        status: 'pruned',
      })
      seed(db, now - 31 * DAY_MS)
      const second = runAiAuditPrune({
        db,
        config: { aiAuditKeepDays: 30 },
        now: () => now + 60_000,
      })
      expect(second).toEqual({ status: 'skipped', reason: 'already-ran' })
      expect(countRows(db, 'ai_calls')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('隔天会再跑一次', () => {
    const db = fresh()
    try {
      const day1 = shanghai(2026, 11, 17, 5)
      expect(
        runAiAuditPrune({ db, config: { aiAuditKeepDays: 30 }, now: () => day1 }),
      ).toMatchObject({
        status: 'pruned',
        deleted: 0,
      })
      const day2 = shanghai(2026, 11, 18, 5)
      expect(
        runAiAuditPrune({ db, config: { aiAuditKeepDays: 30 }, now: () => day2 }),
      ).toMatchObject({
        status: 'pruned',
      })
      expect(countRows(db, 'job_runs')).toBe(2)
    } finally {
      db.close()
    }
  })

  it('删除抛错时记 failed 而不是让进程带着异常退出', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17, 5)
      db.exec('DROP TABLE ai_calls')
      const outcome = runAiAuditPrune({ db, config: { aiAuditKeepDays: 30 }, now: () => now })
      expect(outcome.status).toBe('failed')
      const run = db
        .prepare<{ status: string; error: string | null }>('SELECT status, error FROM job_runs')
        .get()
      expect(run?.status).toBe('failed')
      expect(run?.error).toBeTruthy()
    } finally {
      db.close()
    }
  })
})

describe('startAiAuditPruneScheduler', () => {
  it('启动即尝试一次（补跑当天已过 04:00 的情况），stop 后不再跑', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17, 9)
      seed(db, now - 45 * DAY_MS)
      const scheduler = startAiAuditPruneScheduler({
        db,
        config: { aiAuditKeepDays: 30 },
        now: () => now,
        intervalMs: 60_000,
      })
      scheduler.stop()
      expect(countRows(db, 'ai_calls')).toBe(0)
      expect(countRows(db, 'job_runs')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('关闭清理时不删任何东西', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17, 9)
      seed(db, now - 400 * DAY_MS)
      const scheduler = startAiAuditPruneScheduler({
        db,
        config: { aiAuditKeepDays: 0 },
        now: () => now,
        intervalMs: 60_000,
      })
      scheduler.stop()
      expect(countRows(db, 'ai_calls')).toBe(1)
    } finally {
      db.close()
    }
  })
})
