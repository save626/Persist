import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { PERSIST_SAVE_DEBOUNCE_MS } from '../lib/persist-state'
import { loadPersistedState, savePersistedState } from '../lib/persist-storage'
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

  /** 数据是否已从 IndexedDB 读完（或确认没有本地存储能力）。 */
  const [hydrated, setHydrated] = useState(false)
  /** 是否允许写回本地：读到「未来版本」的数据时置 false，避免旧代码覆盖新数据。 */
  const persistEnabledRef = useRef(false)
  /** 最近一次状态，供 pagehide 补写使用（effect 闭包里拿不到最新值）。 */
  const latestStateRef = useRef<{ data: ImportableMockData; snapshot: MockSnapshot | null } | null>(
    null,
  )

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

  /**
   * 首次挂载：把上次退出前的本地数据读回来。
   * 没有 IndexedDB（jsdom / 隐私模式）时只降级为纯内存，不让页面卡住。
   */
  useEffect(() => {
    let cancelled = false
    void loadPersistedState().then((result) => {
      if (cancelled) return
      if (result.status === 'loaded' && result.state) {
        replaceMockData(result.state.data)
        setSnapshot(result.state.snapshot)
      }
      persistEnabledRef.current =
        result.status !== 'unavailable' && result.status !== 'unsupported-version'
      if (result.status === 'unsupported-version') {
        console.warn('[persist] 本机数据来自更新版本的 Persist，本次不写入以免覆盖')
      }
      setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [replaceMockData])

  /** 待持久化的切片与备份 0.2.0 的 data 完全一致：本地存储、导出文件、导入校验同构。 */
  const persistableData = useMemo<ImportableMockData>(
    () => ({
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
    [
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
    ],
  )

  useEffect(() => {
    latestStateRef.current = { data: persistableData, snapshot }
  }, [persistableData, snapshot])

  /** 交互后防抖写入，把连续操作合并成一次事务；严格模式重复执行也只是多写一次同样的数据。 */
  useEffect(() => {
    if (!hydrated || !persistEnabledRef.current) return
    const timer = window.setTimeout(() => {
      void savePersistedState(persistableData, snapshot)
    }, PERSIST_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [hydrated, persistableData, snapshot])

  /** 页面隐藏 / 关闭时补写一次，避免防抖窗口内直接关页面丢数据。 */
  useEffect(() => {
    if (!hydrated) return
    const flush = () => {
      const latest = latestStateRef.current
      if (!latest || !persistEnabledRef.current) return
      void savePersistedState(latest.data, latest.snapshot)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [hydrated])

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

  // 读本地数据通常只要几毫秒；这期间不渲染，避免先闪一帧演示数据再被替换。
  if (!hydrated) return null

  return <MockDataContext.Provider value={value}>{children}</MockDataContext.Provider>
}
