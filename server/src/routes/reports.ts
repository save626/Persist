import type { FastifyInstance } from 'fastify'
import { errorBody } from '../contract.js'
import type { Db } from '../db/driver.js'
import {
  decodeReportCursor,
  getReport,
  listReports,
  toDetail,
  type ListReportsResult,
} from '../db/repositories/reports.js'
import { enforceRateLimit, requireDevice } from './guards.js'
import type { RateLimiter } from '../rate-limit.js'
import type { AnalysisReportsListResponse } from '@persist/shared/contract/analysis'

/**
 * 报告归档查询（步骤 13）。
 *
 * - GET /api/v1/reports?limit=&cursor=  按创建时间倒序，游标分页（`createdAt:id`）；
 * - GET /api/v1/reports/:id             单份报告（含正文与指标）。
 *
 * 两个接口都只读、走同步限流（客户端打开报告页时会连发两次），不占综合分析额度。
 */

export interface ReportRoutesOptions {
  db: Db
  limiter: RateLimiter
  now: () => number
}

export function registerReportArchiveRoutes(
  app: FastifyInstance,
  options: ReportRoutesOptions,
): void {
  app.get('/api/v1/reports', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return
    const auth = requireDevice(options.db, request, reply, options.now)
    if (!auth) return

    const query = (request.query ?? {}) as Record<string, unknown>
    let limit: number | undefined
    if (query.limit !== undefined) {
      limit = Number(query.limit)
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return reply
          .header('cache-control', 'no-store')
          .code(422)
          .send(errorBody('invalid_request', 'limit 必须是 1–50 的整数。'))
      }
    }
    const cursor = typeof query.cursor === 'string' ? query.cursor : null
    if (cursor !== null && decodeReportCursor(cursor) === null) {
      return reply
        .header('cache-control', 'no-store')
        .code(422)
        .send(errorBody('invalid_request', 'cursor 格式不对。'))
    }

    const result: ListReportsResult = listReports(options.db, auth.userId, {
      ...(limit === undefined ? {} : { limit }),
      cursor,
    })
    const body: AnalysisReportsListResponse = {
      reports: result.reports,
      nextCursor: result.nextCursor,
    }
    return reply.header('cache-control', 'no-store').code(200).send(body)
  })

  app.get('/api/v1/reports/:id', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return
    const auth = requireDevice(options.db, request, reply, options.now)
    if (!auth) return

    const params = (request.params ?? {}) as Record<string, unknown>
    const id = typeof params.id === 'string' ? params.id : ''
    const report = id ? getReport(options.db, auth.userId, id) : null
    if (!report) {
      return reply
        .header('cache-control', 'no-store')
        .code(404)
        .send(errorBody('not_found', '报告不存在或已过保留期。'))
    }
    return reply.header('cache-control', 'no-store').code(200).send(toDetail(report))
  })
}
