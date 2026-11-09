import type { FastifyInstance } from 'fastify'
import type { BackupRestoreResponse } from '@persist/shared/contract/backup'
import { parseBackupRestoreBody } from '@persist/shared/contract/backup'
import type { ServerConfig } from '../config.js'
import { errorBody } from '../contract.js'
import type { PersistDatabase } from '../db/index.js'
import { executeRestore, previewRestore, RestoreError, type RestoreOptions } from '../db/restore.js'
import type { RateLimiter } from '../rate-limit.js'
import { enforceRateLimit, requireDevice } from './guards.js'

/**
 * POST /api/v1/backups/:id/restore（步骤 14b）
 *
 * - 不传 confirm 或 confirm:false：只返回 current / restored 行数预览；
 * - confirm:true：先自动生成 pre-restore 快照，再执行原子恢复；
 * - 所有响应 no-store；鉴权走设备令牌，限流与 /api/v1 其余接口共用。
 *
 * 这里故意不提供 GET /api/v1/backups：按交接约定，快照列表 / 手动创建 HTTP 端点
 * 放在 14b–14d 完成后再补，本步只闭合「已存在的规范快照如何安全恢复」。
 */

export interface BackupRoutesOptions {
  database: PersistDatabase
  config: ServerConfig
  limiter: RateLimiter
  now: () => number
}

export function registerBackupRoutes(app: FastifyInstance, options: BackupRoutesOptions): void {
  let restoring = false

  app.post('/api/v1/backups/:id/restore', async (request, reply) => {
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

      if (restoring) {
        return reply
          .header('cache-control', 'no-store')
          .code(409)
          .send(errorBody('restore_in_progress', '已有恢复任务在执行，请稍后重试。'))
      }
      restoring = true
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
        restoring = false
      }
    }
  })
}
