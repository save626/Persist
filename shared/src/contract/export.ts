/**
 * 服务端全量导出契约（步骤 14c）。
 *
 * `GET /api/v1/export` 返回的对象必须能被当前客户端 0.3.0 的
 * `parseMockBackupValue` 直接导入；因此 `data` 的切片名称与客户端备份一致。
 * `mode: "server-export"` 只说明数据来源，客户端 0.3.0 的导入逻辑不按 mode 做门禁。
 * `schemaVersion: 2` 是服务端数据库结构口径，客户端会忽略这个额外顶层字段。
 */

export const PERSIST_EXPORT_VERSION = '0.3.0'
export const PERSIST_EXPORT_SCHEMA_VERSION = 2
export const PERSIST_EXPORT_MODE = 'server-export'

export type PersistExportRecord = Record<string, unknown>

export interface PersistExportData {
  goals: PersistExportRecord[]
  planItems: PersistExportRecord[]
  waterLog: PersistExportRecord[]
  studyRecords: PersistExportRecord[]
  dietDays: PersistExportRecord[]
  fitnessSession: PersistExportRecord | null
  fitnessHistory: PersistExportRecord[]
  profile: PersistExportRecord
  settings: PersistExportRecord
  aiConsent: boolean
  eveningReview: PersistExportRecord | null
  reports: PersistExportRecord[]
  longTermPlans: PersistExportRecord[]
}

export interface PersistExportEnvelope {
  app: 'Persist'
  version: typeof PERSIST_EXPORT_VERSION
  mode: typeof PERSIST_EXPORT_MODE
  schemaVersion: typeof PERSIST_EXPORT_SCHEMA_VERSION
  exportedAt: string
  data: PersistExportData
}

/** 稳定的下载文件名；只使用 UTC 时分秒，避免不同平台的冒号转义差异。 */
export function createPersistExportFilename(exportedAt: string): string {
  const timestamp = Date.parse(exportedAt)
  if (!Number.isFinite(timestamp)) throw new Error('exportedAt 必须是合法的 ISO 时间字符串。')
  const compact = new Date(timestamp)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `persist-export-${compact}.json`
}
