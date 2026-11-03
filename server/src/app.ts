import { createDeepSeekClient, type AiClient } from './ai/deepseek.js'
import type { ServerConfig } from './config.js'
import { errorBody } from './contract.js'
import { createRateLimiter } from './rate-limit.js'
import { registerChatRoute } from './routes/chat.js'
import { registerHealthRoute } from './routes/health.js'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'

/**
 * 组装 Fastify 实例。所有外部依赖（模型客户端、时钟、fetch）都可注入，
 * 便于测试里不起真实网络也能覆盖成功、失败、超时、限流四条路径。
 */

export interface BuildAppOptions {
  config: ServerConfig
  ai?: AiClient
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  now?: () => number
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      level: options.config.logLevel,
      // 只拯救关键请求头；请求体从不进日志，避免档案内容落盘。
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: options.config.trustProxy,
    bodyLimit: 256 * 1024,
  })

  const ai = options.ai ?? createDeepSeekClient(options.config, options.fetchImpl)
  const limiter = createRateLimiter({
    max: options.config.rateLimitMax,
    windowMs: options.config.rateLimitWindowMs,
    ...(options.now ? { now: options.now } : {}),
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'unhandled error')
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500
    reply.code(status).send(errorBody('internal_error', '服务端处理失败，请稍后重试。'))
  })

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(errorBody('not_found', '接口不存在。'))
  })

  registerHealthRoute(app, { config: options.config })
  registerChatRoute(app, { config: options.config, ai, limiter })

  return app
}
