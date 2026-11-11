import type { ImportableMockData } from '../types'
import type { AccountDeleteResponse } from '@persist/shared/contract/account'
import {
  DEFAULT_PULL_LIMIT,
  MAX_BOOTSTRAP_ENTITIES,
  type EntityCandidate,
  type PushResult,
} from './sync-contract'
import { nextBackoffMs, SyncRequestError, type SyncClient } from './sync-client'
import {
  applyPulledEntities,
  collectLocalEntities,
  diffLocalEntities,
  hashEntities,
  removedCandidates,
  toCandidates,
} from './sync-entities'
import { SyncQueue, type SyncQueueStorage } from './sync-queue'
import {
  createEmptySyncMeta,
  createOpId,
  type OutboxRecord,
  type SyncMetaRecord,
} from './sync-store'

/**
 * 同步调度器（设计文档 §7.2 / §7.3 / §7.4）。
 *
 * 数据流：本地写入 → 差分 → outbox → push → pull 增量 → 合并回本地。
 * 几条硬约束：
 * - 同步默认关闭；`enabled=false` 时一个请求都不发（本机永远是数据源）。
 * - 网络失败只退避重试，不伪造「已同步」，也不阻塞任何页面操作。
 * - 401 不自动清本地数据、不自动重建账号，只提示「用恢复码重新绑定」。
 * - pull 合并期间抑制本地差分，避免把服务端数据当成新写入再推回去。
 */

/** 写入后 5 秒合并推送；另有 60 秒兜底轮询。 */
export const SYNC_DEBOUNCE_MS = 5_000
export const SYNC_SAFETY_INTERVAL_MS = 60_000

/** UI 只认这三种状态；`error` / `syncing` 是叠加信息，不改变主状态。 */
export type SyncState = '已同步' | '待同步' | '离线' | '未开启'

export interface SyncStatusSnapshot {
  enabled: boolean
  pending: number
  /** 最近一次成功同步的本地时间展示串（`--` 表示还没同步过）。 */
  lastSyncAt: string | null
  online: boolean
  syncing: boolean
  /** 最近一次失败的一句话说明；成功同步后清空。 */
  error: string | null
  /** 令牌失效，需要用户用恢复码重新绑定。 */
  needsAttention: boolean
  state: SyncState
}

