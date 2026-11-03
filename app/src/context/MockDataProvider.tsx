import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { INITIAL_MEALS } from '../data/diet'
import { INITIAL_PROFILE } from '../data/profile'
import { INITIAL_REPORTS } from '../data/reports'
import { INITIAL_SETTINGS } from '../data/settings'
import { INITIAL_STUDY_RECORDS } from '../data/study'
import {
  activateLongTermPlan,
  createLongTermPlan,
  type LongTermPlanDraft,
} from '../lib/long-term-plan'
import { countMockRecords } from '../lib/mock-data-transfer'
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
import { MockDataContext } from './mock-data-context'

const INITIAL_GOALS: Goal[] = [
  {
    id: 'goal-1',
    title: '高数阶段测验',
    date: '2026-11-15',
    time: '19:00',
    enabled: true,
    tone: 'primary',
  },
  {
    id: 'goal-2',
    title: '英语六级考试',
    date: '2026-12-19',
    time: '09:00',
    enabled: true,
    tone: 'alt',
  },
]

const INITIAL_PLAN: PlanItem[] = [
  {
    id: 'morning',
    name: '早餐与晨间记录',
    time: '08:20',
    detail: '380 kcal · 睡眠 7 小时 10 分',
    kind: 'default',
    done: true,
  },
  {
    id: 'lunch',
    name: '午餐记录',
    time: '12:25',
    detail: '鸡胸肉藜麦碗 · 620 kcal',
    kind: 'food',
    done: true,
  },
  {
    id: 'water',
    name: '午后补水',
    time: '15:40',
    detail: '250 ml · 今日累计 1.2 L',
    kind: 'water',
    done: true,
  },
  {
    id: 'training',
    name: '上肢力量训练',
    time: '18:30',
    detail: '45 分钟 · 胸 / 肩 / 三头',
    kind: 'default',
    done: false,
    actionable: true,
  },
  {
    id: 'math',
    name: '高数：极限与连续',
    time: '20:30',
    detail: '45 分钟 · 练习 12 题',
    kind: 'study',
    done: false,
  },
]

const INITIAL_WATER_MILLILITERS = 1_200

