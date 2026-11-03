import type {
  FitnessSessionState,
  LongTermPlan,
  PlanCadence,
  PlanModule,
  StudyRecord,
  WeeklyTarget,
  WeeklyTargetUnit,
} from '../types'

export const WEEKLY_TARGET_UNITS: WeeklyTargetUnit[] = ['次', '分钟', '公里', '千卡', '篇']

export const PLAN_MODULES: PlanModule[] = ['fitness', 'study', 'diet', 'other']

export const MAX_PER_WEEK = 999

const UNIT_SET = new Set<string>(WEEKLY_TARGET_UNITS)
const MODULE_SET = new Set<string>(PLAN_MODULES)

export interface LongTermPlanTargetDraft {
  label: string
  unit: WeeklyTargetUnit
  perWeek: number
  module?: PlanModule
}

export interface LongTermPlanDraft {
  title: string
  goal: string
  cadence: PlanCadence
  startDate?: string
  endDate?: string
  weeklyTargets: LongTermPlanTargetDraft[]
  milestones?: LongTermPlan['milestones']
  /** 计划来源：AI 对话确认的填 'ai-chat'；手工创建/导入的留空，按 'manual' 落库 */
  source?: LongTermPlan['source']
}

export function toIsoDate(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 严格校验 YYYY-MM-DD，并且必须是真实存在的日历日。
 * 不能用 Date.parse() 单独判定：它会把 '2026-02-30' 悄悄滚到 3 月 2 日，
 * 于是不存在的日期在创建、导入两侧都会被放行。这里按年月日回填一次再比对。
 */
export function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function normalizePerWeek(value: number) {
  if (!Number.isFinite(value)) return null
  const rounded = Math.round(value)
  if (rounded <= 0) return null
  return Math.min(rounded, MAX_PER_WEEK)
}

function normalizeTarget(draft: LongTermPlanTargetDraft, index: number): WeeklyTarget | null {
  const label = String(draft.label ?? '').trim()
  if (!label) return null
  if (!UNIT_SET.has(draft.unit)) return null
  const perWeek = normalizePerWeek(draft.perWeek)
  if (perWeek === null) return null
  const module = draft.module && MODULE_SET.has(draft.module) ? draft.module : undefined
  return {
    id: `target-${index + 1}`,
    label,
    unit: draft.unit,
    perWeek,
    ...(module ? { module } : {}),
  }
}

/**
 * 把对话（或未来服务端）给出的计划提案归一化成可落库的结构。
 * 任何不合法的字段要么被过滤，要么让整份提案作废，绝不写入半成品。
 */
export function createLongTermPlan(
  draft: LongTermPlanDraft,
  now: Date = new Date(),
): LongTermPlan | null {
  const title = String(draft.title ?? '').trim()
  if (!title) return null
  const goal = String(draft.goal ?? '').trim() || title
  const cadence: PlanCadence = draft.cadence === 'cycle' ? 'cycle' : 'weekly'
  const weeklyTargets = draft.weeklyTargets
    .map((target, index) => normalizeTarget(target, index))
    .filter((target): target is WeeklyTarget => target !== null)
  if (weeklyTargets.length === 0) return null

  const startDate =
    draft.startDate && isValidIsoDate(draft.startDate) ? draft.startDate : toIsoDate(now)
  const endDate =
    draft.endDate && isValidIsoDate(draft.endDate) && draft.endDate >= startDate
      ? draft.endDate
      : undefined

  const milestones = (draft.milestones ?? [])
    .filter(
      (item) => item && isValidIsoDate(String(item.date ?? '')) && String(item.label ?? '').trim(),
    )
    .map((item) => ({
      date: item.date,
      label: String(item.label).trim(),
      ...(item.metric ? { metric: item.metric } : {}),
    }))

  return {
    id: `plan-${now.getTime()}`,
    title,
    goal,
    startDate,
    ...(endDate ? { endDate } : {}),
    cadence,
    weeklyTargets,
    ...(milestones.length > 0 ? { milestones } : {}),
    status: 'draft',
    source: draft.source === 'ai-chat' ? 'ai-chat' : 'manual',
    createdAt: now.toISOString(),
  }
}

export interface WeekRange {
  start: Date
  end: Date
  startIso: string
  endIso: string
  label: string
}

/** 周一为一周起点，和中文习惯的「本周」一致。 */
export function getWeekRange(now: Date = new Date()): WeekRange {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const offset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - offset)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return {
    start,
    end,
    startIso: toIsoDate(start),
    endIso: toIsoDate(end),
    label: `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`,
  }
}

