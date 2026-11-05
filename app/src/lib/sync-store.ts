import { isEntityKind, type EntityCandidate, type EntityKind } from './sync-contract'

/**
 * 同步状态的本地存储（新的 IndexedDB 数据库 `persist-sync`）。
 *
 * 单独一个库、单独一套 key：业务数据在 `persist-app`，同步凭据/outbox 在
 * `persist-sync`。这样「清空本机数据」不会顺手把设备令牌清掉，
 * 而「退出同步」也不用碰业务数据。
 *
 * 纯逻辑（合并 outbox、分批、默认值归一化）都在这里，IDB 读写只是薄封装，
 * 单测只测纯逻辑，避免在 jsdom 里依赖真实 IndexedDB。
 */

export const SYNC_DB_NAME = 'persist-sync'
export const SYNC_DB_VERSION = 1
export const SYNC_META_STORE = 'meta'
export const SYNC_OUTBOX_STORE = 'outbox'
export const SYNC_META_ID = 'persist-sync-meta'

/** 打开数据库的超时时间：浏览器隐私模式下 IndexedDB 可能永远不回调。 */
const SYNC_OPEN_TIMEOUT_MS = 2_000

/** 令牌、恢复码、设备身份。恢复码只在注册/恢复成功后返回一次，由本机保管。 */
export interface SyncMetaRecord {
  id: typeof SYNC_META_ID
  /** 用户是否打开过「数据同步」开关；默认 false，关闭时同步层不发任何请求。 */
  enabled: boolean
  userId: string | null
  deviceId: string | null
  /** 设备令牌（只在本机与请求头里出现，不进业务数据）。 */
  token: string | null
  /** 32 位十六进制恢复码；只用于换机恢复，显示在设置页。 */
  recoveryCode: string | null
  deviceLabel: string
  /** 是否已经做过首次全量上传；false 时下一次同步先走 bootstrap。 */
  bootstrapDone: boolean
  /** pull 游标：已经合并到本地的最大 `rev`。 */
  lastPulledRev: number
  /** 最近一次成功同步的时间（ISO 字符串，仅用于展示）。 */
  lastSyncAt: string | null
  /** 每个实体最近一次本地写入时间（`entityKey → ms`），LWW 用。 */
  entityTimes: Record<string, number>
  /** 每个实体最近一次写入内容的哈希，用来做差分。 */
  entityHashes: Record<string, string>
}

/** 一条待推送的本地变更。`batchOpId` 在首次组批时写入，重试复用同一个 opId。 */
export interface OutboxRecord {
  id: string
  /** 首次组批时写入的推送 opId；服务端按 opId 幂等。 */
  batchOpId?: string
  kind: EntityKind
  entityId: string
  updatedAt: number
  deleted: boolean
  data?: unknown
  queuedAt: number
}

export function createEmptySyncMeta(): SyncMetaRecord {
  return {
    id: SYNC_META_ID,
    enabled: false,
    userId: null,
    deviceId: null,
    token: null,
    recoveryCode: null,
    deviceLabel: '',
    bootstrapDone: false,
    lastPulledRev: 0,
    lastSyncAt: null,
    entityTimes: {},
    entityHashes: {},
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readStringRecord(value: unknown): Record<string, string> {
  const record = readRecord(value)
  if (!record) return {}
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') result[key] = entry
  }
  return result
}

function readNumberRecord(value: unknown): Record<string, number> {
  const record = readRecord(value)
  if (!record) return {}
  const result: Record<string, number> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) result[key] = entry
  }
  return result
}

/**
 * 把从 IndexedDB 读出来的任意值归一化成合法 meta。
 * 升级/手改/半写坏的数据都不该让同步层直接崩，缺字段一律回默认值。
 */