export interface SyncEngineDeps {
  client: SyncClient
  metaStorage: {
    loadMeta: () => Promise<SyncMetaRecord>
    saveMeta: (meta: SyncMetaRecord) => Promise<void>
  }
  queueStorage: SyncQueueStorage
  getData: () => ImportableMockData
  applyData: (data: ImportableMockData) => void
  now?: () => number
  random?: () => number
  isOnline?: () => boolean
  /** 状态变化回调；Provider 用它驱动设置页文案。 */
  onChange?: (status: SyncStatusSnapshot) => void
  setTimer?: (handler: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

function formatLastSync(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function describeError(error: unknown): string {
  if (error instanceof SyncRequestError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '同步失败，请稍后重试。'
}

export class SyncEngine {
  private readonly deps: SyncEngineDeps
  private meta: SyncMetaRecord = createEmptySyncMeta()
  private queue: SyncQueue
  private syncing = false
  private accountDeleting = false
  private applyingRemote = false
  private retryAttempt = 0
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private lastError: string | null = null
  /** 正常同步完成也会保留的提示（例如跳过了格式不合法的记录）。 */
  private warning: string | null = null
  private needsAttention = false
  private started = false
  private readonly onOnline = () => {
    void this.flush('online')
  }
  private readonly onOffline = () => {
    this.error = null
    this.emit()
  }
  private readonly onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void this.flush('visibility')
    }
  }

  private error: string | null = null
  /** `noteDataChange` 的串行链：先落 outbox 再推进基线，任何一步失败都不吞掉后续变更。 */
  private noteChain: Promise<void> = Promise.resolve()

  constructor(deps: SyncEngineDeps) {
    this.deps = deps
    this.queue = new SyncQueue(deps.queueStorage, createOpId)
  }

  // ---------------------------------------------------------------------------
  // 生命周期
  // ---------------------------------------------------------------------------

  async init(): Promise<SyncStatusSnapshot> {
    this.meta = await this.deps.metaStorage.loadMeta()
    await this.queue.load()
    this.emit()
    return this.status()
  }

  /** 绑定浏览器事件并做首次拉取；Provider 挂载后调用一次。 */
  start(): void {
    if (this.started) return
    this.started = true
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline)
      window.addEventListener('offline', this.onOffline)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility)
    }
    this.intervalTimer = setInterval(() => {
      void this.flush('interval')
    }, SYNC_SAFETY_INTERVAL_MS)
    if (this.meta.enabled && this.meta.token) void this.flush('start')
  }

  stop(): void {
    this.started = false
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline)
      window.removeEventListener('offline', this.onOffline)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility)
    }
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.intervalTimer = null
    this.clearDebounce()
    this.clearRetry()
  }

  // ---------------------------------------------------------------------------
  // 状态
  // ---------------------------------------------------------------------------

  private get online(): boolean {
    if (this.deps.isOnline) return this.deps.isOnline()
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
    return true
  }

  status(): SyncStatusSnapshot {
    const pending = this.queue.pendingCount
    const enabled = this.meta.enabled && Boolean(this.meta.token)
    let state: SyncState
    if (!enabled) state = '未开启'
    else if (!this.online) state = '离线'
    else if (pending > 0) state = '待同步'
    else state = '已同步'
    return {
      enabled,
      pending,
      lastSyncAt: formatLastSync(this.meta.lastSyncAt),
      online: this.online,
      syncing: this.syncing,
      error: this.error ?? this.lastError ?? this.warning,
      needsAttention: this.needsAttention,
      state,
    }
  }

  private emit(): void {
    this.deps.onChange?.(this.status())
  }

  getMeta(): Readonly<SyncMetaRecord> {
    return { ...this.meta }
  }

  get recoveryCode(): string | null {
    return this.meta.recoveryCode
  }

  get deviceLabel(): string {
    return this.meta.deviceLabel
  }

  // ---------------------------------------------------------------------------
  // 开关 / 绑定
  // ---------------------------------------------------------------------------

  /**
   * 打开同步。第一次打开会注册账号并做一次全量上传；
   * 已经绑定过的设备只是重新打开开关，随后补发 outbox。
   */
  async enable(deviceLabel: string): Promise<void> {
    this.error = null
    this.lastError = null
    this.needsAttention = false
    if (this.meta.token) {
      this.meta = { ...this.meta, enabled: true, deviceLabel }
      await this.saveMeta()
      this.emit()
      // 关闭同步期间产生的本地写入（当时没进 outbox）在这里补差分。
      this.noteDataChange()
      await this.flush('enable')
      return
    }

    const registered = await this.deps.client.register({ label: deviceLabel })
    this.meta = {
      ...this.meta,
      enabled: true,
      userId: registered.userId,
      deviceId: registered.deviceId,
      token: registered.token,
      recoveryCode: registered.recoveryCode,
      deviceLabel,
      bootstrapDone: false,
      lastPulledRev: 0,
      entityTimes: {},
      entityHashes: {},
    }
    await this.saveMeta()
    this.emit()
    await this.flush('enable')
  }

  /** 关闭同步：停止一切网络活动，保留本机数据与已存的凭据，方便再次打开。 */
  async disable(): Promise<void> {
    this.meta = { ...this.meta, enabled: false }
    await this.saveMeta()
    this.clearDebounce()
    this.clearRetry()
    this.syncing = false
    this.emit()
  }

  /** 用恢复码把本机绑定到已有账号：服务端数据为准，从 rev 0 全量拉。 */
  async restore(recoveryCode: string, deviceLabel: string): Promise<void> {
    const credentials = await this.deps.client.restore({ recoveryCode, label: deviceLabel })
    // 换账号前先丢弃旧账号的待发变更，避免把 A 账号的写入推给 B 账号。
    await this.queue.clear()
    this.meta = {
      ...this.meta,
      enabled: true,
      userId: credentials.userId,
      deviceId: credentials.deviceId,
      token: credentials.token,
      deviceLabel,
      bootstrapDone: true,
      lastPulledRev: 0,
      entityTimes: {},
      entityHashes: {},
    }
    await this.saveMeta()
    this.emit()
    await this.flush('restore')
  }

  /** 吊销本机令牌并关闭同步；本机数据保持不动。 */
  async revokeDevice(): Promise<void> {
    const token = this.meta.token
    if (token) await this.deps.client.revoke(token, {})
    // 本机可能还有没发出去的变更：账号已吊销，直接作废队列，避免下次开启时串号。
    await this.queue.clear()
    this.meta = {
      ...this.meta,
      enabled: false,
      userId: null,
      deviceId: null,
      token: null,
      recoveryCode: null,
      bootstrapDone: false,
      lastPulledRev: 0,
      entityTimes: {},
      entityHashes: {},
    }
    await this.saveMeta()
    this.clearDebounce()
    this.clearRetry()
    this.emit()
  }

  /**
   * 删除当前服务端账号。成功后清空同步凭据与 outbox，但业务数据保持不动；
   * Provider 会在本方法成功后继续执行本机数据清空。
   */
  async deleteAccount(): Promise<AccountDeleteResponse> {
    const token = this.meta.token
    if (!token) throw new Error('当前没有已绑定的服务端账号。')
    if (this.syncing) throw new Error('正在同步，请稍后再删除账号。')

    this.accountDeleting = true
    this.clearDebounce()
    this.clearRetry()
    try {
      await this.noteChain
      const result = await this.deps.client.deleteAccount(token)
      await this.queue.clear()
      this.meta = createEmptySyncMeta()
      await this.saveMeta()
      this.syncing = false
      this.retryAttempt = 0
      this.lastError = null
      this.error = null
      this.warning = null
      this.needsAttention = false
      this.emit()
      return result
    } finally {
      this.accountDeleting = false
    }
  }

  // ---------------------------------------------------------------------------
  // 本地写入 → outbox
  // ---------------------------------------------------------------------------

  /**
   * 业务数据变了：算差分、进 outbox、5 秒后合并推送。
   * 同名写法在 Provider 的持久化 effect 里调用，不在页面里散落。
   *
   * 顺序：先落 outbox，再推进本地基线。中途被打断最多重复发送（服务端按 opId 幂等），
   * 不会出现「基线说已同步、实际根本没发出去」的静默丢数据。
   */
  noteDataChange(): void {
    if (!this.meta.enabled || !this.meta.token) return
    if (this.accountDeleting) return
    if (this.applyingRemote) return

    const entities = collectLocalEntities(this.deps.getData())
    const diff = diffLocalEntities(entities, this.meta.entityHashes)
    if (diff.changed.length === 0 && diff.removed.length === 0) return

    const now = this.now()
    const candidates: EntityCandidate[] = [
      ...toCandidates(diff.changed, now),
      ...removedCandidates(diff.removed, now),
    ]

    this.noteChain = this.noteChain
      .then(async () => {
        await this.queue.enqueue(candidates, now)
        const entityHashes = { ...this.meta.entityHashes }
        const entityTimes = { ...this.meta.entityTimes }
        for (const candidate of candidates) {
          const key = `${candidate.kind}:${candidate.id}`
          entityTimes[key] = now
          const hash = diff.hashes[key]
          if (hash) entityHashes[key] = hash
          else delete entityHashes[key]
        }
        this.meta = { ...this.meta, entityHashes, entityTimes }
        await this.saveMeta()
      })
      .catch(() => {
        // 队列写失败只会让这批变更留在基线之外，下次写入会重新差分；不要把异常抛给 UI。
      })
      .then(() => this.emit())

    this.scheduleDebounce()
  }

  private scheduleDebounce(): void {
    this.clearDebounce()
    this.debounceTimer = (this.deps.setTimer ?? setTimeout)(() => {
      this.debounceTimer = null
      void this.flush('debounce')
    }, SYNC_DEBOUNCE_MS)
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      ;(this.deps.clearTimer ?? clearTimeout)(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      ;(this.deps.clearTimer ?? clearTimeout)(this.retryTimer)
      this.retryTimer = null
    }
  }

  private scheduleRetry(): void {
    this.clearRetry()
    const delay = nextBackoffMs(this.retryAttempt, this.deps.random)
    this.retryAttempt += 1
    this.retryTimer = (this.deps.setTimer ?? setTimeout)(() => {
      this.retryTimer = null
      void this.flush('retry')
    }, delay)
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private async saveMeta(): Promise<void> {
    await this.deps.metaStorage.saveMeta(this.meta)
  }

  // ---------------------------------------------------------------------------
  // 同步主体
  // ---------------------------------------------------------------------------

  /** 手动「立即同步」与定时触发共用；并发调用会直接复用当前这次。 */
  async flush(_reason: string): Promise<SyncStatusSnapshot> {
    if (this.accountDeleting) return this.status()
    if (this.syncing) return this.status()
    if (!this.meta.enabled || !this.meta.token) return this.status()
    if (!this.online) {
      this.error = null
      this.emit()
      return this.status()
    }
    if (this.needsAttention) return this.status()

    // 让本次 flush 看到最新的 outbox（例如用户刚写完就点「立即同步」）。
    await this.noteChain

    this.syncing = true
    this.error = null
    this.warning = null
    this.emit()
    const token = this.meta.token
    try {
      if (!this.meta.bootstrapDone) await this.bootstrap(token)
      await this.pushPending(token)
      await this.pullAll(token)

      // 恢复码绑定以服务端为准：拉取完成后把当前本地数据整体记为基线。
      // 服务端没有、只存在本机上的记录留在本机，但不再自动推给这个账号。
      if (_reason === 'restore') {
        const entities = collectLocalEntities(this.deps.getData())
        const now = this.now()
        this.meta = {
          ...this.meta,
          entityHashes: hashEntities(entities),
          entityTimes: Object.fromEntries(
            entities.map((entity) => [`${entity.kind}:${entity.id}`, now]),
          ),
        }
      }

      this.meta = { ...this.meta, lastSyncAt: new Date(this.now()).toISOString() }
      await this.saveMeta()
      this.retryAttempt = 0
      this.lastError = null
      this.error = null
    } catch (error) {
      this.lastError = describeError(error)
      this.error = this.lastError
      if (error instanceof SyncRequestError) {
        if (error.kind === 'unauthorized') {
          this.needsAttention = true
          this.error = '设备令牌已失效，请用恢复码重新绑定本机。'
          this.clearRetry()
        } else if (error.retryable) {
          this.scheduleRetry()
        } else {
          this.error = `本地有一条变更无法同步：${error.message}`
        }
      } else {
        this.scheduleRetry()
      }
    } finally {
      this.syncing = false
      this.emit()
    }
    return this.status()
  }

  private async bootstrap(token: string): Promise<void> {
    const entities = collectLocalEntities(this.deps.getData())
    if (entities.length > MAX_BOOTSTRAP_ENTITIES) {
      throw new SyncRequestError(
        'invalid',
        `本机有 ${entities.length} 条记录，超过首次全量上传上限 ${MAX_BOOTSTRAP_ENTITIES} 条。`,
      )
    }
    const now = this.now()
    const result = await this.deps.client.bootstrap(token, {
      entities: toCandidates(entities, now),
    })
    this.absorbSkips(result)
    this.meta = {
      ...this.meta,
      bootstrapDone: true,
      entityHashes: hashEntities(entities),
      entityTimes: Object.fromEntries(
        entities.map((entity) => [`${entity.kind}:${entity.id}`, now]),
      ),
    }
    await this.saveMeta()
  }

  private async pushPending(token: string): Promise<void> {
    const batches = await this.queue.prepareBatches()
    for (const batch of batches) {
      try {
        const result = await this.deps.client.push(token, {
          opId: batch.opId,
          entities: batch.entities,
        })
        this.absorbSkips(result)
        await this.queue.completeBatch(batch)
      } catch (error) {
        if (
          error instanceof SyncRequestError &&
          !error.retryable &&
          error.kind !== 'unauthorized'
        ) {
          // 请求本身不合法：留着记录等用户处理，但不要无限重试同一批。
          await this.queue.parkBatch(batch)
          throw error
        }
        throw error
      }
    }
    await this.saveMeta()
  }

  private async pullAll(token: string): Promise<void> {
    for (let round = 0; round < 100; round += 1) {
      const response = await this.deps.client.pull(token, {
        since: this.meta.lastPulledRev,
        limit: DEFAULT_PULL_LIMIT,
      })
      if (response.entities.length > 0) {
        const merged = applyPulledEntities(
          this.deps.getData(),
          response.entities,
          this.meta.entityTimes,
          this.now(),
        )
        if (merged.applied > 0) {
          this.applyingRemote = true
          try {
            this.deps.applyData(merged.data)
          } finally {
            this.applyingRemote = false
          }
        }
        this.meta = {
          ...this.meta,
          lastPulledRev: Math.max(this.meta.lastPulledRev, response.nextSince),
          entityTimes: merged.times,
          entityHashes: merged.hashes,
        }
        await this.saveMeta()
      } else {
        this.meta = {
          ...this.meta,
          lastPulledRev: Math.max(this.meta.lastPulledRev, response.nextSince),
        }
        await this.saveMeta()
      }
      if (!response.hasMore) break
    }
  }

  private absorbSkips(result: PushResult): void {
    const invalid = result.skipped.filter((entry) => entry.reason === 'invalid')
    if (invalid.length > 0) {
      this.warning = `${invalid.length} 条本地记录无法同步（格式不合法），已跳过。`
    }
  }

  /** 便于单测：当前 outbox 快照（不触发 IO）。 */
  outbox(): OutboxRecord[] {
    return this.queue.snapshot()
  }
}
