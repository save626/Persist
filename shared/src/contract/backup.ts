/**
 * 备份快照契约。
 *
 * 快照文件名本身是服务端生成的稳定 id（例如 persist-20261107-030055-scheduled.sqlite），
 * 不额外引入数据库主键：CLI 生成快照、恢复前预览引用的都是同一份标识。
 *
 * 2026-11-18 起不再有 HTTP 入口，`BackupListItem` / 列表与创建响应 /
 * `BackupRestoreBody` 等只在路由里用到的形状一并移除；备份与恢复只经本机
 * `db/backup-cli.ts` 与 systemd timer 触发。
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

/** 规范快照文件名里允许出现的 reason。 */
export type BackupReason = 'scheduled' | 'manual' | 'pre-restore'

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
