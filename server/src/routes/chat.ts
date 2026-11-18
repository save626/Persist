import { AiError, type AiClient, type AiTokenUsage } from '../ai/deepseek.js'
import { sanitizeExtraction } from '../ai/extract.js'
import { buildChatMessages, buildExtractionMessages } from '../ai/prompts.js'
import { recordAiCall, type AiCallResult } from '../ai/ai-audit.js'
import { addAiTokens } from '../ai/ai-usage.js'
import type { ServerConfig } from '../config.js'
import { errorBody, parseChatRequest, type ChatStreamEvent } from '../contract.js'
import type { Db } from '../db/driver.js'
import type { RateLimiter } from '../rate-limit.js'
import { enforceAiGate, enforceAiQuota } from './guards.js'
import type { FastifyInstance } from 'fastify'

/**
 * POST /api/chat —— 与 app/src/lib/chat-types.ts 的 ChatEvent 流一一对应。
 *
 * 时序（契约的一部分，前端据此渲染）：
 * stage(collect) → delta* → questions? → profilePatch? → stage(propose) → proposal? → warnings? → done
 *
 * 任何一步失败都发一个 error 事件后断流，不伪装成成功；
 * 前端收到 error 后回退到本地 Mock，并保留已经显示的部分内容。
 */

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // 让 Nginx 不要缓冲 SSE（部署文档里也要求 proxy_buffering off）
  'X-Accel-Buffering': 'no',
}

const FALLBACK_MESSAGE = '模型服务暂时不可用，请稍后重试；也可以继续使用本地 Mock 对话。'

export interface ChatRouteOptions {
  config: ServerConfig
  ai: AiClient
  limiter: RateLimiter
  /** 配额与审计要用：`ai_usage` / `ai_calls` 都在同一个库。 */
  db: Db
  now: () => number
  heartbeatMs?: number
}

export function registerChatRoute(app: FastifyInstance, options: ChatRouteOptions): void {
  const heartbeatMs = options.heartbeatMs ?? 15_000

  app.post('/api/chat', async (request, reply) => {
    const parsed = parseChatRequest(request.body, options.config)
    if (!parsed.ok) {
      return reply.code(400).send(errorBody('invalid_request', parsed.message))
    }

    if (!options.config.deepseekApiKey) {
      return reply
        .code(503)
        .send(errorBody('ai_not_configured', '服务端尚未配置模型密钥，请使用本地 Mock 对话。'))
    }

    // 调用者凭据门（P0）。位置刻意在 Key 检查之后：没配 Key 的部署不应该对任何人返回
    // 401，否则会把「服务端没配好」误报成「凭据错」。放在限流之前：没有凭据的请求
    // 不该消耗 IP 额度。
    const gate = enforceAiGate({
      db: options.db,
      config: options.config,
      request,
      reply,
      now: options.now,
    })
    if (!gate) return reply

    const decision = options.limiter.take(request.ip)
    if (!decision.allowed) {
      reply.header('retry-after', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1_000))))
      return reply.code(429).send(errorBody('rate_limited', '请求过于频繁，请稍后再试。'))
    }

    // 日配额（P0 Step 2）。放在 IP 限流之后：短时突发先被限流挡住，避免一个脚本
    // 用光整天的额度；预占的额度失败不退还。
    if (
      !enforceAiQuota({
        db: options.db,
        config: options.config,
        gate,
        request,
        reply,
        now: options.now,
      })
    ) {
      return reply
    }

    const startedAt = options.now()
    // SSE 一旦 hijack，HTTP 状态就固定为 200；失败以 `error` 事件表达，
    // 所以审计里靠 `result` 区分，不能靠 httpStatus。
    let result: AiCallResult = 'ai_failed'

    // 一次 /api/chat 会打两次模型：流式回复 + 结构化抽取。两次的 usage 累计到这一处，
    // 请求结束时一次写入（P0 Step 3）。拿不到 usage 时保持 0，不猜。
    const tokens = { prompt: 0, completion: 0 }
    const collectUsage = (usage: AiTokenUsage) => {
      tokens.prompt += usage.promptTokens
      tokens.completion += usage.completionTokens
    }

    reply.hijack()
    const response = reply.raw
    response.writeHead(200, SSE_HEADERS)

    const abort = new AbortController()
    let closed = false
    response.on('close', () => {
      closed = true
      abort.abort()
    })

    const write = (event: ChatStreamEvent) => {
      if (closed || response.writableEnded) return
      response.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    const heartbeat = setInterval(() => {
      if (!closed && !response.writableEnded) response.write(': ping\n\n')
    }, heartbeatMs)
    heartbeat.unref()

    try {
      write({ type: 'stage', stage: 'collect' })

      for await (const text of options.ai.streamChat(buildChatMessages(parsed.value), {
        signal: abort.signal,
        onUsage: collectUsage,
      })) {
        if (abort.signal.aborted) break
        write({ type: 'delta', text })
      }

      if (!abort.signal.aborted) {
        const raw = await options.ai.completeJson(buildExtractionMessages(parsed.value), {
          signal: abort.signal,
          onUsage: collectUsage,
        })
        const extraction = sanitizeExtraction(raw, parsed.value.profile)
        if (extraction.questions.length > 0) {
          write({ type: 'questions', questions: extraction.questions })
        }
        if (Object.keys(extraction.patch).length > 0) {
          write({ type: 'profilePatch', patch: extraction.patch })
        }
        if (extraction.proposal) {
          write({ type: 'stage', stage: 'propose' })
          write({ type: 'proposal', proposal: extraction.proposal })
        }
        if (extraction.warnings.length > 0) {
          write({ type: 'warnings', warnings: extraction.warnings })
        }
      }

      write({ type: 'done' })
      result = abort.signal.aborted ? 'client_closed' : 'ok'
    } catch (error) {
      request.log.warn({ err: error }, 'chat turn failed')
      if (abort.signal.aborted) {
        result = 'client_closed'
      } else {
        result = error instanceof AiError && error.code === 'timeout' ? 'timeout' : 'ai_failed'
        write({
          type: 'error',
          code: result === 'timeout' ? 'timeout' : 'ai_failed',
          message: FALLBACK_MESSAGE,
        })
      }
    } finally {
      clearInterval(heartbeat)
      if (!response.writableEnded) response.end()
      // token 记账（P0 Step 3）：两维配额都关掉时不写库（回滚路径不留空行）。
      if (options.config.aiDailyLimit > 0 || options.config.aiDailyTokens > 0) {
        addAiTokens(
          options.db,
          {
            keyId: gate.keyId,
            promptTokens: tokens.prompt,
            completionTokens: tokens.completion,
            now: options.now,
          },
          (error) => request.log.warn({ err: error }, 'ai token accounting failed'),
        )
      }
      recordAiCall(
        options.db,
        {
          keyId: gate.keyId,
          route: '/api/chat',
          result,
          httpStatus: 200,
          model: options.config.deepseekModel,
          latencyMs: options.now() - startedAt,
          promptTokens: tokens.prompt,
          completionTokens: tokens.completion,
          ip: request.ip,
          now: options.now,
        },
        (error) => request.log.warn({ err: error }, 'ai audit write failed'),
      )
    }
  })
}
