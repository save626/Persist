import { createContext, useContext, type Dispatch, type SetStateAction } from 'react'
import type { LongTermPlanDraft } from '../lib/long-term-plan'
import type {
  DietDay,
  EveningReviewPayload,
  FitnessSessionRecord,
  FitnessSessionState,
  Goal,
  ImportableMockData,
  LongTermPlan,
  Meal,
  MockSnapshot,
  MockSettings,
  PlanItem,
  ProfileData,
  ReportRecord,
  StudyRecord,
  WaterLogEntry,
} from '../types'

/**
 * 数据上下文的契约。
 *
 * 0.3.0（8d 数据历史化）之后同时存在两套读法：
 * - `planItems` / `waterLog` / `meals` 保持「今天」的语义不变，页面原有调用点无需改动；
 * - `planHistory` / `waterHistory` / `dietDays` / `fitnessHistory` 暴露全量数据，
 *   供按日筛选、报告窗口与训练历史使用。
 */
export interface MockDataContextValue {
  goals: Goal[]
  updateGoal: (id: string, patch: Partial<Goal>) => void
  /** 「今天」的计划项。 */
  planItems: PlanItem[]
  /** 写「今天」的计划项：只替换今天这一块，其他日期原样保留。 */
  setPlanItems: Dispatch<SetStateAction<PlanItem[]>>
  /** 全部日期的计划项。 */
  planHistory: PlanItem[]
  waterLiters: number
  /** 「今天」的饮水记录。 */
  waterLog: WaterLogEntry[]
  /** 全部日期的饮水记录。 */
  waterHistory: WaterLogEntry[]
  addWater: (milliliters: number) => void
  lastWaterMilliliters: number | null
  undoWater: () => void
  studyRecords: StudyRecord[]
  setStudyRecords: Dispatch<SetStateAction<StudyRecord[]>>
  /** 「今天」的四个餐次。 */
  meals: Meal[]
  /** 写「今天」的饮食：只替换今天这一块，其他日期原样保留。 */
  setMeals: Dispatch<SetStateAction<Meal[]>>
  /** 饮食按日台账（全部日期）。 */
  dietDays: DietDay[]
  fitnessSession: FitnessSessionState | null
  setFitnessSession: Dispatch<SetStateAction<FitnessSessionState | null>>
  /** 已完成训练的归档历史（新→旧）。 */
  fitnessHistory: FitnessSessionRecord[]
  /** 把已完成的会话归档进历史，返回生成的记录。 */
  archiveFitnessSession: (session: FitnessSessionState, now?: Date) => FitnessSessionRecord
  /** 本次会话的「今天」（YYYY-MM-DD，本地时区）。 */
  today: string
  profile: ProfileData
  updateProfile: (patch: Partial<ProfileData>) => void
  settings: MockSettings
  updateSettings: (patch: Partial<MockSettings>) => void
  resetSettings: () => void
  aiConsent: boolean
  setAiConsent: (enabled: boolean) => void
  eveningReview: EveningReviewPayload | null
  setEveningReview: Dispatch<SetStateAction<EveningReviewPayload | null>>
  reports: ReportRecord[]
  setReports: Dispatch<SetStateAction<ReportRecord[]>>
  snapshot: MockSnapshot | null
  createMockSnapshot: () => MockSnapshot
  appendStudyRecords: (records: StudyRecord[]) => void
  replaceMockData: (data: ImportableMockData) => void
  /** 删除本机 IndexedDB 记录并把内存态还原到首次启动基线（设置页「清空本机数据」）。 */
  clearLocalData: () => Promise<void>
  longTermPlans: LongTermPlan[]
  addLongTermPlan: (draft: LongTermPlanDraft) => LongTermPlan | null
  updateLongTermPlan: (id: string, patch: Partial<LongTermPlan>) => void
  archiveLongTermPlan: (id: string) => void
  activatePlan: (id: string) => void
}

export const MockDataContext = createContext<MockDataContextValue | null>(null)

export function useMockData() {
  const value = useContext(MockDataContext)
  if (!value) throw new Error('useMockData must be used within MockDataProvider')
  return value
}
