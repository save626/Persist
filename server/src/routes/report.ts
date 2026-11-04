import { AiError, type AiClient } from '../ai/deepseek.js'
import { buildReportMessages } from '../ai/prompts.js'
import { sanitizeReportContent } from '../ai/report.js'
import type { ServerConfig } from '../config.js'
import { errorBody, parseReportRequest, type ReportResponse } from '../contract.js'
import type { RateLimiter } from '../rate-limit.js'
import type { FastifyInstance } from 'fastify'

/**
 * POST /api/report —— 按一次 JSON 请求生成一份报告文字结论。
 *
 * 为什么这里不用 SSE：报告是「一次成型」的结构化结果，没有逐字阅读的必要；
 * 传输体积小、失败边界清晰（要么整份报告，要么明确报错），前端可以只做一次校验。
 *
 * 失败语义（前端据此决定回退还是报错）：
 * - 400 invalid_request：前端请求不符合契约，属于客户端 bug，不回退；
 * - 503 ai_not_configured：服务端没有密钥，前端应继续用本地 Mock；
 * - 429 rate_limited：请求过于频繁，前端回退本地 Mock 并提示；
 * - 502/504 ai_failed|timeout|invalid_response：上游失败，前端回退本地 Mock；
 * - 499 client_closed：浏览器已取消，不写任何内容。
 */

const UNAVAILABLE_MESSAGE = '模型服务暂时不可用，请稍后重试；本次可以继续使用本地 Mock 报告。'
const TIMEOUT_MESSAGE = '模型服务响应超时，请稍后重试。'
const INVALID_MESSAGE = '模型返回的报告结构不合规，请重试。'

export interface ReportRouteOptions {
  config: ServerConfig
  ai: AiClient
  limiter: RateLimiter
}

export function registerReportRoute(app: FastifyInstance, options: ReportRouteOptions): void {
  app.post('/api/report', async (request, reply) => {
    const parsed = parseReportRequest(request.body)
    if (!parsed.ok) {
      return reply.code(400).send(errorBody('invalid_request', parsed.message))
    }

    if (!options.config.deepseekApiKey) {
      return reply
        .code(503)
        .send(errorBody('ai_not_configured', '服务端尚未配置模型密钥，请使用本地 Mock 报告。'))
    }

    const decision = options.limiter.take(request.ip)
    if (!decision.allowed) {
      reply.header('retry-after', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1_000))))
      return reply.code(429).send(errorBody('rate_limited', '请求过于频繁，请稍后再试。'))
    }

    // 浏览器关闭连接时取消上游请求。request 的 'close' 在请求体读完后就会触发，
    // 这里改用响应的 'close'，并用 writableEnded 区分「正常回包」和「客户端提前断开」。
    const abort = new AbortController()
    const onClose = () => {
      if (!reply.raw.writableEnded) abort.abort()
    }
    reply.raw.on('close', onClose)

    try {
      const raw = await options.ai.completeJson(buildReportMessages(parsed.value), {
        signal: abort.signal,
      })
      const sanitized = sanitizeReportContent(raw)
      if (!sanitized.ok) {
        request.log.warn({ reason: sanitized.reason }, 'report response rejected')
        return reply
          .header('cache-control', 'no-store')
          .code(502)
          .send(errorBody('invalid_response', INVALID_MESSAGE))
      }

      const body: ReportResponse = {
        report: sanitized.value,
        model: options.config.deepseekModel,
      }
      return reply.header('cache-control', 'no-store').code(200).send(body)
    } catch (error) {
      if (abort.signal.aborted) {
        return reply.code(499).send(errorBody('client_closed', '请求已取消。'))
      }
      if (error instanceof AiError && error.code === 'timeout') {
        return reply
          .header('cache-control', 'no-store')
          .code(504)
          .send(errorBody('timeout', TIMEOUT_MESSAGE))
      }
      request.log.warn({ err: error }, 'report generation failed')
      return reply
        .header('cache-control', 'no-store')
        .code(502)
        .send(errorBody('ai_failed', UNAVAILABLE_MESSAGE))
    } finally {
      reply.raw.off('close', onClose)
    }
  })
}
