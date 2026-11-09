import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import type {
  BackupDatabaseSummary,
  BackupRecordCounts,
  BackupSnapshotInfo,
  PreRestoreBackupInfo,
  RestorePreview,
} from '@persist/shared/contract/backup'
import {
  checksumPath,
  createBackup,
  integrityCheck,
  listBackups,
  readChecksumSidecar,
  sha256File,
} from './backup.js'
import { openDatabase, type Db } from './driver.js'
import { migrate, SCHEMA_VERSION } from './migrations.js'

/**
 * 步骤 14b：从每日 / 手动快照恢复数据库。
 *
 * 安全顺序（P4 §12）：
 * 1. 只接受备份目录里由服务端命名规则生成的快照，拒绝任何路径拼接；
 * 2. 先校验旁车 sha256，再跑 PRAGMA integrity_check；
 * 3. 预览当前库与快照的 schema / 按账号统计数据，必须显式 confirm 才动作；
 * 4. 恢复前先 VACUUM INTO 一份 pre-restore 快照；
 * 5. 关闭连接 → 同目录临时文件 → 旧库改名 → 新库就位 → 原地重开并迁移；
 * 6. 任一步失败都把旧库改名回来并重开，临时文件清理掉。
 *
 * 恢复的是整个 SQLite 文件（单用户部署），不是只替换某账号的数据。
 */

export type RestoreErrorCode =
  | 'restore_in_memory_unsupported'
  | 'backup_not_found'
  | 'backup_checksum_failed'
  | 'backup_integrity_failed'
  | 'backup_schema_unsupported'
  | 'backup_schema_incomplete'
  | 'backup_user_mismatch'
  | 'pre_restore_backup_failed'
  | 'restore_copy_failed'
  | 'restore_failed'
  | 'restore_rollback_failed'

export class RestoreError extends Error {
  constructor(
    readonly code: RestoreErrorCode,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message)
    this.name = 'RestoreError'
  }
}

export interface RestoreOptions {
  db: Db
  dbPath: string
  backupDir: string
  userId: string
  backupId: string
  now?: () => number
}

export interface RestoreExecution {
  preview: RestorePreview
  preRestoreBackup: PreRestoreBackupInfo
  restoredAt: number
  schemaVersion: number
}

interface SnapshotInspection {
  info: BackupSnapshotInfo
  summary: BackupDatabaseSummary
}

const REQUIRED_V1_TABLES = [
  'users',
  'devices',
  'sync_seq',
  'profiles',
  'settings',
  'plan_items',
  'study_records',
  'fitness_sessions',
  'diet_entries',
  'water_logs',
  'goals',
  'long_term_plans',
  'sync_ops',
] as const

const REQUIRED_V2_TABLES = ['analysis_reports', 'job_runs'] as const

const COUNT_QUERIES = {
  profile: ['profiles', 'deleted_at IS NULL'],
  settings: ['settings', 'deleted_at IS NULL'],
  planItems: ['plan_items', 'deleted_at IS NULL'],
  studyRecords: ['study_records', 'deleted_at IS NULL'],
  fitnessSessions: ['fitness_sessions', 'deleted_at IS NULL'],
  dietEntries: ['diet_entries', 'deleted_at IS NULL'],
  waterLogs: ['water_logs', 'deleted_at IS NULL'],
  goals: ['goals', 'deleted_at IS NULL'],
  longTermPlans: ['long_term_plans', 'deleted_at IS NULL'],
  reports: ['analysis_reports', '1 = 1'],
  devices: ['devices', '1 = 1'],
  syncOps: ['sync_ops', '1 = 1'],
} as const

type CountKey = keyof typeof COUNT_QUERIES

function tableExists(db: Db, table: string): boolean {
  return Boolean(
    db
      .prepare<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  )
}

function countRows(db: Db, table: string, where: string, userId: string): number {
  if (!tableExists(db, table)) return 0
  const row = db
    .prepare<{ total: number }>(
      `SELECT COUNT(*) AS total FROM ${table} WHERE user_id = ? AND ${where}`,
    )
    .get(userId)
  return row ? Number(row.total) : 0
}

