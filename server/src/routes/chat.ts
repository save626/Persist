import { AiError, type AiClient } from '../ai/deepseek.js'
import { sanitizeExtraction } from '../ai/extract.js'
import { buildChatMessages, buildExtractionMessages } from '../ai/prompts.js'
import type { ServerConfig } from '../config.js'
import { errorBody, parseChatRequest, type ChatStreamEvent } from '../contract.js'
import type { RateLimiter } from '../rate-limit.js'
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

    const decision = options.limiter.take(request.ip)
    if (!decision.allowed) {
      reply.header('retry-after', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1_000))))
      return reply.code(429).send(errorBody('rate_limited', '请求过于频繁，请稍后再试。'))
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
      })) {
        if (abort.signal.aborted) break
        write({ type: 'delta', text })
      }

      if (!abort.signal.aborted) {
        const raw = await options.ai.completeJson(buildExtractionMessages(parsed.value), {
          signal: abort.signal,
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
    } catch (error) {
      request.log.warn({ err: error }, 'chat turn failed')
      if (!abort.signal.aborted) {
        write({
          type: 'error',
          code: error instanceof AiError && error.code === 'timeout' ? 'timeout' : 'ai_failed',
          message: FALLBACK_MESSAGE,
        })
      }
    } finally {
      clearInterval(heartbeat)
      if (!response.writableEnded) response.end()
    }
  })
}
