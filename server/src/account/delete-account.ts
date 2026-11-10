import { existsSync, rmSync } from 'node:fs'
import type { AccountDeleteResponse, AccountDeletionCounts } from '@persist/shared/contract/account'
import { checksumPath, listBackups } from '../db/backup.js'
import type { Db } from '../db/driver.js'
import { countActiveUsers } from '../db/repositories/devices.js'

/**
 * 14d：硬删除当前账号及其服务端数据。
 *
 * 数据库内的删除全部在一个 `BEGIN IMMEDIATE` 事务里完成；任何一步失败都整体回滚。
 * 备份是整库快照，不能按账号局部裁剪，因此只要还有其他 active 账号且存在规范快照，
 * 就拒绝删除，避免为了删一个账号而毁掉别人的可恢复副本。
 */

export type AccountDeleteErrorCode =
  'account_delete_blocked' | 'account_not_found' | 'backup_cleanup_failed'

export class AccountDeleteError extends Error {
  constructor(
    readonly code: AccountDeleteErrorCode,
    message: string,
    readonly statusCode = 409,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AccountDeleteError'
  }
}

export interface DeleteAccountOptions {
  db: Db
  backupDir: string
  userId: string
  now: () => number
}

const ENTITY_TABLES = [
  'profiles',
  'settings',
  'plan_items',
  'study_records',
  'fitness_sessions',
  'diet_entries',
  'water_logs',
  'goals',
  'long_term_plans',
] as const

function countRows(db: Db, table: string, userId: string): number {
  const row = db
    .prepare<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE user_id = ?`)
    .get(userId)
  return row ? Number(row.total) : 0
}

function deleteRows(db: Db, table: string, userId: string): number {
  return db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId).changes
}

function removeBackupFiles(backupDir: string): number {
  let removed = 0
  for (const entry of listBackups(backupDir)) {
    const sidecar = checksumPath(entry.path)
    for (const path of [sidecar, entry.path]) {
      if (!existsSync(path)) continue
      try {
        rmSync(path, { force: true })
        removed += 1
      } catch (error) {
        throw new AccountDeleteError(
          'backup_cleanup_failed',
          '账号数据已删除，但备份文件清理未完成，请检查服务端日志。',
          500,
          { cause: error },
        )
      }
    }
  }
  return removed
}

export function deleteAccount(options: DeleteAccountOptions): AccountDeleteResponse {
  const snapshots = listBackups(options.backupDir)
  if (snapshots.length > 0 && countActiveUsers(options.db) > 1) {
    throw new AccountDeleteError(
      'account_delete_blocked',
      '当前数据库还有其他 active 账号，且整库快照无法按账号拆分；为避免删除他人可恢复数据，已拒绝删除。',
      409,
    )
  }

  const deletedAt = Math.trunc(options.now())
  const counts = options.db.transaction<AccountDeletionCounts>(() => {
    const next: AccountDeletionCounts = {
      profile: countRows(options.db, 'profiles', options.userId),
      settings: countRows(options.db, 'settings', options.userId),
      planItems: countRows(options.db, 'plan_items', options.userId),
      studyRecords: countRows(options.db, 'study_records', options.userId),
      fitnessSessions: countRows(options.db, 'fitness_sessions', options.userId),
      dietEntries: countRows(options.db, 'diet_entries', options.userId),
      waterLogs: countRows(options.db, 'water_logs', options.userId),
      goals: countRows(options.db, 'goals', options.userId),
      longTermPlans: countRows(options.db, 'long_term_plans', options.userId),
      analysisReports: countRows(options.db, 'analysis_reports', options.userId),
      jobRuns: countRows(options.db, 'job_runs', options.userId),
      syncOps: countRows(options.db, 'sync_ops', options.userId),
      devices: countRows(options.db, 'devices', options.userId),
      backupFiles: 0,
    }

    for (const table of ENTITY_TABLES) deleteRows(options.db, table, options.userId)
    deleteRows(options.db, 'analysis_reports', options.userId)
    deleteRows(options.db, 'job_runs', options.userId)
    deleteRows(options.db, 'sync_ops', options.userId)
    deleteRows(options.db, 'devices', options.userId)
    const deletedUsers = options.db.prepare('DELETE FROM users WHERE id = ?').run(options.userId)
    if (deletedUsers.changes !== 1) {
      throw new AccountDeleteError('account_not_found', '账号不存在或已被删除。', 409)
    }
    return next
  })

  counts.backupFiles = removeBackupFiles(options.backupDir)
  return { deleted: true, deletedAt, counts }
}
