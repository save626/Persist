import type { FastifyInstance } from 'fastify'
import type { AiClient } from '../ai/deepseek.js'
import type { ServerConfig } from '../config.js'
import { errorBody } from '../contract.js'
import type { Db } from '../db/driver.js'
import { enforceRateLimit, requireDevice } from './guards.js'
import type { RateLimiter } from '../rate-limit.js'
import {
  isAnalysisRangeDays,
  parseAnalysisRequest,
  type AnalysisFactsResponse,
  type AnalysisRangeDays,
} from '@persist/shared/contract/analysis'
import { AnalysisFailure, generateAnalysisReport } from '../analysis/service.js'
import { buildAnalysisFacts, isAiConsentOff } from '../analysis/facts.js'

/**
 * 综合分析接口（步骤 13 / P4 §8.5）。
 *
 * POST /api/v1/analysis/reports
 *   - 缓存优先：同一 dataRev 已有报告就直接返回（cached: true），不花模型额度；
 *   - force: true 时按当前 dataRev 重新生成并覆盖缓存行；
 *   - 无 Key / 超时 / 上游失败 → 200 + origin "rules"（数据没问题，只是模型不可用）；
 *   - 模型返回结构不合规或写了事实包以外的数字 → 502，不用半份报告凑数。
 *
 * GET /api/v1/analysis/facts
 *   - 只读事实包，用于前端预览「AI 将看到什么」，也是验收数字口径的入口。
 */

export interface AnalysisRoutesOptions {
  db: Db
  ai: AiClient
  config: ServerConfig
  limiter: RateLimiter
  now: () => number
}

const FAILURE_STATUS: Record<AnalysisFailure['code'], number> = {
  consent_off: 403,
  insufficient_data: 409,
  invalid_response: 502,
}

const FAILURE_ERROR_CODE: Record<AnalysisFailure['code'], string> = {
  consent_off: 'ai_consent_off',
  insufficient_data: 'insufficient_data',
  invalid_response: 'invalid_response',
}

export function registerAnalysisRoutes(app: FastifyInstance, options: AnalysisRoutesOptions): void {
  app.post('/api/v1/analysis/reports', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return
    const auth = requireDevice(options.db, request, reply, options.now)
    if (!auth) return

    const parsed = parseAnalysisRequest(request.body)
    if (!parsed.ok) {
      return reply
        .header('cache-control', 'no-store')
        .code(422)
        .send(errorBody('invalid_request', parsed.message))
    }

    try {
      const report = await generateAnalysisReport(
        {
          db: options.db,
          ai: options.ai,
          config: options.config,
          logger: request.log,
        },
        {
          userId: auth.userId,
          rangeDays: parsed.value.rangeDays,
          force: parsed.value.force === true,
          now: options.now(),
        },
      )
      return reply.header('cache-control', 'no-store').code(200).send(report)
    } catch (error) {
      if (error instanceof AnalysisFailure) {
        return reply
          .header('cache-control', 'no-store')
          .code(FAILURE_STATUS[error.code])
          .send(errorBody(FAILURE_ERROR_CODE[error.code], error.message))
      }
      throw error
    }
  })

  app.get('/api/v1/analysis/facts', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return
    const auth = requireDevice(options.db, request, reply, options.now)
    if (!auth) return

    const query = (request.query ?? {}) as Record<string, unknown>
    const rawRange = query.rangeDays === undefined ? 30 : Number(query.rangeDays)
    if (!isAnalysisRangeDays(rawRange)) {
      return reply
        .header('cache-control', 'no-store')
        .code(422)
        .send(errorBody('invalid_request', '分析窗口只支持 7 / 30 / 90 天。'))
    }
    if (isAiConsentOff(options.db, auth.userId)) {
      return reply
        .header('cache-control', 'no-store')
        .code(403)
        .send(errorBody('ai_consent_off', '你在档案页关闭了 AI 分析授权。'))
    }

    const facts = buildAnalysisFacts(options.db, auth.userId, {
      rangeDays: rawRange as AnalysisRangeDays,
      now: options.now(),
    })
    const body: AnalysisFactsResponse = { facts }
    return reply.header('cache-control', 'no-store').code(200).send(body)
  })
}