export function MockDataProvider({ children }: { children: ReactNode }) {
  const [goals, setGoals] = useState<Goal[]>(INITIAL_GOALS)
  const [planItems, setPlanItems] = useState<PlanItem[]>(INITIAL_PLAN)
  const [waterLog, setWaterLog] = useState<WaterLogEntry[]>([])
  const [studyRecords, setStudyRecords] = useState<StudyRecord[]>(INITIAL_STUDY_RECORDS)
  const [meals, setMeals] = useState<Meal[]>(INITIAL_MEALS)
  const [fitnessSession, setFitnessSession] = useState<FitnessSessionState | null>(null)
  const [profile, setProfileState] = useState<ProfileData>(INITIAL_PROFILE)
  const [settings, setSettings] = useState<MockSettings>(INITIAL_SETTINGS)
  const [aiConsent, setAiConsentState] = useState(INITIAL_PROFILE.aiConsent)
  const [eveningReview, setEveningReview] = useState<EveningReviewPayload | null>(null)
  const [reports, setReports] = useState<ReportRecord[]>(INITIAL_REPORTS)
  const [snapshot, setSnapshot] = useState<MockSnapshot | null>(null)
  const [longTermPlans, setLongTermPlans] = useState<LongTermPlan[]>([])

  const updateGoal = useCallback((id: string, patch: Partial<Goal>) => {
    setGoals((current) => current.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal)))
  }, [])

  const addWater = useCallback((milliliters: number) => {
    if (!Number.isFinite(milliliters) || milliliters <= 0) return
    const amount = Math.round(milliliters)
    const time = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date())
    setWaterLog((current) => [...current, { id: `water-${Date.now()}`, milliliters: amount, time }])
  }, [])

  const undoWater = useCallback(() => {
    setWaterLog((current) => current.slice(0, -1))
  }, [])

  const setAiConsent = useCallback((enabled: boolean) => {
    setAiConsentState(enabled)
    setProfileState((current) => ({ ...current, aiConsent: enabled }))
  }, [])

  const updateProfile = useCallback((patch: Partial<ProfileData>) => {
    if (patch.aiConsent !== undefined) setAiConsentState(patch.aiConsent)
    setProfileState((current) => ({ ...current, ...patch }))
  }, [])

  const updateSettings = useCallback((patch: Partial<MockSettings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [])

  const resetSettings = useCallback(() => {
    setSettings({
      ...INITIAL_SETTINGS,
      reminders: INITIAL_SETTINGS.reminders.map((reminder) => ({
        ...reminder,
        enabled: false,
      })),
      sources: { fitness: false, diet: false, study: false, profile: false },
    })
    setAiConsent(false)
  }, [setAiConsent])

  const appendStudyRecords = useCallback((records: StudyRecord[]) => {
    if (records.length === 0) return
    setStudyRecords((current) => [...current, ...records])
  }, [])

  const addLongTermPlan = useCallback((draft: LongTermPlanDraft) => {
    const plan = createLongTermPlan(draft)
    if (!plan) return null
    setLongTermPlans((current) => [plan, ...current])
    return plan
  }, [])

  const updateLongTermPlan = useCallback((id: string, patch: Partial<LongTermPlan>) => {
    setLongTermPlans((current) =>
      current.map((plan) => (plan.id === id ? { ...plan, ...patch } : plan)),
    )
  }, [])

  const archiveLongTermPlan = useCallback((id: string) => {
    setLongTermPlans((current) =>
      current.map((plan) => (plan.id === id ? { ...plan, status: 'archived' } : plan)),
    )
  }, [])

  /** 设为进行中：原来那份进行中的计划会被归档，逻辑集中在纯函数里。 */
  const activatePlan = useCallback((id: string) => {
    setLongTermPlans((current) => activateLongTermPlan(current, id))
  }, [])

  const replaceMockData = useCallback((data: ImportableMockData) => {
    setGoals(data.goals)
    setPlanItems(data.planItems)
    setWaterLog(data.waterLog)
    setStudyRecords(data.studyRecords)
    setMeals(data.meals)
    setFitnessSession(data.fitnessSession)
    setProfileState({ ...data.profile, aiConsent: data.aiConsent })
    setSettings(data.settings)
    setAiConsentState(data.aiConsent)
    setEveningReview(data.eveningReview)
    setReports(data.reports)
    setLongTermPlans(data.longTermPlans ?? [])
    setSnapshot(null)
  }, [])

  const createMockSnapshot = useCallback(() => {
    const next: MockSnapshot = {
      id: `snapshot-${Date.now()}`,
      createdAt: new Date().toISOString(),
      recordCount: countMockRecords({
        goals,
        planItems,
        waterLog,
        studyRecords,
        meals,
        fitnessSession,
        profile,
        settings,
        aiConsent,
        eveningReview,
        reports,
        longTermPlans,
      }),
    }
    setSnapshot(next)
    return next
  }, [
    aiConsent,
    eveningReview,
    fitnessSession,
    goals,
    longTermPlans,
    meals,
    planItems,
    profile,
    reports,
    settings,
    studyRecords,
    waterLog,
  ])

  const waterLiters = useMemo(
    () =>
      (INITIAL_WATER_MILLILITERS +
        waterLog.reduce((total, entry) => total + entry.milliliters, 0)) /
      1000,
    [waterLog],
  )
  const lastWaterMilliliters = waterLog.at(-1)?.milliliters ?? null

  const value = useMemo(
    () => ({
      goals,
      updateGoal,
      planItems,
      setPlanItems,
      waterLiters,
      waterLog,
      addWater,
      lastWaterMilliliters,
      undoWater,
      studyRecords,
      setStudyRecords,
      meals,
      setMeals,
      fitnessSession,
      setFitnessSession,
      profile,
      updateProfile,
      settings,
      updateSettings,
      resetSettings,
      aiConsent,
      setAiConsent,
      eveningReview,
      setEveningReview,
      reports,
      setReports,
      snapshot,
      createMockSnapshot,
      appendStudyRecords,
      replaceMockData,
      longTermPlans,
      addLongTermPlan,
      updateLongTermPlan,
      archiveLongTermPlan,
      activatePlan,
    }),
    [
      addWater,
      addLongTermPlan,
      activatePlan,
      aiConsent,
      appendStudyRecords,
      archiveLongTermPlan,
      createMockSnapshot,
      eveningReview,
      fitnessSession,
      goals,
      lastWaterMilliliters,
      longTermPlans,
      meals,
      planItems,
      profile,
      replaceMockData,
      reports,
      resetSettings,
      setAiConsent,
      settings,
      snapshot,
      studyRecords,
      undoWater,
      updateGoal,
      updateLongTermPlan,
      updateProfile,
      updateSettings,
      waterLiters,
      waterLog,
    ],
  )

  return <MockDataContext.Provider value={value}>{children}</MockDataContext.Provider>
}
