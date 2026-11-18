import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AccountDeleteResponse } from '@persist/shared/contract/account'
import { createEmptyMeals } from '../data/diet'
import { createInitialDataForRuntimeMode } from '../data/runtime-initial-data'
import { INITIAL_SETTINGS } from '../data/settings'
import {
  createFitnessSessionRecord,
  dayMeals,
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
import type { RuntimeMode } from '../lib/runtime-mode'
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
import { useRuntimeMode } from './runtime-mode-context'
import { useUI } from './ui-context'

function createRuntimeInitialData(mode: RuntimeMode): ImportableMockData {
  return createInitialDataForRuntimeMode(mode)
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
  errorKind: null,
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
  const runtime = useRuntimeMode()
  const { showToast } = useUI()
  /** 演示数据的日期随打开日期平移；AI 内容仍固定为部署前预生成版本。 */
  const [today, setToday] = useState(() => todayDateKey())
  /**
   * 最新「今天」的同步副本：`applyMockData` 与几个 setter 需要读当前日期，
   * 但不能把它们放进依赖里——否则跨日会让水合 effect 重跑一次，
   * 用磁盘上的旧数据覆盖内存里还没落盘的改动。
   */
  const todayRef = useRef(today)
  const [initialData] = useState(() => createRuntimeInitialData(runtime.mode))

  const [goals, setGoals] = useState<Goal[]>(initialData.goals)
  /** 全部日期的计划项（0.3.0 起每条都带 `date`）。 */
  const [planItems, setPlanItemsState] = useState<PlanItem[]>(initialData.planItems)
  /** 全部日期的饮水记录。 */
  const [waterLog, setWaterLogState] = useState<WaterLogEntry[]>(initialData.waterLog)
  const [studyRecords, setStudyRecordsState] = useState<StudyRecord[]>(initialData.studyRecords)
  /** 饮食按日台账；页面仍通过 `meals` 拿「今天」的切片。 */
  const [dietDays, setDietDaysState] = useState<DietDay[]>(initialData.dietDays)
  const [fitnessSession, setFitnessSessionState] = useState<FitnessSessionState | null>(
    initialData.fitnessSession,
  )
  /** 已完成训练的归档历史（新→旧）。 */
  const [fitnessHistory, setFitnessHistory] = useState<FitnessSessionRecord[]>(
    initialData.fitnessHistory,
  )
  const [profile, setProfileState] = useState<ProfileData>(initialData.profile)
  const [settings, setSettings] = useState<MockSettings>(initialData.settings)
  const [aiConsent, setAiConsentState] = useState(initialData.aiConsent)
  const [eveningReview, setEveningReviewState] = useState<EveningReviewPayload | null>(
    initialData.eveningReview,
  )
  const [reports, setReportsState] = useState<ReportRecord[]>(initialData.reports)
  const [snapshot, setSnapshot] = useState<MockSnapshot | null>(null)
  const [longTermPlans, setLongTermPlans] = useState<LongTermPlan[]>(
    initialData.longTermPlans ?? [],
  )

  /** 数据是否已从 IndexedDB 读完（或确认没有本地存储能力）。 */
  const [hydrated, setHydrated] = useState(() => !runtime.persist)
  /** 是否允许写回本地：读到「未来版本」的数据时置 false，避免旧代码覆盖新数据。 */
  const persistEnabledRef = useRef(false)
  /** 最近一次状态，供 pagehide 补写使用（effect 闭包里拿不到最新值）。 */
  const latestStateRef = useRef<{ data: ImportableMockData; snapshot: MockSnapshot | null } | null>(
    null,
  )
  /** 当前排队的防抖写入定时器；「清空本机数据」必须先掐掉它，否则旧数据会被写回。 */
  const saveTimerRef = useRef<number | null>(null)

  /** 同步状态：引擎每次状态变化都映射到这里，页面只读不写。 */
  const [syncStatus, setSyncStatus] = useState<SyncStatusSnapshot>(() =>
    runtime.sync ? INITIAL_SYNC_STATUS : INITIAL_SYNC_STATUS,
  )
  /** 恢复码、设备名与令牌只在绑定/恢复/吊销后变化，避免每次状态推送都放进 context。 */
  const [syncInfo, setSyncInfo] = useState<{
    recoveryCode: string | null
    deviceLabel: string
    /** 服务端综合分析等需要 Bearer 令牌的请求从这里取；未绑定为 null。 */
    token: string | null
  }>({
    recoveryCode: null,
    deviceLabel: '',
    token: null,
  })

  /** 「今天」的切片：页面读到的 `planItems` / `waterLog` / `meals` 语义不变，只表示今天。 */
  const todayPlanItems = useMemo(() => planItemsForDate(planItems, today), [planItems, today])
  const todayWaterLog = useMemo(() => waterForDate(waterLog, today), [waterLog, today])
  /** 跨日后的第一次打开还没有今天的 `dietDays`，这里给页面四个空餐次骨架。 */
  const meals = useMemo(() => dayMeals(dietDays, today), [dietDays, today])

  /** demo 为只读快照：所有写入口统一拦截，避免某个页面漏掉按钮门禁后改到内存数据。 */
  const blockReadOnly = useCallback(() => {
    if (!runtime.readOnly) return false
    showToast('演示模式为部署前预生成内容，仅可查看。')
    return true
  }, [runtime.readOnly, showToast])

  const setStudyRecords = useCallback(
    (action: React.SetStateAction<StudyRecord[]>) => {
      if (blockReadOnly()) return
      setStudyRecordsState(action)
    },
    [blockReadOnly],
  )

  const setFitnessSession = useCallback(
    (action: React.SetStateAction<FitnessSessionState | null>) => {
      if (blockReadOnly()) return
      setFitnessSessionState(action)
    },
    [blockReadOnly],
  )

  /**
   * 复盘写入统一盖上「今天」：调用方（复盘弹层）只给精力/状态/备注，
   * 日期在这里补齐，避免某个入口忘记带日期、写完立刻被读取侧当作过期数据丢掉。
   */
  const setEveningReview = useCallback(
    (action: React.SetStateAction<EveningReviewPayload | null>) => {
      if (blockReadOnly()) return
      setEveningReviewState((current) => {
        const next = typeof action === 'function' ? action(current) : action
        return next ? { ...next, date: todayRef.current } : null
      })
    },
    [blockReadOnly],
  )

  const setReports = useCallback(
    (action: React.SetStateAction<ReportRecord[]>) => {
      if (blockReadOnly()) return
      setReportsState(action)
    },
    [blockReadOnly],
  )

  /** 兼容旧调用点：写「今日计划」时只替换今天这一块，其他日期原样保留。 */
  const setPlanItems = useCallback(
    (action: React.SetStateAction<PlanItem[]>) => {
      if (blockReadOnly()) return
      setPlanItemsState((current) =>
        patchPlanItemsForDate(current, today, (items) =>
          typeof action === 'function' ? action(items) : action,
        ),
      )
    },
    [blockReadOnly, today],
  )

  /**
   * 兼容旧调用点：写「今日饮食」时只替换今天这一块，其他日期原样保留。
   * 今天还没有记录时以四个空餐次为起点（否则 `map` 一个空数组会把写入吞掉）。
   */
  const setMeals = useCallback(
    (action: React.SetStateAction<Meal[]>) => {
      if (blockReadOnly()) return
      setDietDaysState((current) =>
        patchMealsForDate(current, today, (items) => {
          const base = items.length > 0 ? items : createEmptyMeals()
          return typeof action === 'function' ? action(base) : action
        }),
      )
    },
    [blockReadOnly, today],
  )

  /** 把已完成的训练会话归档进历史；返回生成的记录，方便调用方立即用到 id。 */
  const archiveFitnessSession = useCallback(
    (session: FitnessSessionState, now: Date = new Date()) => {
      const record = createFitnessSessionRecord(session, now)
      if (blockReadOnly()) return record
      setFitnessHistory((current) => sortFitnessHistoryDesc([record, ...current]))
      return record
    },
    [blockReadOnly],
  )

  const addGoal = useCallback(
    (goal: Goal) => {
      if (blockReadOnly()) return
      setGoals((current) => (current.length >= 2 ? current : [...current, goal]))
    },
    [blockReadOnly],
  )

  const updateGoal = useCallback(
    (id: string, patch: Partial<Goal>) => {
      if (blockReadOnly()) return
      setGoals((current) => current.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal)))
    },
    [blockReadOnly],
  )

  const addWater = useCallback(
    (milliliters: number) => {
      if (blockReadOnly()) return
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
    [blockReadOnly, today],
  )

  /** 撤销「今天」的最后一次饮水；其他日期的历史不受影响。 */
  const undoWater = useCallback(() => {
    if (blockReadOnly()) return
    setWaterLogState((current) => {
      const todayEntries = waterForDate(current, today)
      const last = todayEntries[todayEntries.length - 1]
      return last ? current.filter((entry) => entry.id !== last.id) : current
    })
  }, [blockReadOnly, today])

  const setAiConsent = useCallback(
    (enabled: boolean) => {
      if (blockReadOnly()) return
      setAiConsentState(enabled)
      setProfileState((current) => ({ ...current, aiConsent: enabled }))
    },
    [blockReadOnly],
  )

  const updateProfile = useCallback(
    (patch: Partial<ProfileData>) => {
      if (blockReadOnly()) return
      if (patch.aiConsent !== undefined) setAiConsentState(patch.aiConsent)
      setProfileState((current) => ({ ...current, ...patch }))
    },
    [blockReadOnly],
  )

  const updateSettings = useCallback(
    (patch: Partial<MockSettings>) => {
      if (blockReadOnly()) return
      setSettings((current) => ({ ...current, ...patch }))
    },
    [blockReadOnly],
  )

  const resetSettings = useCallback(() => {
    if (blockReadOnly()) return
    setSettings({
      ...INITIAL_SETTINGS,
      reminders: INITIAL_SETTINGS.reminders.map((reminder) => ({
        ...reminder,
        enabled: false,
      })),
      sources: { fitness: false, diet: false, study: false, profile: false },
    })
    setAiConsent(false)
  }, [blockReadOnly, setAiConsent])

  const appendStudyRecords = useCallback(
    (records: StudyRecord[]) => {
      if (blockReadOnly()) return
      if (records.length === 0) return
      setStudyRecordsState((current) => [...current, ...records])
    },
    [blockReadOnly],
  )

  const addLongTermPlan = useCallback(
    (draft: LongTermPlanDraft) => {
      if (blockReadOnly()) return null
      const plan = createLongTermPlan(draft)
      if (!plan) return null
      setLongTermPlans((current) => [plan, ...current])
      return plan
    },
    [blockReadOnly],
  )

  const updateLongTermPlan = useCallback(
    (id: string, patch: Partial<LongTermPlan>) => {
      if (blockReadOnly()) return
      setLongTermPlans((current) =>
        current.map((plan) => (plan.id === id ? { ...plan, ...patch } : plan)),
      )
    },
    [blockReadOnly],
  )

  const archiveLongTermPlan = useCallback(
    (id: string) => {
      if (blockReadOnly()) return
      setLongTermPlans((current) =>
        current.map((plan) => (plan.id === id ? { ...plan, status: 'archived' } : plan)),
      )
    },
    [blockReadOnly],
  )

  /** 设为进行中：原来那份进行中的计划会被归档，逻辑集中在纯函数里。 */
  const activatePlan = useCallback(
    (id: string) => {
      if (blockReadOnly()) return
      setLongTermPlans((current) => activateLongTermPlan(current, id))
    },
    [blockReadOnly],
  )

  const applyMockData = useCallback((data: ImportableMockData) => {
    const todayKey = todayRef.current
    setGoals(data.goals)
    setPlanItemsState(data.planItems)
    setWaterLogState(data.waterLog)
    setStudyRecordsState(data.studyRecords)
    setDietDaysState(data.dietDays)
    setFitnessSessionState(data.fitnessSession?.date === todayKey ? data.fitnessSession : null)
    setFitnessHistory(sortFitnessHistoryDesc(data.fitnessHistory))
    setProfileState({ ...data.profile, aiConsent: data.aiConsent })
    setSettings(data.settings)
    setAiConsentState(data.aiConsent)
    // 复盘原样留在内存里（内容属于昨天也值得保留到最后一次覆盖），
    // 「是不是今天的」由下面暴露给页面的派生值判断。
    setEveningReviewState(data.eveningReview)
    setReportsState(data.reports)
    setLongTermPlans(data.longTermPlans ?? [])
    setSnapshot(null)
  }, [])

  /**
   * 整库替换标记：导入备份、加载演示数据、清空本机都属于「一次换掉整个数据集」。
   * 这类动作不该让同步引擎把「基线里有、这一版没有」的实体当成用户删除，
   * 否则服务端会被整体清空（11-18 事故）。标记只对下一次差分生效，用完即清。
   */
  const suppressRemovalsRef = useRef(false)

  const replaceMockData = useCallback(
    (data: ImportableMockData) => {
      if (blockReadOnly()) return
      suppressRemovalsRef.current = true
      applyMockData(data)
    },
    [applyMockData, blockReadOnly],
  )

  /**
   * 删除本机数据（IndexedDB 记录）并还原到首次启动基线。
   * 顺序不能换：先停写回、掐掉已排队的防抖写入，再删记录、重置内存态（含 snapshot），
   * 最后恢复写回，让「初始基线」在 200 ms 后作为新记录落盘；否则旧数据会在防抖窗口末尾被写回。
   * `hydrated` 保持不变，不重新水合，避免再次读到刚删掉的记录。
   */
  const clearLocalData = useCallback(async () => {
    if (blockReadOnly()) return
    persistEnabledRef.current = false
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    await clearPersistedState({ dbName: runtime.storageDbName })
    const nextInitialData = createRuntimeInitialData(runtime.mode)
    suppressRemovalsRef.current = true
    applyMockData(nextInitialData)
    // 同步刷新 pagehide 补写用的镜像，避免「清空后立刻关页面」把旧数据又写回去。
    latestStateRef.current = { data: nextInitialData, snapshot: null }
    // 记录已删除，此后写入的是本版本基线；即使之前读到过未来版本数据，用户主动清空后也由本版本接管。
    persistEnabledRef.current = true
  }, [applyMockData, blockReadOnly, runtime.mode, runtime.storageDbName])

  /**
   * 同步引擎只在挂载 effect 里创建，实例放 ref：渲染期间不读 ref，
   * 页面操作（事件回调）里再通过 `requireSyncEngine` 取。
   * 它不直接读写 React 状态：读最新数据走 `latestStateRef`，应用远端数据走 `replaceMockData`，
   * 本地写入 → outbox 的差分由下面的持久化 effect 统一触发。
   * 默认关闭：未开启时 `noteDataChange` 直接返回，不产生网络请求。
   */
  const syncEngineRef = useRef<SyncEngine | null>(null)

  const requireSyncEngine = useCallback(() => {
    if (!runtime.sync) throw new Error('桌面体验模式不启用跨设备同步。')
    const engine = syncEngineRef.current
    if (!engine) throw new Error('同步引擎尚未准备好，请稍后重试。')
    return engine
  }, [runtime.sync])

  /** 恢复码/设备名/令牌不随每次状态推送变化，只在绑定类操作后刷新。 */
  const refreshSyncInfo = useCallback((engine: SyncEngine) => {
    setSyncInfo({
      recoveryCode: engine.recoveryCode,
      deviceLabel: engine.deviceLabel,
      token: engine.getMeta().token,
    })
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

  const deleteServerAccount = useCallback(async (): Promise<AccountDeleteResponse> => {
    const engine = requireSyncEngine()
    try {
      return await engine.deleteAccount()
    } finally {
      refreshSyncInfo(engine)
    }
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
    if (!runtime.persist) {
      persistEnabledRef.current = false
      return
    }
    let cancelled = false
    void loadPersistedState({ dbName: runtime.storageDbName }).then((result) => {
      if (cancelled) return
      if (result.status === 'loaded' && result.state) {
        applyMockData(result.state.data)
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
  }, [applyMockData, runtime.persist, runtime.storageDbName])

  /**
   * 跨日自愈：`today` 是「本次会话的今天」，只在挂载时算一次。
   * PWA / APK 常驻后台跨过 0 点后再回到前台，若不推进 `today`，
   * 今天页会把昨天的计划、饮水、饮食切片继续当成「今天」显示。
   * 定时器负责前台长时间挂着的情况（后台会被节流，故同时监听可见性变化与聚焦）。
   */
  useEffect(() => {
    const syncToday = () => {
      const next = todayDateKey()
      if (next === todayRef.current) return
      todayRef.current = next
      setToday(next)
      // 训练会话是「今天这一次」的草稿：跨日后旧草稿不再可用，
      // 保留它只会让「完成训练」按钮继续禁用（归档记录已在 fitnessHistory 里）。
      setFitnessSessionState((current) => (current && current.date !== next ? null : current))
    }
    syncToday()
    const timer = window.setInterval(syncToday, 60_000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncToday()
    }
    window.addEventListener('focus', syncToday)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', syncToday)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

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
    if (!runtime.sync) return
    const engine = new SyncEngine({
      client: createSyncClient(),
      metaStorage: createSyncStore(),
      queueStorage: createSyncStore(),
      getData: () => latestStateRef.current?.data ?? createRuntimeInitialData(runtime.mode),
      // 远端数据落库走 applyMockData，不走 replaceMockData：后者带「不产生删除」标记，
      // 而应用服务端墓碑恰恰是真正的删除，不能被抑制。
      applyData: (data) => applyMockData(data),
      onChange: (status) => setSyncStatus(status),
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    })
    syncEngineRef.current = engine
    let cancelled = false
    void engine.init().then((status) => {
      if (cancelled) return
      setSyncStatus(status)
      setSyncInfo({
        recoveryCode: engine.recoveryCode,
        deviceLabel: engine.deviceLabel,
        token: engine.getMeta().token,
      })
      engine.start()
    })
    return () => {
      cancelled = true
      engine.stop()
      if (syncEngineRef.current === engine) syncEngineRef.current = null
    }
  }, [applyMockData, runtime.mode, runtime.sync])

  /**
   * 本地数据变化时通知同步引擎：它自己算差分并在 5 秒后合并推送。
   * 同步关闭时这里只做一次早退，不产生任何请求。
   * 整库替换（导入/演示数据/清空本机）后第一次差分不产生删除，见 replaceMockData。
   */
  useEffect(() => {
    if (!hydrated) return
    const suppressRemovals = suppressRemovalsRef.current
    suppressRemovalsRef.current = false
    syncEngineRef.current?.noteDataChange({ suppressRemovals })
  }, [hydrated, persistableData])

  /** 交互后防抖写入，把连续操作合并成一次事务；严格模式重复执行也只是多写一次同样的数据。 */
  useEffect(() => {
    if (!runtime.persist || !hydrated || !persistEnabledRef.current) return
    const timer = window.setTimeout(() => {
      saveTimerRef.current = null
      void savePersistedState(persistableData, snapshot, { dbName: runtime.storageDbName })
    }, PERSIST_SAVE_DEBOUNCE_MS)
    saveTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (saveTimerRef.current === timer) saveTimerRef.current = null
    }
  }, [hydrated, persistableData, runtime.persist, runtime.storageDbName, snapshot])

  /** 页面隐藏 / 关闭时补写一次，避免防抖窗口内直接关页面丢数据。 */
  useEffect(() => {
    if (!runtime.persist || !hydrated) return
    const flush = () => {
      const latest = latestStateRef.current
      if (!latest || !persistEnabledRef.current) return
      void savePersistedState(latest.data, latest.snapshot, { dbName: runtime.storageDbName })
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
  }, [hydrated, runtime.persist, runtime.storageDbName])

  /** owner / guest 都从 0 起算；demo 的预置基线由运行模式配置提供。 */
  const waterBaselineMilliliters = runtime.waterBaselineMilliliters
  const waterLiters = useMemo(
    () =>
      (waterBaselineMilliliters +
        todayWaterLog.reduce((total, entry) => total + entry.milliliters, 0)) /
      1000,
    [waterBaselineMilliliters, todayWaterLog],
  )
  const lastWaterMilliliters = todayWaterLog.at(-1)?.milliliters ?? null

  /**
   * 只把「今天」的复盘暴露给页面：昨天填过的复盘留在内存与磁盘里，
   * 但今天读到的必须是 `null`，否则今天页会显示「今天的复盘已经记录」。
   */
  const todayEveningReview = useMemo(
    () => (eveningReview?.date === today ? eveningReview : null),
    [eveningReview, today],
  )

  const value = useMemo(
    () => ({
      goals,
      addGoal,
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
      /** 「今天」的复盘；昨天的复盘不暴露（否则今天页会显示已完成）。 */
      eveningReview: todayEveningReview,
      /** 原始复盘（可能属于昨天），只给导出/快照用，展示请用上面那个。 */
      latestEveningReview: eveningReview,
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
      syncToken: syncInfo.token,
      enableSync,
      disableSync,
      restoreSync,
      revokeSync,
      deleteServerAccount,
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
      deleteServerAccount,
      dietDays,
      enableSync,
      eveningReview,
      todayEveningReview,
      fitnessHistory,
      fitnessSession,
      addGoal,
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
      setEveningReview,
      setFitnessSession,
      setMeals,
      setReports,
      setStudyRecords,
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
