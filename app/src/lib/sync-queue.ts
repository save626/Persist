import { MAX_PUSH_ENTITIES, type EntityCandidate } from './sync-contract'
import {
  groupOutboxBatches,
  mergeOutbox,
  toPushEntities,
  type OutboxBatch,
  type OutboxRecord,
} from './sync-store'

/**
 * outbox 的待发队列（设计文档 §7.2 / §7.3）。
 *
 * 这一层把「哪些变更还没发出去」管起来：合并同实体、组批、成功后清账。
 * 只做内存 + 持久化两件事，不关心退避与 UI；网络在 sync-client，调度在 sync-engine。
 */

/** 队列依赖的持久化能力；测试里换成内存实现即可。 */
export interface SyncQueueStorage {
  loadOutbox: () => Promise<OutboxRecord[]>
  saveOutbox: (records: OutboxRecord[]) => Promise<void>
  removeOutbox: (ids: string[]) => Promise<void>
}

export interface PushBatch {
  opId: string
  entities: ReturnType<typeof toPushEntities>
  recordIds: string[]
}

export class SyncQueue {
  private records: OutboxRecord[] = []
  private loaded = false
  private readonly storage: SyncQueueStorage
  private readonly createBatchId: () => string

  constructor(storage: SyncQueueStorage, createBatchId: () => string) {
    this.storage = storage
    this.createBatchId = createBatchId
  }

  async load(): Promise<OutboxRecord[]> {
    this.records = await this.storage.loadOutbox()
    this.loaded = true
    return this.records.slice()
  }

  /** 未加载时先读一次，避免把新变更覆盖掉上次会话没发完的记录。 */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  get pendingCount(): number {
    return this.records.length
  }

  snapshot(): OutboxRecord[] {
    return this.records.slice()
  }

  /** 合并新变更并落盘；返回合并后的待发条数。 */
  async enqueue(candidates: EntityCandidate[], queuedAt: number): Promise<number> {
    if (candidates.length === 0) return this.pendingCount
    await this.ensureLoaded()
    const before = new Map(this.records.map((record) => [record.id, record]))
    const next = mergeOutbox(this.records, candidates, queuedAt)
    const changed = next.filter((record) => {
      const previous = before.get(record.id)
      return (
        !previous ||
        previous.updatedAt !== record.updatedAt ||
        previous.deleted !== record.deleted ||
        previous.batchOpId !== record.batchOpId
      )
    })
    this.records = next
    await this.storage.saveOutbox(changed)
    return this.records.length
  }

  /**
   * 取下一批要发的变更：已有 opId 的批次优先重发（服务端按 opId 幂等），
   * 新记录现组批并把 opId 写回 outbox，重试时沿用同一个 opId。
   */
  async prepareBatches(maxEntities: number = MAX_PUSH_ENTITIES): Promise<PushBatch[]> {
    await this.ensureLoaded()
    if (this.records.length === 0) return []
    const batches = groupOutboxBatches(this.records, Math.max(1, maxEntities), this.createBatchId)
    const touched: OutboxRecord[] = []
    const result: PushBatch[] = batches.map((batch: OutboxBatch) => {
      for (const record of batch.records) {
        if (!record.batchOpId) {
          record.batchOpId = batch.opId
          touched.push(record)
        }
      }
      return {
        opId: batch.opId,
        entities: toPushEntities(batch.records),
        recordIds: batch.records.map((record) => record.id),
      }
    })
    if (touched.length > 0) await this.storage.saveOutbox(touched)
    return result
  }

  /** 一批推送成功（含服务端幂等重放）后清账。 */
  async completeBatch(batch: PushBatch): Promise<void> {
    const remove = new Set(batch.recordIds)
    this.records = this.records.filter((record) => !remove.has(record.id))
    await this.storage.removeOutbox(batch.recordIds)
  }

  /**
   * 清空 outbox：换账号/吊销设备后，旧账号的待发变更不能带到新账号。
   * 只清队列，不动业务数据。
   */
  async clear(): Promise<void> {
    await this.ensureLoaded()
    const ids = this.records.map((record) => record.id)
    this.records = []
    if (ids.length > 0) await this.storage.removeOutbox(ids)
  }

  /** 放弃一批（例如服务端判定请求非法）：保留记录以便用户看到「待同步 N」，不再自动重试。 */
  async parkBatch(batch: PushBatch): Promise<void> {
    const parked = this.records
      .filter((record) => batch.recordIds.includes(record.id))
      .map((record) => {
        const next = { ...record }
        delete next.batchOpId
        return next
      })
    if (parked.length === 0) return
    const parkedById = new Map(parked.map((record) => [record.id, record]))
    this.records = this.records.map((record) => parkedById.get(record.id) ?? record)
    await this.storage.saveOutbox(parked)
  }
}
