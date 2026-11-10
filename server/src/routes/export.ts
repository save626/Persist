import type { FastifyInstance } from 'fastify'
import { createPersistExportFilename } from '@persist/shared/contract/export'
import { errorBody } from '../contract.js'
import type { Db } from '../db/driver.js'
import { buildAccountExport } from '../export/account-export.js'
import type { RateLimiter } from '../rate-limit.js'
import { enforceRateLimit, requireDevice } from './guards.js'

/**
 * GET /api/v1/export（步骤 14c）。
 * 只读当前设备所属账号，输出客户端 0.3.0 可导入的完整业务数据；
 * 响应不缓存，并以附件文件名下载。
 */

export interface ExportRouteOptions {
  db: Db
  limiter: RateLimiter
  now: () => number
}

export function registerExportRoutes(app: FastifyInstance, options: ExportRouteOptions): void {
  app.get('/api/v1/export', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return
    const auth = requireDevice(options.db, request, reply, options.now)
    if (!auth) return

    try {
      const exportedAt = new Date(options.now()).toISOString()
      const body = buildAccountExport(options.db, auth.userId, exportedAt)
      return reply
        .header('cache-control', 'no-store')
        .header(
          'content-disposition',
          `attachment; filename="${createPersistExportFilename(exportedAt)}"`,
        )
        .type('application/json; charset=utf-8')
        .code(200)
        .send(body)
    } catch (error) {
      request.log.error({ err: error }, 'account export failed')
      return reply
        .header('cache-control', 'no-store')
        .code(500)
        .send(errorBody('export_failed', '导出失败，请稍后重试。'))
    }
  })
}
