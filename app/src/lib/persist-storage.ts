import type { ImportableMockData, MockSnapshot } from '../types'
import {
  PERSIST_STATE_DB_NAME,
  PERSIST_STATE_RECORD_ID,
  PERSIST_STATE_SCHEMA_VERSION,
  PERSIST_STATE_STORE_NAME,
  createPersistedStateRecord,
  readPersistedSchemaVersion,
  readPersistedState,
  type PersistedState,
} from './persist-state'

/**
 * 本地存储层：只负责 IndexedDB 的打开、读写与降级，业务规则全在 lib/persist-state.ts。
 * 不用 Dexie：这里只需要「一条记录 + 一个版本号」，原生 IndexedDB 足够，
 * 也避免给前端包再加一个运行时依赖；若将来需要多表查询，可替换本文件而不动上层。
 */
export type PersistLoadStatus =
  'loaded' | 'empty' | 'unavailable' | 'corrupt' | 'unsupported-version'

export type PersistLoadResult = {
  status: PersistLoadStatus
  state: PersistedState | null
}

const DB_VERSION = 1
/** IndexedDB 打开超时：隐私模式/被策略禁用时不能让整页一直空白。 */
const DB_OPEN_TIMEOUT_MS = 2_000

let databasePromise: Promise<IDBDatabase | null> | null = null

/** jsdom、隐私模式、被浏览器策略禁用时是没有 indexedDB 的，此时整个 App 退回纯内存。 */
export function isPersistStorageSupported() {
  return typeof indexedDB !== 'undefined'
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!isPersistStorageSupported()) return Promise.resolve(null)
  if (databasePromise) return databasePromise

  databasePromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false
    const finish = (database: IDBDatabase | null) => {
      if (settled) return
      settled = true
      resolve(database)
    }

    const timer = setTimeout(() => finish(null), DB_OPEN_TIMEOUT_MS)
    try {
      const request = indexedDB.open(PERSIST_STATE_DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(PERSIST_STATE_STORE_NAME)) {
          database.createObjectStore(PERSIST_STATE_STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onblocked = () => {
        clearTimeout(timer)
        finish(null)
      }
      request.onerror = () => {
        clearTimeout(timer)
        finish(null)
      }
      request.onsuccess = () => {
        clearTimeout(timer)
        const database = request.result
        database.onversionchange = () => database.close()
        finish(database)
      }
    } catch {
      clearTimeout(timer)
      finish(null)
    }
  })

  return databasePromise
}

/** 启动时读回上一次的数据；任何失败都只是降级，不会阻塞渲染。 */
export async function loadPersistedState(): Promise<PersistLoadResult> {
  const database = await openDatabase()
  if (!database) return { status: 'unavailable', state: null }

  try {
    const store = database
      .transaction(PERSIST_STATE_STORE_NAME, 'readonly')
      .objectStore(PERSIST_STATE_STORE_NAME)
    const raw: unknown = await requestToPromise(store.get(PERSIST_STATE_RECORD_ID))
    if (raw === undefined || raw === null) return { status: 'empty', state: null }

    const schemaVersion = readPersistedSchemaVersion(raw)
    if (schemaVersion !== null && schemaVersion > PERSIST_STATE_SCHEMA_VERSION) {
      return { status: 'unsupported-version', state: null }
    }

    const state = readPersistedState(raw)
    if (!state) return { status: 'corrupt', state: null }
    return { status: 'loaded', state }
  } catch {
    return { status: 'corrupt', state: null }
  }
}

/** 写入当前状态；返回 false 表示这次没写进去（无存储或事务失败），调用方无需弹错。 */
export async function savePersistedState(
  data: ImportableMockData,
  snapshot: MockSnapshot | null,
): Promise<boolean> {
  const database = await openDatabase()
  if (!database) return false

  try {
    const record = createPersistedStateRecord(data, snapshot)
    const store = database
      .transaction(PERSIST_STATE_STORE_NAME, 'readwrite')
      .objectStore(PERSIST_STATE_STORE_NAME)
    await requestToPromise(store.put(record))
    return true
  } catch {
    return false
  }
}

/** 预留：P4 备份恢复 / 「清空本机数据」会用到，本轮 UI 尚未接入。 */
export async function clearPersistedState(): Promise<void> {
  const database = await openDatabase()
  if (!database) return

  try {
    const store = database
      .transaction(PERSIST_STATE_STORE_NAME, 'readwrite')
      .objectStore(PERSIST_STATE_STORE_NAME)
    await requestToPromise(store.delete(PERSIST_STATE_RECORD_ID))
  } catch {
    // 清空失败不需要打扰用户，下次写入会覆盖。
  }
}
