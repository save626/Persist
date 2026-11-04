import type { ProfileData } from '../types'

/**
 * AI 报告的前后端共享类型（与服务端 `server/src/contract.ts` 同源）。
 *
 * 设计约定：
 * - 服务端只负责写「文字结论」（标题、状态、摘要、结论、建议、风险提示）；
 * - 指标、数据条与引用依据都由前端按本地记录确定性生成，模型不参与；
 * - `ReportDigest` 里每个模块只有在用户已授权、且对应来源开关打开时才有值，
 *   未授权的模块必须是 null，绝不用 0 或空数组顶替。
 */

export const REPORT_TYPES = ['今日简报', '训练建议', '学习观察'] as const
export type ReportType = (typeof REPORT_TYPES)[number]

export const REPORT_RANGE_DAYS = [7, 30, 90] as const
export type ReportRangeDays = (typeof REPORT_RANGE_DAYS)[number]

export interface ReportFitnessDigest {
  hasSession: boolean
  exerciseCount: number
  doneSets: number
  totalSets: number
  strengthVolumeKg: number
  durationMinutes: number
  distanceKm: number
  exerciseNames: string[]
}

export interface ReportStudyDigest {
  recordCount: number
  englishCount: number
  mathCount: number
  totalMinutes: number
}

export interface ReportDietDigest {
  mealCount: number
  foodEntryCount: number
  waterLiters: number
  waterEvents: number
}

export interface ReportDigest {
  fitness: ReportFitnessDigest | null
  study: ReportStudyDigest | null
  diet: ReportDietDigest | null
  /** 只有个人档案来源开启时才有值；其中的 aiConsent 恒为 true。 */
  profile: ProfileData | null
}

export interface ReportRequest {
  type: ReportType
  rangeDays: ReportRangeDays
  digest: ReportDigest
}

/** 模型输出的文字部分；服务端已按白名单净化，前端只做形状兜底。 */
export interface ReportContent {
  title: string
  status: string
  summary: string
  conclusions: string[]
  actions: string[]
  warnings: string[]
}
