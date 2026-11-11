import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ConfirmDialog, PageSheet } from '../components/PageSheet'
import { useMockData } from '../context/mock-data-context'
import { PREBUILT_AI_LABEL } from '../data/prebuilt-demo-ai'
import { useRuntimeMode } from '../context/runtime-mode-context'
import { useUI } from '../context/ui-context'
import { calculateProfileCompleteness, countProfileFields } from '../data/profile'
import {
  ANALYSIS_CACHE_LABEL,
  ANALYSIS_CONSENT_LABEL,
  ANALYSIS_FALLBACK_NOTE,
  ANALYSIS_INVALID_LABEL,
  ANALYSIS_LOCAL_LABEL,
  ANALYSIS_RULES_LABEL,
  ANALYSIS_RULES_NOTE,
  ANALYSIS_SERVER_LABEL,
  ANALYSIS_SYNC_OFF_LABEL,
  ANALYSIS_UNAVAILABLE_LABEL,
  AnalysisRequestError,
  createAnalysisClient,
} from '../lib/analysis-client'
import type {
  AnalysisRangeDays,
  AnalysisReportDetail,
  AnalysisReportListItem,
  AnalysisReportResponse,
} from '../lib/analysis-contract'
import { createDateWindow, todayDateKey } from '../lib/history'
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
import { collectReportWindowFacts } from '../lib/report-window'
import type { ReportContent, ReportDigest, ReportRangeDays } from '../lib/report-types'
import type { DataSource, PlanItem, ReportRecord } from '../types'

