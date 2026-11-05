import type { Db } from '../db/driver.js'
import { errorBody } from '../contract.js'
import type { RateLimiter } from '../rate-limit.js'
import { parseBootstrapBody, parsePullQuery, parsePushBody } from '@persist/shared/contract/sync'
import {
  SyncOpConflictError,
  applyBootstrap,
  applyPush,
  buildPullResponse,
} from '../sync/service.js'
import { enforceRateLimit, requireDevice } from './guards.js'
import type { FastifyInstance } from 'fastify'

/**
 * 增量同步接口（设计文档 §7.2 / §10）。
 *
 * 语义边界：
 * - push / bootstrap 的 LWW 冲突由服务端裁决，冲突项以 skipped 返回，不算错误；
 * - pull 是纯读，按 rev 游标翻页，墓碑也会出现（deleted: true）；
 * - 鉴权失败一律 401，不泄露账号是否存在。
 */

export interface SyncRouteOptions {
  db: Db
  limiter: RateLimiter
  now: () => number
}

/** bootstrap 是首次全量上传，单独放宽请求体上限；其余接口仍是全局 256 KB。 */
const BOOTSTRAP_BODY_LIMIT = 8 * 1024 * 1024

export function registerSyncRoutes(app: FastifyInstance, options: SyncRouteOptions): void {
  app.post(
    '/api/v1/sync/bootstrap',
    { bodyLimit: BOOTSTRAP_BODY_LIMIT },
    async (request, reply) => {
      if (!enforceRateLimit(options.limiter, request, reply)) return reply

      const auth = requireDevice(options.db, request, reply, options.now)
      if (!auth) return reply

      const parsed = parseBootstrapBody(request.body)
      if (!parsed.ok) {
        return reply.code(400).send(errorBody('invalid_request', parsed.message))
      }
      return reply.send(applyBootstrap(options.db, auth, parsed.value.entities))
    },
  )

  app.post('/api/v1/sync/push', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return reply

    const auth = requireDevice(options.db, request, reply, options.now)
    if (!auth) return reply

    const parsed = parsePushBody(request.body)
    if (!parsed.ok) {
      return reply.code(400).send(errorBody('invalid_request', parsed.message))
    }

    try {
      return reply.send(applyPush(options.db, auth, parsed.value, options.now))
    } catch (error) {
      if (error instanceof SyncOpConflictError) {
        return reply.code(400).send(errorBody('invalid_request', error.message))
      }
      throw error
    }
  })

  app.get('/api/v1/sync/pull', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return reply

    const auth = requireDevice(options.db, request, reply, options.now)
    if (!auth) return reply

    const parsed = parsePullQuery(request.query)
    if (!parsed.ok) {
      return reply.code(400).send(errorBody('invalid_request', parsed.message))
    }
    return reply
      .header('cache-control', 'no-store')
      .send(buildPullResponse(options.db, auth, parsed.value))
  })
}
