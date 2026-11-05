import { describe, expect, it } from 'vitest'
import { SyncQueue, type SyncQueueStorage } from './sync-queue'
import type { EntityCandidate } from './sync-contract'
import type { OutboxRecord } from './sync-store'

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

function record(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
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

/** 内存版存储：模拟按 id upsert / 删除。 */
function createStorage(initial: OutboxRecord[] = []): SyncQueueStorage & {
  snapshot: () => OutboxRecord[]
} {
  let records = initial.map((item) => ({ ...item }))
  return {
    async loadOutbox() {
      return records.map((item) => ({ ...item }))
    },
    async saveOutbox(next) {
      for (const item of next) {
        const index = records.findIndex((existing) => existing.id === item.id)
        if (index >= 0) records[index] = { ...item }
        else records.push({ ...item })
      }
    },
    async removeOutbox(ids) {
      const remove = new Set(ids)
      records = records.filter((item) => !remove.has(item.id))
    },
    snapshot: () => records,
  }
}

describe('SyncQueue', () => {
  it('load 读出持久化的 outbox', async () => {
    const storage = createStorage([record()])
    const queue = new SyncQueue(storage, () => 'batch-new')
    expect(await queue.load()).toHaveLength(1)
    expect(queue.pendingCount).toBe(1)
  })

  it('enqueue 先加载已有记录再合并，不会覆盖上次会话没发完的变更', async () => {
    const storage = createStorage([record({ id: 'old', entityId: 'goal-9' })])
    const queue = new SyncQueue(storage, () => 'batch-new')

    expect(await queue.enqueue([candidate()], 2_000)).toBe(2)
    expect(
      storage
        .snapshot()
        .map((item) => item.entityId)
        .sort(),
    ).toEqual(['goal-1', 'goal-9'])
  })

  it('同一实体的多次变更合并成一条', async () => {
    const storage = createStorage()
    const queue = new SyncQueue(storage, () => 'batch-new')

    await queue.enqueue([candidate({ updatedAt: 1_000 })], 1_000)
    await queue.enqueue([candidate({ updatedAt: 2_000 })], 2_000)

    expect(queue.pendingCount).toBe(1)
    expect(storage.snapshot()[0]?.updatedAt).toBe(2_000)
  })

  it('prepareBatches 写入 batchOpId 并持久化；重试沿用同一 opId', async () => {
    const storage = createStorage()
    let counter = 0
    const queue = new SyncQueue(storage, () => `batch-${(counter += 1)}`)

    await queue.enqueue([candidate()], 1_000)
    const first = await queue.prepareBatches(500)
    expect(first).toHaveLength(1)
    expect(first[0]?.opId).toBe('batch-1')
    expect(storage.snapshot()[0]?.batchOpId).toBe('batch-1')

    const retry = await queue.prepareBatches(500)
    expect(retry[0]?.opId).toBe('batch-1')

    // 新变更单独组批，不会混进已发过的那批。
    await queue.enqueue([candidate({ id: 'goal-2' })], 2_000)
    const next = await queue.prepareBatches(500)
    expect(next.map((batch) => batch.opId)).toEqual(['batch-1', 'batch-2'])
  })

  it('completeBatch 清账，parkBatch 保留记录但换新批次', async () => {
    const storage = createStorage()
    let counter = 0
    const queue = new SyncQueue(storage, () => `batch-${(counter += 1)}`)
    await queue.enqueue([candidate()], 1_000)

    const [batch] = await queue.prepareBatches(500)
    expect(batch).toBeDefined()
    await queue.parkBatch(batch!)
    expect(storage.snapshot()[0]?.batchOpId).toBeUndefined()
    const [retried] = await queue.prepareBatches(500)
    expect(retried?.opId).toBe('batch-2')

    await queue.completeBatch(retried!)
    expect(queue.pendingCount).toBe(0)
    expect(storage.snapshot()).toHaveLength(0)
  })

  it('clear 清空内存与持久化队列，不动其他数据', async () => {
    const storage = createStorage([record(), record({ id: 'op-2', entityId: 'goal-2' })])
    const queue = new SyncQueue(storage, () => 'batch-new')
    await queue.load()

    await queue.clear()

    expect(queue.pendingCount).toBe(0)
    expect(storage.snapshot()).toHaveLength(0)
  })

  it('按上限切批，批内实体数量不超过上限', async () => {
    const storage = createStorage()
    const queue = new SyncQueue(storage, () => 'batch-x')
    const candidates = Array.from({ length: 5 }, (_unused, index) =>
      candidate({ id: `goal-${index}` }),
    )
    await queue.enqueue(candidates, 1_000)

    const batches = await queue.prepareBatches(2)
    expect(batches.map((batch) => batch.entities.length)).toEqual([2, 2, 1])
    expect(batches.every((batch) => batch.recordIds.length === batch.entities.length)).toBe(true)
  })
})
