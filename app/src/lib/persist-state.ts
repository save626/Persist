import type { ImportableMockData, MockSnapshot } from '../types'
import {
  parseMockBackupValue,
  serializeMockBackup,
  type PersistBackupPayload,
} from './mock-data-transfer'

/** IndexedDB 里只存一条记录，主键固定，后续迁移只改这条记录的形状。 */
export const PERSIST_STATE_RECORD_ID = 'persist-mock-state'
export const PERSIST_STATE_DB_NAME = 'persist-app'
export const PERSIST_STATE_STORE_NAME = 'mock-state'
/**
 * 本地记录结构版本。改动 `PersistedStateRecord` 的形状就必须 +1，
 * 并在下面的 `MIGRATIONS` 里补一条「从旧版本升到该版本」的纯函数。
 */
export const PERSIST_STATE_SCHEMA_VERSION = 1
/** 交互后合并写入的防抖窗口，避免每次输入都开一个 IndexedDB 事务。 */
export const PERSIST_SAVE_DEBOUNCE_MS = 200

/**
 * 本地持久化记录：备份负载 + 快照 + 存储元信息。
 * `backup` 复用导出备份的 0.2.0 结构，因此「本地数据」和「备份文件」走同一套字段校验，
 * 也让后续 P4 的真实备份/恢复可以直接搬运这一层。
 */
export type PersistedStateRecord = {
  id: string
  schemaVersion: number
  savedAt: string
  backup: PersistBackupPayload
  snapshot: MockSnapshot | null
}

export type PersistedState = {
  data: ImportableMockData
  snapshot: MockSnapshot | null
  savedAt: string
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMockSnapshot(value: unknown): value is MockSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.recordCount === 'number' &&
    Number.isFinite(value.recordCount)
  )
}

function readBackupExportedAt(value: unknown): string {
  return isRecord(value) && typeof value.exportedAt === 'string' ? value.exportedAt : ''
}

/** 把当前内存状态打包成待写入 IndexedDB 的记录（纯函数，便于单测）。 */
export function createPersistedStateRecord(
  data: ImportableMockData,
  snapshot: MockSnapshot | null,
  savedAt: Date = new Date(),
): PersistedStateRecord {
  return {
    id: PERSIST_STATE_RECORD_ID,
    schemaVersion: PERSIST_STATE_SCHEMA_VERSION,
    savedAt: savedAt.toISOString(),
    backup: serializeMockBackup(data, savedAt),
    snapshot: snapshot ? { ...snapshot } : null,
  }
}

/**
 * 每条迁移只负责把记录从 version 升到 version + 1，保持纯函数。
 * 版本 0 是「还没有 schemaVersion 字段」的早期记录（只有 backup/snapshot）。
 */
const MIGRATIONS: Record<number, (record: UnknownRecord) => UnknownRecord> = {
  0: (record) => ({
    ...record,
    schemaVersion: 1,
    savedAt:
      typeof record.savedAt === 'string' ? record.savedAt : readBackupExportedAt(record.backup),
  }),
}

function detectSchemaVersion(record: UnknownRecord): number | null {
  if (typeof record.schemaVersion === 'number') {
    return Number.isInteger(record.schemaVersion) && record.schemaVersion >= 0
      ? record.schemaVersion
      : null
  }
  // 没有版本号但带 backup 的记录视为最早的 0 版，交给 MIGRATIONS[0] 补字段。
  return isRecord(record.backup) ? 0 : null
}

/** 读取记录声明的结构版本；用于区分「数据损坏」和「数据来自更新的 App 版本」。 */
export function readPersistedSchemaVersion(raw: unknown): number | null {
  return isRecord(raw) ? detectSchemaVersion(raw) : null
}

/**
 * 把任意读到的对象迁移到当前版本。
 * 未来版本（大于当前）返回 null：宁可这一轮不读，也不要用旧代码覆盖新版数据。
 */
export function migratePersistedStateRecord(raw: unknown): UnknownRecord | null {
  if (!isRecord(raw)) return null
  const version = detectSchemaVersion(raw)
  if (version === null || version > PERSIST_STATE_SCHEMA_VERSION) return null

  let record = raw
  for (let from = version; from < PERSIST_STATE_SCHEMA_VERSION; from += 1) {
    const step = MIGRATIONS[from]
    if (!step) return null
    record = step(record)
  }
  return record
}

/**
 * 把 IndexedDB 读到的原始记录还原成可用的业务数据。
 * 任何校验失败都返回 null（调用方回退到演示数据），不抛错——本地数据永远不该让页面白屏。
 */
export function readPersistedState(raw: unknown): PersistedState | null {
  const record = migratePersistedStateRecord(raw)
  if (!record || record.schemaVersion !== PERSIST_STATE_SCHEMA_VERSION) return null

  try {
    return {
      data: parseMockBackupValue(record.backup),
      snapshot: isMockSnapshot(record.snapshot) ? record.snapshot : null,
      savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
    }
  } catch {
    return null
  }
}
