import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ConfirmDialog, PageSheet } from '../components/PageSheet'
import { useMockData } from '../context/mock-data-context'
import { useUI } from '../context/ui-context'
import { calculateProfileCompleteness, countProfileFields } from '../data/profile'
import { formatTrainingSummary, summarizeFitness } from '../lib/fitness'
import { todayDateKey } from '../lib/history'
import {
  AI_REPORT_LABEL,
  MOCK_REPORT_LABEL,
  REPORT_FALLBACK_NOTE,
  ReportContractError,
  ReportUnavailableError,
  probeAiReport,
  requestAiReport,
} from '../lib/ai-report-client'
import { buildReportDigest } from '../lib/report-digest'
import type { ReportContent, ReportDigest, ReportRangeDays } from '../lib/report-types'
import type { DataSource, PlanItem, ReportRecord } from '../types'

type GenerationState = 'idle' | 'loading' | 'success' | 'error'
type RangeKey = '7' | '30' | '90'
/** 当前生成引擎：正在检测 / 真实模型（经服务端代理）/ 本地 Mock。 */
type ReportSource = 'probing' | 'ai' | 'mock'

function updatePlanItem(items: PlanItem[], id: string, patch: Partial<PlanItem>) {
  return items.map((item) => (item.id === id && !item.done ? { ...item, ...patch } : item))
}

/**
 * 报告建议落到「今天」的计划里：建议本身不带日期，插入时统一盖上今天，
 * 避免把建议写到别的日期上。
 */
function upsertPlanItem(items: PlanItem[], suggestion: Omit<PlanItem, 'date'>) {
  const dated: PlanItem = { ...suggestion, date: todayDateKey() }
  const index = items.findIndex((item) => item.id === dated.id)
  if (index === -1) return [...items, dated]
  if (items[index].done) return items
  return items.map((item, itemIndex) =>
    itemIndex === index ? { ...item, ...dated, done: false } : item,
  )
}

function applyReportSuggestions(items: PlanItem[], report: ReportRecord) {
  const reportId = report.id

  if (report.type === '今日简报') {
    return upsertPlanItem(items, {
      id: 'brief-hydration-check',
      name: '下午分两次补水',
      time: '15:30',
      detail: '每次 250 ml · 根据当前饮水缺口调整',
      kind: 'water',
      done: false,
    })
  }

  if (reportId === 'report-week-current') {
    return updatePlanItem(items, 'math', {
      time: '18:10',
      detail: '45 分钟 · 晚饭前练习 12 题',
    })
  }

  if (reportId === 'report-fitness-1024') {
    return upsertPlanItem(items, {
      id: 'post-training-protein',
      name: '训练后蛋白质补充',
      time: '20:00',
      detail: '乳清蛋白或酸奶 · 25–30 g 蛋白质',
      kind: 'food',
      done: false,
    })
  }

  if (reportId === 'report-study-1025') {
    return upsertPlanItem(items, {
      id: 'english-review-20',
      name: '英语轻量复盘',
      time: '20:20',
      detail: '20 分钟 · 回顾今日生词与错题',
      kind: 'study',
      done: false,
    })
  }

  if (reportId === 'report-diet-1022') {
    return upsertPlanItem(items, {
      id: 'breakfast-protein',
      name: '早餐补充蛋白质',
      time: '08:10',
      detail: '鸡蛋、酸奶或豆制品 · 20–25 g 蛋白质',
      kind: 'food',
      done: false,
    })
  }

  return items
}

const TYPE_CARDS = [
  {
    icon: 'spark' as const,
    title: '今日简报',
    detail: '结合今天已完成的记录生成下一步建议。',
    tag: '可按需生成',
  },
  {
    icon: 'fitness' as const,
    title: '训练建议',
    detail: '基于力量、时长、距离、强度与近期恢复状态。',
    tag: '已连接训练记录',
  },
  {
    icon: 'study' as const,
    title: '学习观察',
    detail: '只分析投入时间与记录结构，不评价记忆力。',
    tag: '英语 + 高数',
  },
]

const RANGE_LABELS: Record<RangeKey, string> = {
  '7': '近 7 天',
  '30': '近 30 天',
  '90': '近 90 天',
}

