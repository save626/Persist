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
  photoName?: string
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

export interface MockSettings {
  reminders: Reminder[]
  summaryOnly: boolean
  sources: Record<DataSource, boolean>
}

export interface WaterLogEntry {
  id: string
  milliliters: number
  time: string
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
  planItems: PlanItem[]
  waterLog: WaterLogEntry[]
  studyRecords: StudyRecord[]
  meals: Meal[]
  fitnessSession: FitnessSessionState | null
  profile: ProfileData
  settings: MockSettings
  aiConsent: boolean
  eveningReview: EveningReviewPayload | null
  reports: ReportRecord[]
  longTermPlans?: LongTermPlan[]
}
