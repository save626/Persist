import type { AuthContext } from '../db/repositories/devices.js'
import type { Db } from '../db/driver.js'
import type { RateLimiter } from '../rate-limit.js'
import type { ServerConfig } from '../config.js'
import { recordAiCall } from '../ai/ai-audit.js'
import { aiUnauthorizedBody, evaluateAiGate, type AiGateDecision } from '../ai/ai-guard.js'
import { reserveAiQuota, type AiQuotaDecision } from '../ai/ai-usage.js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { aiQuotaExceededBody, aiTokenQuotaExceededBody, errorBody } from '../contract.js'
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
 * 返回判定结果表示可以继续处理（调用方要用 `keyId` 归集配额与审计）；
 * 返回 `null` 表示已经写好 401，调用方直接 `return reply`。
 *
 * `warn` 模式下放行，但仍把失败结果写进日志——这是「切换 enforce 之前，先确认新 APK
 * 到底有没有带对凭据」的唯一观测手段。`off` 模式正常通过，不产生日志噪音。
 */
export function enforceAiGate(
  config: ServerConfig,
  request: FastifyRequest,
  reply: FastifyReply,
): AiGateDecision | null {
  const decision = evaluateAiGate(config.aiGate, config.aiKeys, request.headers.authorization)
  if (decision.result !== 'ok' && decision.result !== 'gate_off') {
    request.log.warn(
      { aiGate: decision.result, route: request.url, allowed: decision.allowed },
      'ai credential check did not pass',
    )
  }
  if (decision.allowed) return decision
  // 401 不缓存：同一条连接上的后续请求不应该复用这个结论。
  reply.header('cache-control', 'no-store').code(401).send(aiUnauthorizedBody())
  return null
}

/**
 * `/api/chat` 与 `/api/report` 的日配额（P0 Step 2 次数 / Step 3 token）。
 *
 * 返回非空表示已经预占一次额度；返回 `null` 表示已写好 429，调用方直接 `return reply`。
 *
 * 位置在 IP 限流之后：单 IP 的短时突发先被限流挡住，避免一个脚本用光整天的额度。
 * 预占的额度失败不退还（见 `ai-usage.ts` 的口径说明）。
 *
 * 被拒时也写一条审计（`quota_exceeded`）：这是判断「是自己在用还是被盗刷」的唯一线索，
 * 只看 `ai_usage` 的计数无法区分。
 */
export function enforceAiQuota(options: {
  db: Db
  config: ServerConfig
  /** 凭据门的判定；`keyId` 为 null 时归到 `anonymous`。 */
  gate: AiGateDecision
  request: FastifyRequest
  reply: FastifyReply
  now: () => number
}): AiQuotaDecision | null {
  const decision = reserveAiQuota(options.db, {
    keyId: options.gate.keyId,
    requestLimit: options.config.aiDailyLimit,
    tokenLimit: options.config.aiDailyTokens,
    now: options.now,
  })
  if (decision.allowed) return decision

  const nowMs = options.now()
  recordAiCall(
    options.db,
    {
      keyId: options.gate.keyId,
      route: options.request.url,
      result: 'quota_exceeded',
      httpStatus: 429,
      model: options.config.deepseekModel,
      ip: options.request.ip,
      now: options.now,
    },
    (error) => options.request.log.warn({ err: error }, 'ai audit write failed'),
  )

  options.request.log.warn(
    {
      aiQuota: {
        reason: decision.reason,
        used: decision.used,
        limit: decision.limit,
        tokensUsed: decision.tokensUsed,
        tokenLimit: decision.tokenLimit,
      },
      keyId: options.gate.keyId ?? 'anonymous',
      route: options.request.url,
    },
    'ai daily quota exhausted',
  )

  const body =
    decision.reason === 'tokens'
      ? aiTokenQuotaExceededBody(decision.tokenLimit)
      : aiQuotaExceededBody(decision.limit)

  options.reply
    .header('cache-control', 'no-store')
    .header('retry-after', String(Math.max(1, Math.ceil((decision.resetAt - nowMs) / 1_000))))
    .code(429)
    .send(body)
  return null
}
