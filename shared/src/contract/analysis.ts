/**
 * 综合分析契约（步骤 13 / P4b）：服务端聚合事实包 + 报告文字。
 *
 * 约定（设计文档 §8）：
 * - 数字只由服务端 SQL 聚合得出，模型只写文字；事实包随报告一起入库便于回溯；
 * - 未授权模块在事实包里整体为 null（不是 0），前端据此说明「未纳入分析」；
 * - 报告正文是纯文本（无 Markdown），长度上限在这里集中定义，服务端净化与前端展示共用。
 */
import type { ParseResult } from './parse.js'

/** 本步只做「综合分析」一种类型；8c 的今日简报/训练建议/学习观察仍走本地报告。 */
export const ANALYSIS_REPORT_TYPE = '综合分析' as const
export type AnalysisReportType = typeof ANALYSIS_REPORT_TYPE

/** 分析窗口只允许 7 / 30 / 90 天，避免任意窗口把事实包撑大。 */
export const ANALYSIS_RANGE_DAYS = [7, 30, 90] as const
export type AnalysisRangeDays = (typeof ANALYSIS_RANGE_DAYS)[number]

export function isAnalysisRangeDays(value: unknown): value is AnalysisRangeDays {
  return typeof value === 'number' && (ANALYSIS_RANGE_DAYS as readonly number[]).includes(value)
}

export interface AnalysisRequest {
  type: AnalysisReportType
  rangeDays: AnalysisRangeDays
  /** true 表示跳过缓存、按当前 dataRev 重新生成（同一 rev 会覆盖旧缓存行）。 */
  force?: boolean
}

export function parseAnalysisRequest(raw: unknown): ParseResult<AnalysisRequest> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: '请求体必须是对象。' }
  }
  const body = raw as Record<string, unknown>
  const type = body.type ?? ANALYSIS_REPORT_TYPE
  if (type !== ANALYSIS_REPORT_TYPE) {
    return { ok: false, message: `报告类型只支持「${ANALYSIS_REPORT_TYPE}」。` }
  }
  const rangeDays = body.rangeDays ?? 30
  if (!isAnalysisRangeDays(rangeDays)) {
    return { ok: false, message: '分析窗口只支持 7 / 30 / 90 天。' }
  }
  const force = body.force
  if (force !== undefined && typeof force !== 'boolean') {
    return { ok: false, message: 'force 必须是布尔值。' }
  }
  const request: AnalysisRequest = { type, rangeDays }
  if (force) request.force = true
  return { ok: true, value: request }
}

export const ANALYSIS_CONSENT_MODULES = ['profile', 'fitness', 'diet', 'study'] as const
export type AnalysisConsentModule = (typeof ANALYSIS_CONSENT_MODULES)[number]
export type AnalysisConsent = Record<AnalysisConsentModule, boolean>

export const ANALYSIS_GRANULARITIES = ['day', 'week'] as const
export type AnalysisGranularity = (typeof ANALYSIS_GRANULARITIES)[number]

/** 档案摘要：只带模型写建议真正需要的字段，不带姓名/联系方式之类标识。 */
export interface FactsProfile {
  age: number
  height: number
  weight: number
  targetWeight: number
  goal: string
  experience: string
  frequency: string
}

export interface FactsWeeklyTarget {
  label: string
  unit: string
  perWeek: number
}

/** 当前长线计划（status=active）；没有就整体为 null。 */
export interface FactsPlan {
  title: string
  weeklyTargets: FactsWeeklyTarget[]
  /** 计划周期内计划项完成率（0–100，一位小数）；无计划项为 null。 */
  progressPct: number | null
}

export interface FactsFitnessDay {
  sessions: number
  sets: number | null
  volumeKg: number | null
  minutes: number | null
}

export interface FactsStudyDay {
  minutes: number
  byCategory: { english: number; math: number } | null
}

export interface FactsDietDay {
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  meals: number
}

export interface FactsPlanDay {
  total: number
  done: number
}

/** 一天的事实；某模块未授权或当天无记录时为 null。 */
export interface FactsDay {
  date: string
  fitness: FactsFitnessDay | null
  study: FactsStudyDay | null
  diet: FactsDietDay | null
  waterMl: number | null
  plan: FactsPlanDay | null
}

export interface FactsWeek {
  weekStart: string
  fitnessSessions: number | null
  volumeKg: number | null
  studyMinutes: number | null
  /** 只按有饮水记录的天数取平均，没记录就是 null，不补 0。 */
  avgWaterMl: number | null
  planRate: number | null
}

export interface FactsTotals {
  fitnessSessions: number | null
  fitnessMinutes: number | null
  volumeKg: number | null
  studyMinutes: number | null
  waterAvgMl: number | null
  /** 0–100，一位小数；没有任何计划项时为 null。 */
  planRate: number | null
  daysWithAnyRecord: number
  daysMissing: number
  /**
   * 90 天窗口只返回周汇总（days 为空），逐日才能算的均值/分科汇总放在这里补，
   * 保证报告指标卡在任何窗口下都有服务端算好的数字可用。
   */
  dietAvgCalories?: number | null
  dietAvgProtein?: number | null
  studyEnglishMinutes?: number | null
  studyMathMinutes?: number | null
}

