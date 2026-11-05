/**
 * 服务端契约：与 app/src/lib/chat-types.ts 保持一致。
 *
 * 说明：P3 先把契约收在服务端内部，前端接入（下一步）时再整体搬到 shared/，
 * 避免这一轮同时改动前端 tsconfig / Vite 别名。两份定义必须同源同义，
 * 字段增减都要同步改，不允许服务端私自扩展 UI 不认识的事件。
 */

import type { ParseResult as SharedParseResult } from '@persist/shared/contract/parse'

export type ChatRole = 'user' | 'assistant'

export interface ChatTurn {
  role: ChatRole
  content: string
}

export interface ProfileData {
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

export type ProfileFieldKey = Exclude<keyof ProfileData, 'aiConsent'>

export interface ChatRequest {
  turns: ChatTurn[]
  profile: ProfileData
  askedFields?: string[]
}

export interface ChatQuestion {
  id: string
  field: ProfileFieldKey | 'plan'
  prompt: string
  hint?: string
  options?: string[]
}

export type PlanCadence = 'weekly' | 'cycle'
export type WeeklyTargetUnit = '次' | '分钟' | '公里' | '千卡' | '篇'
export type PlanModule = 'fitness' | 'study' | 'diet' | 'other'

export interface LongTermPlanTargetDraft {
  label: string
  unit: WeeklyTargetUnit
  perWeek: number
  module?: PlanModule
}

export interface ChatPlanProposal {
  title: string
  goal: string
  cadence: PlanCadence
  startDate?: string
  endDate?: string
  weeklyTargets: LongTermPlanTargetDraft[]
  milestones: { date: string; label: string; metric?: string }[]
  profilePatch: Partial<ProfileData>
  assumptions: string[]
  warnings: string[]
  highlights: string[]
}

export type ChatEvent =
  | { type: 'stage'; stage: 'collect' | 'propose' | 'applied' }
  | { type: 'delta'; text: string }
  | { type: 'questions'; questions: ChatQuestion[] }
  | { type: 'profilePatch'; patch: Partial<ProfileData> }
  | { type: 'proposal'; proposal: ChatPlanProposal }
  | { type: 'warnings'; warnings: string[] }
  | { type: 'done' }

/** 流到一半失败时额外发的事件；不是正常完成路径的一部分。 */
export interface ChatErrorEvent {
  type: 'error'
  code: 'ai_failed' | 'timeout' | 'invalid_response'
  message: string
}

export type ChatStreamEvent = ChatEvent | ChatErrorEvent

/** 与 app/src/lib/profile-rules.ts 的 PROFILE_NUMBER_RULES 保持一致。 */
export const PROFILE_NUMBER_RULES = {
  age: { min: 14, max: 100 },
  height: { min: 120, max: 230 },
  weight: { min: 35, max: 250 },
  targetWeight: { min: 35, max: 250 },
  sleepHours: { min: 3, max: 14 },
} as const

export type ProfileNumberField = keyof typeof PROFILE_NUMBER_RULES

export const PROFILE_TEXT_FIELDS = [
  'goal',
  'experience',
  'frequency',
  'equipment',
  'dietPreference',
  'allergies',
  'bedtime',
  'stress',
] as const satisfies readonly ProfileFieldKey[]

export const MAX_PROFILE_TEXT_LENGTH = 120

export const NUMBER_FIELDS = Object.keys(PROFILE_NUMBER_RULES) as ProfileNumberField[]

const ROLE_SET = new Set<string>(['user', 'assistant'])

export interface ChatLimits {
  maxTurns: number
  maxTurnChars: number
  maxPromptChars: number
}

/** 定义在 shared（服务端 / 前端同一份）；这里只给 chat 契约保留原来的默认类型参数。 */
export type ParseResult<T = ChatRequest> = SharedParseResult<T>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 严格校验档案上下文。
 * 对话与报告共用同一份规则：数字字段必须是有限数字、文本字段必须是字符串、
 * aiConsent 必须是布尔值，且忽略未知字段（向前兼容旧客户端）。
 */
export function parseProfile(raw: unknown): ParseResult<ProfileData> {
  if (!isRecord(raw)) return { ok: false, message: '缺少 profile 档案上下文。' }

  const profile = {} as ProfileData
  for (const field of NUMBER_FIELDS) {
    const value = raw[field]
    if (!isFiniteNumber(value)) {
      return { ok: false, message: `profile.${field} 必须是有限数字。` }
    }
    profile[field] = value
  }
  for (const field of PROFILE_TEXT_FIELDS) {
    const value = raw[field]
    if (typeof value !== 'string') {
      return { ok: false, message: `profile.${field} 必须是字符串。` }
    }
    profile[field] = value.trim()
  }
  if (typeof raw.aiConsent !== 'boolean') {
    return { ok: false, message: 'profile.aiConsent 必须是布尔值。' }
  }
  profile.aiConsent = raw.aiConsent

  return { ok: true, value: profile }
}

/**
 * 严格校验一次对话请求。
 * 任何字段类型不对都直接拒绝（400），不做「猜你想要」的静默修复：
 * 请求体是内部契约，不是用户输入，坏了应该让前端报错而不是让模型收到垃圾上下文。
 */
export function parseChatRequest(body: unknown, limits: ChatLimits): ParseResult {
  if (!isRecord(body)) return { ok: false, message: '请求体必须是 JSON 对象。' }

  const rawTurns = body.turns
  if (!Array.isArray(rawTurns) || rawTurns.length === 0) {
    return { ok: false, message: 'turns 必须是非空数组。' }
  }
  if (rawTurns.length > limits.maxTurns) {
    return { ok: false, message: `对话轮次过多（上限 ${limits.maxTurns} 条）。` }
  }

  const turns: ChatTurn[] = []
  let totalChars = 0
  for (const rawTurn of rawTurns) {
    if (!isRecord(rawTurn)) return { ok: false, message: 'turns 的每一项必须是对象。' }
    const role = rawTurn.role
    if (typeof role !== 'string' || !ROLE_SET.has(role)) {
      return { ok: false, message: 'turns[].role 只能是 user 或 assistant。' }
    }
    if (typeof rawTurn.content !== 'string') {
      return { ok: false, message: 'turns[].content 必须是字符串。' }
    }
    const content = rawTurn.content.trim()
    if (!content) return { ok: false, message: 'turns[].content 不能为空。' }
    if (content.length > limits.maxTurnChars) {
      return { ok: false, message: `单条消息过长（上限 ${limits.maxTurnChars} 字）。` }
    }
    totalChars += content.length
    turns.push({ role: role as ChatRole, content })
  }
  if (totalChars > limits.maxPromptChars) {
    return { ok: false, message: `对话总长度过长（上限 ${limits.maxPromptChars} 字）。` }
  }
  const lastTurn = turns[turns.length - 1]
  if (!lastTurn || lastTurn.role !== 'user') {
    return { ok: false, message: '最后一次发言必须来自 user。' }
  }

  const profileResult = parseProfile(body.profile)
  if (!profileResult.ok) return profileResult
  const profile = profileResult.value

  let askedFields: string[] | undefined
  if (body.askedFields !== undefined) {
    if (!Array.isArray(body.askedFields)) {
      return { ok: false, message: 'askedFields 必须是字符串数组。' }
    }
    if (body.askedFields.length > 30) {
      return { ok: false, message: 'askedFields 数量过多。' }
    }
    askedFields = []
    for (const item of body.askedFields) {
      if (typeof item !== 'string' || item.length > 40) {
        return { ok: false, message: 'askedFields 的每一项必须是长度不超过 40 的字符串。' }
      }
      askedFields.push(item)
    }
  }

  return {
    ok: true,
    value: { turns, profile, ...(askedFields ? { askedFields } : {}) },
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } }
}