type GenerationState = 'idle' | 'loading' | 'success' | 'error'
type RangeKey = '7' | '30' | '90'
/** 当前报告来源：正在检测 / 真实模型（经服务端代理）/ 本地 Mock / demo 预生成。 */
type ReportSource = 'probing' | 'ai' | 'mock' | 'prebuilt'

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

  if (report.type === '综合分析') {
    // 服务端综合分析只提供文字建议：把「建议动作」转成今日计划条目，保留原文出处。
    const slots = ['20:00', '20:30', '21:00', '21:30']
    return report.actions.slice(0, slots.length).reduce(
      (next, action, index) =>
        upsertPlanItem(next, {
          id: `analysis-action-${reportId}-${index}`,
          name: action.length > 20 ? `${action.slice(0, 20)}…` : action,
          time: slots[index],
          detail: `${report.period}服务端综合分析建议`,
          kind: 'default',
          done: false,
        }),
      items,
    )
  }

  if (report.origin === 'prebuilt') {
    const slots = ['19:00', '19:30', '20:00']
    return report.actions.slice(0, slots.length).reduce(
      (next, action, index) =>
        upsertPlanItem(next, {
          id: `prebuilt-action-${reportId}-${index}`,
          name: action.length > 20 ? `${action.slice(0, 20)}…` : action,
          time: slots[index],
          detail: `${report.period} · 查看报告后加入`,
          kind: 'default',
          done: false,
        }),
      items,
    )
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

const ANALYSIS_EXPERIENCE_MODE_LABEL = '桌面体验模式'

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

/** 报告记录的 date 是本地化的「月/日」，这里把 provider 的日期键（YYYY-MM-DD）换成同一口径。 */
function reportDateFromKey(dateKey: string) {
  const [, month, day] = dateKey.split('-')
  if (!month || !day) return dateKey
  return `${Number(month)}/${Number(day)}`
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

function formatPrebuiltGeneratedAt(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function ReportDetailSheet({
  report,
  readOnly = false,
  onClose,
  onApply,
}: {
  report: ReportRecord
  readOnly?: boolean
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
            : report.origin === 'rules'
              ? '本报告由服务端规则基于真实记录生成，模型暂时不可用，未调用外部模型。'
              : report.origin === 'mock'
                ? '本报告由本地 Mock 规则生成，未调用真实模型。'
                : report.origin === 'prebuilt' && report.prebuilt
                  ? `本报告在部署前通过 ${report.prebuilt.model} 生成（${formatPrebuiltGeneratedAt(report.prebuilt.generatedAt)}）；部署后只读，不再调用 AI。`
                  : '这条报告来自本地示例数据，用于展示报告结构。'}
        </span>
      </div>
      <div className="surface-form-actions">
        <button className="btn secondary" type="button" onClick={onClose}>
          关闭
        </button>
        {!readOnly && (
          <button className="btn primary" type="button" onClick={onApply}>
            应用建议
          </button>
        )}
      </div>
    </PageSheet>
  )
}

/** 服务端综合分析页内状态：两种入口不可用 + 加载 + 两种成功来源 + 两种失败分支。 */
type ServerAnalysisView =
  | { kind: 'experience-off' }
  | { kind: 'prebuilt'; report: ReportRecord | null }
  | { kind: 'sync-off' }
  | { kind: 'consent-off' }
  | { kind: 'loading' }
  | { kind: 'ai'; report: AnalysisReportResponse }
  | { kind: 'rules'; report: AnalysisReportResponse }
  | { kind: 'local'; error: AnalysisRequestError }
  | { kind: 'error'; error: AnalysisRequestError }

/** 服务端归档详情映射成本地报告结构，复用同一个详情抽屉；不写回 reports 历史。 */
function mapAnalysisDetailToReport(detail: AnalysisReportDetail): ReportRecord {
  return {
    id: `analysis-${detail.id}`,
    type: '综合分析',
    title: detail.content.title,
    date: formatReportDate(new Date(detail.createdAt)),
    period: `近 ${detail.rangeDays} 天`,
    summary: detail.content.summary,
    status: detail.content.status,
    metric: detail.metrics.map((metric) => ({ ...metric })),
    conclusions: [...detail.content.conclusions],
    actions: [...detail.content.actions],
    evidence: [...detail.content.analysis],
    origin: detail.origin === 'rules' ? 'rules' : 'ai',
  }
}

function AnalysisReportContent({ report }: { report: AnalysisReportResponse }) {
  return (
    <>
      <h3>{report.content.title}</h3>
      <div className="reports-analysis-meta">
        <span className="reports-status-pill">
          <span className="dot" />
          {report.content.status}
        </span>
        <span>
          近 {report.range.days} 天 · {report.range.start} ~ {report.range.end}
        </span>
        {report.model && <span className="reports-analysis-model">{report.model}</span>}
      </div>
      <p className="reports-analysis-summary">{report.content.summary}</p>
      <div className="reports-analysis-metrics">
        {report.metrics.map((metric) => (
          <div key={`${metric.label}-${metric.value}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </div>
        ))}
      </div>
      <div className="reports-analysis-body">
        {report.content.analysis.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <div className="reports-analysis-lists">
        <div>
          <h4>观察结论</h4>
          <ol>
            {report.content.conclusions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </div>
        <div>
          <h4>建议动作</h4>
          <ul>
            {report.content.actions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      {report.content.warnings.length > 0 && (
        <div className="reports-analysis-warnings" role="status">
          <Icon name="lock" className="icon-sm" />
          <div>
            {report.content.warnings.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/** 服务端不可用时展示本机已有报告：明确标注「本地生成 · Mock 报告」，不冒充 AI。 */
function LocalAnalysisFallback({ report }: { report: ReportRecord | null }) {
  if (!report) {
    return (
      <div className="reports-analysis-local-report">
        <h3>本机还没有历史报告</h3>
        <p>先生成一份今日简报，再查看可用的本地分析内容。</p>
      </div>
    )
  }

  return (
    <div className="reports-analysis-local-report">
      <h3>{report.title}</h3>
      <p>{report.summary}</p>
      <div className="reports-analysis-metrics">
        {report.metric.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </div>
        ))}
      </div>
      <div className="reports-analysis-lists">
        <div>
          <h4>观察结论</h4>
          <ol>
            {report.conclusions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </div>
        <div>
          <h4>建议动作</h4>
          <ul>
            {report.actions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function AnalysisErrorState({
  error,
  rangeDays,
}: {
  error: AnalysisRequestError
  rangeDays: AnalysisRangeDays
}) {
  if (error.kind === 'unauthorized') {
    return (
      <div className="reports-analysis-state">
        <h3>本机令牌已失效，需要重新绑定</h3>
        <p>{error.message}</p>
        <p className="reports-analysis-note">
          重新绑定不会删除本机数据，服务端仍以恢复码对应的账号为准。
        </p>
      </div>
    )
  }
  if (error.kind === 'consent-off') {
    return (
      <div className="reports-analysis-state">
        <h3>{ANALYSIS_CONSENT_LABEL}</h3>
        <p>服务端检查到你关闭了 AI 授权或所有数据来源，因此没有发起分析。</p>
      </div>
    )
  }
  if (error.kind === 'insufficient') {
    return (
      <div className="reports-analysis-state">
        <h3>窗口内记录不足，先记录几天再看</h3>
        <p>{`当前窗口：近 ${rangeDays} 天。${error.message}`}</p>
        <p className="reports-analysis-note">
          服务端需要窗口内有足够多天的真实记录，才会生成综合分析。
        </p>
      </div>
    )
  }
  if (error.kind === 'invalid') {
    return (
      <div className="reports-analysis-state">
        <h3>分析请求没有被接受</h3>
        <p>{error.message}</p>
        <p className="reports-analysis-note">分析窗口只支持 7 / 30 / 90 天，可切换窗口后重试。</p>
      </div>
    )
  }
  if (error.kind === 'rate-limited') {
    return (
      <div className="reports-analysis-state">
        <h3>请求太频繁，稍后再试</h3>
        <p>{error.message}</p>
      </div>
    )
  }
  return (
    <div className="reports-analysis-state">
      <h3>{ANALYSIS_INVALID_LABEL}</h3>
      <p className="reports-analysis-note">
        服务端返回的报告结构或长度不符合契约，记录本身没有受影响，可以重试。
      </p>
    </div>
  )
}

function ServerAnalysisPanel({
  view,
  rangeLabel,
  rangeDays,
  localReport,
  onReanalyze,
  onRetry,
  onGoProfile,
  onGoSettings,
}: {
  view: ServerAnalysisView
  rangeLabel: string
  rangeDays: AnalysisRangeDays
  localReport: ReportRecord
  onReanalyze: () => void
  onRetry: () => void
  onGoProfile: () => void
  onGoSettings: () => void
}) {
  const variant =
    view.kind === 'experience-off'
      ? 'experience-mode'
      : view.kind === 'prebuilt'
        ? 'experience-mode'
        : view.kind === 'ai'
          ? 'ai'
          : view.kind === 'rules'
            ? 'rules'
            : view.kind === 'local'
              ? 'local'
              : view.kind === 'loading'
                ? 'loading'
                : view.kind === 'sync-off'
                  ? 'sync-off'
                  : view.kind === 'consent-off'
                    ? 'consent'
                    : 'error'
  const badge =
    view.kind === 'experience-off'
      ? `${ANALYSIS_EXPERIENCE_MODE_LABEL} · 仅本地 Mock`
      : view.kind === 'prebuilt'
        ? PREBUILT_AI_LABEL
        : view.kind === 'ai'
          ? ANALYSIS_SERVER_LABEL
          : view.kind === 'rules'
            ? ANALYSIS_RULES_LABEL
            : view.kind === 'local'
              ? ANALYSIS_LOCAL_LABEL
              : view.kind === 'error'
                ? view.error.kind === 'consent-off'
                  ? ANALYSIS_CONSENT_LABEL
                  : view.error.kind === 'invalid-response'
                    ? ANALYSIS_INVALID_LABEL
                    : ANALYSIS_UNAVAILABLE_LABEL
                : null

  return (
    <section
      className={`panel reports-analysis reports-analysis--${variant}`}
      aria-labelledby="serverAnalysisTitle"
      aria-live="polite"
    >
      <div className="reports-analysis-head">
        <div>
          <span className="reports-analysis-kicker">SERVER ANALYSIS · {rangeLabel}</span>
          <h2 id="serverAnalysisTitle">服务端综合分析</h2>
        </div>
        {badge && <span className="reports-analysis-badge">{badge}</span>}
      </div>

      {view.kind === 'experience-off' && (
        <div className="reports-analysis-state">
          <h3>{ANALYSIS_EXPERIENCE_MODE_LABEL}固定使用本地 Mock</h3>
          <p>桌面体验模式不调用服务端综合分析，也不会上传本机记录。下方本地报告与历史不受影响。</p>
        </div>
      )}

      {view.kind === 'prebuilt' && (
        <div className="reports-analysis-state">
          <p className="reports-analysis-note" role="status">
            以下内容在部署前通过 DeepSeek
            生成并固化进前端包；当前只读，部署后不会再次调用模型或上传记录。
          </p>
          <LocalAnalysisFallback report={view.report} />
        </div>
      )}

      {view.kind === 'sync-off' && (
        <div className="reports-analysis-state">
          <h3>{ANALYSIS_SYNC_OFF_LABEL}</h3>
          <p>
            服务端综合分析在服务器上聚合记录并归档报告，需要先开启跨设备同步并绑定本机。下面的本地报告与历史不受影响。
          </p>
        </div>
      )}

      {view.kind === 'consent-off' && (
        <div className="reports-analysis-state">
          <h3>{ANALYSIS_CONSENT_LABEL}</h3>
          <p>
            服务端检查到你关闭了 AI
            授权或所有数据来源，因此没有发起分析。开启后只会发送你授权的数据摘要。
          </p>
        </div>
      )}

      {view.kind === 'loading' && (
        <div className="reports-analysis-state">
          <h3>正在生成服务端综合分析…</h3>
          <p>服务端正在聚合{rangeLabel}的记录并等待模型生成，通常需要几秒到十几秒。</p>
        </div>
      )}

      {view.kind === 'ai' && (
        <div className="reports-analysis-state">
          {view.report.cached && (
            <p className="reports-analysis-cache" role="status">
              {ANALYSIS_CACHE_LABEL}
            </p>
          )}
          <AnalysisReportContent report={view.report} />
        </div>
      )}

      {view.kind === 'rules' && (
        <div className="reports-analysis-state">
          <p className="reports-analysis-note" role="status">
            {ANALYSIS_RULES_NOTE}
          </p>
          <AnalysisReportContent report={view.report} />
        </div>
      )}

      {view.kind === 'local' && (
        <div className="reports-analysis-state">
          <h3>{ANALYSIS_UNAVAILABLE_LABEL}</h3>
          <p>{view.error.message}</p>
          <p className="reports-analysis-note">{ANALYSIS_FALLBACK_NOTE}</p>
          <LocalAnalysisFallback report={localReport} />
        </div>
      )}

      {view.kind === 'error' && <AnalysisErrorState error={view.error} rangeDays={rangeDays} />}

      <div className="reports-analysis-actions">
        {view.kind === 'sync-off' && (
          <button className="btn secondary" type="button" onClick={onGoSettings}>
            去设置开启数据同步
          </button>
        )}
        {view.kind === 'consent-off' && (
          <button className="btn secondary" type="button" onClick={onGoProfile}>
            去个人档案开启 AI 授权
          </button>
        )}
        {view.kind === 'error' && view.error.kind === 'unauthorized' && (
          <button className="btn secondary" type="button" onClick={onGoSettings}>
            去设置里重新绑定本机
          </button>
        )}
        {view.kind === 'error' && view.error.kind === 'consent-off' && (
          <button className="btn secondary" type="button" onClick={onGoProfile}>
            去个人档案开启 AI 授权
          </button>
        )}
        {view.kind === 'loading' && (
          <span className="reports-analysis-hint">正在等待服务端返回…</span>
        )}
        {(view.kind === 'ai' || view.kind === 'rules') && (
          <button className="btn primary" type="button" onClick={onReanalyze}>
            <Icon name="spark" className="icon-sm" />
            重新分析
          </button>
        )}
        {(view.kind === 'local' ||
          (view.kind === 'error' &&
            view.error.kind !== 'unauthorized' &&
            view.error.kind !== 'consent-off' &&
            view.error.kind !== 'insufficient')) && (
          <button className="btn secondary" type="button" onClick={onRetry}>
            <Icon name="undo" className="icon-sm" />
            重试
          </button>
        )}
      </div>
    </section>
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
    waterLiters: todayWaterLiters,
    fitnessSession,
    fitnessHistory,
    dietDays,
    waterHistory,
    planHistory,
    today,
    aiConsent,
    reports,
    setReports,
    syncStatus,
    syncToken,
  } = useMockData()
  const runtime = useRuntimeMode()
  const navigate = useNavigate()
  // 顶部「生成状态」原本只是本页的临时状态：跳到别的页面再回来会重置为「尚未生成」，
  // 看上去像刚生成的报告丢了。这里按「今天是否已经生成过今日简报」派生展示状态；
  // 报告实体本身仍存放在 reports（随 IndexedDB 持久化），这里只负责别把已生成误报成未生成。
  // 用派生值而不是 effect 回写 state：刷新时 reports 要等 IndexedDB 回填，用 effect 同步
  // 会多一轮渲染，也违反 react(set-state-in-effect)。
  const todayReportDate = reportDateFromKey(today)
  // 只认「最新一份报告就是今天生成的今日简报」：这样顶部成功态与下面的 LATEST SYNTHESIS
  // 卡片指向同一份记录，不会出现「顶部说已生成、卡片却是另一份」的分裂。
  const todayBriefReport = useMemo(() => {
    const latest = reports[0]
    if (runtime.mode === 'demo') {
      return (
        reports.find((report) => report.id === 'report-demo-daily') ??
        reports.find((report) => report.origin === 'prebuilt') ??
        latest ??
        null
      )
    }
    if (!latest || latest.type !== '今日简报' || latest.date !== todayReportDate) return null
    return latest
  }, [reports, runtime.mode, todayReportDate])
  const [range, setRange] = useState<RangeKey>('7')
  const [generation, setGeneration] = useState<GenerationState>('idle')
  const [probeState, setProbeState] = useState<ReportSource>('probing')
  // 没有授权时一律视为本地 Mock，不等待、也不发起健康检查。
  const reportSource: ReportSource =
    runtime.mode === 'demo' ? 'prebuilt' : aiConsent && runtime.ai.report ? probeState : 'mock'
  const [fallbackNote, setFallbackNote] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [selectedReport, setSelectedReport] = useState<ReportRecord | null>(null)
  const [pendingReport, setPendingReport] = useState<ReportRecord | null>(null)
  const [confirmApply, setConfirmApply] = useState(false)
  const [generatedReport, setGeneratedReport] = useState<ReportRecord | null>(null)
  // 本页没有正在生成/报错时，以「今天已生成的今日简报」作为成功态展示。
  const generationDisplay: GenerationState =
    runtime.mode === 'demo' || (generation === 'idle' && todayBriefReport) ? 'success' : generation
  const displayReport = generatedReport ?? todayBriefReport

  // ——— 服务端综合分析（设计 §8）———
  // 服务端分析结果只存在本页 state 与服务端归档里，绝不合并进 reports / 本地历史，
  // 也不改写本地报告内容：两者数据来源、留存策略都不同。
  const analysisClient = useMemo(() => createAnalysisClient(), [])
  const analysisRangeDays = Number(range) as AnalysisRangeDays
  const analysisSyncReady = syncStatus.enabled && Boolean(syncToken)
  const analysisAnySourceEnabled =
    settings.sources.fitness ||
    settings.sources.diet ||
    settings.sources.study ||
    settings.sources.profile
  const prebuiltAnalysisReport = useMemo(
    () => reports.find((report) => report.id === 'report-demo-analysis') ?? null,
    [reports],
  )
  const analysisGate: 'prebuilt' | 'experience-off' | 'sync-off' | 'consent-off' | 'ready' =
    runtime.mode === 'demo'
      ? 'prebuilt'
      : !runtime.ai.serverAnalysis
        ? 'experience-off'
        : !analysisSyncReady
          ? 'sync-off'
          : !aiConsent || !analysisAnySourceEnabled
            ? 'consent-off'
            : 'ready'
  const [analysisNonce, setAnalysisNonce] = useState(0)
  const analysisForceRef = useRef(false)
  // 「加载中」由「请求键是否已产出结果」派生：effect 里不再同步 setState，避免级联渲染。
  const analysisRequestKey = `${analysisRangeDays}:${analysisNonce}:${syncToken ?? ''}`
  const [analysisResult, setAnalysisResult] = useState<{
    key: string
    view: ServerAnalysisView
  } | null>(null)
  const [analysisArchive, setAnalysisArchive] = useState<AnalysisReportListItem[]>([])
  const [archiveState, setArchiveState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [archiveRefreshKey, setArchiveRefreshKey] = useState(0)
  const [analysisDetail, setAnalysisDetail] = useState<ReportRecord | null>(null)
  const [analysisDetailId, setAnalysisDetailId] = useState<string | null>(null)
  // 门禁关闭时不展示上次的旧结果；门禁恢复后由下面的 effect 重新请求。
  const displayAnalysisView: ServerAnalysisView =
    analysisGate === 'prebuilt'
      ? { kind: 'prebuilt', report: prebuiltAnalysisReport }
      : analysisGate === 'experience-off'
        ? { kind: 'experience-off' }
        : analysisGate === 'sync-off'
          ? { kind: 'sync-off' }
          : analysisGate === 'consent-off'
            ? { kind: 'consent-off' }
            : analysisResult && analysisResult.key === analysisRequestKey
              ? analysisResult.view
              : { kind: 'loading' }

  const sourceEnabled = (source: DataSource) => aiConsent && settings.sources[source]

  // 报告窗口「近 7 / 30 / 90 天」以本机今天为最后一天；下面的所有数字都按这个窗口汇总。
  const reportWindow = useMemo(() => createDateWindow(Number(range), today), [range, today])
  const windowFacts = useMemo(
    () =>
      collectReportWindowFacts({
        window: reportWindow,
        fitnessSession,
        fitnessHistory,
        studyRecords,
        dietDays,
        waterHistory,
        planHistory,
      }),
    [
      dietDays,
      fitnessHistory,
      fitnessSession,
      planHistory,
      reportWindow,
      studyRecords,
      waterHistory,
    ],
  )
  const fitnessFacts = windowFacts.fitness
  const studyFacts = windowFacts.study
  const dietFacts = windowFacts.diet
  const waterFacts = windowFacts.water
  const planFacts = windowFacts.plan
  const rangeLabel = RANGE_LABELS[range]
  const doneSets = fitnessFacts.doneSets
  const trainingSummaryText = fitnessFacts.summaryText
  const trainingCount = fitnessFacts.sessionCount
  const studyCount = studyFacts.recordCount
  const englishCount = studyFacts.englishCount
  const mathCount = studyFacts.mathCount
  const studyMinutes = studyFacts.totalMinutes
  const mealCount = dietFacts.mealCount
  const foodEntryCount = dietFacts.foodEntryCount
  const waterCount = waterFacts.eventCount
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
        ? trainingSummaryText
          ? `训练记录：${rangeLabel} ${trainingSummaryText}`
          : `训练记录：${rangeLabel}还没有训练记录`
        : '训练记录：本次不引用',
      studySourceEnabled
        ? `学习记录：${rangeLabel}共 ${studyCount} 条，英语 ${englishCount} 条、高数 ${mathCount} 条，累计 ${studyMinutes} 分钟`
        : '学习记录：本次不引用',
      dietSourceEnabled
        ? `饮食记录：${rangeLabel} ${mealCount} 个有食物的餐次，共 ${foodEntryCount} 个食物条目`
        : '饮食记录：本次不引用',
      dietSourceEnabled
        ? `饮水记录：${rangeLabel}累计 ${waterFacts.liters.toFixed(2)} L（${waterCount} 次记录，日均 ${waterFacts.dailyAverage.toFixed(2)} L）`
        : '饮水记录：本次不引用',
      profileSourceEnabled
        ? `个人档案：已填写 ${profileFieldCount} / 14 项，完整度 ${profileCompleteness}%`
        : '个人档案：本次不引用',
    ],
    [
      dietSourceEnabled,
      englishCount,
      fitnessSourceEnabled,
      foodEntryCount,
      mathCount,
      mealCount,
      profileCompleteness,
      profileFieldCount,
      profileSourceEnabled,
      rangeLabel,
      studyCount,
      studyMinutes,
      studySourceEnabled,
      trainingSummaryText,
      waterCount,
      waterFacts.dailyAverage,
      waterFacts.liters,
    ],
  )

  const latestReport: ReportRecord = reports[0] ?? {
    id: `empty-report-${todayReportDate}`,
    type: '今日简报',
    title: '还没有报告',
    date: todayReportDate,
    period: rangeLabel,
    summary: '先留下一段真实记录，再点击上方「生成今日简报」建立第一份报告。',
    status: '待生成',
    metric: [],
    conclusions: [],
    actions: ['先完成一次记录，再生成今日简报。'],
    evidence: [],
    origin: 'mock',
  }

  const todayBriefDraft = useMemo(() => {
    // 「今天」的饮水缺口仍按今日切片算（2 L 目标是每日目标）；窗口内累计只用于汇总口径。
    const todayWaterGap = Math.max(0, 2 - todayWaterLiters)
    const trainingDone = trainingCount > 0 || fitnessFacts.hasSession
    const status = todayWaterGap > 0.05 ? '先补饮水' : trainingDone ? '节奏稳定' : '待推进'
    const planSummary =
      planFacts.total > 0 ? `${rangeLabel}计划完成 ${planFacts.done} / ${planFacts.total} 项。` : ''
    const summary = `${rangeLabel}已留下 ${localRecordTotal} 条本地记录，其中可引用 ${referencedRecordTotal} 条。${planSummary}${
      trainingDone
        ? '训练记录已经进入窗口，晚间更适合安排一次轻量学习复盘。'
        : '窗口内还没有训练，建议先守住今天最重要的训练安排。'
    }${
      todayWaterGap > 0.05
        ? `今天饮水还差约 ${Math.round(todayWaterGap * 1000)} ml。`
        : '今天饮水已达到目标。'
    }`

    const conclusions = [
      trainingCount > 0
        ? `${rangeLabel}训练 ${trainingCount} 次：${trainingSummaryText}。`
        : fitnessFacts.hasSession
          ? `今天已经开始训练：${trainingSummaryText}，尚未完成任何一组。`
          : `${rangeLabel}还没有训练记录，先完成今天计划中的训练，再决定是否追加学习任务。`,
      `${rangeLabel}学习累计 ${studyMinutes} 分钟，英语 ${englishCount} 条、高数 ${mathCount} 条。`,
      `${rangeLabel}饮水累计 ${waterFacts.liters.toFixed(2)} L（${waterCount} 次记录，日均 ${waterFacts.dailyAverage.toFixed(2)} L）；今天${
        todayWaterGap > 0.05
          ? `距离 2 L 目标还有 ${Math.round(todayWaterGap * 1000)} ml`
          : '已达到 2 L 目标'
      }。`,
    ]

    const actions = [
      todayWaterGap > 0.05
        ? `下午分两次补水，每次约 ${Math.max(150, Math.min(300, Math.round((todayWaterGap * 1000) / 2)))} ml。`
        : '保持当前饮水节奏，不额外增加集中饮水。',
      trainingDone
        ? '训练后 2 小时内补充一餐含蛋白质的主食，并按实际运动量安排恢复。'
        : '把训练放在晚饭前，完成后根据实际记录决定是否追加运动量。',
      studyMinutes >= 45 * reportWindow.days
        ? '窗口内学习投入已足，晚间只做一次 20 分钟轻量复盘，不再新增高数任务。'
        : '先用 20 分钟完成高数错题复盘，再结束今天的学习。',
    ]

    const metric = [
      {
        label: '训练',
        value: `${trainingCount} 次`,
        detail: `${rangeLabel}完成 ${doneSets} 组`,
      },
      { label: '学习', value: `${studyMinutes} min`, detail: `${rangeLabel} ${studyCount} 条记录` },
      {
        label: '饮食记录',
        value: `${mealCount} 餐`,
        detail: `${rangeLabel} ${foodEntryCount} 个食物条目`,
      },
      {
        label: '饮水（日均）',
        value: `${waterFacts.dailyAverage.toFixed(2)} L`,
        detail: `${rangeLabel}累计 ${waterFacts.liters.toFixed(2)} L`,
      },
    ]

    return {
      type: '今日简报',
      title: trainingDone ? '训练已经落地，接下来守住补水与复盘' : '先把训练安排好，再收住晚间学习',
      period: rangeLabel,
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
    fitnessFacts.hasSession,
    foodEntryCount,
    localRecordTotal,
    mathCount,
    mealCount,
    planFacts.done,
    planFacts.total,
    rangeLabel,
    referencedRecordTotal,
    reportWindow.days,
    studyCount,
    studyMinutes,
    todayWaterLiters,
    trainingCount,
    trainingSummaryText,
    waterCount,
    waterFacts.dailyAverage,
    waterFacts.liters,
  ])

  /**
   * 发给服务端的最小化摘要：只包含「已授权 + 来源开关打开」的模块，
   * 其余模块保持 null，绝不用 0 顶替（否则模型会把未授权误当成「没有记录」）。
   * 传入 `window` 后训练 / 学习 / 饮食 / 饮水都按当前窗口汇总，字段形状不变。
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
        waterLiters: todayWaterLiters,
        waterLog,
        window: reportWindow,
        fitnessHistory,
        dietDays,
        waterHistory,
        planHistory,
      }),
    [
      aiConsent,
      dietDays,
      fitnessHistory,
      fitnessSession,
      meals,
      planHistory,
      profile,
      reportWindow,
      settings,
      studyRecords,
      todayWaterLiters,
      waterHistory,
      waterLog,
    ],
  )

  // 打开页面时检测服务端是否真的能调用模型：只有明确可用才展示 DeepSeek 标签。
  useEffect(() => {
    if (!aiConsent || !runtime.ai.report) return
    let active = true
    void probeAiReport().then((available) => {
      if (active) setProbeState(available ? 'ai' : 'mock')
    })
    return () => {
      active = false
    }
  }, [aiConsent, runtime.ai.report])

  const canUseAi =
    aiConsent &&
    runtime.ai.report &&
    reportSource === 'ai' &&
    (referencedRecordTotal > 0 || profileSourceEnabled)

  const finishGeneration = (content?: ReportContent) => {
    const next = buildDailyReport(todayBriefDraft, content)
    setReports((current) => [next, ...current])
    setGeneratedReport(next)
    setGeneration('success')
  }

  const generate = async () => {
    if (runtime.mode === 'demo') {
      setSelectedReport(todayBriefReport)
      return
    }
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

  // 请求服务端综合分析。force=true 跳过服务端缓存（「重新分析」）；
  // 网络 / 超时 / 503 属于「服务不可用」，回退到本机报告内容；其余才是真正的错误态。
  const runAnalysis = useCallback(
    async (force: boolean, signal?: AbortSignal) => {
      if (analysisGate !== 'ready' || !syncToken) return
      const key = `${analysisRangeDays}:${analysisNonce}:${syncToken}`
      try {
        const report = await analysisClient.requestAnalysisReport(syncToken, {
          rangeDays: analysisRangeDays,
          force,
          signal,
        })
        setAnalysisResult({
          key,
          view: { kind: report.origin === 'rules' ? 'rules' : 'ai', report },
        })
        // 命中缓存时归档里已有这份报告，不必再请求一次列表。
        if (!report.cached) setArchiveRefreshKey((count) => count + 1)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
        if (!(error instanceof AnalysisRequestError)) throw error
        const view: ServerAnalysisView =
          error.kind === 'network' || error.kind === 'timeout' || error.kind === 'server'
            ? { kind: 'local', error }
            : { kind: 'error', error }
        setAnalysisResult({ key, view })
      }
    },
    [analysisClient, analysisGate, analysisNonce, analysisRangeDays, syncToken],
  )

  const requestAnalysis = (force: boolean) => {
    analysisForceRef.current = force
    setAnalysisNonce((nonce) => nonce + 1)
  }

  // 窗口切换 / 同步恢复 / 手动重新分析时请求一次。
  // 自动请求 force=false，让服务端按 dataRev 命中缓存；手动「重新分析」才跳过缓存。
  useEffect(() => {
    if (analysisGate !== 'ready' || !syncToken) return
    const controller = new AbortController()
    const force = analysisForceRef.current
    analysisForceRef.current = false
    void runAnalysis(force, controller.signal)
    return () => controller.abort()
  }, [analysisGate, runAnalysis, syncToken])

  // 服务端归档：与正文分开请求，列表失败只影响这一块，不遮挡报告正文。
  useEffect(() => {
    if (analysisGate !== 'ready' || !syncToken) return
    let active = true
    void analysisClient
      .fetchReportArchive(syncToken, { limit: 10 })
      .then((result) => {
        if (!active) return
        setAnalysisArchive(result.reports)
        setArchiveState('ready')
        setArchiveError(null)
      })
      .catch((error: unknown) => {
        if (!active) return
        setArchiveState('error')
        setArchiveError(
          error instanceof AnalysisRequestError ? error.message : '服务端归档读取失败，稍后再试。',
        )
      })
    return () => {
      active = false
    }
  }, [analysisClient, analysisGate, archiveRefreshKey, syncToken])

  const openAnalysisArchive = async (item: AnalysisReportListItem) => {
    if (!syncToken) return
    setAnalysisDetailId(item.id)
    try {
      const detail = await analysisClient.fetchReportDetail(syncToken, item.id)
      setAnalysisDetail(mapAnalysisDetailToReport(detail))
    } catch (error) {
      showToast(error instanceof AnalysisRequestError ? error.message : '报告读取失败，稍后再试。')
    } finally {
      setAnalysisDetailId(null)
    }
  }

  const requestApply = (report: ReportRecord) => {
    if (runtime.mode === 'demo') {
      showToast('演示模式为部署前预生成内容，仅可查看。')
      return
    }
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
            {runtime.mode === 'demo'
              ? '演示中的报告和简报均在部署前通过真实模型生成并固化；当前只读，不会再次调用 AI。'
              : '报告只在你主动生成时运行。它引用近 7 / 30 / 90 天窗口内的训练、饮食、学习与个人档案摘要，帮助你看见趋势，而不是制造新的任务压力。'}
          </p>
        </div>
        <div className="head-actions reports-head-actions">
          <span className="reports-mock-badge">
            <Icon name={reportSource === 'ai' ? 'spark' : 'lock'} className="icon-sm" />
            {reportSource === 'probing'
              ? '正在检测模型服务…'
              : reportSource === 'ai'
                ? AI_REPORT_LABEL
                : reportSource === 'prebuilt'
                  ? PREBUILT_AI_LABEL
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
            {runtime.mode === 'demo'
              ? '查看预生成简报'
              : generation === 'loading'
                ? '正在生成…'
                : '生成今日简报'}
          </button>
        </div>
      </header>

      <section
        className={`reports-generation ${generationDisplay}`}
        aria-live="polite"
        aria-label="AI 报告生成状态"
      >
        <div className="reports-generation-mark">
          <Icon
            name={
              generationDisplay === 'error'
                ? 'close'
                : generationDisplay === 'success'
                  ? 'check'
                  : 'spark'
            }
          />
        </div>
        <div className="reports-generation-copy">
          <span>AI REPORT ENGINE</span>
          {generationDisplay === 'idle' && (
            <>
              <h2>今日简报尚未生成</h2>
              <p>
                {rangeLabel}
                {'共 '}
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
          {generationDisplay === 'loading' && (
            <>
              <h2>正在整理今天的记录</h2>
              <p>
                {canUseAi
                  ? '正在经本站服务端读取授权摘要并请求模型，通常需要几秒到十几秒。'
                  : '正在本地按规则整理训练、饮食、学习与个人档案摘要。'}
              </p>
            </>
          )}
          {generationDisplay === 'success' && (
            <>
              <h2>{runtime.mode === 'demo' ? '部署前生成的今日简报' : '今日简报已生成'}</h2>
              <p>{displayReport?.summary ?? latestReport.summary}</p>
              {fallbackNote && (
                <p className="reports-fallback-note" role="status">
                  {fallbackNote}
                </p>
              )}
            </>
          )}
          {generationDisplay === 'error' && (
            <>
              <h2>这次生成没有完成</h2>
              <p>{generationError ?? '报告服务返回了错误。记录本身没有受影响，可以直接重试。'}</p>
            </>
          )}
        </div>
        <div className="reports-generation-actions">
          {generationDisplay === 'loading' && (
            <span className="reports-loading-dots">
              <i />
              <i />
              <i />
            </span>
          )}
          {generationDisplay === 'success' && (
            <button
              className="btn primary"
              type="button"
              onClick={() => setSelectedReport(displayReport ?? latestReport)}
            >
              查看简报
            </button>
          )}
          {generationDisplay === 'error' && (
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
                    disabled={runtime.mode === 'demo'}
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
                  disabled={reports.length === 0}
                  onClick={() => requestApply(latestReport)}
                >
                  应用建议
                </button>
              </div>
            </div>
          </section>

          <ServerAnalysisPanel
            view={displayAnalysisView}
            rangeLabel={rangeLabel}
            rangeDays={analysisRangeDays}
            localReport={latestReport ?? null}
            onReanalyze={() => requestAnalysis(true)}
            onRetry={() => requestAnalysis(false)}
            onGoProfile={() => navigate('/profile')}
            onGoSettings={() => navigate('/settings')}
          />

          {analysisGate === 'ready' && (
            <section
              className="panel reports-analysis-archive"
              aria-labelledby="analysisArchiveTitle"
            >
              <div className="panel-head">
                <div>
                  <h2 className="panel-title" id="analysisArchiveTitle">
                    服务端归档
                  </h2>
                  <p className="panel-sub">服务端保存的综合分析报告，保留 365 天后自动删除。</p>
                </div>
                {archiveState === 'ready' && (
                  <span className="reports-history-count">{analysisArchive.length} 份</span>
                )}
              </div>
              {archiveState === 'loading' && (
                <p className="reports-analysis-archive-state">正在读取归档…</p>
              )}
              {archiveState === 'error' && (
                <p className="reports-analysis-archive-state" role="status">
                  {archiveError}
                </p>
              )}
              {archiveState === 'ready' && analysisArchive.length === 0 && (
                <p className="reports-analysis-archive-state">
                  服务端还没有归档报告，生成一次后就会出现在这里。
                </p>
              )}
              {analysisArchive.length > 0 && (
                <div className="reports-analysis-archive-list">
                  {analysisArchive.map((item) => (
                    <button
                      type="button"
                      className="reports-analysis-archive-row"
                      key={item.id}
                      onClick={() => {
                        void openAnalysisArchive(item)
                      }}
                      disabled={analysisDetailId === item.id}
                    >
                      <span className="reports-analysis-archive-date">
                        <strong>{formatReportDate(new Date(item.createdAt))}</strong>
                        <small>{item.type}</small>
                      </span>
                      <span className="reports-analysis-archive-copy">
                        <strong>{item.title}</strong>
                        <small>
                          近 {item.rangeDays} 天 · {item.status}
                        </small>
                      </span>
                      <span className="reports-analysis-archive-origin">
                        {item.origin === 'ai' ? ANALYSIS_SERVER_LABEL : ANALYSIS_RULES_LABEL}
                      </span>
                      <Icon name="chev" className="icon-sm" />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

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
                    <em>{runtime.mode === 'demo' ? '部署前预生成' : card.tag}</em>
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
                <p className="panel-sub">按当前窗口汇总，生成报告时可能引用的本地记录。</p>
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
                {rangeLabel}共 {localRecordTotal} 条 · 本次引用 {referencedRecordTotal} 条
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
                  {reportSource === 'ai'
                    ? '服务端代理已连接'
                    : reportSource === 'prebuilt'
                      ? '部署前生成 · 当前只读'
                      : '本地 Mock 模式'}
                </h2>
              </div>
            </div>
            <p>
              {runtime.mode === 'demo'
                ? '演示中的报告文字已经在部署前通过本站服务端调用 DeepSeek 生成，并随前端包一起发布；部署后只读取静态内容。'
                : '生成报告时，浏览器只把你在设置中授权的摘要发给本站服务端，由服务端携带 API Key 调用 DeepSeek；浏览器接触不到 Key，也拿不到除了报告文字之外的模型输出。'}
            </p>
            <div className="reports-service-status">
              <span className="dot" />
              <strong>
                {reportSource === 'probing'
                  ? '状态：正在检测'
                  : reportSource === 'ai'
                    ? '状态：已连接 DeepSeek'
                    : reportSource === 'prebuilt'
                      ? '状态：读取部署前快照'
                      : '状态：生成时使用本地 Mock'}
              </strong>
              <small>
                {reportSource === 'ai'
                  ? '请求经 /api/report 代理转发'
                  : reportSource === 'prebuilt'
                    ? '当前不请求 /api/health、/api/report 或 /api/chat'
                    : '本地规则生成，不发送任何模型请求'}
              </small>
            </div>
          </section>
        </aside>
      </div>

      {selectedReport && (
        <ReportDetailSheet
          report={selectedReport}
          readOnly={runtime.mode === 'demo'}
          onClose={() => setSelectedReport(null)}
          onApply={() => requestApply(selectedReport)}
        />
      )}

      {analysisDetail && (
        <ReportDetailSheet
          report={analysisDetail}
          readOnly={runtime.mode === 'demo'}
          onClose={() => setAnalysisDetail(null)}
          onApply={() => requestApply(analysisDetail)}
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
