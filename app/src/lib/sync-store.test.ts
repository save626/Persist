import { describe, expect, it } from 'vitest'
import type { EntityCandidate } from './sync-contract'
import {
  createEmptySyncMeta,
  createOpId,
  groupOutboxBatches,
  mergeOutbox,
  normalizeOutboxRecord,
  normalizeSyncMeta,
  outboxKey,
  toPushEntities,
  type OutboxRecord,
  SYNC_META_ID,
} from './sync-store'

function candidate(overrides: Partial<EntityCandidate> = {}): EntityCandidate {
  return {
    kind: 'goal',
    id: 'goal-1',
    updatedAt: 1_000,
    deleted: false,
    data: { id: 'goal-1', title: '目标' },
    ...overrides,
  }
}

function outbox(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: 'op-1',
    kind: 'goal',
    entityId: 'goal-1',
    updatedAt: 1_000,
    deleted: false,
    data: { id: 'goal-1', title: '目标' },
    queuedAt: 1_000,
    ...overrides,
  }
}

describe('meta 归一化', () => {
  it('默认值：同步关闭、没有凭据、游标为 0', () => {
    const meta = createEmptySyncMeta()
    expect(meta.id).toBe(SYNC_META_ID)
    expect(meta.enabled).toBe(false)
    expect(meta.token).toBeNull()
    expect(meta.bootstrapDone).toBe(false)
    expect(meta.lastPulledRev).toBe(0)
    expect(meta.entityHashes).toEqual({})
  })

  it('脏数据回默认值，负数游标被夹到 0', () => {
    const meta = normalizeSyncMeta({
      enabled: 'yes',
      token: 42,
      deviceLabel: '  我的手机  ',
      lastPulledRev: -9,
      lastSyncAt: 123,
      entityTimes: { 'goal:goal-1': 5, bad: 'x' },
      entityHashes: { 'goal:goal-1': 'abc', bad: 1 },
    })
    expect(meta.enabled).toBe(false)
    expect(meta.token).toBeNull()
    expect(meta.deviceLabel).toBe('  我的手机  ')
    expect(meta.lastPulledRev).toBe(0)
    expect(meta.lastSyncAt).toBeNull()
    expect(meta.entityTimes).toEqual({ 'goal:goal-1': 5 })
    expect(meta.entityHashes).toEqual({ 'goal:goal-1': 'abc' })
  })

  it('非对象输入也返回合法默认值', () => {
    expect(normalizeSyncMeta(null)).toEqual(createEmptySyncMeta())
    expect(normalizeSyncMeta('oops')).toEqual(createEmptySyncMeta())
  })
})

describe('outbox 记录归一化', () => {
  it('缺 id / queuedAt 时补上，保留批次 opId', () => {
    const record = normalizeOutboxRecord({
      kind: 'water_log',
      entityId: 'w1',
      updatedAt: 5,
      deleted: true,
      batchOpId: 'batch-1',
    })
    expect(record).not.toBeNull()
    expect(record?.kind).toBe('water_log')
    expect(record?.batchOpId).toBe('batch-1')
    expect(typeof record?.id).toBe('string')
    expect(typeof record?.queuedAt).toBe('number')
  })

  it('未知 kind、缺 updatedAt 的记录直接丢弃', () => {
    expect(normalizeOutboxRecord({ kind: 'report', entityId: 'r1', updatedAt: 1 })).toBeNull()
    expect(normalizeOutboxRecord({ kind: 'goal', entityId: 'g1' })).toBeNull()
    expect(normalizeOutboxRecord(null)).toBeNull()
  })
})

describe('mergeOutbox', () => {
  it('新实体追加，同一实体只保留最新一次写入', () => {
    const first = mergeOutbox([], [candidate()], 1_100)
    expect(first).toHaveLength(1)
    expect(first[0]?.batchOpId).toBeUndefined()

    const second = mergeOutbox(
      first,
      [candidate({ updatedAt: 2_000, data: { id: 'goal-1', title: '新' } })],
      2_100,
    )
    expect(second).toHaveLength(1)
    expect(second[0]?.updatedAt).toBe(2_000)
    expect(second[0]?.data).toEqual({ id: 'goal-1', title: '新' })
  })

  it('内容变化会作废旧批次，避免复用已应用过的 opId', () => {
    const existing = outbox({ batchOpId: 'batch-old' })
    const merged = mergeOutbox([existing], [candidate({ updatedAt: 3_000 })], 3_100)
    expect(merged[0]?.batchOpId).toBeUndefined()
  })

  it('更早的变更被忽略；同一时间戳的删除胜出', () => {
    const existing = outbox({ updatedAt: 5_000 })
    expect(mergeOutbox([existing], [candidate({ updatedAt: 4_000 })], 6_000)[0]?.updatedAt).toBe(
      5_000,
    )

    const deleted = mergeOutbox([existing], [candidate({ updatedAt: 5_000, deleted: true })], 6_000)
    expect(deleted[0]?.deleted).toBe(true)
    expect(deleted[0]?.data).toBeUndefined()
  })

  it('不同实体互不影响', () => {
    const merged = mergeOutbox(
      [outbox()],
      [candidate({ kind: 'water_log', id: 'w1', data: { id: 'w1' } })],
      2_000,
    )
    expect(merged.map((record) => outboxKey(record.kind, record.entityId))).toEqual([
      'goal:goal-1',
      'water_log:w1',
    ])
  })
})

describe('groupOutboxBatches', () => {
  it('已带 opId 的记录按原批次重发，新记录按上限切批', () => {
    let counter = 0
    const createId = () => `new-${(counter += 1)}`
    const records = [
      outbox({ id: 'a', batchOpId: 'batch-x' }),
      outbox({ id: 'b', kind: 'water_log', entityId: 'w1' }),
      outbox({ id: 'c', entityId: 'goal-2' }),
      outbox({ id: 'd', entityId: 'goal-3' }),
      outbox({ id: 'e', batchOpId: 'batch-x' }),
    ]
    const batches = groupOutboxBatches(records, 2, createId)

    expect(batches[0]?.opId).toBe('batch-x')
    expect(batches[0]?.records.map((record) => record.id)).toEqual(['a', 'e'])
    expect(batches.slice(1).map((batch) => batch.opId)).toEqual(['new-1', 'new-2'])
    expect(batches[1]?.records.map((record) => record.id)).toEqual(['b', 'c'])
    expect(batches[2]?.records.map((record) => record.id)).toEqual(['d'])
  })

  it('空 outbox 返回空批次列表', () => {
    expect(groupOutboxBatches([], 100)).toEqual([])
  })
})

describe('toPushEntities', () => {
  it('墓碑不带 data', () => {
    const [entity] = toPushEntities([outbox({ deleted: true, data: undefined })])
    expect(entity).toEqual({ kind: 'goal', id: 'goal-1', updatedAt: 1_000, deleted: true })
  })
})

describe('createOpId', () => {
  it('返回非空且互不相同的 id', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createOpId()))
    expect(ids.size).toBe(20)
    expect([...ids].every((id) => id.length > 0)).toBe(true)
  })
})