// ---------------------------------------------------------------------------
// AI 报告（8c）
//
// 与 app/src/lib/report-types.ts 同源。报告只需要「文字结论」：
// 数字、指标与引用依据都由前端按本地记录确定性生成，模型不得编造。
// 请求里的每个模块都必须是用户已授权且来源开关打开的数据，未授权的模块一律为 null。
// ---------------------------------------------------------------------------

export const REPORT_TYPES = ['今日简报', '训练建议', '学习观察'] as const
export type ReportType = (typeof REPORT_TYPES)[number]

export const REPORT_RANGE_DAYS = [7, 30, 90] as const
export type ReportRangeDays = (typeof REPORT_RANGE_DAYS)[number]

/** 训练摘要：只有聚合数字与动作名，不包含任何备注原文。 */
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

const REPORT_TYPE_SET = new Set<string>(REPORT_TYPES)
const REPORT_RANGE_SET = new Set<number>(REPORT_RANGE_DAYS)

/** 单个模块的数字上限：越界一律拒绝，不做静默截断。 */
const LIMITS = {
  exerciseCount: 50,
  sets: 500,
  strengthVolumeKg: 1_000_000,
  durationMinutes: 10_000,
  distanceKm: 1_000,
  studyRecords: 5_000,
  studyMinutes: 1_000_000,
  mealCount: 50,
  foodEntries: 1_000,
  waterLiters: 20,
  waterEvents: 500,
} as const

