export type GoalTone = 'primary' | 'alt'

export interface Goal {
  id: string
  title: string
  date: string
  time: string
  enabled: boolean
  tone: GoalTone
}

export type PlanKind = 'default' | 'food' | 'water' | 'study'

export interface PlanItem {
  id: string
  name: string
  time: string
  detail: string
  kind: PlanKind
  done: boolean
  actionable?: boolean
  /** 计划归属日（YYYY-MM-DD，本地时区）。v2 起必填；v1 数据迁移时补当天日期。 */
  date: string
}

export type StudyCategory = 'english' | 'math'

export interface StudyRecord {
  id: string
  category: StudyCategory
  source: string
  date: string
  startTime: string
  duration: number
  note: string
  newWords?: number
  reviewWords?: number
  accuracy?: number
  listening?: number
  chapter?: string
  questions?: number
  wrong?: number
}

export type MealId = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface FoodEntry {
  id: string
  name: string
  portion: string
  calories: number
  protein: number
  carbs: number
  fat: number
}

export interface Meal {
  id: MealId
  label: string
  time: string
  entries: FoodEntry[]
}

export type ExerciseKind = 'strength' | 'duration' | 'distance'

export interface WorkoutSet {
  id: string
  weight?: number
  reps?: number
  durationMinutes?: number
  distanceKm?: number
  rpe?: number
  done: boolean
}

export interface Exercise {
  id: string
  name: string
  kind?: ExerciseKind
  muscle: string
  equipment: string
  targetReps: string
  rest: string
  sets: WorkoutSet[]
}

export interface ExerciseTemplate {
  id: string
  name: string
  kind?: ExerciseKind
  muscle: string
  equipment: string
  targetReps: string
  rest: string
  setCount: number
  weight?: number
  reps?: number
  durationMinutes?: number
  distanceKm?: number
}

export type SessionStatus = 'active' | 'completed'

export interface FitnessSessionState {
  activeTemplateId: string
  exercises: Exercise[]
  sessionStatus: SessionStatus
  elapsedSeconds: number
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

export type ReminderId = 'water' | 'training' | 'review'

export interface Reminder {
  id: ReminderId
  title: string
  detail: string
  time: string
  enabled: boolean
  icon: 'water' | 'fitness' | 'clock'
}

export type DataSource = 'fitness' | 'diet' | 'study' | 'profile'

/** 每日简报（服务端定时聚合）：默认关闭，开启后由服务端每天按时生成并归档。 */
export interface DailyBriefSettings {
  enabled: boolean
  /** 生成时刻 HH:mm；非法值回退 21:00。 */
  at: string
}

export interface MockSettings {
  reminders: Reminder[]
  summaryOnly: boolean
  sources: Record<DataSource, boolean>
  /**
   * 每日简报设置。旧版本快照没有该字段，读取时用
   * `normalizeDailyBriefSettings` 补默认值（关闭 + 21:00），不改 schema 版本。
   */
  dailyBrief?: DailyBriefSettings
}

export interface WaterLogEntry {
  id: string
  milliliters: number
  time: string
  /** 饮水归属日（YYYY-MM-DD，本地时区）。v2 起必填。 */
  date: string
}

/** 一天的饮食台账：`meals` 是该日四个餐次（含空餐次）的快照。 */
export interface DietDay {
  date: string
  meals: Meal[]
}

/**
 * 已完成的训练归档。与 `FitnessSessionState`（进行中的那个会话）区分：
 * 历史记录多了 `id` / `date` / `completedAt`，可以按日排序和批量检索。
 */
export interface FitnessSessionRecord {
  id: string
  /** 完成训练当天（YYYY-MM-DD，本地时区）。 */
  date: string
  /** 完成时刻（ISO 8601），同一天多次训练按它排序。 */
  completedAt: string
  templateId: string
  elapsedSeconds: number
  exercises: Exercise[]
}

export interface EveningReviewPayload {
  energy: number
  state: string
  note: string
}

export interface ReportMetric {
  label: string
  value: string
  detail: string
}

export interface ReportRecord {
  id: string
  type: string
  title: string
  date: string
  updatedAt?: string
  period: string
  summary: string
  status: string
  metric: ReportMetric[]
  conclusions: string[]
  actions: string[]
  evidence: string[]
  /**
   * 这份报告的来源：经服务端调用 DeepSeek、服务端规则降级、本地 Mock 规则生成，
   * 或部署前已固化进前端包的 demo 预生成内容；旧数据没有该字段。
   */
  origin?: 'ai' | 'rules' | 'mock' | 'prebuilt'
  /** 预生成内容的真实模型与生成时间；只有 origin === 'prebuilt' 时存在。 */
  prebuilt?: {
    model: string
    generatedAt: string
  }
}

export type PlanCadence = 'weekly' | 'cycle'

export type WeeklyTargetUnit = '次' | '分钟' | '公里' | '千卡' | '篇'

export type PlanModule = 'fitness' | 'study' | 'diet' | 'other'

export interface WeeklyTarget {
  id: string
  label: string
  unit: WeeklyTargetUnit
  perWeek: number
  module?: PlanModule
}

export type LongTermPlanStatus = 'draft' | 'active' | 'archived'

export interface LongTermPlanMilestone {
  date: string
  label: string
  metric?: string
}

export interface LongTermPlan {
  id: string
  title: string
  goal: string
  startDate: string
  endDate?: string
  cadence: PlanCadence
  weeklyTargets: WeeklyTarget[]
  milestones?: LongTermPlanMilestone[]
  status: LongTermPlanStatus
  source: 'ai-chat' | 'manual'
  createdAt: string
}

export interface MockSnapshot {
  id: string
  createdAt: string
  recordCount: number
}

export interface ImportableMockData {
  goals: Goal[]
  /** 全部日期的计划项；按日筛选由 lib/history.ts 的 `planItemsForDate` 完成。 */
  planItems: PlanItem[]
  /** 全部日期的饮水记录；按日汇总由 `waterForDate` 完成。 */
  waterLog: WaterLogEntry[]
  studyRecords: StudyRecord[]
  /** 饮食按日台账（v2 起替代原来的「只有今天」的 `meals` 切片）。 */
  dietDays: DietDay[]
  /** 进行中的训练会话；完成后归档进 `fitnessHistory`。 */
  fitnessSession: FitnessSessionState | null
  /** 已完成的训练历史（v2 新增）。 */
  fitnessHistory: FitnessSessionRecord[]
  profile: ProfileData
  settings: MockSettings
  aiConsent: boolean
  eveningReview: EveningReviewPayload | null
  reports: ReportRecord[]
  longTermPlans?: LongTermPlan[]
}
