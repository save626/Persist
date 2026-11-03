/**
 * 服务端结构化结果净化。
 *
 * 模型给什么都不能直接信：这里把 questions / profilePatch / proposal / warnings
 * 逐字段对回契约，越界、类型不对、日期不存在的内容一律丢弃（或整份提案作废），
 * 保证前端拿到的每个字段都符合它自己的校验规则。
 *
 * 与 app/src/lib/profile-rules.ts、long-term-plan.ts 的规则保持同源；
 * 前端接入 shared/ 后这些规则会合并到一处。
 */

import {
  MAX_PROFILE_TEXT_LENGTH,
  NUMBER_FIELDS,
  PROFILE_NUMBER_RULES,
  PROFILE_TEXT_FIELDS,
  type ChatPlanProposal,
  type ChatQuestion,
  type LongTermPlanTargetDraft,
  type PlanCadence,
  type PlanModule,
  type ProfileData,
  type WeeklyTargetUnit,
} from '../contract.js'

const UNITS: readonly WeeklyTargetUnit[] = ['次', '分钟', '公里', '千卡', '篇']
const MODULES: readonly PlanModule[] = ['fitness', 'study', 'diet', 'other']
const QUESTION_FIELDS = new Set<string>([...PROFILE_TEXT_FIELDS, ...NUMBER_FIELDS, 'plan'])

const MAX_QUESTIONS = 4
const MAX_TARGETS = 4
const MAX_MILESTONES = 6
const MAX_LIST_ITEMS = 6

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** 去掉多余空白、裁掉控制字符；空串或超长一律视为无效。 */
function asText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || text.length > maxLength) return null
  return text
}

function asTextList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    if (result.length >= maxItems) break
    const text = asText(item, maxLength)
    if (text && !result.includes(text)) result.push(text)
  }
  return result
}

function asIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null
}

function asNumberInRange(value: unknown, min: number, max: number): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null
  return numeric
}

/** 与前端 sanitizeProfilePatch 同规则：aiConsent 永远不允许由模型写入。 */
export function sanitizeProfilePatch(raw: unknown, profile: ProfileData): Partial<ProfileData> {
  const source = asRecord(raw)
  const patch: Partial<ProfileData> = {}
  if (!source) return patch
  const writable = patch as Record<string, unknown>

  for (const field of NUMBER_FIELDS) {
    if (!(field in source)) continue
    const rule = PROFILE_NUMBER_RULES[field]
    const value = asNumberInRange(source[field], rule.min, rule.max)
    if (value === null || value === profile[field]) continue
    writable[field] = value
  }

  for (const field of PROFILE_TEXT_FIELDS) {
    if (!(field in source)) continue
    const text = asText(source[field], MAX_PROFILE_TEXT_LENGTH)
    if (!text || text === profile[field]) continue
    writable[field] = text
  }

  return patch
}

function sanitizeQuestions(raw: unknown): ChatQuestion[] {
  if (!Array.isArray(raw)) return []
  const questions: ChatQuestion[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (questions.length >= MAX_QUESTIONS) break
    const record = asRecord(item)
    if (!record) continue
    const field = typeof record.field === 'string' ? record.field : ''
    if (!QUESTION_FIELDS.has(field) || seen.has(field)) continue
    const prompt = asText(record.prompt, 160)
    if (!prompt) continue
    seen.add(field)
    const hint = asText(record.hint, 160)
    const options = asTextList(record.options, 6, 30)
    questions.push({
      id: `q-${field}`,
      field: field as ChatQuestion['field'],
      prompt,
      ...(hint ? { hint } : {}),
      ...(options.length > 0 ? { options } : {}),
    })
  }
  return questions
}

function sanitizeTargets(raw: unknown): LongTermPlanTargetDraft[] {
  if (!Array.isArray(raw)) return []
  const targets: LongTermPlanTargetDraft[] = []
  for (const item of raw) {
    if (targets.length >= MAX_TARGETS) break
    const record = asRecord(item)
    if (!record) continue
    const label = asText(record.label, 40)
    const unit =
      typeof record.unit === 'string' && UNITS.includes(record.unit as WeeklyTargetUnit)
        ? (record.unit as WeeklyTargetUnit)
        : null
    const perWeekRaw = asNumberInRange(record.perWeek, 1, 999)
    if (!label || !unit || perWeekRaw === null) continue
    const module =
      typeof record.module === 'string' && MODULES.includes(record.module as PlanModule)
        ? (record.module as PlanModule)
        : undefined
    targets.push({ label, unit, perWeek: Math.round(perWeekRaw), ...(module ? { module } : {}) })
  }
  return targets
}

function sanitizeMilestones(raw: unknown): { date: string; label: string; metric?: string }[] {
  if (!Array.isArray(raw)) return []
  const milestones: { date: string; label: string; metric?: string }[] = []
  for (const item of raw) {
    if (milestones.length >= MAX_MILESTONES) break
    const record = asRecord(item)
    if (!record) continue
    const date = asIsoDate(record.date)
    const label = asText(record.label, 60)
    if (!date || !label) continue
    const metric = asText(record.metric, 60)
    milestones.push({ date, label, ...(metric ? { metric } : {}) })
  }
  return milestones
}

function sanitizeProposal(raw: unknown, profile: ProfileData): ChatPlanProposal | null {
  const record = asRecord(raw)
  if (!record) return null
  const title = asText(record.title, 60)
  if (!title) return null
  const weeklyTargets = sanitizeTargets(record.weeklyTargets)
  // 没有一条合法周目标的提案没有意义，整份作废，前端会继续追问。
  if (weeklyTargets.length === 0) return null

  const goal = asText(record.goal, 200) ?? title
  const cadence: PlanCadence = record.cadence === 'cycle' ? 'cycle' : 'weekly'
  const startDate = asIsoDate(record.startDate)
  const endDateCandidate = asIsoDate(record.endDate)
  const endDate =
    endDateCandidate && startDate && endDateCandidate >= startDate ? endDateCandidate : undefined

  return {
    title,
    goal,
    cadence,
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    weeklyTargets,
    milestones: sanitizeMilestones(record.milestones),
    profilePatch: sanitizeProfilePatch(record.profilePatch, profile),
    assumptions: asTextList(record.assumptions, MAX_LIST_ITEMS, 160),
    warnings: asTextList(record.warnings, MAX_LIST_ITEMS, 160),
    highlights: asTextList(record.highlights, MAX_LIST_ITEMS, 160),
  }
}

export interface SanitizedExtraction {
  questions: ChatQuestion[]
  patch: Partial<ProfileData>
  proposal: ChatPlanProposal | null
  warnings: string[]
}

export function sanitizeExtraction(raw: unknown, profile: ProfileData): SanitizedExtraction {
  const record = asRecord(raw) ?? {}
  return {
    questions: sanitizeQuestions(record.questions),
    patch: sanitizeProfilePatch(record.profilePatch, profile),
    proposal: sanitizeProposal(record.proposal, profile),
    warnings: asTextList(record.warnings, MAX_LIST_ITEMS, 160),
  }
}
