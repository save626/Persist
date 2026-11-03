import type { LongTermPlan, ProfileData } from '../types'
import type { ChatPlanProposal } from './chat-types'
import {
  isValidIsoDate,
  MAX_PER_WEEK,
  toIsoDate,
  type LongTermPlanDraft,
  type LongTermPlanTargetDraft,
} from './long-term-plan'

/**
 * 对话草案 ↔ 页面表单之间的纯转换层。
 *
 * 把「AI 给的建议」变成「可编辑的草案」这一步必须可测：
 * 日期默认值、档案补丁的展示文案、被丢弃字段的提示，都不应该散落在 JSX 里。
 */

export const PROFILE_FIELD_LABELS: Record<string, string> = {
  age: '年龄',
  height: '身高',
  weight: '体重',
  targetWeight: '目标体重',
  sleepHours: '睡眠时长',
  goal: '当前目标',
  experience: '训练经验',
  frequency: '训练频率',
  equipment: '器械条件',
  dietPreference: '饮食偏好',
  allergies: '过敏与忌口',
  bedtime: '入睡时间',
  stress: '近期压力',
}

export interface ProfilePatchEntry {
  field: string
  label: string
  previous: string
  next: string
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '未填写'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

/** 只列出「真的会变」的字段，供确认页展示改动对比。 */
export function profilePatchEntries(
  patch: Partial<ProfileData>,
  profile: ProfileData,
): ProfilePatchEntry[] {
  const entries: ProfilePatchEntry[] = []
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'aiConsent') continue
    if (value === undefined || value === null || value === '') continue
    const previous = profile[field as keyof ProfileData]
    const previousText = formatValue(previous)
    const nextText = formatValue(value)
    if (previousText === nextText) continue
    entries.push({
      field,
      label: PROFILE_FIELD_LABELS[field] ?? field,
      previous: previousText,
      next: nextText,
    })
  }
  return entries
}

export function describeDroppedProfileFields(dropped: readonly string[]): string {
  if (dropped.length === 0) return ''
  const labels = dropped.map((field) => PROFILE_FIELD_LABELS[field] ?? field)
  return `已忽略 ${dropped.length} 项不符合档案规则的输入：${labels.join('、')}`
}

export function mergeProfilePatch(
  current: Partial<ProfileData>,
  next: Partial<ProfileData>,
): Partial<ProfileData> {
  return { ...current, ...next }
}

export interface ProposalDates {
  startDate: string
  endDate?: string
}

/**
 * 开始日期默认草案创建当天；结束日期默认取最后一个里程碑。
 * 非法日期一律降级，不抛错 —— 表单里永远拿到一个能编辑的值。
 */
export function resolveProposalDates(
  proposal: ChatPlanProposal,
  now: Date = new Date(),
): ProposalDates {
  const startDate =
    proposal.startDate && isValidIsoDate(proposal.startDate) ? proposal.startDate : toIsoDate(now)
  const milestoneDates = proposal.milestones
    .map((milestone) => milestone.date)
    .filter((date) => isValidIsoDate(date))
    .sort()
  const suggestedEnd =
    proposal.endDate && isValidIsoDate(proposal.endDate)
      ? proposal.endDate
      : milestoneDates[milestoneDates.length - 1]
  if (suggestedEnd && suggestedEnd >= startDate) return { startDate, endDate: suggestedEnd }
  return { startDate }
}

export function proposalToDraft(
  proposal: ChatPlanProposal,
  now: Date = new Date(),
): LongTermPlanDraft {
  const dates = resolveProposalDates(proposal, now)
  return {
    title: proposal.title,
    goal: proposal.goal,
    cadence: proposal.cadence,
    ...dates,
    weeklyTargets: proposal.weeklyTargets.map((target) => ({ ...target })),
    milestones: proposal.milestones.map((milestone) => ({ ...milestone })),
    source: 'ai-chat',
  }
}

/** 已保存的计划 → 可编辑草案（用于「继续确认」一份旧草稿）。 */
export function planToDraft(plan: LongTermPlan): LongTermPlanDraft {
  return {
    title: plan.title,
    goal: plan.goal,
    cadence: plan.cadence,
    startDate: plan.startDate,
    ...(plan.endDate ? { endDate: plan.endDate } : {}),
    weeklyTargets: plan.weeklyTargets.map((target) => ({
      label: target.label,
      unit: target.unit,
      perWeek: target.perWeek,
      ...(target.module ? { module: target.module } : {}),
    })),
    milestones: (plan.milestones ?? []).map((milestone) => ({ ...milestone })),
    source: plan.source,
  }
}

export const DEFAULT_MANUAL_TARGET: LongTermPlanTargetDraft = {
  label: '力量训练',
  unit: '次',
  perWeek: 3,
  module: 'fitness',
}

export function emptyPlanDraft(now: Date = new Date()): LongTermPlanDraft {
  return {
    title: '',
    goal: '',
    cadence: 'weekly',
    startDate: toIsoDate(now),
    weeklyTargets: [{ ...DEFAULT_MANUAL_TARGET }],
    milestones: [],
    source: 'manual',
  }
}

export interface DraftValidation {
  ok: boolean
  message: string
  draft?: LongTermPlanDraft
}

/** 表单提交前的统一校验：清洗空白、取整次数、校验日期，失败时给出中文原因。 */
export function validateDraft(draft: LongTermPlanDraft, now: Date = new Date()): DraftValidation {
  const title = draft.title.trim()
  if (!title) return { ok: false, message: '给计划起个标题再保存。' }

  const startDate =
    draft.startDate && isValidIsoDate(draft.startDate) ? draft.startDate : toIsoDate(now)
  const endDate = draft.endDate?.trim() ?? ''
  if (endDate && (!isValidIsoDate(endDate) || endDate < startDate)) {
    return { ok: false, message: '结束日期需要是合法日期，且不能早于开始日期。' }
  }

  const weeklyTargets: LongTermPlanTargetDraft[] = []
  for (const target of draft.weeklyTargets) {
    const label = target.label.trim()
    const perWeek = Math.round(Number(target.perWeek))
    if (!label || !Number.isFinite(perWeek) || perWeek <= 0) continue
    weeklyTargets.push({
      label,
      unit: target.unit,
      perWeek: Math.min(perWeek, MAX_PER_WEEK),
      ...(target.module ? { module: target.module } : {}),
    })
  }
  if (weeklyTargets.length === 0) {
    return { ok: false, message: '至少保留一条有效的每周目标（名称 + 次数）。' }
  }

  return {
    ok: true,
    message: '',
    draft: {
      title,
      goal: draft.goal.trim() || title,
      cadence: draft.cadence,
      startDate,
      ...(endDate ? { endDate } : {}),
      weeklyTargets,
      milestones: draft.milestones ?? [],
      source: draft.source === 'ai-chat' ? 'ai-chat' : 'manual',
    },
  }
}
