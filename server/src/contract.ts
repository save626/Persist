/**
 * 服务端契约：与 app/src/lib/chat-types.ts 保持一致。
 *
 * 说明：P3 先把契约收在服务端内部，前端接入（下一步）时再整体搬到 shared/，
 * 避免这一轮同时改动前端 tsconfig / Vite 别名。两份定义必须同源同义，
 * 字段增减都要同步改，不允许服务端私自扩展 UI 不认识的事件。
 */

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

export type ParseResult = { ok: true; value: ChatRequest } | { ok: false; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
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

  const rawProfile = body.profile
  if (!isRecord(rawProfile)) return { ok: false, message: '缺少 profile 档案上下文。' }

  const profile = {} as ProfileData
  for (const field of NUMBER_FIELDS) {
    const value = rawProfile[field]
    if (!isFiniteNumber(value)) {
      return { ok: false, message: `profile.${field} 必须是有限数字。` }
    }
    profile[field] = value
  }
  for (const field of PROFILE_TEXT_FIELDS) {
    const value = rawProfile[field]
    if (typeof value !== 'string') {
      return { ok: false, message: `profile.${field} 必须是字符串。` }
    }
    profile[field] = value.trim()
  }
  if (typeof rawProfile.aiConsent !== 'boolean') {
    return { ok: false, message: 'profile.aiConsent 必须是布尔值。' }
  }
  profile.aiConsent = rawProfile.aiConsent

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
