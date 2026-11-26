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
import { readBearerToken, TOKEN_PREFIX } from '../auth.js'
import { isAiConsentOff } from '../analysis/facts.js'

/** gate.keyId 的设备令牌形态是 `user:<id>`；从这里取出 userId 做授权状态查询。 */
function userIdFromKeyId(keyId: string | null): string | null {
  if (!keyId?.startsWith('user:')) return null
  const id = keyId.slice('user:'.length)
  return id || null
}

/**
 * AI 授权服务端强制（2026-11-25 安全审查）。
 *
 * `/api/chat` 与 `/api/report` 原本只在前端检查 `aiConsent`（关掉就走 Mock、不发请求），
 * 篡改客户端可直接打接口绕过。这里在鉴权门之后按userId查库，明确关闭（aiConsent === false）
 * 就返回 403——与 `/api/v1/analysis/*` 的 `isAiConsentOff` 同一口径。
 *
 * 无 userId（旧 psa_ 凭据）或未同步 profile 时放行：本地优先产品里"数据缺失"不等于"用户关闭"。
 * 这与 AI 鉴权门的 fail-closed 不冲突——鉴权本身仍是 enforce，这里只补授权这一维。
 */
export function enforceAiConsent(options: {
  db: Db
  gate: { keyId: string | null }
  request: FastifyRequest
  reply: FastifyReply
}): boolean {
  const userId = userIdFromKeyId(options.gate.keyId)
  if (!userId || !isAiConsentOff(options.db, userId)) return true
  options.request.log.warn({ route: options.request.url }, 'ai blocked by consent')
  options.reply
    .header('cache-control', 'no-store')
    .code(403)
    .send(errorBody('ai_consent_off', '你在档案页关闭了 AI 数据处理授权，本接口不可用。'))
  return false
}

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
 * `/api/chat` 与 `/api/report` 的调用者凭据门（P0 + 17:3x 起接受设备令牌）。
 *
 * 两种凭据都收：
 * - `pst_*` 设备令牌：查库换出 `userId`，额度与审计都归到这个账号。这是**首选**形态——
 *   它可吊销、按账号归因，且不必在安装包里藏任何长期密钥（开源仓库下尤其重要）。
 * - `psa_*` 构建期内联凭据：保留为回滚锚点，旧 APK 仍可用；新包不再带它。
 *
 * 返回判定结果表示可以继续处理（调用方要用 `keyId` 归集配额与审计）；
 * 返回 `null` 表示已经写好 401，调用方直接 `return reply`。
 */
export function enforceAiGate(options: {
  db: Db
  config: ServerConfig
  request: FastifyRequest
  reply: FastifyReply
  now: () => number
}): AiGateDecision | null {
  const header = options.request.headers.authorization
  const token = readBearerToken(header)

  // 设备令牌优先：它绑定账号，能吊销，也能把额度落到具体使用者身上。
  if (token?.startsWith(TOKEN_PREFIX)) {
    const auth = authenticateRequest(options.db, header, options.now)
    if (auth) return { allowed: true, keyId: `user:${auth.userId}`, result: 'ok' }
    options.request.log.warn({ route: options.request.url }, 'ai device credential rejected')
    options.reply.header('cache-control', 'no-store').code(401).send(aiUnauthorizedBody())
    return null
  }

  const decision = evaluateAiGate(options.config.aiGate, options.config.aiKeys, header)
  if (decision.result !== 'ok' && decision.result !== 'gate_off') {
    options.request.log.warn(
      { aiGate: decision.result, route: options.request.url, allowed: decision.allowed },
      'ai credential check did not pass',
    )
  }
  if (decision.allowed) return decision
  // 401 不缓存：同一条连接上的后续请求不应该复用这个结论。
  options.reply.header('cache-control', 'no-store').code(401).send(aiUnauthorizedBody())
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
  /**
   * 计数归属。凭据门传判定结果；不走凭据门的接口（如综合分析，它只认设备令牌）
   * 直接传一个固定归属，让「同一类调用」共用一份当日额度。
   */
  gate: { keyId: string | null }
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