function formatReportDate(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

function defaultUpdatedAt() {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

type DailyDraft = Omit<ReportRecord, 'id' | 'date' | 'updatedAt' | 'origin'>

/**
 * 合成一条日报记录：数字、指标与依据始终来自本地规则（可复算），
 * 只有标题、状态、摘要、结论与建议允许由模型撰写（content 为空即本地 Mock）。
 */
function buildDailyReport(draft: DailyDraft, content?: ReportContent): ReportRecord {
  return {
    ...draft,
    title: content?.title ?? draft.title,
    status: content?.status ?? draft.status,
    summary: content?.summary ?? draft.summary,
    conclusions: content?.conclusions ?? draft.conclusions,
    actions: content?.actions ?? draft.actions,
    origin: content ? 'ai' : 'mock',
    id: `report-daily-${Date.now()}`,
    date: formatReportDate(new Date()),
    updatedAt: defaultUpdatedAt(),
  }
}

function ReportDetailSheet({
  report,
  onClose,
  onApply,
}: {
  report: ReportRecord
  onClose: () => void
  onApply: () => void
}) {
  return (
    <PageSheet
      title={report.title}
      subtitle={`${report.type} · ${report.period}`}
      onClose={onClose}
      className="reports-detail-sheet"
    >
      <div className="reports-detail-summary">
        <span className="reports-status-pill">
          <span className="dot" />
          {report.status}
        </span>
        <p>{report.summary}</p>
      </div>
      <div className="reports-detail-metrics">
        {report.metric.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </div>
        ))}
      </div>
      <div className="reports-detail-section">
        <h3>观察结论</h3>
        <ol>
          {report.conclusions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </div>
      <div className="reports-detail-section">
        <h3>建议动作</h3>
        <div className="reports-action-list">
          {report.actions.map((item, index) => (
            <div key={item}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <p>{item}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="reports-detail-section reports-detail-evidence">
        <h3>分析依据</h3>
        {report.evidence.map((item) => (
          <p key={item}>
            <Icon name="check" className="icon-sm" />
            {item}
          </p>
        ))}
      </div>
      <div className="surface-note">
        <Icon name="lock" className="icon-sm" />
        <span>
          {report.origin === 'ai'
            ? '本报告由 DeepSeek 生成 · 经本站服务端代理；请求只包含你在设置中授权的摘要，API Key 不会出现在浏览器。'
            : report.origin === 'mock'
              ? '本报告由本地 Mock 规则生成，未调用真实模型。'
              : '这条报告来自本地示例数据，用于展示报告结构。'}
        </span>
      </div>
      <div className="surface-form-actions">
        <button className="btn secondary" type="button" onClick={onClose}>
          关闭
        </button>
        <button className="btn primary" type="button" onClick={onApply}>
          应用建议
        </button>
      </div>
    </PageSheet>
  )
}

export function ReportsPage() {
  const { showToast } = useUI()
  const {
    setPlanItems,
    profile,
    settings,
    meals,
    studyRecords,
    waterLog,
    waterLiters,
    fitnessSession,
    aiConsent,
    reports,
    setReports,
  } = useMockData()
  const navigate = useNavigate()
  const [range, setRange] = useState<RangeKey>('7')
  const [generation, setGeneration] = useState<GenerationState>('idle')
  const [probeState, setProbeState] = useState<ReportSource>('probing')
  // 没有授权时一律视为本地 Mock，不等待、也不发起健康检查。
  const reportSource: ReportSource = aiConsent ? probeState : 'mock'
  const [fallbackNote, setFallbackNote] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [selectedReport, setSelectedReport] = useState<ReportRecord | null>(null)
  const [pendingReport, setPendingReport] = useState<ReportRecord | null>(null)
  const [confirmApply, setConfirmApply] = useState(false)
  const [generatedReport, setGeneratedReport] = useState<ReportRecord | null>(null)

  const sourceEnabled = (source: DataSource) => aiConsent && settings.sources[source]
  const exercises = fitnessSession?.exercises ?? []
  const fitnessSummary = summarizeFitness(exercises)
  const doneSets = fitnessSummary.doneSets
  const trainingSummaryText = formatTrainingSummary(exercises)
  const trainingCount = doneSets > 0 || fitnessSession?.sessionStatus === 'completed' ? 1 : 0
  const studyCount = studyRecords.length
  const englishCount = studyRecords.filter((record) => record.category === 'english').length
  const mathCount = studyRecords.filter((record) => record.category === 'math').length
  const studyMinutes = studyRecords.reduce((total, record) => total + record.duration, 0)
  const mealCount = meals.filter((meal) => meal.entries.length > 0).length
  const foodEntryCount = meals.reduce((total, meal) => total + meal.entries.length, 0)
  const waterCount = waterLog.length + 1
  const profileFieldCount = countProfileFields(profile)
  const profileCompleteness = calculateProfileCompleteness(profile)
  const fitnessSourceEnabled = aiConsent && settings.sources.fitness
  const studySourceEnabled = aiConsent && settings.sources.study
  const dietSourceEnabled = aiConsent && settings.sources.diet
  const profileSourceEnabled = aiConsent && settings.sources.profile
  const dataRows = useMemo(
    () => [
      {
        key: 'fitness' as const,
        label: '训练记录',
        shortLabel: '训练',
        count: trainingCount,
        unit: '次',
        enabled: fitnessSourceEnabled,
      },
      {
        key: 'study' as const,
        label: '学习记录',
        shortLabel: '学习',
        count: studyCount,
        unit: '条',
        enabled: studySourceEnabled,
      },
      {
        key: 'diet' as const,
        label: '饮食餐次',
        shortLabel: '饮食',
        count: mealCount,
        unit: '餐',
        enabled: dietSourceEnabled,
      },
      {
        key: 'diet' as const,
        label: '饮水事件',
        shortLabel: '饮水',
        count: waterCount,
        unit: '条',
        enabled: dietSourceEnabled,
      },
    ],
    [
      dietSourceEnabled,
      fitnessSourceEnabled,
      mealCount,
      studyCount,
      studySourceEnabled,
      trainingCount,
      waterCount,
    ],
  )
  const localRecordTotal = dataRows.reduce((total, row) => total + row.count, 0)
  const referencedRecordTotal = dataRows.reduce(
    (total, row) => total + (row.enabled ? row.count : 0),
    0,
  )
  const maxDataCount = Math.max(1, ...dataRows.map((row) => row.count))
  const citationSummary = dataRows
    .filter((row) => row.enabled)
    .map((row) => `${row.shortLabel} ${row.count} ${row.unit}`)
    .join('、')
  const evidenceItems = useMemo(
    () => [
      fitnessSourceEnabled
        ? fitnessSession
          ? `训练记录：${trainingSummaryText}`
          : '训练记录：今天尚未开始训练'
        : '训练记录：本次不引用',
      studySourceEnabled
        ? `学习记录：共 ${studyCount} 条，英语 ${englishCount} 条、高数 ${mathCount} 条，累计 ${studyMinutes} 分钟`
        : '学习记录：本次不引用',
      dietSourceEnabled
        ? `饮食记录：${mealCount} 个有食物的餐次，共 ${foodEntryCount} 个食物条目`
        : '饮食记录：本次不引用',
      dietSourceEnabled
        ? `饮水记录：当前 ${waterLiters.toFixed(2)} L，摘要中包含 ${waterCount} 个记录节点`
        : '饮水记录：本次不引用',
      profileSourceEnabled
        ? `个人档案：已填写 ${profileFieldCount} / 14 项，完整度 ${profileCompleteness}%`
        : '个人档案：本次不引用',
    ],
    [
      dietSourceEnabled,
      englishCount,
      fitnessSession,
      fitnessSourceEnabled,
      foodEntryCount,
      mathCount,
      mealCount,
      profileCompleteness,
      profileFieldCount,
      profileSourceEnabled,
      studyCount,
      studyMinutes,
      studySourceEnabled,
      trainingSummaryText,
      waterCount,
      waterLiters,
    ],
  )

  const latestReport = reports[0]

  const todayBriefDraft = useMemo(() => {
    const waterGap = Math.max(0, 2 - waterLiters)
    const trainingDone = trainingCount > 0
    const status = waterGap > 0.05 ? '先补饮水' : trainingDone ? '节奏稳定' : '待推进'
    const summary = `今天已留下 ${localRecordTotal} 条本地记录，其中可引用 ${referencedRecordTotal} 条。${
      trainingDone
        ? '训练已经开始，晚间更适合安排一次轻量学习复盘。'
        : '训练尚未开始，建议先守住最重要的训练安排。'
    }${waterGap > 0.05 ? `饮水还差约 ${Math.round(waterGap * 1000)} ml。` : '饮水已达到今日目标。'}`

    const conclusions = [
      trainingDone
        ? `训练记录已更新：${trainingSummaryText}。`
        : '训练尚未开始，先完成计划中的训练，再决定是否追加学习任务。',
      `学习记录累计 ${studyMinutes} 分钟，英语 ${englishCount} 条、高数 ${mathCount} 条。`,
      waterGap > 0.05
        ? `饮水当前 ${waterLiters.toFixed(2)} L，距离 2 L 目标还有 ${Math.round(waterGap * 1000)} ml。`
        : '饮水已达到 2 L 目标，后续只需按节奏补充。',
    ]

    const actions = [
      waterGap > 0.05
        ? `下午分两次补水，每次约 ${Math.max(150, Math.min(300, Math.round((waterGap * 1000) / 2)))} ml。`
        : '保持当前饮水节奏，不额外增加集中饮水。',
      trainingDone
        ? '训练后 2 小时内补充一餐含蛋白质的主食，并按实际运动量安排恢复。'
        : '把训练放在晚饭前，完成后根据实际记录决定是否追加运动量。',
      studyMinutes >= 45
        ? '晚间只做一次 20 分钟轻量复盘，不再新增高数任务。'
        : '先用 20 分钟完成高数错题复盘，再结束今天的学习。',
    ]

    const metric = [
      {
        label: '训练',
        value: trainingDone ? `${doneSets} 组` : '未开始',
        detail: trainingDone ? '当前会话' : '按原计划推进',
      },
      { label: '学习', value: `${studyMinutes} min`, detail: `${studyCount} 条记录` },
      { label: '饮食记录', value: `${mealCount} 餐`, detail: `${foodEntryCount} 个食物条目` },
      {
        label: '饮水',
        value: `${waterLiters.toFixed(2)} L`,
        detail: waterGap > 0.05 ? `还差 ${Math.round(waterGap * 1000)} ml` : '已达标',
      },
    ]

    return {
      type: '今日简报',
      title: trainingDone ? '训练已经落地，接下来守住补水与复盘' : '先把训练安排好，再收住晚间学习',
      period: RANGE_LABELS[range],
      summary,
      status,
      metric,
      conclusions,
      actions,
      evidence: evidenceItems,
    }
  }, [
    doneSets,
    englishCount,
    evidenceItems,
    foodEntryCount,
    localRecordTotal,
    mathCount,
    mealCount,
    range,
    referencedRecordTotal,
    studyCount,
    studyMinutes,
    trainingCount,
    trainingSummaryText,
    waterLiters,
  ])

  /**
   * 发给服务端的最小化摘要：只包含「已授权 + 来源开关打开」的模块，
   * 其余模块保持 null，绝不用 0 顶替（否则模型会把未授权误当成「没有记录」）。
   */
  const reportDigest = useMemo<ReportDigest>(
    () =>
      buildReportDigest({
        aiConsent,
        settings,
        profile,
        fitnessSession,
        studyRecords,
        meals,
        waterLiters,
        waterLog,
      }),
    [aiConsent, settings, profile, fitnessSession, studyRecords, meals, waterLiters, waterLog],
  )

  // 打开页面时检测服务端是否真的能调用模型：只有明确可用才展示 DeepSeek 标签。
  useEffect(() => {
    if (!aiConsent) return
    let active = true
    void probeAiReport().then((available) => {
      if (active) setProbeState(available ? 'ai' : 'mock')
    })
    return () => {
      active = false
    }
  }, [aiConsent])

  const canUseAi =
    aiConsent && reportSource === 'ai' && (referencedRecordTotal > 0 || profileSourceEnabled)

  const finishGeneration = (content?: ReportContent) => {
    const next = buildDailyReport(todayBriefDraft, content)
    setReports((current) => [next, ...current])
    setGeneratedReport(next)
    setGeneration('success')
  }

  const generate = async () => {
    if (generation === 'loading') return
    setGeneration('loading')
    setGenerationError(null)
    setFallbackNote(null)
    setGeneratedReport(null)
    setSummaryOpen(false)
    setEvidenceOpen(false)

    if (!canUseAi) {
      // 本地 Mock：规则生成是同步的，留一点整理时间让状态变化可见。
      await new Promise((resolve) => window.setTimeout(resolve, 600))
      finishGeneration()
      return
    }

    try {
      const content = await requestAiReport({
        type: '今日简报',
        rangeDays: Number(range) as ReportRangeDays,
        digest: reportDigest,
      })
      finishGeneration(content)
    } catch (error) {
      if (error instanceof ReportUnavailableError) {
        // 服务端暂时不可用：回退本地 Mock，并如实说明这一次不是真实模型生成的。
        setProbeState('mock')
        setFallbackNote(`${REPORT_FALLBACK_NOTE}（${error.message}）`)
        finishGeneration()
        return
      }
      if (error instanceof ReportContractError) {
        setGenerationError(`${error.message}记录本身没有受影响，可以直接重试。`)
        setGeneration('error')
        return
      }
      throw error
    }
  }

  const requestApply = (report: ReportRecord) => {
    setSelectedReport(null)
    setPendingReport(report)
    setConfirmApply(true)
  }

  const applyPendingReport = () => {
    if (!pendingReport) return
    setPlanItems((items) => applyReportSuggestions(items, pendingReport))
    setConfirmApply(false)
    setPendingReport(null)
    showToast(`已应用「${pendingReport.type}」建议`)
    navigate('/')
  }

  const openReportType = (title: string) => {
    if (title === '今日简报') {
      void generate()
      return
    }
    const report = reports.find((item) => item.type === title)
    if (report) setSelectedReport(report)
  }

  return (
    <>
      <header className="head reports-head">
        <div className="heading">
          <div className="eyebrow">AI 报告 · 综合复盘</div>
          <h1>
            把记录，整理成
            <br />
            下一步。
          </h1>
          <p className="subtitle">
            报告只在你主动生成时运行。它引用训练、饮食、学习与个人档案的摘要，帮助你看见趋势，而不是制造新的任务压力。
          </p>
        </div>
        <div className="head-actions reports-head-actions">
          <span className="reports-mock-badge">
            <Icon name={reportSource === 'ai' ? 'spark' : 'lock'} className="icon-sm" />
            {reportSource === 'probing'
              ? '正在检测模型服务…'
              : reportSource === 'ai'
                ? AI_REPORT_LABEL
                : MOCK_REPORT_LABEL}
          </span>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              void generate()
            }}
            disabled={generation === 'loading'}
          >
            <Icon name="spark" className="icon-sm" />
            {generation === 'loading' ? '正在生成…' : '生成今日简报'}
          </button>
        </div>
      </header>

      <section
        className={`reports-generation ${generation}`}
        aria-live="polite"
        aria-label="AI 报告生成状态"
      >
        <div className="reports-generation-mark">
          <Icon
            name={generation === 'error' ? 'close' : generation === 'success' ? 'check' : 'spark'}
          />
        </div>
        <div className="reports-generation-copy">
          <span>AI REPORT ENGINE</span>
          {generation === 'idle' && (
            <>
              <h2>今日简报尚未生成</h2>
              <p>
                {'当前有 '}
                {localRecordTotal}
                {' 条本地记录，本次可引用 '}
                {referencedRecordTotal}
                {' 条。'}
                {canUseAi
                  ? '将由本站服务端调用 DeepSeek 生成一份约 200 字的简报。'
                  : '将用本地 Mock 规则生成一份约 200 字的简报。'}
              </p>
            </>
          )}
          {generation === 'loading' && (
            <>
              <h2>正在整理今天的记录</h2>
              <p>
                {canUseAi
                  ? '正在经本站服务端读取授权摘要并请求模型，通常需要几秒到十几秒。'
                  : '正在本地按规则整理训练、饮食、学习与个人档案摘要。'}
              </p>
            </>
          )}
          {generation === 'success' && (
            <>
              <h2>今日简报已生成</h2>
              <p>{generatedReport?.summary ?? latestReport.summary}</p>
              {fallbackNote && (
                <p className="reports-fallback-note" role="status">
                  {fallbackNote}
                </p>
              )}
            </>
          )}
          {generation === 'error' && (
            <>
              <h2>这次生成没有完成</h2>
              <p>{generationError ?? '报告服务返回了错误。记录本身没有受影响，可以直接重试。'}</p>
            </>
          )}
        </div>
        <div className="reports-generation-actions">
          {generation === 'loading' && (
            <span className="reports-loading-dots">
              <i />
              <i />
              <i />
            </span>
          )}
          {generation === 'success' && (
            <button
              className="btn primary"
              type="button"
              onClick={() => setSelectedReport(generatedReport ?? latestReport)}
            >
              查看简报
            </button>
          )}
          {generation === 'error' && (
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                void generate()
              }}
            >
              <Icon name="undo" className="icon-sm" />
              重试
            </button>
          )}
        </div>
      </section>

      <div className="reports-layout">
        <div className="reports-main-column">
          <section className="panel reports-brief" aria-labelledby="weeklyBriefTitle">
            <div className="reports-brief-top">
              <div>
                <span className="reports-kicker">LATEST SYNTHESIS · {RANGE_LABELS[range]}</span>
                <h2 id="weeklyBriefTitle">{latestReport.title}</h2>
                <p>{latestReport.summary}</p>
              </div>
              <span className="reports-status-pill">
                <span className="dot" />
                {latestReport.status}
              </span>
            </div>

            <div className="reports-range-row">
              <div className="segmented" aria-label="报告时间范围">
                {(['7', '30', '90'] as RangeKey[]).map((key) => (
                  <button
                    className={range === key ? 'active' : ''}
                    type="button"
                    key={key}
                    onClick={() => setRange(key)}
                  >
                    {RANGE_LABELS[key]}
                  </button>
                ))}
              </div>
              <span>
                {RANGE_LABELS[range]} · 更新于 {latestReport.updatedAt ?? latestReport.date}
              </span>
            </div>

            <div className="reports-brief-metrics">
              {latestReport.metric.map((metric) => (
                <div key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small>{metric.detail}</small>
                </div>
              ))}
            </div>

            <div className="reports-conclusions">
              {latestReport.conclusions.map((item, index) => (
                <div key={item}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>

            {summaryOpen && (
              <div className="reports-summary-expand">
                <div>
                  <span>建议动作</span>
                  <strong>{latestReport.actions[0]}</strong>
                  <p>{latestReport.actions.slice(1).join(' ')}</p>
                </div>
                <div>
                  <span>引用范围</span>
                  <strong>
                    {referencedRecordTotal}
                    {' 条记录 · '}
                    {sourceEnabled('profile') ? `${profileFieldCount} 项档案字段` : '档案不引用'}
                  </strong>
                  <p>
                    {citationSummary || '当前没有开启任何业务记录来源。'}
                    {sourceEnabled('profile')
                      ? `；档案完整度 ${profileCompleteness}%。`
                      : '；个人档案本次不引用。'}
                  </p>
                </div>
              </div>
            )}

            {evidenceOpen && (
              <div className="reports-evidence">
                <h3>分析依据</h3>
                {evidenceItems.map((item) => (
                  <p key={item}>
                    <Icon name="check" className="icon-sm" />
                    {item}
                  </p>
                ))}
                <div>
                  <Icon name="lock" className="icon-sm" />
                  <span>
                    API Key
                    只保存在你的服务器；发送内容由设置中的来源开关控制，未授权来源不会出现在摘要里。
                  </span>
                </div>
              </div>
            )}

            <div className="reports-brief-actions">
              <button
                className="btn quiet"
                type="button"
                onClick={() => setEvidenceOpen((open) => !open)}
              >
                {evidenceOpen ? '收起依据' : '查看分析依据'}
                <Icon name="chev" className="icon-sm" />
              </button>
              <div>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => setSummaryOpen((open) => !open)}
                >
                  {summaryOpen ? '收起摘要' : '展开详情'}
                </button>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => requestApply(latestReport)}
                >
                  应用建议
                </button>
              </div>
            </div>
          </section>

          <section className="panel reports-history" aria-labelledby="reportHistoryTitle">
            <div className="panel-head">
              <div>
                <h2 className="panel-title" id="reportHistoryTitle">
                  历史报告
                </h2>
                <p className="panel-sub">保留当时的上下文，不覆盖旧结论。</p>
              </div>
              <span className="reports-history-count">{reports.length} 份</span>
            </div>
            <div className="reports-history-list">
              {reports.map((report) => (
                <button
                  type="button"
                  className="reports-history-row"
                  key={report.id}
                  onClick={() => setSelectedReport(report)}
                >
                  <span className="reports-history-date">
                    <strong>{report.date}</strong>
                    <small>{report.type}</small>
                  </span>
                  <span className="reports-history-copy">
                    <strong>{report.title}</strong>
                    <small>{report.summary}</small>
                  </span>
                  <span className="reports-history-tag">{report.status}</span>
                  <Icon name="chev" className="icon-sm" />
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside className="reports-side-column">
          <section className="panel reports-types" aria-labelledby="reportTypesTitle">
            <div className="panel-head">
              <div>
                <h2 className="panel-title" id="reportTypesTitle">
                  报告类型
                </h2>
                <p className="panel-sub">按当前记录可生成的内容。</p>
              </div>
            </div>
            <div className="reports-type-list">
              {TYPE_CARDS.map((card) => (
                <button
                  type="button"
                  className="reports-type-row"
                  key={card.title}
                  onClick={() => openReportType(card.title)}
                >
                  <span className="reports-type-icon">
                    <Icon name={card.icon} />
                  </span>
                  <span>
                    <strong>{card.title}</strong>
                    <small>{card.detail}</small>
                    <em>{card.tag}</em>
                  </span>
                  <Icon name="chev" className="icon-sm" />
                </button>
              ))}
            </div>
          </section>

          <section className="panel reports-data" aria-labelledby="reportDataTitle">
            <div className="panel-head">
              <div>
                <h2 className="panel-title" id="reportDataTitle">
                  本次数据摘要
                </h2>
                <p className="panel-sub">生成报告时可能引用的本地记录。</p>
              </div>
            </div>
            <div className="reports-data-bars">
              {dataRows.map((row) => (
                <div className={row.enabled ? '' : 'muted'} key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.count}</strong>
                  <i>
                    <span
                      style={{
                        width: row.count
                          ? `${Math.max(7, (row.count / maxDataCount) * 100)}%`
                          : '0%',
                      }}
                    />
                  </i>
                  <em>{row.enabled ? '引用' : '本次不引用'}</em>
                </div>
              ))}
            </div>
            <div className="reports-data-foot">
              <span>
                本地共 {localRecordTotal} 条 · 本次引用 {referencedRecordTotal} 条
              </span>
              <strong>
                {sourceEnabled('profile')
                  ? `档案摘要 ${profileFieldCount} / 14 项`
                  : '档案摘要 本次不引用'}
              </strong>
            </div>
          </section>

          <section className="reports-service" aria-labelledby="reportServiceTitle">
            <div className="reports-service-head">
              <span>
                <Icon name="spark" />
              </span>
              <div>
                <small>DEEPSEEK SERVICE</small>
                <h2 id="reportServiceTitle">
                  {reportSource === 'ai' ? '服务端代理已连接' : '本地 Mock 模式'}
                </h2>
              </div>
            </div>
            <p>
              生成报告时，浏览器只把你在设置中授权的摘要发给本站服务端，由服务端携带 API Key 调用
              DeepSeek；浏览器接触不到 Key，也拿不到除了报告文字之外的模型输出。
            </p>
            <div className="reports-service-status">
              <span className="dot" />
              <strong>
                {reportSource === 'probing'
                  ? '状态：正在检测'
                  : reportSource === 'ai'
                    ? '状态：已连接 DeepSeek'
                    : '状态：生成时使用本地 Mock'}
              </strong>
              <small>
                {reportSource === 'ai'
                  ? '请求经 /api/report 代理转发'
                  : '本地规则生成，不发送任何模型请求'}
              </small>
            </div>
          </section>
        </aside>
      </div>

      {selectedReport && (
        <ReportDetailSheet
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
          onApply={() => requestApply(selectedReport)}
        />
      )}

      {confirmApply && (
        <ConfirmDialog
          title="把这些建议应用到今日计划？"
          description="会新增或调整今日安排，但不会修改已经完成的历史记录。应用后会回到“今日”，调整后的计划会随本地数据一起保存。"
          confirmLabel="应用并查看今日"
          onClose={() => {
            setConfirmApply(false)
            setPendingReport(null)
          }}
          onConfirm={applyPendingReport}
        />
      )}
    </>
  )
}
