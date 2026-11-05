import { createDeepSeekClient, type AiClient } from './ai/deepseek.js'
import type { ServerConfig } from './config.js'
import { errorBody } from './contract.js'
import { openPersistDatabase, type PersistDatabase } from './db/index.js'
import { createRateLimiter } from './rate-limit.js'
import { registerAnalysisRoutes } from './routes/analysis.js'
import { registerChatRoute } from './routes/chat.js'
import { registerDeviceRoutes } from './routes/devices.js'
import { registerHealthRoute } from './routes/health.js'
import { registerReportArchiveRoutes } from './routes/reports.js'
import { registerReportRoute } from './routes/report.js'
import { registerSyncRoutes } from './routes/sync.js'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'

/**
 * 组装 Fastify 实例。所有外部依赖（模型客户端、时钟、fetch、数据库）都可注入，
 * 便于测试里不起真实网络也能覆盖成功、失败、超时、限流四条路径。
 *
 * `db` 不传时开一个内存库（测试默认走这条路），随 app 关闭一起关掉；
 * 生产入口 index.ts 传文件库进来，负责它的生命周期。
 */

export interface BuildAppOptions {
  config: ServerConfig
  db?: PersistDatabase
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

  const now = options.now ?? (() => Date.now())
  const ai = options.ai ?? createDeepSeekClient(options.config, options.fetchImpl)
  const limiter = createRateLimiter({
    max: options.config.rateLimitMax,
    windowMs: options.config.rateLimitWindowMs,
    ...(options.now ? { now: options.now } : {}),
  })
  const syncLimiter = createRateLimiter({
    max: options.config.syncRateLimitMax,
    windowMs: options.config.rateLimitWindowMs,
    ...(options.now ? { now: options.now } : {}),
  })
  // 综合分析单独计数：一次生成可能跑 45 s，不能挤掉聊天与同步的额度。
  const analysisLimiter = createRateLimiter({
    max: options.config.analysisRateLimitMax,
    windowMs: options.config.rateLimitWindowMs,
    ...(options.now ? { now: options.now } : {}),
  })

  const ownsDatabase = !options.db
  const db = options.db ?? openPersistDatabase({ path: ':memory:' })
  if (ownsDatabase) {
    app.addHook('onClose', async () => {
      db.db.close()
    })
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'unhandled error')
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500
    reply.code(status).send(errorBody('internal_error', '服务端处理失败，请稍后重试。'))
  })

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(errorBody('not_found', '接口不存在。'))
  })

  registerHealthRoute(app, { config: options.config, db })
  registerChatRoute(app, { config: options.config, ai, limiter })
  registerReportRoute(app, { config: options.config, ai, limiter })
  registerAnalysisRoutes(app, {
    db: db.db,
    ai,
    config: options.config,
    limiter: analysisLimiter,
    now,
  })
  registerReportArchiveRoutes(app, { db: db.db, limiter: syncLimiter, now })
  registerDeviceRoutes(app, { db: db.db, limiter: syncLimiter, now })
  registerSyncRoutes(app, { db: db.db, limiter: syncLimiter, now })

  return app
}