function readCount(value: unknown, max: number): number | null {
  if (!Number.isInteger(value)) return null
  const numeric = value as number
  return numeric >= 0 && numeric <= max ? numeric : null
}

function readAmount(value: unknown, max: number): number | null {
  if (!isFiniteNumber(value)) return null
  return value >= 0 && value <= max ? value : null
}

function readTextList(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length > maxItems) return null
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const text = item.replace(/\s+/g, ' ').trim()
    if (text.length > maxLength) return null
    items.push(text)
  }
  return items
}

function readFitnessDigest(raw: unknown): ParseResult<ReportFitnessDigest> {
  if (!isRecord(raw)) return { ok: false, message: 'digest.fitness 必须是对象或 null。' }
  if (typeof raw.hasSession !== 'boolean') {
    return { ok: false, message: 'digest.fitness.hasSession 必须是布尔值。' }
  }
  const counts = {} as Record<'exerciseCount' | 'doneSets' | 'totalSets', number>
  const rules: [keyof typeof counts, number][] = [
    ['exerciseCount', LIMITS.exerciseCount],
    ['doneSets', LIMITS.sets],
    ['totalSets', LIMITS.sets],
  ]
  for (const [field, max] of rules) {
    const value = readCount(raw[field], max)
    if (value === null) {
      return { ok: false, message: `digest.fitness.${field} 必须是 0–${max} 的整数。` }
    }
    counts[field] = value
  }
  const strengthVolumeKg = readAmount(raw.strengthVolumeKg, LIMITS.strengthVolumeKg)
  if (strengthVolumeKg === null) {
    return { ok: false, message: 'digest.fitness.strengthVolumeKg 必须是有效的非负数字。' }
  }
  const durationMinutes = readAmount(raw.durationMinutes, LIMITS.durationMinutes)
  if (durationMinutes === null) {
    return { ok: false, message: 'digest.fitness.durationMinutes 必须是有效的非负数字。' }
  }
  const distanceKm = readAmount(raw.distanceKm, LIMITS.distanceKm)
  if (distanceKm === null) {
    return { ok: false, message: 'digest.fitness.distanceKm 必须是有效的非负数字。' }
  }
  const exerciseNames = readTextList(raw.exerciseNames, 8, 20)
  if (!exerciseNames) {
    return { ok: false, message: 'digest.fitness.exerciseNames 必须是长度不超过 20 的字符串数组。' }
  }

  return {
    ok: true,
    value: {
      hasSession: raw.hasSession,
      ...counts,
      strengthVolumeKg,
      durationMinutes,
      distanceKm,
      exerciseNames,
    },
  }
}

