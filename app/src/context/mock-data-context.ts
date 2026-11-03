import { createContext, useContext, type Dispatch, type SetStateAction } from 'react'
import type { LongTermPlanDraft } from '../lib/long-term-plan'
import type {
  EveningReviewPayload,
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

export interface MockDataContextValue {
  goals: Goal[]
  updateGoal: (id: string, patch: Partial<Goal>) => void
  planItems: PlanItem[]
  setPlanItems: Dispatch<SetStateAction<PlanItem[]>>
  waterLiters: number
  waterLog: WaterLogEntry[]
  addWater: (milliliters: number) => void
  lastWaterMilliliters: number | null
  undoWater: () => void
  studyRecords: StudyRecord[]
  setStudyRecords: Dispatch<SetStateAction<StudyRecord[]>>
  meals: Meal[]
  setMeals: Dispatch<SetStateAction<Meal[]>>
  fitnessSession: FitnessSessionState | null
  setFitnessSession: Dispatch<SetStateAction<FitnessSessionState | null>>
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
