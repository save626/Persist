/**
 * AI 报告与板块观察的共享契约。
 *
 * 数字与事实由前端根据本地记录确定性生成，模型只负责标题、摘要、
 * 结论、行动建议与风险提示。训练、饮食、学习观察复用同一条 /api/report 通道。
 */
export const REPORT_TYPES = ['今日简报', '训练建议', '饮食观察', '学习观察'] as const
export type ReportType = (typeof REPORT_TYPES)[number]

export const REPORT_RANGE_DAYS = [7, 30, 90] as const
export type ReportRangeDays = (typeof REPORT_RANGE_DAYS)[number]

/** 报告只需要档案中可用于建议的字段，不携带姓名、联系方式等标识。 */
export interface ReportProfileData {
  age: number
  height: number
  weight: number
  targetWeight: number
  goal: string
  experience: string
  frequency: string
  equipment: string
  dietPreference: string
  allergies: string
  bedtime: string
  sleepHours: number
  stress: string
  aiConsent: boolean
}

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
  profile: ReportProfileData | null
}

export interface ReportRequest {
  type: ReportType
  rangeDays: ReportRangeDays
  digest: ReportDigest
}

export interface ReportContent {
  title: string
  status: string
  summary: string
  conclusions: string[]
  actions: string[]
  warnings: string[]
}

export interface ReportResponse {
  report: ReportContent
  model: string
}
