import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { INITIAL_MEALS } from '../data/diet'
import { INITIAL_PROFILE } from '../data/profile'
import { INITIAL_REPORTS } from '../data/reports'
import { INITIAL_SETTINGS } from '../data/settings'
import { INITIAL_STUDY_RECORDS } from '../data/study'
import {
  createFitnessSessionRecord,
  mealsForDate,
  patchMealsForDate,
  patchPlanItemsForDate,
  planItemsForDate,
  sortFitnessHistoryDesc,
  todayDateKey,
  waterForDate,
} from '../lib/history'
import {
  activateLongTermPlan,
  createLongTermPlan,
  type LongTermPlanDraft,
} from '../lib/long-term-plan'
import { countMockRecords } from '../lib/mock-data-transfer'
import { PERSIST_SAVE_DEBOUNCE_MS } from '../lib/persist-state'
import { clearPersistedState, loadPersistedState, savePersistedState } from '../lib/persist-storage'
import { createSyncClient } from '../lib/sync-client'
import { SyncEngine, type SyncStatusSnapshot } from '../lib/sync-engine'
import { createSyncStore } from '../lib/sync-store'
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

/** 演示计划不带日期：首次启动时统一盖上「今天」，保证以后按日筛选也能命中。 */
const INITIAL_PLAN: Array<Omit<PlanItem, 'date'>> = [
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

/** 把不带日期的演示计划盖上指定日期。 */
function planForDate(date: string): PlanItem[] {
  return INITIAL_PLAN.map((item) => ({ ...item, date }))
}

/**
 * 首次启动的基线状态：各切片与上面 useState 的初值一一对应（快照与长期计划为空）。
 * 「清空本机数据」复用它，保证清空后与第一次打开 App 看到的内容完全一致。
 * v2 起演示数据只落在「当天」这一天：饮食进 `dietDays`，计划与饮水带 `date`。
 */
function createInitialMockData(now: Date = new Date()): ImportableMockData {
  const today = todayDateKey(now)
  return {
    goals: INITIAL_GOALS,
    planItems: planForDate(today),
    waterLog: [],
    studyRecords: INITIAL_STUDY_RECORDS,
    dietDays: [{ date: today, meals: INITIAL_MEALS }],
    fitnessSession: null,
    fitnessHistory: [],
    profile: INITIAL_PROFILE,
    settings: INITIAL_SETTINGS,
    aiConsent: INITIAL_PROFILE.aiConsent,
    eveningReview: null,
    reports: INITIAL_REPORTS,
    longTermPlans: [],
  }
}

/** 同步尚未初始化时的展示状态：默认关闭，页面上只有一个空壳。 */
const INITIAL_SYNC_STATUS: SyncStatusSnapshot = {
  enabled: false,
  pending: 0,
  lastSyncAt: null,
  online: true,
  syncing: false,
  error: null,
  needsAttention: false,
  state: '未开启',
}

/** 默认设备名：不追踪具体型号，只按平台给一个人能看懂的标签。 */
function defaultSyncDeviceLabel(): string {
  if (typeof navigator === 'undefined') return '本机浏览器'
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'Android 浏览器'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS 浏览器'
  if (/Mac OS X/i.test(ua)) return 'Mac 浏览器'
  if (/Windows/i.test(ua)) return 'Windows 浏览器'
  return '本机浏览器'
}

export function MockDataProvider({ children }: { children: ReactNode }) {
  /** 本次会话的「今天」。日期只在挂载时取一次，避免跨零点后页面数据整体跳变。 */
  const [today] = useState(() => todayDateKey())

  const [goals, setGoals] = useState<Goal[]>(INITIAL_GOALS)
  /** 全部日期的计划项（0.3.0 起每条都带 `date`）。 */
  const [planItems, setPlanItemsState] = useState<PlanItem[]>(() => planForDate(today))
  /** 全部日期的饮水记录。 */
  const [waterLog, setWaterLogState] = useState<WaterLogEntry[]>([])
  const [studyRecords, setStudyRecords] = useState<StudyRecord[]>(INITIAL_STUDY_RECORDS)
  /** 饮食按日台账；页面仍通过 `meals` 拿「今天」的切片。 */
  const [dietDays, setDietDaysState] = useState<DietDay[]>(() => [
    { date: today, meals: INITIAL_MEALS },
  ])
  const [fitnessSession, setFitnessSession] = useState<FitnessSessionState | null>(null)
  /** 已完成训练的归档历史（新→旧）。 */
  const [fitnessHistory, setFitnessHistory] = useState<FitnessSessionRecord[]>([])
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
  /** 当前排队的防抖写入定时器；「清空本机数据」必须先掐掉它，否则旧数据会被写回。 */
  const saveTimerRef = useRef<number | null>(null)

  /** 同步状态：引擎每次状态变化都映射到这里，页面只读不写。 */
  const [syncStatus, setSyncStatus] = useState<SyncStatusSnapshot>(INITIAL_SYNC_STATUS)
  /** 恢复码与设备名只在绑定/恢复/吊销后变化，避免每次状态推送都放进 context。 */
  const [syncInfo, setSyncInfo] = useState<{ recoveryCode: string | null; deviceLabel: string }>({
    recoveryCode: null,
    deviceLabel: '',
  })

  /** 「今天」的切片：页面读到的 `planItems` / `waterLog` / `meals` 语义不变，只表示今天。 */
  const todayPlanItems = useMemo(() => planItemsForDate(planItems, today), [planItems, today])
  const todayWaterLog = useMemo(() => waterForDate(waterLog, today), [waterLog, today])
  const meals = useMemo(() => mealsForDate(dietDays, today), [dietDays, today])

  /** 兼容旧调用点：写「今日计划」时只替换今天这一块，其他日期原样保留。 */
  const setPlanItems = useCallback(
    (action: React.SetStateAction<PlanItem[]>) => {
      setPlanItemsState((current) =>
        patchPlanItemsForDate(current, today, (items) =>
          typeof action === 'function' ? action(items) : action,
        ),
      )
    },
    [today],
  )

  /** 兼容旧调用点：写「今日饮食」时只替换今天这一块，其他日期原样保留。 */
  const setMeals = useCallback(
    (action: React.SetStateAction<Meal[]>) => {
      setDietDaysState((current) =>
        patchMealsForDate(current, today, (items) =>
          typeof action === 'function' ? action(items) : action,
        ),
      )
    },
    [today],
  )

  /** 把已完成的训练会话归档进历史；返回生成的记录，方便调用方立即用到 id。 */
  const archiveFitnessSession = useCallback(
    (session: FitnessSessionState, now: Date = new Date()) => {
      const record = createFitnessSessionRecord(session, now)
      setFitnessHistory((current) => sortFitnessHistoryDesc([record, ...current]))
      return record
    },
    [],
  )

  const updateGoal = useCallback((id: string, patch: Partial<Goal>) => {
    setGoals((current) => current.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal)))
  }, [])

  const addWater = useCallback(
    (milliliters: number) => {
      if (!Number.isFinite(milliliters) || milliliters <= 0) return
      const amount = Math.round(milliliters)
      const time = new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date())
      setWaterLogState((current) => [
        ...current,
        { id: `water-${Date.now()}`, milliliters: amount, time, date: today },
      ])
    },
    [today],
  )

  /** 撤销「今天」的最后一次饮水；其他日期的历史不受影响。 */
  const undoWater = useCallback(() => {
    setWaterLogState((current) => {
      const todayEntries = waterForDate(current, today)
      const last = todayEntries[todayEntries.length - 1]
      return last ? current.filter((entry) => entry.id !== last.id) : current
    })
  }, [today])

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
    setPlanItemsState(data.planItems)
    setWaterLogState(data.waterLog)
    setStudyRecords(data.studyRecords)
    setDietDaysState(data.dietDays)
    setFitnessSession(data.fitnessSession)
    setFitnessHistory(sortFitnessHistoryDesc(data.fitnessHistory))
    setProfileState({ ...data.profile, aiConsent: data.aiConsent })
    setSettings(data.settings)
    setAiConsentState(data.aiConsent)
    setEveningReview(data.eveningReview)
    setReports(data.reports)
    setLongTermPlans(data.longTermPlans ?? [])
    setSnapshot(null)
  }, [])

  /**
   * 删除本机数据（IndexedDB 记录）并还原到首次启动基线。
   * 顺序不能换：先停写回、掐掉已排队的防抖写入，再删记录、重置内存态（含 snapshot），
   * 最后恢复写回，让「初始基线」在 200 ms 后作为新记录落盘；否则旧数据会在防抖窗口末尾被写回。
   * `hydrated` 保持不变，不重新水合，避免再次读到刚删掉的记录。
   */
  const clearLocalData = useCallback(async () => {
    persistEnabledRef.current = false
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    await clearPersistedState()
    const initialData = createInitialMockData()
    replaceMockData(initialData)
    // 同步刷新 pagehide 补写用的镜像，避免「清空后立刻关页面」把旧数据又写回去。
    latestStateRef.current = { data: initialData, snapshot: null }
    // 记录已删除，此后写入的是本版本基线；即使之前读到过未来版本数据，用户主动清空后也由本版本接管。
    persistEnabledRef.current = true
  }, [replaceMockData])

  /**
   * 同步引擎只在挂载 effect 里创建，实例放 ref：渲染期间不读 ref，
   * 页面操作（事件回调）里再通过 `requireSyncEngine` 取。
   * 它不直接读写 React 状态：读最新数据走 `latestStateRef`，应用远端数据走 `replaceMockData`，
   * 本地写入 → outbox 的差分由下面的持久化 effect 统一触发。
   * 默认关闭：未开启时 `noteDataChange` 直接返回，不产生网络请求。
   */
  const syncEngineRef = useRef<SyncEngine | null>(null)

  const requireSyncEngine = useCallback(() => {
    const engine = syncEngineRef.current
    if (!engine) throw new Error('同步引擎尚未准备好，请稍后重试。')
    return engine
  }, [])

  /** 恢复码/设备名不随每次状态推送变化，只在绑定类操作后刷新。 */
  const refreshSyncInfo = useCallback((engine: SyncEngine) => {
    setSyncInfo({ recoveryCode: engine.recoveryCode, deviceLabel: engine.deviceLabel })
  }, [])

  const enableSync = useCallback(
    async (label?: string) => {
      const engine = requireSyncEngine()
      try {
        await engine.enable(label?.trim() || defaultSyncDeviceLabel())
      } finally {
        refreshSyncInfo(engine)
      }
    },
    [refreshSyncInfo, requireSyncEngine],
  )

  const disableSync = useCallback(async () => {
    const engine = requireSyncEngine()
    await engine.disable()
    refreshSyncInfo(engine)
  }, [refreshSyncInfo, requireSyncEngine])

  const restoreSync = useCallback(
    async (recoveryCode: string, label?: string) => {
      const engine = requireSyncEngine()
      try {
        await engine.restore(recoveryCode.trim(), label?.trim() || defaultSyncDeviceLabel())
      } finally {
        refreshSyncInfo(engine)
      }
    },
    [refreshSyncInfo, requireSyncEngine],
  )

  const revokeSync = useCallback(async () => {
    const engine = requireSyncEngine()
    await engine.revokeDevice()
    refreshSyncInfo(engine)
  }, [refreshSyncInfo, requireSyncEngine])

  const syncNow = useCallback(async () => requireSyncEngine().flush('manual'), [requireSyncEngine])

  const createMockSnapshot = useCallback(() => {
    const next: MockSnapshot = {
      id: `snapshot-${Date.now()}`,
      createdAt: new Date().toISOString(),
      recordCount: countMockRecords({
        goals,
        planItems,
        waterLog,
        studyRecords,
        dietDays,
        fitnessSession,
        fitnessHistory,
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
    dietDays,
    eveningReview,
    fitnessHistory,
    fitnessSession,
    goals,
    longTermPlans,
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

  /** 待持久化的切片与备份 0.3.0 的 data 完全一致：本地存储、导出文件、导入校验同构。 */
  const persistableData = useMemo<ImportableMockData>(
    () => ({
      goals,
      planItems,
      waterLog,
      studyRecords,
      dietDays,
      fitnessSession,
      fitnessHistory,
      profile,
      settings,
      aiConsent,
      eveningReview,
      reports,
      longTermPlans,
    }),
    [
      aiConsent,
      dietDays,
      eveningReview,
      fitnessHistory,
      fitnessSession,
      goals,
      longTermPlans,
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

  /** 引擎初始化：只读本机同步元数据（不联网），随后绑定在线/离线与兜底轮询。 */
  useEffect(() => {
    const engine = new SyncEngine({
      client: createSyncClient(),
      metaStorage: createSyncStore(),
      queueStorage: createSyncStore(),
      getData: () => latestStateRef.current?.data ?? createInitialMockData(),
      applyData: (data) => replaceMockData(data),
      onChange: (status) => setSyncStatus(status),
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    })
    syncEngineRef.current = engine
    let cancelled = false
    void engine.init().then((status) => {
      if (cancelled) return
      setSyncStatus(status)
      setSyncInfo({ recoveryCode: engine.recoveryCode, deviceLabel: engine.deviceLabel })
      engine.start()
    })
    return () => {
      cancelled = true
      engine.stop()
      if (syncEngineRef.current === engine) syncEngineRef.current = null
    }
  }, [replaceMockData])

  /**
   * 本地数据变化时通知同步引擎：它自己算差分并在 5 秒后合并推送。
   * 同步关闭时这里只做一次早退，不产生任何请求。
   */
  useEffect(() => {
    if (!hydrated) return
    syncEngineRef.current?.noteDataChange()
  }, [hydrated, persistableData])

  /** 交互后防抖写入，把连续操作合并成一次事务；严格模式重复执行也只是多写一次同样的数据。 */
  useEffect(() => {
    if (!hydrated || !persistEnabledRef.current) return
    const timer = window.setTimeout(() => {
      saveTimerRef.current = null
      void savePersistedState(persistableData, snapshot)
    }, PERSIST_SAVE_DEBOUNCE_MS)
    saveTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (saveTimerRef.current === timer) saveTimerRef.current = null
    }
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

  /** 今日饮水 = 基线 1.2 L + 今天的记录；其他日期的历史不计入今日进度。 */
  const waterLiters = useMemo(
    () =>
      (INITIAL_WATER_MILLILITERS +
        todayWaterLog.reduce((total, entry) => total + entry.milliliters, 0)) /
      1000,
    [todayWaterLog],
  )
  const lastWaterMilliliters = todayWaterLog.at(-1)?.milliliters ?? null

  const value = useMemo(
    () => ({
      goals,
      updateGoal,
      /** 「今天」的计划项切片。 */
      planItems: todayPlanItems,
      setPlanItems,
      /** 全部日期的计划项，供历史/报告按日筛选。 */
      planHistory: planItems,
      waterLiters,
      /** 「今天」的饮水记录切片。 */
      waterLog: todayWaterLog,
      /** 全部日期的饮水记录，供历史/报告按日筛选。 */
      waterHistory: waterLog,
      addWater,
      lastWaterMilliliters,
      undoWater,
      studyRecords,
      setStudyRecords,
      /** 「今天」的四个餐次切片。 */
      meals,
      setMeals,
      /** 饮食按日台账。 */
      dietDays,
      fitnessSession,
      setFitnessSession,
      fitnessHistory,
      archiveFitnessSession,
      /** 本次会话的「今天」（YYYY-MM-DD，本地时区）。 */
      today,
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
      clearLocalData,
      /** 同步状态与操作（默认关闭；页面只通过这里触发网络）。 */
      syncStatus,
      syncRecoveryCode: syncInfo.recoveryCode,
      syncDeviceLabel: syncInfo.deviceLabel,
      enableSync,
      disableSync,
      restoreSync,
      revokeSync,
      syncNow,
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
      archiveFitnessSession,
      archiveLongTermPlan,
      clearLocalData,
      createMockSnapshot,
      disableSync,
      dietDays,
      enableSync,
      eveningReview,
      fitnessHistory,
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
      restoreSync,
      revokeSync,
      setAiConsent,
      setMeals,
      setPlanItems,
      settings,
      snapshot,
      studyRecords,
      syncInfo,
      syncNow,
      syncStatus,
      today,
      todayPlanItems,
      todayWaterLog,
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
