import type { FastifyInstance } from 'fastify'
import type {
  BackupCreateResponse,
  BackupListItem,
  BackupListResponse,
  BackupRestoreResponse,
} from '@persist/shared/contract/backup'
import { parseBackupRestoreBody } from '@persist/shared/contract/backup'
import type { ServerConfig } from '../config.js'
import { errorBody } from '../contract.js'
import type { PersistDatabase } from '../db/index.js'
import {
  BackupCreateError,
  createBackup,
  listBackups,
  readChecksumSidecar,
  type BackupEntry,
} from '../db/backup.js'
import { executeRestore, previewRestore, RestoreError, type RestoreOptions } from '../db/restore.js'
import type { RateLimiter } from '../rate-limit.js'
import { enforceRateLimit, requireDevice } from './guards.js'

/**
 * 备份 HTTP 路由：
 *
 * - GET  /api/v1/backups：列出规范快照，不返回服务端路径；
 * - POST /api/v1/backups：立即生成 manual 快照并按配置执行保留清理；
 * - POST /api/v1/backups/:id/restore（步骤 14b）：预览或显式确认后恢复。
 *
 * 恢复不传 confirm 或 confirm:false 时只返回计数预览；confirm:true 才执行。
 * 所有响应 no-store；鉴权走设备令牌，限流与 /api/v1 其余接口共用。
 */

export interface BackupRoutesOptions {
  database: PersistDatabase
  config: ServerConfig
  limiter: RateLimiter
  now: () => number
}

function toListItem(entry: BackupEntry): BackupListItem {
  let sha256: string | null = null
  try {
    sha256 = readChecksumSidecar(entry.path, entry.name)
  } catch {
    // 旁车不可读时仍列出快照；恢复路径会再次严格校验并拒绝不可用快照。
  }
  return {
    id: entry.name,
    bytes: entry.bytes,
    createdAt: entry.createdAt,
    reason: entry.reason,
    sha256,
  }
}

export function registerBackupRoutes(app: FastifyInstance, options: BackupRoutesOptions): void {
  let operationInProgress = false

  app.get('/api/v1/backups', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    if (!enforceRateLimit(options.limiter, request, reply)) return
    const auth = requireDevice(options.database.db, request, reply, options.now)
    if (!auth) return

    const body: BackupListResponse = {
      backups: listBackups(options.config.backupDir).map(toListItem),
    }
    return reply.code(200).send(body)
  })

  app.post('/api/v1/backups', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    if (!enforceRateLimit(options.limiter, request, reply)) return
    const auth = requireDevice(options.database.db, request, reply, options.now)
    if (!auth) return

    if (operationInProgress) {
      return reply
        .code(409)
        .send(errorBody('backup_in_progress', '已有备份操作在执行，请稍后重试。'))
    }

    operationInProgress = true
    try {
      const created = createBackup({
        dbPath: options.database.path,
        backupDir: options.config.backupDir,
        now: options.now(),
        reason: 'manual',
        policy: {
          keepDays: options.config.backupKeepDays,
          keepWeeks: options.config.backupKeepWeeks,
          keepMonths: options.config.backupKeepMonths,
        },
      })
      const body: BackupCreateResponse = {
        backup: {
          id: created.file,
          bytes: created.bytes,
          createdAt: created.createdAt,
          reason: created.reason,
          sha256: created.sha256,
        },
      }
      return reply.code(201).send(body)
    } catch (error) {
      if (error instanceof BackupCreateError) {
        if (error.code === 'memory_database') {
          return reply
            .code(409)
            .send(errorBody('backup_unavailable', '当前数据库不支持生成文件快照。'))
        }
        return reply
          .code(409)
          .send(errorBody('backup_already_exists', '同一秒已生成过快照，请稍后重试。'))
      }
      request.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'backup create failed',
      )
      return reply
        .code(500)
        .send(errorBody('backup_create_failed', '创建快照失败，请检查服务端日志。'))
    } finally {
      operationInProgress = false
    }
  })

  app.post('/api/v1/backups/:id/restore', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    if (!enforceRateLimit(options.limiter, request, reply)) return
    const auth = requireDevice(options.database.db, request, reply, options.now)
    if (!auth) return

    const parsed = parseBackupRestoreBody(request.body)
    if (!parsed.ok) {
      return reply
        .header('cache-control', 'no-store')
        .code(422)
        .send(errorBody('invalid_request', parsed.message))
    }

    const params = (request.params ?? {}) as Record<string, unknown>
    const backupId = typeof params.id === 'string' ? params.id : ''
    const restoreOptions: RestoreOptions = {
      db: options.database.db,
      dbPath: options.database.path,
      backupDir: options.config.backupDir,
      userId: auth.userId,
      backupId,
      now: options.now,
    }

    let claimedRestore = false
    try {
      if (parsed.value.confirm !== true) {
        const preview = previewRestore(restoreOptions)
        const body: BackupRestoreResponse = { restored: false, preview }
        return reply.header('cache-control', 'no-store').code(200).send(body)
      }

      if (operationInProgress) {
        return reply
          .code(409)
          .send(errorBody('restore_in_progress', '已有恢复任务在执行，请稍后重试。'))
      }
      operationInProgress = true
      claimedRestore = true
      const result = executeRestore({
        ...restoreOptions,
        busyTimeoutMs: options.config.dbBusyTimeoutMs,
      })
      options.database.schemaVersion = result.schemaVersion
      const body: BackupRestoreResponse = {
        restored: true,
        preview: result.preview,
        preRestoreBackup: result.preRestoreBackup,
        restoredAt: result.restoredAt,
      }
      return reply.header('cache-control', 'no-store').code(200).send(body)
    } catch (error) {
      if (error instanceof RestoreError) {
        return reply
          .header('cache-control', 'no-store')
          .code(error.statusCode)
          .send(errorBody(error.code, error.message))
      }
      request.log.error({ err: error }, 'backup restore failed')
      return reply
        .header('cache-control', 'no-store')
        .code(500)
        .send(errorBody('restore_failed', '恢复失败，请检查服务端日志。'))
    } finally {
      if (claimedRestore) {
        operationInProgress = false
      }
    }
  })
}