function readStudyDigest(raw: unknown): ParseResult<ReportStudyDigest> {
  if (!isRecord(raw)) return { ok: false, message: 'digest.study 必须是对象或 null。' }
  const recordCount = readCount(raw.recordCount, LIMITS.studyRecords)
  if (recordCount === null) {
    return {
      ok: false,
      message: `digest.study.recordCount 必须是 0–${LIMITS.studyRecords} 的整数。`,
    }
  }
  const englishCount = readCount(raw.englishCount, LIMITS.studyRecords)
  if (englishCount === null) {
    return { ok: false, message: 'digest.study.englishCount 必须是有效的非负整数。' }
  }
  const mathCount = readCount(raw.mathCount, LIMITS.studyRecords)
  if (mathCount === null) {
    return { ok: false, message: 'digest.study.mathCount 必须是有效的非负整数。' }
  }
  const totalMinutes = readAmount(raw.totalMinutes, LIMITS.studyMinutes)
  if (totalMinutes === null) {
    return { ok: false, message: 'digest.study.totalMinutes 必须是有效的非负数字。' }
  }
  return { ok: true, value: { recordCount, englishCount, mathCount, totalMinutes } }
}

function readDietDigest(raw: unknown): ParseResult<ReportDietDigest> {
  if (!isRecord(raw)) return { ok: false, message: 'digest.diet 必须是对象或 null。' }
  const mealCount = readCount(raw.mealCount, LIMITS.mealCount)
  if (mealCount === null) {
    return { ok: false, message: `digest.diet.mealCount 必须是 0–${LIMITS.mealCount} 的整数。` }
  }
  const foodEntryCount = readCount(raw.foodEntryCount, LIMITS.foodEntries)
  if (foodEntryCount === null) {
    return {
      ok: false,
      message: `digest.diet.foodEntryCount 必须是 0–${LIMITS.foodEntries} 的整数。`,
    }
  }
  const waterLiters = readAmount(raw.waterLiters, LIMITS.waterLiters)
  if (waterLiters === null) {
    return { ok: false, message: 'digest.diet.waterLiters 必须是 0–20 的数字。' }
  }
  const waterEvents = readCount(raw.waterEvents, LIMITS.waterEvents)
  if (waterEvents === null) {
    return { ok: false, message: 'digest.diet.waterEvents 必须是有效的非负整数。' }
  }
  return { ok: true, value: { mealCount, foodEntryCount, waterLiters, waterEvents } }
}

/**
 * 严格校验一次报告请求。
 * 至少要有一个人工开启的数据来源，否则模型拿不到任何事实、只会编造内容，
 * 这种情况直接拒绝，让前端继续走本地 Mock。
 */
export function parseReportRequest(body: unknown): ParseResult<ReportRequest> {
  if (!isRecord(body)) return { ok: false, message: '请求体必须是 JSON 对象。' }

  const type = body.type
  if (typeof type !== 'string' || !REPORT_TYPE_SET.has(type)) {
    return { ok: false, message: `type 只能是 ${REPORT_TYPES.join('、')}。` }
  }
  if (typeof body.rangeDays !== 'number' || !REPORT_RANGE_SET.has(body.rangeDays)) {
    return { ok: false, message: `rangeDays 只能是 ${REPORT_RANGE_DAYS.join('、')}。` }
  }
  if (!isRecord(body.digest)) return { ok: false, message: '缺少 digest 数据摘要。' }
  const digest = body.digest

  const readings = [
    ['fitness', digest.fitness, readFitnessDigest],
    ['study', digest.study, readStudyDigest],
    ['diet', digest.diet, readDietDigest],
  ] as const

  let fitness: ReportFitnessDigest | null = null
  let study: ReportStudyDigest | null = null
  let diet: ReportDietDigest | null = null
  for (const [name, raw, read] of readings) {
    if (raw === null || raw === undefined) continue
    const result = read(raw)
    if (!result.ok) return result
    if (name === 'fitness') fitness = result.value as ReportFitnessDigest
    else if (name === 'study') study = result.value as ReportStudyDigest
    else diet = result.value as ReportDietDigest
  }

  let profile: ProfileData | null = null
  if (digest.profile !== null && digest.profile !== undefined) {
    const profileResult = parseProfile(digest.profile)
    if (!profileResult.ok) return profileResult
    profile = profileResult.value
  }

  if (!fitness && !study && !diet && !profile) {
    return { ok: false, message: 'digest 里没有任何可引用的数据来源。' }
  }

  return {
    ok: true,
    value: {
      type: type as ReportType,
      rangeDays: body.rangeDays as ReportRangeDays,
      digest: { fitness, study, diet, profile },
    },
  }
}