export function normalizeSyncMeta(raw: unknown): SyncMetaRecord {
  const base = createEmptySyncMeta()
  const record = readRecord(raw)
  if (!record) return base
  const lastPulledRev =
    typeof record.lastPulledRev === 'number' && Number.isFinite(record.lastPulledRev)
      ? Math.max(0, Math.trunc(record.lastPulledRev))
      : 0
  return {
    ...base,
    enabled: record.enabled === true,
    userId: typeof record.userId === 'string' ? record.userId : null,
    deviceId: typeof record.deviceId === 'string' ? record.deviceId : null,
    token: typeof record.token === 'string' ? record.token : null,
    recoveryCode: typeof record.recoveryCode === 'string' ? record.recoveryCode : null,
    deviceLabel: typeof record.deviceLabel === 'string' ? record.deviceLabel : '',
    bootstrapDone: record.bootstrapDone === true,
    lastPulledRev,
    lastSyncAt: typeof record.lastSyncAt === 'string' ? record.lastSyncAt : null,
    entityTimes: readNumberRecord(record.entityTimes),
    entityHashes: readStringRecord(record.entityHashes),
  }
}

/** 归一化一条 outbox 记录；脏数据返回 null，由调用方丢弃。 */
export function normalizeOutboxRecord(raw: unknown): OutboxRecord | null {
  const record = readRecord(raw)
  if (!record) return null
  if (typeof record.kind !== 'string' || !isEntityKind(record.kind)) return null
  if (typeof record.entityId !== 'string') return null
  if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) return null
  return {
    id: typeof record.id === 'string' ? record.id : createOpId(),
    ...(typeof record.batchOpId === 'string' ? { batchOpId: record.batchOpId } : {}),
    kind: record.kind,
    entityId: record.entityId,
    updatedAt: record.updatedAt,
    deleted: record.deleted === true,
    ...(record.data === undefined ? {} : { data: record.data }),
    queuedAt:
      typeof record.queuedAt === 'number' && Number.isFinite(record.queuedAt)
        ? record.queuedAt
        : Date.now(),
  }
}

export function outboxKey(kind: EntityKind, entityId: string): string {
  return `${kind}:${entityId}`
}

/** 浏览器 / Node 都有 `crypto.randomUUID`；没有时退回时间戳 + 随机串（仅保证本机唯一）。 */
export function createOpId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 把新变更合并进 outbox：同一实体的旧记录被新记录替换（只留最新一次写入）。
 *
 * - `updatedAt` 更早的变更直接忽略（乱序回调不该把新值写回旧值）；
 * - 新建 + 删除出现在同一轮时，删除胜出（墓碑必须发出去）；
 * - 已在 outbox 里的记录保持原 opId 顺序，重试语义不变。
 */
export function mergeOutbox(
  existing: OutboxRecord[],
  candidates: EntityCandidate[],
  queuedAt: number,
): OutboxRecord[] {
  const next = existing.slice()
  for (const candidate of candidates) {
    if (!candidate.id) continue
    const key = outboxKey(candidate.kind, candidate.id)
    const index = next.findIndex((record) => outboxKey(record.kind, record.entityId) === key)
    if (index >= 0) {
      const current = next[index]
      if (!current || candidate.updatedAt < current.updatedAt) continue
      if (candidate.updatedAt === current.updatedAt && !candidate.deleted) continue
      const merged: OutboxRecord = {
        ...current,
        updatedAt: candidate.updatedAt,
        deleted: candidate.deleted === true,
        queuedAt,
      }
      if (candidate.deleted) delete merged.data
      else merged.data = candidate.data
      // 内容变了就必须换一个新批次，不能沿用可能已被服务端应用过的旧 opId。
      delete merged.batchOpId
      next[index] = merged
      continue
    }
    const record: OutboxRecord = {
      id: createOpId(),
      kind: candidate.kind,
      entityId: candidate.id,
      updatedAt: candidate.updatedAt,
      deleted: candidate.deleted === true,
      ...(candidate.deleted ? {} : { data: candidate.data }),
      queuedAt,
    }
    next.push(record)
  }
  return next
}

export interface OutboxBatch {
  opId: string
  records: OutboxRecord[]
}

/**
 * 把 outbox 切成可推送的批次：已经带上 `batchOpId` 的记录必须按原批次重试
 * （服务端按 opId 幂等，换了 opId 会把已应用过的变更再应用一遍），
 * 新记录现组批并写回 opId。
 */
