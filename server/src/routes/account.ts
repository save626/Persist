import type { FastifyInstance } from 'fastify'
import type { AccountDeleteResponse } from '@persist/shared/contract/account'
import { parseAccountDeleteBody } from '@persist/shared/contract/account'
import { AccountDeleteError, deleteAccount } from '../account/delete-account.js'
import { errorBody } from '../contract.js'
import type { Db } from '../db/driver.js'
import type { RateLimiter } from '../rate-limit.js'
import { enforceRateLimit, requireDevice } from './guards.js'

/**
 * DELETE /api/v1/account（步骤 14d）。
 *
 * 先限流、再鉴权、再要求显式 confirm，最后在单个数据库事务中硬删除当前账号。
 * 所有响应均 no-store；成功日志只记录事件、时间和计数，不记录用户 ID、令牌或正文。
 */

export interface AccountDeletionRouteOptions {
  db: Db
  backupDir: string
  limiter: RateLimiter
  now: () => number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function registerAccountDeletionRoute(
  app: FastifyInstance,
  options: AccountDeletionRouteOptions,
): void {
  app.delete('/api/v1/account', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return
    const auth = requireDevice(options.db, request, reply, options.now)
    if (!auth) return

    const parsed = parseAccountDeleteBody(request.body)
    if (!parsed.ok) {
      const raw = request.body
      const confirmationMissing =
        raw === undefined ||
        raw === null ||
        (isRecord(raw) && (raw.confirm === undefined || raw.confirm === false))
      const code = confirmationMissing ? 'confirmation_required' : 'invalid_request'
      return reply
        .header('cache-control', 'no-store')
        .code(422)
        .send(errorBody(code, parsed.message))
    }

    try {
      const body: AccountDeleteResponse = deleteAccount({
        db: options.db,
        backupDir: options.backupDir,
        userId: auth.userId,
        now: options.now,
      })
      request.log.info(
        { event: 'account_deleted', deletedAt: body.deletedAt, counts: body.counts },
        'account deleted',
      )
      return reply.header('cache-control', 'no-store').code(200).send(body)
    } catch (error) {
      if (error instanceof AccountDeleteError) {
        const log = {
          event: 'account_delete_rejected',
          code: error.code,
          err: error,
        }
        if (error.statusCode >= 500) {
          request.log.error(log, 'account deletion failed after database commit')
        } else {
          request.log.warn(log, 'account deletion rejected')
        }
        return reply
          .header('cache-control', 'no-store')
          .code(error.statusCode)
          .send(errorBody(error.code, error.message))
      }
      request.log.error({ err: error }, 'account deletion failed')
      return reply
        .header('cache-control', 'no-store')
        .code(500)
        .send(errorBody('account_delete_failed', '删除账号失败，当前账号数据未被完整删除。'))
    }
  })
}
