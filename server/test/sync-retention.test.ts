import { describe, expect, it } from 'vitest'
import { migrate } from '../src/db/migrations.js'
import { openDatabase, type Db } from '../src/db/driver.js'
import { pruneSyncOps, pruneTombstones } from '../src/sync/tombstones.js'
import {
  SYNC_RETENTION_JOB,
  runSyncRetention,
  startSyncRetentionScheduler,
} from '../src/jobs/sync-retention.js'

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' })
  migrate(db)
  return db
}

/** 北京时间某天某点；Asia/Shanghai 无夏令时，直接按 UTC+8 构造，不依赖机器时区。 */
function shanghai(year: number, month: number, day: number, hour = 5): number {
  return Date.UTC(year, month - 1, day, hour - 8, 0, 0, 0)
}

const DAY_MS = 86_400_000

function seedUser(db: Db, id: string, at: number): void {
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(id, at)
}

function seedDevice(
  db: Db,
  input: { id: string; userId: string; createdAt: number; lastSeenAt: number | null; revokedAt?: number | null },
): void {
  db.prepare(
    `INSERT INTO devices (id, user_id, token_hash, label, created_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  ).run(input.id, input.userId, `hash_${input.id}`, input.createdAt, input.lastSeenAt, input.revokedAt ?? null)
}

/** 插一条 plan_items；deletedAt 非空即墓碑。 */
function seedPlanItem(
  db: Db,
  input: { id: string; userId: string; deletedAt: number | null; rev: number; at: number },
): void {
  db.prepare(
    `INSERT INTO plan_items (id, user_id, date, kind, done, payload_json, updated_at, deleted_at, rev)
     VALUES (?, ?, '2026-11-17', 'default', 0, '{}', ?, ?, ?)`,
  ).run(input.id, input.userId, input.at, input.deletedAt, input.rev)
}

function seedSyncOp(db: Db, id: string, userId: string, appliedAt: number): void {
  db.prepare(
    'INSERT INTO sync_ops (op_id, device_id, user_id, applied_at, result_json) VALUES (?, ?, ?, ?, ?)',
  ).run(id, 'dev_x', userId, appliedAt, '{}')
}

function count(db: Db, table: string): number {
  return Number(db.prepare<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total)
}

describe('pruneTombstones', () => {
  it('没有设备时按时间删：删旧墓碑，保留新墓碑与未删除行', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      seedUser(db, 'usr_a', now - 365 * DAY_MS)
      seedPlanItem(db, { id: 'p_old', userId: 'usr_a', deletedAt: now - 40 * DAY_MS, rev: 1, at: now })
      seedPlanItem(db, { id: 'p_new', userId: 'usr_a', deletedAt: now - 3 * DAY_MS, rev: 2, at: now })
      seedPlanItem(db, { id: 'p_live', userId: 'usr_a', deletedAt: null, rev: 3, at: now })

      expect(pruneTombstones(db, { cutoff: now - 30 * DAY_MS })).toBe(1)
      const ids = db
        .prepare<{ id: string }>('SELECT id FROM plan_items ORDER BY id')
        .all()
        .map((row) => row.id)
      expect(ids).toEqual(['p_live', 'p_new'])
    } finally {
      db.close()
    }
  })

  it('墓碑时间恰好等于 cutoff 时不删（边界用严格小于）', () => {
    const db = fresh()
    try {
      const cutoff = shanghai(2026, 10, 18)
      seedUser(db, 'usr_a', cutoff - 365 * DAY_MS)
      seedPlanItem(db, { id: 'p_edge', userId: 'usr_a', deletedAt: cutoff, rev: 1, at: cutoff })
      expect(pruneTombstones(db, { cutoff })).toBe(0)
      expect(count(db, 'plan_items')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('设备水位：墓碑比设备最后一次联系还新时不删（否则会在那台设备上复活）', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      seedUser(db, 'usr_a', now - 365 * DAY_MS)
      // 设备已经 20 天没联系，比 10 天前的墓碑还早 ⇒ 它还没机会拉到这条删除。
      seedDevice(db, {
        id: 'dev_slow',
        userId: 'usr_a',
        createdAt: now - 200 * DAY_MS,
        lastSeenAt: now - 20 * DAY_MS,
      })
      seedPlanItem(db, { id: 'p_shadow', userId: 'usr_a', deletedAt: now - 10 * DAY_MS, rev: 1, at: now })

      expect(pruneTombstones(db, { cutoff: now - 5 * DAY_MS })).toBe(0)
      expect(count(db, 'plan_items')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('设备水位：设备在墓碑之后联系过就允许删（两块条件同时满足才动手）', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      seedUser(db, 'usr_a', now - 365 * DAY_MS)
      seedDevice(db, {
        id: 'dev_fast',
        userId: 'usr_a',
        createdAt: now - 200 * DAY_MS,
        lastSeenAt: now - 1 * DAY_MS,
      })
      seedPlanItem(db, { id: 'p_ok', userId: 'usr_a', deletedAt: now - 40 * DAY_MS, rev: 1, at: now })
      expect(pruneTombstones(db, { cutoff: now - 30 * DAY_MS })).toBe(1)
    } finally {
      db.close()
    }
  })

  it('已吊销的设备不参与水位', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      seedUser(db, 'usr_a', now - 365 * DAY_MS)
      seedDevice(db, {
        id: 'dev_dead',
        userId: 'usr_a',
        createdAt: now - 300 * DAY_MS,
        lastSeenAt: now - 100 * DAY_MS,
        revokedAt: now - 90 * DAY_MS,
      })
      seedPlanItem(db, { id: 'p_old', userId: 'usr_a', deletedAt: now - 60 * DAY_MS, rev: 1, at: now })
      expect(pruneTombstones(db, { cutoff: now - 30 * DAY_MS })).toBe(1)
    } finally {
      db.close()
    }
  })

  it('水位按账号分别计算：一个账号的慢设备不会拖住另一个账号', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      seedUser(db, 'usr_slow', now - 365 * DAY_MS)
      seedUser(db, 'usr_free', now - 365 * DAY_MS)
      seedDevice(db, {
        id: 'dev_slow',
        userId: 'usr_slow',
        createdAt: now - 200 * DAY_MS,
        lastSeenAt: now - 1 * DAY_MS,
      })
      // usr_slow 的墓碑比设备上次联系更新（1 天前发生过删除）⇒ 保留。
      seedPlanItem(db, { id: 'p_slow', userId: 'usr_slow', deletedAt: now - 1 * DAY_MS, rev: 1, at: now })
      // usr_free 没有设备 ⇒ 只看时间，40 天前的墓碑照删。
      seedPlanItem(db, { id: 'p_free', userId: 'usr_free', deletedAt: now - 40 * DAY_MS, rev: 2, at: now })

      expect(pruneTombstones(db, { cutoff: now - 30 * DAY_MS })).toBe(1)
      const left = db.prepare<{ id: string }>('SELECT id FROM plan_items').all()
      expect(left.map((row) => row.id)).toEqual(['p_slow'])
    } finally {
      db.close()
    }
  })

  it('覆盖所有同步实体表，不只 plan_items', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      const old = now - 100 * DAY_MS
      seedUser(db, 'usr_a', now - 365 * DAY_MS)
      db.prepare(
        `INSERT INTO water_logs (id, user_id, date, time, milliliters, payload_json, updated_at, deleted_at, rev)
         VALUES ('w1','usr_a','2026-08-01','08:00',250,'{}',?,?,1)`,
      ).run(old, old)
      db.prepare(
        `INSERT INTO goals (id, user_id, date, title, enabled, payload_json, updated_at, deleted_at, rev)
         VALUES ('g1','usr_a','2026-08-01','x',1,'{}',?,?,2)`,
      ).run(old, old)
      db.prepare(
        `INSERT INTO long_term_plans (id, user_id, status, payload_json, updated_at, deleted_at, rev)
         VALUES ('l1','usr_a','active','{}',?,?,3)`,
      ).run(old, old)
      expect(pruneTombstones(db, { cutoff: now - 30 * DAY_MS })).toBe(3)
      expect(count(db, 'water_logs')).toBe(0)
      expect(count(db, 'goals')).toBe(0)
      expect(count(db, 'long_term_plans')).toBe(0)
    } finally {
      db.close()
    }
  })

  it('超过一批时循环删完', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      const old = now - 60 * DAY_MS
      seedUser(db, 'usr_a', now - 365 * DAY_MS)
      db.transaction(() => {
        for (let i = 0; i < 1_200; i += 1) {
          seedPlanItem(db, { id: `p_${i}`, userId: 'usr_a', deletedAt: old, rev: i + 1, at: old })
        }
      })
      expect(pruneTombstones(db, { cutoff: now - 30 * DAY_MS, batchSize: 100 })).toBe(1_200)
      expect(count(db, 'plan_items')).toBe(0)
    } finally {
      db.close()
    }
  })
})

describe('pruneSyncOps', () => {
  it('只删过期的幂等记录，返回条数', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      seedSyncOp(db, 'op_old', 'usr_a', now - 60 * DAY_MS)
      seedSyncOp(db, 'op_new', 'usr_a', now - 1 * DAY_MS)
      expect(pruneSyncOps(db, { cutoff: now - 30 * DAY_MS })).toBe(1)
      expect(count(db, 'sync_ops')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('超过一批时循环删完', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      const old = now - 60 * DAY_MS
      db.transaction(() => {
        for (let i = 0; i < 600; i += 1) seedSyncOp(db, `op_${i}`, 'usr_a', old)
      })
      expect(pruneSyncOps(db, { cutoff: now - 30 * DAY_MS, batchSize: 100 })).toBe(600)
    } finally {
      db.close()
    }
  })
})

describe('runSyncRetention', () => {
  function seedOldTombstone(db: Db, now: number): void {
    seedUser(db, 'usr_a', now - 365 * DAY_MS)
    seedPlanItem(db, { id: 'p_old', userId: 'usr_a', deletedAt: now - 40 * DAY_MS, rev: 1, at: now })
    seedSyncOp(db, 'op_old', 'usr_a', now - 40 * DAY_MS)
  }

  it('keepDays 为 0 时跳过，且不留 job_runs 噪声行', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17)
      seedOldTombstone(db, now)
      const outcome = runSyncRetention({ db, config: { syncRetentionDays: 0 }, now: () => now })
      expect(outcome).toEqual({ status: 'skipped', reason: 'disabled' })
      expect(count(db, 'plan_items')).toBe(1)
      expect(count(db, 'job_runs')).toBe(0)
    } finally {
      db.close()
    }
  })

  it('04:00 之前不跑', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17, 3)
      seedOldTombstone(db, now)
      const outcome = runSyncRetention({ db, config: { syncRetentionDays: 30 }, now: () => now })
      expect(outcome).toEqual({ status: 'skipped', reason: 'not-due' })
      expect(count(db, 'plan_items')).toBe(1)
      expect(count(db, 'job_runs')).toBe(0)
    } finally {
      db.close()
    }
  })

  it('到点后删墓碑与幂等记录，并留下 ok 的执行记录', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17, 5)
      seedOldTombstone(db, now)
      const outcome = runSyncRetention({ db, config: { syncRetentionDays: 30 }, now: () => now })
      expect(outcome).toMatchObject({ status: 'pruned', tombstones: 1, syncOps: 1, keepDays: 30 })
      expect(count(db, 'plan_items')).toBe(0)
      expect(count(db, 'sync_ops')).toBe(0)

      const run = db
        .prepare<{ name: string; run_key: string; status: string; user_id: string | null }>(
          'SELECT name, run_key, status, user_id FROM job_runs',
        )
        .get()
      expect(run).toEqual({
        name: SYNC_RETENTION_JOB,
        run_key: '2026-11-17',
        status: 'ok',
        user_id: null,
      })
    } finally {
      db.close()
    }
  })

  it('同一天重复调用不重复删', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17, 5)
      seedOldTombstone(db, now)
      runSyncRetention({ db, config: { syncRetentionDays: 30 }, now: () => now })
      seedPlanItem(db, { id: 'p_old2', userId: 'usr_a', deletedAt: now - 40 * DAY_MS, rev: 9, at: now })
      const second = runSyncRetention({
        db,
        config: { syncRetentionDays: 30 },
        now: () => now + 60_000,
      })
      expect(second).toEqual({ status: 'skipped', reason: 'already-ran' })
      expect(count(db, 'plan_items')).toBe(1)
    } finally {
      db.close()
    }
  })

  it('删除抛错时记 failed，不让进程带着异常退出', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17, 5)
      db.exec('DROP TABLE sync_ops')
      const outcome = runSyncRetention({ db, config: { syncRetentionDays: 30 }, now: () => now })
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

describe('startSyncRetentionScheduler', () => {
  it('启动即尝试一次（补跑当天已过 04:00 的情况），stop 后不再跑', () => {
    const db = fresh()
    try {
      const now = shanghai(2026, 11, 17, 9)
      seedUser(db, 'usr_a', now - 365 * DAY_MS)
      seedPlanItem(db, { id: 'p_old', userId: 'usr_a', deletedAt: now - 45 * DAY_MS, rev: 1, at: now })
      const scheduler = startSyncRetentionScheduler({
        db,
        config: { syncRetentionDays: 30 },
        now: () => now,
        intervalMs: 60_000,
      })
      scheduler.stop()
      expect(count(db, 'plan_items')).toBe(0)
      expect(count(db, 'job_runs')).toBe(1)
    } finally {
      db.close()
    }
  })
})