export function groupOutboxBatches(
  records: OutboxRecord[],
  maxEntities: number,
  createBatchId: () => string = createOpId,
): OutboxBatch[] {
  const batches: OutboxBatch[] = []
  const byOpId = new Map<string, OutboxRecord[]>()
  for (const record of records) {
    if (!record.batchOpId) continue
    const group = byOpId.get(record.batchOpId) ?? []
    group.push(record)
    byOpId.set(record.batchOpId, group)
  }
  for (const [opId, group] of byOpId) batches.push({ opId, records: group })

  const fresh = records.filter((record) => !record.batchOpId)
  for (let index = 0; index < fresh.length; index += maxEntities) {
    batches.push({
      opId: createBatchId(),
      records: fresh.slice(index, index + maxEntities),
    })
  }
  return batches
}

/** outbox 记录 → push 请求里的 entities。 */
export function toPushEntities(records: OutboxRecord[]): Array<{
  kind: EntityKind
  id: string
  updatedAt: number
  deleted: boolean
  data?: unknown
}> {
  return records.map((record) => ({
    kind: record.kind,
    id: record.entityId,
    updatedAt: record.updatedAt,
    deleted: record.deleted,
    ...(record.deleted ? {} : { data: record.data }),
  }))
}

interface SyncDatabaseHandlers {
  loadMeta: () => Promise<SyncMetaRecord>
  saveMeta: (meta: SyncMetaRecord) => Promise<void>
  loadOutbox: () => Promise<OutboxRecord[]>
  saveOutbox: (records: OutboxRecord[]) => Promise<void>
  removeOutbox: (ids: string[]) => Promise<void>
  clear: () => Promise<void>
}

let cachedDb: IDBDatabase | null = null
let openPromise: Promise<IDBDatabase | null> | null = null

function openDatabase(): Promise<IDBDatabase | null> {
  if (cachedDb) return Promise.resolve(cachedDb)
  if (openPromise) return openPromise
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  openPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false
    const timer = setTimeout(() => finish(null), SYNC_OPEN_TIMEOUT_MS)

    function finish(db: IDBDatabase | null) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      openPromise = null
      if (db) cachedDb = db
      resolve(db)
    }

    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(SYNC_DB_NAME, SYNC_DB_VERSION)
    } catch {
      finish(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SYNC_META_STORE)) {
        db.createObjectStore(SYNC_META_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(SYNC_OUTBOX_STORE)) {
        db.createObjectStore(SYNC_OUTBOX_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => finish(request.result)
    request.onerror = () => finish(null)
    request.onblocked = () => finish(null)
  })
  return openPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | null> {
  const db = await openDatabase()
  if (!db) return null
  try {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    const request = action(store)
    const result = request ? await requestToPromise(request) : null
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    })
    return result
  } catch {
    return null
  }
}

/** IndexedDB 读写封装；环境不支持时全部安全降级（同步层据此显示「暂不可用」）。 */
export function createSyncStore(): SyncDatabaseHandlers {
  return {
    async loadMeta() {
      const raw = await withStore(SYNC_META_STORE, 'readonly', (store) => store.get(SYNC_META_ID))
      return normalizeSyncMeta(raw)
    },
    async saveMeta(meta) {
      await withStore(SYNC_META_STORE, 'readwrite', (store) => store.put(meta))
    },
    async loadOutbox() {
      const raw = await withStore(SYNC_OUTBOX_STORE, 'readonly', (store) => store.getAll())
      if (!Array.isArray(raw)) return []
      return raw
        .map((record) => normalizeOutboxRecord(record))
        .filter((record): record is OutboxRecord => record !== null)
    },
    async saveOutbox(records) {
      if (records.length === 0) return
      await withStore(SYNC_OUTBOX_STORE, 'readwrite', (store) => {
        for (const record of records) store.put(record)
      })
    },
    async removeOutbox(ids) {
      if (ids.length === 0) return
      await withStore(SYNC_OUTBOX_STORE, 'readwrite', (store) => {
        for (const id of ids) store.delete(id)
      })
    },
    async clear() {
      await withStore(SYNC_META_STORE, 'readwrite', (store) => store.clear())
      await withStore(SYNC_OUTBOX_STORE, 'readwrite', (store) => store.clear())
    },
  }
}

/** 测试用：清掉缓存的连接，避免跨用例复用。 */
export function resetSyncStoreForTests(): void {
  cachedDb = null
  openPromise = null
}