function readCounts(db: Db, userId: string): BackupRecordCounts {
  const counts = {} as BackupRecordCounts
  for (const [key, [table, where]] of Object.entries(COUNT_QUERIES) as Array<
    [CountKey, (typeof COUNT_QUERIES)[CountKey]]
  >) {
    counts[key] = countRows(db, table, where, userId)
  }
  return counts
}

function readSchemaVersion(db: Db): number {
  if (!tableExists(db, 'schema_migrations')) return 0
  const row = db
    .prepare<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_migrations')
    .get()
  return row?.version ? Number(row.version) : 0
}

function missingRequiredTables(db: Db, schemaVersion: number): string[] {
  const required =
    schemaVersion >= 2 ? [...REQUIRED_V1_TABLES, ...REQUIRED_V2_TABLES] : REQUIRED_V1_TABLES
  return required.filter((table) => !tableExists(db, table))
}

function userExists(db: Db, userId: string): boolean {
  if (!tableExists(db, 'users')) return false
  return Boolean(
    db
      .prepare<{ id: string }>('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL')
      .get(userId),
  )
}

function summary(db: Db, userId: string): BackupDatabaseSummary {
  return { schemaVersion: readSchemaVersion(db), counts: readCounts(db, userId) }
}

function inspectSnapshot(options: RestoreOptions): SnapshotInspection {
  const entry = listBackups(options.backupDir).find(
    (candidate) => candidate.name === options.backupId,
  )
  if (!entry) {
    throw new RestoreError('backup_not_found', '备份不存在或文件名不符合快照命名规则。', 404)
  }

  const sha256 = readChecksumSidecar(entry.path, entry.name)
  if (!sha256) {
    throw new RestoreError('backup_checksum_failed', '备份旁车校验失败，拒绝恢复。', 409)
  }

  let integrity: string
  try {
    integrity = integrityCheck(entry.path)
  } catch {
    throw new RestoreError('backup_integrity_failed', '备份无法打开或完整性校验失败。', 409)
  }
  if (integrity !== 'ok') {
    throw new RestoreError('backup_integrity_failed', `备份完整性校验失败：${integrity}`, 409)
  }

  let snapshotDb: Db | null = null
  try {
    snapshotDb = openDatabase({ path: entry.path, readOnly: true })
    const schemaVersion = readSchemaVersion(snapshotDb)
    if (schemaVersion <= 0 || schemaVersion > SCHEMA_VERSION) {
      throw new RestoreError(
        'backup_schema_unsupported',
        `备份 schema 版本 ${schemaVersion} 不受当前服务端支持（当前 ${SCHEMA_VERSION}）。`,
        409,
      )
    }
    const missing = missingRequiredTables(snapshotDb, schemaVersion)
    if (missing.length > 0) {
      throw new RestoreError(
        'backup_schema_incomplete',
        `备份缺少必要数据表：${missing.join('、')}，拒绝恢复。`,
        409,
      )
    }
    if (!userExists(snapshotDb, options.userId)) {
      throw new RestoreError('backup_user_mismatch', '该备份不包含当前账号，拒绝恢复。', 409)
    }
    const restored = summary(snapshotDb, options.userId)
    return {
      info: {
        id: entry.name,
        bytes: entry.bytes,
        createdAt: entry.createdAt,
        sha256,
        schemaVersion,
      },
      summary: { ...restored, schemaVersion },
    }
  } catch (error) {
    if (error instanceof RestoreError) throw error
    throw new RestoreError('backup_integrity_failed', '备份内容无法读取，拒绝恢复。', 409)
  } finally {
    snapshotDb?.close()
  }
}

/** 只读预览：验证快照并对比当前库与快照中的账号数据量。 */
export function previewRestore(options: RestoreOptions): RestorePreview {
  if (options.dbPath === ':memory:') {
    throw new RestoreError('restore_in_memory_unsupported', '内存库不支持快照恢复。', 409)
  }
  const snapshot = inspectSnapshot(options)
  let current: BackupDatabaseSummary
  try {
    current = summary(options.db, options.userId)
  } catch {
    throw new RestoreError('restore_failed', '当前数据库无法读取，拒绝恢复。', 500)
  }
  return { backup: snapshot.info, current, restored: snapshot.summary }
}

function removeSidecars(dbPath: string): void {
  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
}

