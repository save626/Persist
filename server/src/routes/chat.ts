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
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ServerResponse } from 'node:http'

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

/**
 * 连通性探针：请求体里带 `probe: true` 就是探针，不传 `turns`，也不碰模型。
 *
 * 为什么需要它：设置页那个「测试服务端连接」原来只打 `GET /api/health`，而 P5-9 的
 * 故障恰恰出在 `/api/chat` 独有的路径上（SSE 的 `hijack` + 裸 `writeHead` 丢了 CORS 头）。
 * 健康检查一路 200，真机对话却一个字节都读不到——只测健康检查等于没测。
 *
 * 为什么不用真实对话来测：真实对话要打两次模型、占一次日配额、还可能撞上 IP 限流。
 * 一个「测试」按钮会被反复点，成本必须为零：探针只走鉴权 + 跨域 + 裸流这三段，
 * 证明「浏览器此刻能从这个部署读到 SSE 帧」，模型是否可用由 `ai` 字段单独回答。
 */
const PROBE_FIELD = 'probe'

function isProbeBody(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    (body as Record<string, unknown>)[PROBE_FIELD] === true
  )
}

/**
 * 打开 SSE 裸流（hijack + 补回 CORS 头）。
 *
 * 真实对话与探针都必须走这里。P5-9 的教训是：CORS 头由 onRequest 钩子写进 Fastify
 * 的回复头表，而 hijack 之后 onSend 不再执行、`writeHead` 又只发传进去的那几个头，
 * 于是头全丢。谁要自己再写一份 `writeHead`，谁就会再丢一次——所以只留这一个入口。
 */
function openSseStream(reply: FastifyReply): ServerResponse {
  reply.hijack()
  const response = reply.raw
  const headers: Record<string, string> = { ...SSE_HEADERS }
  for (const name of ['access-control-allow-origin', 'vary']) {
    const value = reply.getHeader(name)
    if (typeof value === 'string' && value.length > 0) headers[name] = value
  }
  response.writeHead(200, headers)
  return response
}

/** 探针的回包：与真实对话同形的两帧，前端只要读到 `done` 就算链路通。 */
function answerProbe(reply: FastifyReply): void {
  const response = openSseStream(reply)
  response.write(`data: ${JSON.stringify({ type: 'stage', stage: 'collect' })}\n\n`)
  response.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
  response.end()
}

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

  /**
   * 真实对话与探针共用的前置门：部署前提 → 凭据 → IP 限流。
   * 探针也要过这三关，否则「测试通过」就证明不了真实对话能用——它想验证的正是这一段。
   * 返回 gate 表示可以继续；返回 null 表示响应已经写好，调用方直接 `return reply`。
   */
  const preflight = (request: FastifyRequest, reply: FastifyReply) => {
    if (!options.config.deepseekApiKey) {
      reply
        .code(503)
        .send(errorBody('ai_not_configured', '服务端尚未配置模型密钥，请使用本地 Mock 对话。'))
      return null
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
    if (!gate) return null

    const decision = options.limiter.take(request.ip)
    if (!decision.allowed) {
      reply
        .header('retry-after', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1_000))))
        .code(429)
        .send(errorBody('rate_limited', '请求过于频繁，请稍后再试。'))
      return null
    }

    return { gate }
  }

  app.post('/api/chat', async (request, reply) => {
    // 探针没有业务请求体，因此在解析之前分流；它到此为止就结束，
    // 不占日配额、不打模型、不写 ai_calls（否则「测一下」会污染用量账本）。
    if (isProbeBody(request.body)) {
      if (!preflight(request, reply)) return reply
      answerProbe(reply)
      return
    }

    const parsed = parseChatRequest(request.body, options.config)
    if (!parsed.ok) {
      return reply.code(400).send(errorBody('invalid_request', parsed.message))
    }

    const opened = preflight(request, reply)
    if (!opened) return reply
    const { gate } = opened

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

    const response = openSseStream(reply)

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
