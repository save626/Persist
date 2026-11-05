import { describe, expect, it } from 'vitest'
import type { Db } from '../src/db/driver.js'
import { openDatabase } from '../src/db/driver.js'
import { EntityDataError, deriveFitnessTotals } from '../src/db/entities.js'
import { migrate } from '../src/db/migrations.js'
import {
  countEntities,
  getEntity,
  pullEntities,
  upsertEntity,
} from '../src/db/repositories/entities.js'
import { allocateRev, currentRev } from '../src/db/repositories/sync-seq.js'
import { countSyncOps, findSyncOp, recordSyncOp } from '../src/db/repositories/sync-ops.js'

const USER = 'usr_1'

function seeded(): Db {
  const db = openDatabase({ path: ':memory:' })
  migrate(db)
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(USER, 1)
  return db
}

const planItem = {
  id: 'plan_1',
  name: '晚间复盘',
  time: '21:00',
  detail: '10 分钟',
  kind: 'default',
  done: false,
  date: '2026-11-05',
}

const studyRecord = {
  id: 'study_1',
  category: 'english',
  source: '百词斩',
  date: '2026-11-05',
  startTime: '08:00',
  duration: 30,
  note: '',
  newWords: 20,
}

describe('upsertEntity', () => {
  it('新增实体：拿到 rev，pull 按原文返回', () => {
    const db = seeded()
    try {
      expect(
        upsertEntity(db, USER, { kind: 'plan_item', updatedAt: 1_000, data: planItem }),
      ).toEqual({
        status: 'applied',
        rev: 1,
      })
      expect(currentRev(db)).toBe(1)

      const pull = pullEntities(db, USER, 0)
      expect(pull.nextSince).toBe(1)
      expect(pull.hasMore).toBe(false)
      expect(pull.entities).toHaveLength(1)
      expect(pull.entities[0]).toMatchObject({
        kind: 'plan_item',
        id: 'plan_1',
        data: planItem,
        deleted: false,
        rev: 1,
      })
    } finally {
      db.close()
    }
  })

  it('LWW：updatedAt 更旧或相等视为 stale，不占新 rev', () => {
    const db = seeded()
    try {
      upsertEntity(db, USER, { kind: 'plan_item', updatedAt: 2_000, data: planItem })

      const older = upsertEntity(db, USER, {
        kind: 'plan_item',
        updatedAt: 1_000,
        data: { ...planItem, done: true },
      })
      expect(older).toEqual({ status: 'stale', rev: 1 })

      const same = upsertEntity(db, USER, {
        kind: 'plan_item',
        updatedAt: 2_000,
        data: { ...planItem, done: true },
      })
      expect(same).toEqual({ status: 'stale', rev: 1 })
      expect(currentRev(db)).toBe(1)
      expect(getEntity(db, USER, 'plan_item', 'plan_1')?.data).toEqual(planItem)
    } finally {
      db.close()
    }
  })

  it('LWW：更新的写入覆盖整行并涨 rev', () => {
    const db = seeded()
    try {
      upsertEntity(db, USER, { kind: 'plan_item', updatedAt: 1_000, data: planItem })
      const result = upsertEntity(db, USER, {
        kind: 'plan_item',
        updatedAt: 2_000,
        data: { ...planItem, done: true },
      })
      expect(result).toEqual({ status: 'applied', rev: 2 })
      expect(getEntity(db, USER, 'plan_item', 'plan_1')).toMatchObject({
        updatedAt: 2_000,
        rev: 2,
        deleted: false,
      })
      expect(
        db.prepare<{ done: number }>('SELECT done FROM plan_items WHERE id = ?').get('plan_1'),
      ).toEqual({ done: 1 })
    } finally {
      db.close()
    }
  })

  it('删除写墓碑：payload 清空，pull 只给 deleted + rev', () => {
    const db = seeded()
    try {
      upsertEntity(db, USER, { kind: 'plan_item', updatedAt: 1_000, data: planItem })
      expect(
        upsertEntity(db, USER, {
          kind: 'plan_item',
          id: 'plan_1',
          updatedAt: 2_000,
          deleted: true,
        }),
      ).toEqual({ status: 'applied', rev: 2 })

      const pull = pullEntities(db, USER, 0)
      expect(pull.entities).toHaveLength(1)
      expect(pull.entities[0]).toMatchObject({ deleted: true, data: null, rev: 2 })
      expect(getEntity(db, USER, 'plan_item', 'plan_1')?.data).toBe(null)
    } finally {
      db.close()
    }
  })

  it('删除服务端从没见过的实体：返回 missing，不写墓碑', () => {
    const db = seeded()
    try {
      expect(
        upsertEntity(db, USER, {
          kind: 'plan_item',
          id: 'plan_missing',
          updatedAt: 1_000,
          deleted: true,
        }),
      ).toEqual({ status: 'missing', rev: 0 })
      expect(currentRev(db)).toBe(0)
      expect(pullEntities(db, USER, 0).entities).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  it('单行实体（profile / settings）以 user 为键覆盖，不产生多行', () => {
    const db = seeded()
    try {
      upsertEntity(db, USER, {
        kind: 'profile',
        updatedAt: 1_000,
        data: { age: 30, goal: '减脂' },
      })
      upsertEntity(db, USER, {
        kind: 'settings',
        updatedAt: 1_000,
        data: { summaryOnly: true, sources: { fitness: true } },
      })
      upsertEntity(db, USER, {
        kind: 'profile',
        updatedAt: 2_000,
        data: { age: 31, goal: '增肌' },
      })

      expect(countEntities(db, USER, 'profile')).toBe(1)
      expect(countEntities(db, USER, 'settings')).toBe(1)
      expect(getEntity(db, USER, 'profile')?.data).toEqual({ age: 31, goal: '增肌' })
      expect(
        db
          .prepare<{ summary_only: number }>('SELECT summary_only FROM settings WHERE user_id = ?')
          .get(USER),
      ).toEqual({ summary_only: 1 })
      const pull = pullEntities(db, USER, 0)
      expect(pull.entities.map((entity) => entity.kind).sort()).toEqual(['profile', 'settings'])
    } finally {
      db.close()
    }
  })

  it('不同用户的数据互不可见', () => {
    const db = seeded()
    try {
      db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('usr_2', 1)
      upsertEntity(db, USER, { kind: 'plan_item', updatedAt: 1_000, data: planItem })
      expect(pullEntities(db, 'usr_2', 0).entities).toHaveLength(0)
      expect(getEntity(db, 'usr_2', 'plan_item', 'plan_1')).toBe(null)
    } finally {
      db.close()
    }
  })
})

describe('pullEntities', () => {
  it('跨实体表按 rev 升序合并返回', () => {
    const db = seeded()
    try {
      upsertEntity(db, USER, { kind: 'plan_item', updatedAt: 1_000, data: planItem })
      upsertEntity(db, USER, { kind: 'study_record', updatedAt: 2_000, data: studyRecord })
      upsertEntity(db, USER, {
        kind: 'diet_entry',
        updatedAt: 3_000,
        data: { id: 'diet_1', date: '2026-11-05', meal: 'lunch', name: '鸡胸饭', calories: 650 },
      })
      expect(pullEntities(db, USER, 0).entities.map((entity) => entity.kind)).toEqual([
        'plan_item',
        'study_record',
        'diet_entry',
      ])
    } finally {
      db.close()
    }
  })

  it('分页：limit 生效，nextSince 可续拉，最后一次 hasMore=false', () => {
    const db = seeded()
    try {
      for (let index = 0; index < 5; index += 1) {
        upsertEntity(db, USER, {
          kind: 'study_record',
          id: `study_${index}`,
          updatedAt: 1_000 + index,
          data: { ...studyRecord, id: `study_${index}` },
        })
      }

      const first = pullEntities(db, USER, 0, 2)
      expect(first.entities.map((entity) => entity.rev)).toEqual([1, 2])
      expect(first.hasMore).toBe(true)
      expect(first.nextSince).toBe(2)

      const second = pullEntities(db, USER, first.nextSince, 2)
      expect(second.entities.map((entity) => entity.rev)).toEqual([3, 4])
      expect(second.hasMore).toBe(true)
      expect(second.nextSince).toBe(4)

      const third = pullEntities(db, USER, second.nextSince, 2)
      expect(third.entities.map((entity) => entity.rev)).toEqual([5])
      expect(third.hasMore).toBe(false)
      expect(third.nextSince).toBe(5)

      expect(pullEntities(db, USER, 5, 2).entities).toHaveLength(0)
    } finally {
      db.close()
    }
  })

  it('since 之后的增量不含旧数据', () => {
    const db = seeded()
    try {
      upsertEntity(db, USER, { kind: 'plan_item', updatedAt: 1_000, data: planItem })
      upsertEntity(db, USER, { kind: 'study_record', updatedAt: 2_000, data: studyRecord })
      const incremental = pullEntities(db, USER, 1)
      expect(incremental.entities).toHaveLength(1)
      expect(incremental.entities[0]?.kind).toBe('study_record')
    } finally {
      db.close()
    }
  })
})

describe('实体校验', () => {
  it('学习记录缺科目、日期非法、饮水时间非法都会被拒（EntityDataError）', () => {
    const db = seeded()
    try {
      const missingCategory = { ...studyRecord, category: undefined }
      expect(() =>
        upsertEntity(db, USER, { kind: 'study_record', updatedAt: 1_000, data: missingCategory }),
      ).toThrow(EntityDataError)

      expect(() =>
        upsertEntity(db, USER, {
          kind: 'study_record',
          updatedAt: 1_000,
          data: { ...studyRecord, date: '2026-02-30' },
        }),
      ).toThrow(EntityDataError)

      expect(() =>
        upsertEntity(db, USER, {
          kind: 'water_log',
          updatedAt: 1_000,
          data: { date: '2026-11-05', time: '9:5', milliliters: 250 },
        }),
      ).toThrow(EntityDataError)

      expect(() =>
        upsertEntity(db, USER, {
          kind: 'water_log',
          updatedAt: 1_000,
          data: { date: '2026-11-05' },
        }),
      ).toThrow(EntityDataError)
    } finally {
      db.close()
    }
  })

  it('未知实体类型与非法 updatedAt 被拒', () => {
    const db = seeded()
    try {
      expect(() =>
        upsertEntity(db, USER, {
          kind: 'nope' as never,
          updatedAt: 1_000,
          data: { date: '2026-11-05' },
        }),
      ).toThrow(EntityDataError)
      expect(() =>
        upsertEntity(db, USER, { kind: 'plan_item', updatedAt: 0, data: planItem }),
      ).toThrow(EntityDataError)
    } finally {
      db.close()
    }
  })
})

describe('训练容量派生列', () => {
  it('只统计 done 的组：容量、时长各自累加', () => {
    expect(
      deriveFitnessTotals([
        {
          sets: [
            { weight: 60, reps: 5, done: true },
            { weight: 60, reps: 5, done: false },
          ],
        },
        { sets: [{ durationMinutes: 2, done: true }] },
      ]),
    ).toEqual({ totalSets: 3, doneSets: 2, volumeKg: 300, durationMinutes: 2, distanceKm: 0 })
  })

  it('fitness_session 落库时拆出 total_sets / done_sets / volume_kg', () => {
    const db = seeded()
    try {
      upsertEntity(db, USER, {
        kind: 'fitness_session',
        id: 'fit_1',
        updatedAt: 1_000,
        data: {
          id: 'fit_1',
          date: '2026-11-05',
          completedAt: '2026-11-05T12:00:00.000Z',
          exercises: [
            {
              id: 'ex_1',
              name: '深蹲',
              sets: [
                { id: 's1', weight: 60, reps: 5, done: true },
                { id: 's2', weight: 65, reps: 5, done: true },
              ],
            },
          ],
        },
      })
      expect(
        db
          .prepare<{ status: string; total_sets: number; done_sets: number; volume_kg: number }>(
            'SELECT status, total_sets, done_sets, volume_kg FROM fitness_sessions WHERE id = ?',
          )
          .get('fit_1'),
      ).toEqual({ status: 'completed', total_sets: 2, done_sets: 2, volume_kg: 625 })
    } finally {
      db.close()
    }
  })
})

describe('sync_ops 幂等表', () => {
  it('记录后可按 opId 取回，计数正确', () => {
    const db = seeded()
    try {
      expect(findSyncOp(db, 'op_1')).toBe(null)
      recordSyncOp(db, {
        opId: 'op_1',
        deviceId: 'dev_1',
        userId: USER,
        appliedAt: 1_700_000_000_000,
        resultJson: '{"results":[]}',
      })
      expect(findSyncOp(db, 'op_1')).toMatchObject({
        opId: 'op_1',
        deviceId: 'dev_1',
        userId: USER,
        appliedAt: 1_700_000_000_000,
        resultJson: '{"results":[]}',
      })
      expect(countSyncOps(db)).toBe(1)
      expect(() =>
        recordSyncOp(db, {
          opId: 'op_1',
          deviceId: 'dev_1',
          userId: USER,
          appliedAt: 1,
          resultJson: '{}',
        }),
      ).toThrow()
    } finally {
      db.close()
    }
  })

  it('allocateRev 单调递增，currentRev 同步更新', () => {
    const db = seeded()
    try {
      expect(currentRev(db)).toBe(0)
      expect(allocateRev(db)).toBe(1)
      expect(allocateRev(db)).toBe(2)
      expect(currentRev(db)).toBe(2)
    } finally {
      db.close()
    }
  })
})