export function isDateInWeek(isoDate: string, week: WeekRange) {
  if (!isValidIsoDate(isoDate)) return false
  return isoDate >= week.startIso && isoDate <= week.endIso
}

export interface WeeklyTargetProgress {
  target: WeeklyTarget
  achieved: number
  ratio: number
  done: boolean
  estimated: boolean
}

export function summarizeWeekProgress(
  plan: LongTermPlan,
  achieved: Record<string, number>,
  estimatedModules: PlanModule[] = [],
): WeeklyTargetProgress[] {
  const estimated = new Set(estimatedModules)
  return plan.weeklyTargets.map((target) => {
    const raw = achieved[target.id] ?? 0
    const value = Number.isFinite(raw) ? Math.max(0, raw) : 0
    const ratio = target.perWeek > 0 ? Math.min(1, value / target.perWeek) : 0
    return {
      target,
      achieved: value,
      ratio,
      done: value >= target.perWeek,
      estimated: target.module ? estimated.has(target.module) : false,
    }
  })
}

export function overallProgress(rows: WeeklyTargetProgress[]) {
  if (rows.length === 0) return 0
  const total = rows.reduce((sum, row) => sum + row.ratio, 0)
  return Math.round((total / rows.length) * 100)
}

export interface WeeklyActivityInput {
  studyRecords: StudyRecord[]
  fitnessSession: FitnessSessionState | null
  now?: Date
}

export interface DerivedAchievements {
  achieved: Record<string, number>
  estimatedModules: PlanModule[]
}

/**
 * 从现有 Mock 数据里估算本周完成量。
 * 健身目前只有一个进行中的会话，学习有完整记录，因此结果一律标记为「估算」，
 * 界面上必须如实说明，不能当成真实统计。
 */
export function deriveWeeklyAchievements(
  plan: LongTermPlan,
  input: WeeklyActivityInput,
): DerivedAchievements {
  const week = getWeekRange(input.now ?? new Date())
  const weekStudy = input.studyRecords.filter((record) => isDateInWeek(record.date, week))
  const studyMinutes = weekStudy.reduce(
    (total, record) => total + (Number.isFinite(record.duration) ? record.duration : 0),
    0,
  )
  const sessionCompleted = input.fitnessSession?.sessionStatus === 'completed'
  const fitnessMinutes = sessionCompleted
    ? Math.round((input.fitnessSession?.elapsedSeconds ?? 0) / 60)
    : 0
  const achieved: Record<string, number> = {}
  const estimatedModules = new Set<PlanModule>()

  for (const target of plan.weeklyTargets) {
    if (target.module === 'study') {
      achieved[target.id] = target.unit === '分钟' ? studyMinutes : weekStudy.length
      estimatedModules.add('study')
      continue
    }
    if (target.module === 'fitness') {
      achieved[target.id] = target.unit === '分钟' ? fitnessMinutes : sessionCompleted ? 1 : 0
      estimatedModules.add('fitness')
      continue
    }
    if (target.module === 'diet') {
      achieved[target.id] = 0
      estimatedModules.add('diet')
      continue
    }
    achieved[target.id] = 0
  }

  return { achieved, estimatedModules: [...estimatedModules] }
}

export function activePlan(plans: LongTermPlan[]) {
  return plans.find((plan) => plan.status === 'active') ?? null
}

/**
 * 纯函数：把指定计划设为进行中，并把原来那份进行中的计划归档。
 * 对应「用户在草案页点确认」这一步，不做任何 IO；找不到目标时原样返回（引用不变）。
 */
export function activateLongTermPlan(plans: LongTermPlan[], id: string): LongTermPlan[] {
  if (!plans.some((plan) => plan.id === id)) return plans
  return plans.map((plan) => {
    if (plan.id === id) return { ...plan, status: 'active' as const }
    if (plan.status === 'active') return { ...plan, status: 'archived' as const }
    return plan
  })
}

export function planStatusLabel(status: LongTermPlan['status']) {
  if (status === 'active') return '进行中'
  if (status === 'archived') return '已归档'
  return '待确认'
}

export function cadenceLabel(cadence: PlanCadence) {
  return cadence === 'cycle' ? '周期计划' : '周计划'
}
