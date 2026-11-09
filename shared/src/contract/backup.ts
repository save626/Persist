import type { ParseResult } from './parse.js'

/**
 * 备份恢复契约（步骤 14b）。
 *
 * 快照文件名本身是服务端生成的稳定 id（例如 persist-20261107-030055-scheduled.sqlite），
 * 不额外引入数据库主键；这样 CLI 生成的快照与 HTTP 恢复看到的是同一份标识。
 */

export interface BackupRecordCounts {
  profile: number
  settings: number
  planItems: number
  studyRecords: number
  fitnessSessions: number
  dietEntries: number
  waterLogs: number
  goals: number
  longTermPlans: number
  reports: number
  devices: number
  syncOps: number
}

export interface BackupDatabaseSummary {
  schemaVersion: number
  counts: BackupRecordCounts
}

export interface BackupSnapshotInfo {
  id: string
  bytes: number
  createdAt: number
  sha256: string
  schemaVersion: number
}

export interface RestorePreview {
  backup: BackupSnapshotInfo
  current: BackupDatabaseSummary
  restored: BackupDatabaseSummary
}

export interface PreRestoreBackupInfo {
  file: string
  bytes: number
  sha256: string
  createdAt: number
}

export interface BackupRestoreBody {
  /** 只有显式 true 才执行替换；省略或 false 都只返回预览。 */
  confirm?: boolean
}

export interface BackupRestoreResponse {
  restored: boolean
  preview: RestorePreview
  preRestoreBackup?: PreRestoreBackupInfo
  restoredAt?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseBackupRestoreBody(raw: unknown): ParseResult<BackupRestoreBody> {
  if (raw === undefined || raw === null) return { ok: true, value: {} }
  if (!isRecord(raw)) return { ok: false, message: '请求体必须是 JSON 对象。' }
  if (raw.confirm !== undefined && typeof raw.confirm !== 'boolean') {
    return { ok: false, message: 'confirm 必须是布尔值。' }
  }
  return { ok: true, value: raw.confirm === true ? { confirm: true } : {} }
}
