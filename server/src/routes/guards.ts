import type { AuthContext } from '../db/repositories/devices.js'
import type { Db } from '../db/driver.js'
import type { RateLimiter } from '../rate-limit.js'
import type { ServerConfig } from '../config.js'
import { aiUnauthorizedBody, evaluateAiGate } from '../ai/ai-guard.js'
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

/**
 * `/api/chat` 与 `/api/report` 的调用者凭据门（P0）。
 *
 * 返回 `true` 表示可以继续处理；`false` 表示已经写好 401，调用方直接 `return reply`。
 *
 * `warn` 模式下放行，但仍把失败结果写进日志——这是「切换 enforce 之前，先确认新 APK
 * 到底有没有带对凭据」的唯一观测手段。`off` 模式正常通过，不产生日志噪音。
 */
export function enforceAiGate(
  config: ServerConfig,
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const decision = evaluateAiGate(config.aiGate, config.aiKeys, request.headers.authorization)
  if (decision.result !== 'ok' && decision.result !== 'gate_off') {
    request.log.warn(
      { aiGate: decision.result, route: request.url, allowed: decision.allowed },
      'ai credential check did not pass',
    )
  }
  if (decision.allowed) return true
  // 401 不缓存：同一条连接上的后续请求不应该复用这个结论。
  reply.header('cache-control', 'no-store').code(401).send(aiUnauthorizedBody())
  return false
}