export interface FactsTrend {
  previousRange: { start: string; end: string } | null
  /** 相对前一个等长窗口的变化百分比；前值缺失或为 0 时为 null。 */
  fitnessSessionsChangePct: number | null
  studyMinutesChangePct: number | null
  planRateChangePct: number | null
}

export interface FactsCoverage {
  fitnessDays: number | null
  studyDays: number | null
  dietDays: number | null
  waterDays: number | null
}

export interface ReportFactsV2 {
  version: 2
  generatedAt: number
  type: AnalysisReportType
  range: { days: AnalysisRangeDays; start: string; end: string }
  granularity: AnalysisGranularity
  /** 生成事实时所依据的同步序号，缓存键的一部分。 */
  dataRev: number
  profile: FactsProfile | null
  plan: FactsPlan | null
  days: FactsDay[]
  weekly: FactsWeek[]
  totals: FactsTotals
  trend: FactsTrend
  coverage: FactsCoverage
  consent: AnalysisConsent
}

export interface AnalysisMetric {
  label: string
  value: string
  detail: string
}

/**
 * 报告正文长度约束（单位：字符）。
 *
 * 设计文档 §8.2 给的是目标区间；这里把「净化器实际强制」的边界写死在契约里，
 * 模型写超一点不会让整份报告 502（超长截断），写得太短/结构缺失才判非法。
 */
export const ANALYSIS_CONTENT_LIMITS = {
  title: { min: 2, max: 24 },
  status: { min: 2, max: 16 },
  summary: { min: 40, max: 260, target: { min: 80, max: 160 } },
  analysis: { min: 2, max: 5, minLength: 40, maxLength: 320 },
  conclusions: { min: 2, max: 4, itemMin: 4, itemMax: 80 },
  actions: { min: 2, max: 4, itemMin: 4, itemMax: 80 },
  warnings: { max: 4, itemMin: 4, itemMax: 80 },
} as const

export type AnalysisOrigin = 'ai' | 'rules'

export interface ReportContentV2 {
  title: string
  status: string
  summary: string
  /** 2–5 段分析正文，每段只陈述事实与推断依据，不做医学诊断。 */
  analysis: string[]
  conclusions: string[]
  actions: string[]
  warnings: string[]
}

export interface AnalysisReportResponse {
  reportId: string
  /** true 表示直接命中缓存（同一 dataRev 下已有报告）。 */
  cached: boolean
  origin: AnalysisOrigin
  /** 实际使用的模型名；规则降级时为 null。 */
  model: string | null
  range: { start: string; end: string; days: number }
  content: ReportContentV2
  metrics: AnalysisMetric[]
  dataRev: number
  createdAt: number
}

export interface AnalysisReportListItem {
  id: string
  type: string
  rangeDays: number
  origin: AnalysisOrigin
  model: string | null
  start: string
  end: string
  dataRev: number
  createdAt: number
  title: string
  status: string
}

export interface AnalysisReportDetail extends AnalysisReportListItem {
  content: ReportContentV2
  metrics: AnalysisMetric[]
}

export interface AnalysisFactsResponse {
  facts: ReportFactsV2
}

export interface AnalysisReportsListResponse {
  reports: AnalysisReportListItem[]
  nextCursor: string | null
}

export interface AnalysisErrorBody {
  error: { code: string; message: string }
}

/** 与设计文档 §13 / §14.1 对齐的错误码。 */
export const ANALYSIS_ERROR_CODES = {
  invalidRequest: 'invalid_request',
  unauthorized: 'unauthorized',
  consentOff: 'ai_consent_off',
  insufficientData: 'insufficient_data',
  aiUnavailable: 'ai_unavailable',
  invalidResponse: 'invalid_response',
  rateLimited: 'rate_limited',
  notFound: 'not_found',
} as const

/**
 * 数据保留口径（P4 §18 已确认）：
 * - 分析报告保留 365 天，过期自动删除（本步实现）；
 * - 同步墓碑保留 30 天、审计日志保留 30 天（本步只落口径，清理任务随步骤 14 的定时器落地）。
 */
export const DATA_RETENTION = {
  reportDays: 365,
  tombstoneDays: 30,
  auditLogDays: 30,
} as const

/** 每日简报默认时间（Asia/Shanghai）；设置页可改。 */
export const DEFAULT_DAILY_BRIEF_AT = '21:00'

export interface DailyBriefSettings {
  enabled: boolean
  /** HH:MM，24 小时制；非法值回落到默认 21:00。 */
  at: string
}

export function parseDailyBriefAt(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw.trim())
  return match ? `${match[1]}:${match[2]}` : null
}

/** 设置里缺字段/字段非法时按「关闭 + 21:00」处理，服务端与设置页共用。 */
export function normalizeDailyBriefSettings(raw: unknown): DailyBriefSettings {
  if (typeof raw !== 'object' || raw === null) {
    return { enabled: false, at: DEFAULT_DAILY_BRIEF_AT }
  }
  const record = raw as Record<string, unknown>
  return {
    enabled: record.enabled === true,
    at: parseDailyBriefAt(record.at) ?? DEFAULT_DAILY_BRIEF_AT,
  }
}
