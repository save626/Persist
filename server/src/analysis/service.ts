import { AiError, type AiClient } from '../ai/deepseek.js'
import { AnalysisContentError, generateAnalysisContent } from '../ai/analysis.js'
import type { ServerConfig } from '../config.js'
import type { Db } from '../db/driver.js'
import {
  deleteCachedReport,
  findCachedReport,
  insertReport,
  pruneReports,
  type StoredReport,
} from '../db/repositories/reports.js'
import type {
  AnalysisMetric,
  AnalysisRangeDays,
  AnalysisReportResponse,
  ReportContentV2,
  ReportFactsV2,
} from '@persist/shared/contract/analysis'
import { ANALYSIS_REPORT_TYPE, DATA_RETENTION } from '@persist/shared/contract/analysis'
import { buildAnalysisFacts, isAiConsentOff } from './facts.js'
import { buildAnalysisMetrics } from './metrics.js'
import { buildRulesContent } from './rules.js'

/**
 * 综合分析生成服务（步骤 13）。
 *
 * 路由与每日简报任务共用这一段逻辑，保证「手动点生成」和「21:00 自动生成」
 * 走完全相同的缓存、降级与保留期路径。
 *
 * 失败语义（与 P4 §8.5 对齐）：
 * - 403 ai_consent_off：档案页 AI 总开关关闭，不生成半份报告；
 * - 409 insufficient_data：窗口内零记录，先提示去记录，而不是让模型编；
 * - 502 invalid_response：模型返回结构不合规或写了事实包以外的数字（不编造）；
 * - 其余模型不可用（无 Key / 超时 / 上游错误）→ 200 + origin 'rules' 降级。
 */

export class AnalysisFailure extends Error {
  readonly code: 'consent_off' | 'insufficient_data' | 'invalid_response'

  constructor(code: AnalysisFailure['code'], message: string) {
    super(message)
    this.name = 'AnalysisFailure'
    this.code = code
  }
}

export interface AnalysisServiceDeps {
  db: Db
  ai: AiClient
  config: Pick<
    ServerConfig,
    'deepseekApiKey' | 'deepseekModel' | 'analysisTimeoutMs' | 'analysisMaxTokens'
  >
  logger?: { warn(payload: Record<string, unknown>, message: string): void }
}

export interface GenerateAnalysisOptions {
  userId: string
  rangeDays: AnalysisRangeDays
  force?: boolean
  now: number
  signal?: AbortSignal
}

function toResponse(report: StoredReport, cached: boolean): AnalysisReportResponse {
  return {
    reportId: report.id,
    cached,
    origin: report.origin,
    model: report.model,
    range: { start: report.start, end: report.end, days: report.rangeDays },
    content: report.content,
    metrics: report.metrics,
    dataRev: report.dataRev,
    createdAt: report.createdAt,
  }
}

function withWarnings(content: ReportContentV2, warnings: string[]): ReportContentV2 {
  if (warnings.length === 0) return content
  return { ...content, warnings: [...content.warnings, ...warnings].slice(0, 4) }
}

const RULES_FALLBACK_WARNING = 'AI 服务暂时不可用，本报告由规则模板生成，只复述已聚合的数据。'
const NO_KEY_WARNING = '当前未配置 AI 服务，本报告由规则模板生成，只复述已聚合的数据。'

interface GeneratedContent {
  content: ReportContentV2
  origin: 'ai' | 'rules'
  model: string | null
}

async function generateContent(
  deps: AnalysisServiceDeps,
  facts: ReportFactsV2,
  options: GenerateAnalysisOptions,
): Promise<GeneratedContent> {
  if (!deps.config.deepseekApiKey) {
    return {
      content: withWarnings(buildRulesContent(facts), [NO_KEY_WARNING]),
      origin: 'rules',
      model: null,
    }
  }

  try {
    const content = await generateAnalysisContent(deps.ai, facts, {
      model: deps.config.deepseekModel,
      maxTokens: deps.config.analysisMaxTokens,
      timeoutMs: deps.config.analysisTimeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    return { content, origin: 'ai', model: deps.config.deepseekModel }
  } catch (error) {
    if (error instanceof AnalysisContentError) {
      deps.logger?.warn({ reasons: error.reasons }, 'analysis content rejected')
      throw new AnalysisFailure('invalid_response', '模型返回的分析内容不合规，请重试。')
    }
    if (error instanceof AiError && (error.code === 'timeout' || error.code === 'upstream')) {
      // 数据已经聚合好了，只是模型不可用：降级规则模板，不让用户等到 502。
      deps.logger?.warn({ code: error.code }, 'analysis ai unavailable, falling back to rules')
      return {
        content: withWarnings(buildRulesContent(facts), [RULES_FALLBACK_WARNING]),
        origin: 'rules',
        model: null,
      }
    }
    if (error instanceof AiError) {
      deps.logger?.warn({ code: error.code }, 'analysis ai returned invalid response')
      throw new AnalysisFailure('invalid_response', '模型返回的分析内容不合规，请重试。')
    }
    throw error
  }
}

export async function generateAnalysisReport(
  deps: AnalysisServiceDeps,
  options: GenerateAnalysisOptions,
): Promise<AnalysisReportResponse> {
  if (isAiConsentOff(deps.db, options.userId)) {
    throw new AnalysisFailure('consent_off', '你在档案页关闭了 AI 分析授权，先开启后再生成。')
  }

  const facts = buildAnalysisFacts(deps.db, options.userId, {
    rangeDays: options.rangeDays,
    now: options.now,
  })
  if (facts.totals.daysWithAnyRecord === 0) {
    throw new AnalysisFailure(
      'insufficient_data',
      `近 ${options.rangeDays} 天还没有可用于分析的记录，先记录几次再生成。`,
    )
  }

  const cacheKey = {
    userId: options.userId,
    type: ANALYSIS_REPORT_TYPE,
    rangeDays: options.rangeDays,
    dataRev: facts.dataRev,
  }
  if (!options.force) {
    const cached = findCachedReport(deps.db, cacheKey)
    if (cached) return toResponse(cached, true)
  }

  const generated = await generateContent(deps, facts, options)
  const metrics: AnalysisMetric[] = buildAnalysisMetrics(facts)

  if (options.force) deleteCachedReport(deps.db, cacheKey)
  let stored: StoredReport
  try {
    stored = insertReport(deps.db, {
      userId: options.userId,
      type: ANALYSIS_REPORT_TYPE,
      rangeDays: options.rangeDays,
      dataRev: facts.dataRev,
      origin: generated.origin,
      model: generated.model,
      start: facts.range.start,
      end: facts.range.end,
      content: generated.content,
      metrics,
      facts,
      createdAt: Math.trunc(options.now),
    })
  } catch (error) {
    // 并发请求同时生成到同一个缓存键：唯一索引会挡下后插入的那条，直接返回已存在那份。
    const existing = findCachedReport(deps.db, cacheKey)
    if (existing) return toResponse(existing, true)
    throw error
  }

  pruneReports(deps.db, Math.trunc(options.now) - DATA_RETENTION.reportDays * 86_400_000)

  return toResponse(stored, false)
}
