import type { AuthContext } from '../db/repositories/devices.js'
import type { Db } from '../db/driver.js'
import type { RateLimiter } from '../rate-limit.js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { errorBody } from '../contract.js'
import { authenticateRequest } from '../sync/service.js'

/**
 * `/api/v1/*` 两个前置动作：按 IP 限流、按设备令牌鉴权。
 * 写成两个小函数只为了路由里读起来是「先限流、再鉴权、再处理」三行，不用每处抄状态码。
 */

export function enforceRateLimit(
  limiter: RateLimiter,
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const decision = limiter.take(request.ip)
  if (decision.allowed) return true
  reply
    .header('retry-after', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1_000))))
    .code(429)
    .send(errorBody('rate_limited', '请求过于频繁，请稍后再试。'))
  return false
}

/**
 * 解析设备令牌。401 的响应体不区分「没令牌 / 令牌错 / 已吊销」，
 * 也不回显任何账号信息，避免把令牌当成可探测的账号名。
 */
export function requireDevice(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply,
  now: () => number,
): AuthContext | null {
  const auth = authenticateRequest(db, request.headers.authorization, now)
  if (auth) return auth
  reply
    .header('cache-control', 'no-store')
    .code(401)
    .send(errorBody('unauthorized', '缺少或无效的设备令牌。'))
  return null
}