function restoreOldDatabase(
  db: Db,
  dbPath: string,
  rollbackPath: string,
  busyTimeoutMs: number | undefined,
): void {
  try {
    // 恢复后的新连接可能仍打开着目标文件；先关掉，Windows 才允许替换回旧库。
    db.close()
    if (existsSync(rollbackPath)) {
      rmSync(dbPath, { force: true })
      renameSync(rollbackPath, dbPath)
    }
    removeSidecars(dbPath)
    db.reopen({ path: dbPath, ...(busyTimeoutMs === undefined ? {} : { busyTimeoutMs }) })
  } catch {
    throw new RestoreError(
      'restore_rollback_failed',
      '恢复失败且自动回滚未能重开数据库，请立即停止服务并从 pre-restore 快照人工恢复。',
      500,
    )
  }
}

export interface ExecuteRestoreOptions extends RestoreOptions {
  busyTimeoutMs?: number
}

/** 执行恢复。调用方必须先展示 preview 并要求用户显式 confirm。 */
export function executeRestore(options: ExecuteRestoreOptions): RestoreExecution {
  const preview = previewRestore(options)
  const nowMs = (options.now ?? Date.now)()
  let preRestoreBackup: PreRestoreBackupInfo
  try {
    const created = createBackup({
      dbPath: options.dbPath,
      backupDir: options.backupDir,
      now: nowMs,
      reason: 'pre-restore',
      retain: false,
    })
    preRestoreBackup = {
      file: created.file,
      bytes: created.bytes,
      sha256: created.sha256,
      createdAt: created.createdAt,
    }
  } catch {
    throw new RestoreError('pre_restore_backup_failed', '恢复前自动备份失败，已取消恢复。', 500)
  }

  const token = `${process.pid}-${randomUUID()}`
  const tempPath = `${options.dbPath}.restore-new-${token}`
  const rollbackPath = `${options.dbPath}.restore-old-${token}`
  let closedForSwap = false

  try {
    copyFileSync(joinBackupPath(options.backupDir, preview.backup.id), tempPath)
    if (sha256File(tempPath) !== preview.backup.sha256) {
      throw new RestoreError('restore_copy_failed', '恢复临时文件校验失败，已取消恢复。', 500)
    }
    if (integrityCheck(tempPath) !== 'ok') {
      throw new RestoreError('restore_copy_failed', '恢复临时文件完整性校验失败，已取消恢复。', 500)
    }

    options.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    options.db.close()
    closedForSwap = true
    removeSidecars(options.dbPath)

    renameSync(options.dbPath, rollbackPath)
    renameSync(tempPath, options.dbPath)
    options.db.reopen({
      path: options.dbPath,
      ...(options.busyTimeoutMs === undefined ? {} : { busyTimeoutMs: options.busyTimeoutMs }),
    })
    const migrated = migrate(options.db, { now: () => nowMs })
    const missing = missingRequiredTables(options.db, migrated.version)
    if (missing.length > 0 || migrated.version <= 0 || !userExists(options.db, options.userId)) {
      throw new RestoreError('restore_failed', '恢复后的数据库校验失败，正在回滚。', 500)
    }

    preview.restored.schemaVersion = migrated.version
    try {
      rmSync(rollbackPath, { force: true })
    } catch {
      // 旧库文件清理失败不影响已完成的恢复；下次运维可人工删除该临时文件。
    }
    return {
      preview,
      preRestoreBackup,
      restoredAt: nowMs,
      schemaVersion: migrated.version,
    }
  } catch (error) {
    if (closedForSwap) {
      restoreOldDatabase(options.db, options.dbPath, rollbackPath, options.busyTimeoutMs)
    }
    if (error instanceof RestoreError) throw error
    throw new RestoreError('restore_failed', '恢复失败，当前数据库已回滚。', 500)
  } finally {
    try {
      rmSync(tempPath, { force: true })
    } catch {
      // 临时文件清理失败不覆盖真正的恢复结果。
    }
    try {
      rmSync(checksumPath(tempPath), { force: true })
    } catch {
      // 同上。
    }
  }
}

function joinBackupPath(backupDir: string, id: string): string {
  // inspectSnapshot 已把 id 限定为 listBackups 返回的规范文件名；这里再拼一次路径。
  const entry = listBackups(backupDir).find((candidate) => candidate.name === id)
  if (!entry) throw new RestoreError('backup_not_found', '备份不存在。', 404)
  return entry.path
}
