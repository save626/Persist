import type { FastifyInstance, FastifyReply } from 'fastify'
import type { AiClient } from '../ai/deepseek.js'
import type { ServerConfig } from '../config.js'
import { errorBody } from '../contract.js'
import type { Db } from '../db/driver.js'
import { enforceAiQuota, enforceRateLimit, requireDevice } from './guards.js'
import type { RateLimiter } from '../rate-limit.js'
import {
  ANALYSIS_REPORT_TYPE,
  isAnalysisRangeDays,
  parseAnalysisRequest,
  type AnalysisFactsResponse,
  type AnalysisRangeDays,
  type ReportFactsV2,
} from '@persist/shared/contract/analysis'
import {
  AnalysisFailure,
  generateAnalysisReport,
  loadAnalysisFacts,
} from '../analysis/service.js'
import { buildAnalysisFacts, isAiConsentOff } from '../analysis/facts.js'
import { addAiTokens } from '../ai/ai-usage.js'
import { findCachedReport } from '../db/repositories/reports.js'
import { recordAiCall, type AiCallResult } from '../ai/ai-audit.js'

/**
 * 综合分析接口（步骤 13 / P4 §8.5）。
 *
 * POST /api/v1/analysis/reports
 *   - 缓存优先：同一 dataRev 已有报告就直接返回（cached: true）；
 *   - force: true 时按当前 dataRev 重新生成并覆盖缓存行；
 *   - 无 Key / 超时 / 上游失败 → 200 + origin "rules"（数据没问题，只是模型不可用）；
 *   - 模型返回结构不合规或写了事实包以外的数字 → 502，不用半份报告凑数。
 *
 * GET /api/v1/analysis/facts
 *   - 只读事实包，用于前端预览「AI 将看到什么」，也是验收数字口径的入口。
 *
 * 配额与审计（本次补上）：这条路径此前只校验设备令牌，**不吃日配额、也不写
 * `ai_calls` / `ai_usage`**。而设备注册是开放的（v1 没有邀请码），于是一个陌生人
 * 只要注册空账号、push 几条假记录，就能反复触发作者的模型账单，且在任何一处
 * 运维视图里都看不见。现在它与 `/api/chat` 走同一套预占 + 记账。
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

/**
 * 分析调用的额度归属。
 *
 * 刻意**不按账号**：账号可以免费无限注册，按账号等于把「无限」切成 N 份「无限」。
 * 用一个固定归属，才能给出「这条链路每天最多花多少」的硬上限，谁也绕不过去。
 * 代价是作者自己与分析调用共用这份额度（个人使用量级下可以接受）。
 */
const ANALYSIS_QUOTA_KEY = 'analysis:global'

/** 把 `AnalysisFailure` 统一翻成对外响应；非本类型返回 false 交给上层抛。 */
function replyAnalysisFailure(reply: FastifyReply, error: unknown): boolean {
  if (!(error instanceof AnalysisFailure)) return false
  reply
    .header('cache-control', 'no-store')
    .code(FAILURE_STATUS[error.code])
    .send(errorBody(FAILURE_ERROR_CODE[error.code], error.message))
  return true
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

    // 先判「授权 + 有数据」，再预占额度：被 403/409 拒掉的请求不消耗当日额度。
    let facts: ReportFactsV2
    try {
      facts = loadAnalysisFacts(options.db, auth.userId, parsed.value.rangeDays, options.now())
    } catch (error) {
      if (replyAnalysisFailure(reply, error)) return
      throw error
    }

    // 命中缓存等于「不调模型」，不该占额度：报告页每次打开都会按当前窗口请求一次，
    // 数据没变时都会命中缓存，占额度会让 100 次的日上限变成「只能开 100 次页面」。
    const cacheKey = {
      userId: auth.userId,
      type: ANALYSIS_REPORT_TYPE,
      rangeDays: parsed.value.rangeDays,
      dataRev: facts.dataRev,
    }
    const willCallModel =
      parsed.value.force === true || findCachedReport(options.db, cacheKey) === null

    if (
      willCallModel &&
      !enforceAiQuota({
        db: options.db,
        config: options.config,
        gate: { keyId: ANALYSIS_QUOTA_KEY },
        request,
        reply,
        now: options.now,
      })
    ) {
      return reply
    }

    const startedAt = options.now()
    // 一次生成可能打两次模型（首次 + 纠正重试），usage 累加到这一处再落账。
    const tokens = { prompt: 0, completion: 0 }
    let result: AiCallResult = 'ai_failed'
    let httpStatus = 500

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
          facts,
          onUsage: (usage) => {
            tokens.prompt += usage.promptTokens
            tokens.completion += usage.completionTokens
          },
        },
      )
      // origin 'ai' 才算真的调成了模型；'rules' 是降级（无 Key / 超时 / 上游失败）。
      result = report.origin === 'ai' ? 'ok' : 'ai_failed'
      httpStatus = 200
      return reply.header('cache-control', 'no-store').code(200).send(report)
    } catch (error) {
      if (error instanceof AnalysisFailure) {
        result = error.code === 'invalid_response' ? 'invalid_response' : 'ai_failed'
        httpStatus = FAILURE_STATUS[error.code]
        if (replyAnalysisFailure(reply, error)) return
      }
      throw error
    } finally {
      // 审计按账号归因，回答「是哪个账号在花」；额度按固定归属记，回答「一共花了多少」。
      // 缓存命中的请求 token 为 0，这是真实的——它确实没有调模型。
      addAiTokens(
        options.db,
        {
          keyId: ANALYSIS_QUOTA_KEY,
          promptTokens: tokens.prompt,
          completionTokens: tokens.completion,
          now: options.now,
        },
        (auditError) => request.log.warn({ err: auditError }, 'ai usage write failed'),
      )
      recordAiCall(
        options.db,
        {
          keyId: `user:${auth.userId}`,
          route: request.url,
          result,
          httpStatus,
          model: options.config.deepseekModel,
          promptTokens: tokens.prompt,
          completionTokens: tokens.completion,
          latencyMs: options.now() - startedAt,
          ip: request.ip,
          now: options.now,
        },
        (auditError) => request.log.warn({ err: auditError }, 'ai audit write failed'),
      )
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
