import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UIContext, type UIContextValue } from '../context/ui-context'
import { MockDataContext, type MockDataContextValue } from '../context/mock-data-context'
import { RuntimeModeProvider } from '../context/RuntimeModeProvider'
import { INITIAL_SETTINGS } from '../data/settings'
import {
  ANALYSIS_CACHE_LABEL,
  ANALYSIS_CONSENT_LABEL,
  ANALYSIS_FALLBACK_NOTE,
  ANALYSIS_INVALID_LABEL,
  ANALYSIS_LOCAL_LABEL,
  ANALYSIS_RULES_LABEL,
  ANALYSIS_RULES_NOTE,
  ANALYSIS_SERVER_LABEL,
  ANALYSIS_UNAVAILABLE_LABEL,
  AnalysisRequestError,
} from '../lib/analysis-client'
import type {
  AnalysisReportResponse,
  AnalysisReportDetail,
  ReportContentV2,
} from '../lib/analysis-contract'
import type { RuntimeMode } from '../lib/runtime-mode'
import type { ProfileData, ReportRecord } from '../types'
import { ReportsPage } from './ReportsPage'

const mocks = vi.hoisted(() => ({
  requestAnalysisReport: vi.fn(),
  fetchReportArchive: vi.fn(),
  fetchReportDetail: vi.fn(),
  fetchAnalysisFacts: vi.fn(),
}))

vi.mock('../lib/analysis-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/analysis-client')>()
  return {
    ...actual,
    createAnalysisClient: () => ({
      requestAnalysisReport: mocks.requestAnalysisReport,
      fetchAnalysisFacts: mocks.fetchAnalysisFacts,
      fetchReportArchive: mocks.fetchReportArchive,
      fetchReportDetail: mocks.fetchReportDetail,
    }),
  }
})

const CONTENT: ReportContentV2 = {
  title: '本周训练与恢复节奏',
  status: '稳步推进',
  summary:
    '过去 7 天你完成了 3 次训练，训练量与饮食摄入基本匹配；恢复节奏稳定，但睡眠时长略低于目标，建议把入睡时间提前 30 分钟。',
  analysis: [
    '训练方面，本周 3 次力量训练覆盖了推、拉、腿三个部分，总容量比上周略有上升，说明渐进超负荷仍在推进。',
    '饮食方面，蛋白质摄入基本达标，但训练日的碳水偏少，可能在下午出现精力低谷，建议在训练前补充一份主食。',
    '恢复方面，睡眠时长平均 6.8 小时，低于你设定的 8 小时目标；连续两晚低于 7 小时后，训练表现出现轻微下滑。',
  ],
  conclusions: ['训练频率稳定，容量小幅提升', '睡眠不足是当前最明显的短板'],
  actions: ['把入睡时间提前到 23:00 前', '训练日午餐增加一份主食'],
  warnings: [],
}

// vitest 未开启 globals，RTL 的自动清理不会生效，这里显式清理避免用例间 DOM 叠加。
afterEach(cleanup)

function buildAiReport(overrides: Partial<AnalysisReportResponse> = {}): AnalysisReportResponse {
  return {
    reportId: 'rpt_analysis_1',
    cached: false,
    origin: 'ai',
    model: 'deepseek-chat',
    range: { start: '2026-02-01', end: '2026-02-07', days: 7 },
    content: CONTENT,
    metrics: [
      { label: '训练次数', value: '3 次', detail: '近 7 天完成' },
      { label: '平均睡眠', value: '6.8 小时', detail: '目标 8 小时' },
    ],
    dataRev: 1,
    createdAt: Date.parse('2026-02-07T12:00:00.000Z'),
    ...overrides,
  }
}

function buildLocalReport(): ReportRecord {
  return {
    id: 'report-local-1',
    type: '今日简报',
    title: '本机简报 · 2 月 7 日',
    date: '2026-02-07',
    period: '近 7 天',
    summary: '这是本机根据已有记录生成的 Mock 简报，用来在服务端不可用时保住可读内容。',
    status: '平稳',
    metric: [{ label: '饮水', value: '1.8 L', detail: '本机记录' }],
    conclusions: ['本机记录完整'],
    actions: ['继续记录'],
    evidence: ['本机记录'],
    origin: 'mock',
  }
}

const PROFILE: ProfileData = {
  age: 26,
  height: 175,
  weight: 70,
  targetWeight: 68,
  goal: '增肌',
  experience: '初级',
  frequency: '每周 3 次',
  equipment: '哑铃',
  dietPreference: '均衡',
  allergies: '无',
  bedtime: '23:00',
  sleepHours: 8,
  stress: '中',
  aiConsent: true,
}

function buildContextValue(overrides: Partial<MockDataContextValue> = {}): MockDataContextValue {
  return {
    goals: [],
    updateGoal: vi.fn(),
    planItems: [],
    setPlanItems: vi.fn(),
    planHistory: [],
    waterLiters: 0,
    waterLog: [],
    waterHistory: [],
    addWater: vi.fn(),
    lastWaterMilliliters: null,
    undoWater: vi.fn(),
    studyRecords: [],
    setStudyRecords: vi.fn(),
    meals: [],
    setMeals: vi.fn(),
    dietDays: [],
    fitnessSession: null,
    setFitnessSession: vi.fn(),
    fitnessHistory: [],
    archiveFitnessSession: vi.fn(),
    today: '2026-02-07',
    profile: PROFILE,
    updateProfile: vi.fn(),
    settings: INITIAL_SETTINGS,
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    aiConsent: true,
    setAiConsent: vi.fn(),
    eveningReview: null,
    setEveningReview: vi.fn(),
    reports: [buildLocalReport()],
    setReports: vi.fn(),
    snapshot: null,
    createMockSnapshot: vi.fn(),
    appendStudyRecords: vi.fn(),
    replaceMockData: vi.fn(),
    clearLocalData: vi.fn(async () => {}),
    syncStatus: {
      enabled: true,
      pending: 0,
      lastSyncAt: null,
      online: true,
      syncing: false,
      error: null,
      needsAttention: false,
      state: '已同步',
    },
    syncRecoveryCode: '0123456789abcdef0123456789abcdef',
    syncDeviceLabel: '本机',
    syncToken: 'token-1',
    enableSync: vi.fn(async () => {}),
    disableSync: vi.fn(async () => {}),
    restoreSync: vi.fn(async () => {}),
    revokeSync: vi.fn(async () => {}),
    deleteServerAccount: vi.fn(async () => {
      throw new Error('not used in analysis tests')
    }),
    syncNow: vi.fn(),
    longTermPlans: [],
    addLongTermPlan: vi.fn(),
    updateLongTermPlan: vi.fn(),
    archiveLongTermPlan: vi.fn(),
    activatePlan: vi.fn(),
    ...overrides,
  }
}

const UI_VALUE: UIContextValue = {
  quickOpen: false,
  openQuickRecord: vi.fn(),
  closeQuickRecord: vi.fn(),
  toast: null,
  showToast: vi.fn(),
}

function renderPage(overrides: Partial<MockDataContextValue> = {}, mode: RuntimeMode = 'owner') {
  return render(
    <RuntimeModeProvider mode={mode}>
      <MemoryRouter initialEntries={['/reports']}>
        <UIContext.Provider value={UI_VALUE}>
          <MockDataContext.Provider value={buildContextValue(overrides)}>
            <ReportsPage />
          </MockDataContext.Provider>
        </UIContext.Provider>
      </MemoryRouter>
    </RuntimeModeProvider>,
  )
}

describe('ReportsPage 服务端综合分析', () => {
  it('服务端返回 AI 报告时展示服务端标签、段落与指标', async () => {
    mocks.requestAnalysisReport.mockResolvedValue(buildAiReport())
    mocks.fetchReportArchive.mockResolvedValue({ reports: [], nextCursor: null })

    renderPage()

    expect(await screen.findByText(ANALYSIS_SERVER_LABEL)).toBeInTheDocument()
    expect(screen.getByText(CONTENT.analysis[0])).toBeInTheDocument()
    expect(screen.getByText('训练次数')).toBeInTheDocument()
    expect(screen.getByText('3 次')).toBeInTheDocument()
    expect(screen.getByText('近 7 天 · 2026-02-01 ~ 2026-02-07')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新分析' })).toBeInTheDocument()
    // 自动请求走缓存优先（force=false）。
    expect(mocks.requestAnalysisReport).toHaveBeenCalledWith(
      'token-1',
      expect.objectContaining({ rangeDays: 7, force: false }),
    )
  })

  it('命中缓存时额外显示缓存标签', async () => {
    mocks.requestAnalysisReport.mockResolvedValue(buildAiReport({ cached: true }))
    mocks.fetchReportArchive.mockResolvedValue({ reports: [], nextCursor: null })

    renderPage()

    expect(await screen.findByText(ANALYSIS_SERVER_LABEL)).toBeInTheDocument()
    expect(screen.getByText(ANALYSIS_CACHE_LABEL)).toBeInTheDocument()
  })

  it('服务端规则降级时展示规则标签，不冒充 AI 生成', async () => {
    mocks.requestAnalysisReport.mockResolvedValue(
      buildAiReport({ origin: 'rules', model: null, reportId: 'rpt_rules_1' }),
    )
    mocks.fetchReportArchive.mockResolvedValue({ reports: [], nextCursor: null })

    renderPage()

    expect(await screen.findByText(ANALYSIS_RULES_LABEL)).toBeInTheDocument()
    expect(screen.getByText(ANALYSIS_RULES_NOTE)).toBeInTheDocument()
    expect(screen.queryByText(ANALYSIS_SERVER_LABEL)).not.toBeInTheDocument()
  })

  it('网络失败时回退本地内容，并明确标注本地 Mock 报告', async () => {
    mocks.requestAnalysisReport.mockRejectedValue(
      new AnalysisRequestError('network', '网络连接失败，请检查网络后重试。'),
    )
    mocks.fetchReportArchive.mockRejectedValue(
      new AnalysisRequestError('network', '网络连接失败，请检查网络后重试。'),
    )

    renderPage()

    expect(await screen.findByText(ANALYSIS_UNAVAILABLE_LABEL)).toBeInTheDocument()
    expect(screen.getAllByText(ANALYSIS_LOCAL_LABEL).length).toBeGreaterThan(0)
    expect(screen.getByText(ANALYSIS_FALLBACK_NOTE)).toBeInTheDocument()
    const localBlock = document.querySelector('.reports-analysis-local-report')
    expect(localBlock).toHaveTextContent('本机简报 · 2 月 7 日')
    expect(screen.queryByText(ANALYSIS_SERVER_LABEL)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('502 结构不合规时展示拒绝展示文案，并保留本地内容', async () => {
    mocks.requestAnalysisReport.mockRejectedValue(
      new AnalysisRequestError('invalid-response', '服务端返回的报告结构不符合契约。'),
    )
    mocks.fetchReportArchive.mockResolvedValue({ reports: [], nextCursor: null })

    renderPage()

    expect((await screen.findAllByText(ANALYSIS_INVALID_LABEL)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('桌面体验模式固定使用本地 Mock，不请求服务端综合分析', async () => {
    mocks.requestAnalysisReport.mockClear()
    renderPage({}, 'guest')

    expect(await screen.findByText('桌面体验模式固定使用本地 Mock')).toBeInTheDocument()
    expect(mocks.requestAnalysisReport).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '去设置开启数据同步' })).not.toBeInTheDocument()
  })

  it('AI 授权关闭时展示授权文案与去个人档案入口，不发起请求', async () => {
    mocks.requestAnalysisReport.mockClear()
    renderPage({
      aiConsent: false,
      settings: {
        ...INITIAL_SETTINGS,
        sources: { fitness: false, diet: false, study: false, profile: false },
      },
    })

    expect((await screen.findAllByText(ANALYSIS_CONSENT_LABEL)).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '去个人档案开启 AI 授权' })).toBeInTheDocument()
    expect(mocks.requestAnalysisReport).not.toHaveBeenCalled()
  })

  it('未开启数据同步时提示不可用，且不请求服务端', async () => {
    mocks.requestAnalysisReport.mockClear()
    renderPage({ syncToken: null })

    expect(await screen.findByText('未开启数据同步，服务端分析不可用')).toBeInTheDocument()
    expect(mocks.requestAnalysisReport).not.toHaveBeenCalled()
  })

  it('服务端归档列表可点击打开详情，详情不写入本地历史', async () => {
    const user = userEvent.setup()
    mocks.requestAnalysisReport.mockResolvedValue(buildAiReport())
    const detail: AnalysisReportDetail = {
      id: 'rpt_analysis_1',
      type: '综合分析',
      rangeDays: 7,
      origin: 'ai',
      model: 'deepseek-chat',
      start: '2026-02-01',
      end: '2026-02-07',
      dataRev: 1,
      createdAt: Date.parse('2026-02-07T12:00:00.000Z'),
      title: CONTENT.title,
      status: CONTENT.status,
      content: CONTENT,
      metrics: buildAiReport().metrics,
    }
    mocks.fetchReportArchive.mockResolvedValue({
      reports: [
        {
          id: detail.id,
          type: detail.type,
          rangeDays: detail.rangeDays,
          origin: 'ai',
          model: detail.model,
          start: detail.start,
          end: detail.end,
          dataRev: detail.dataRev,
          createdAt: detail.createdAt,
          title: detail.title,
          status: detail.status,
        },
      ],
      nextCursor: null,
    })
    mocks.fetchReportDetail.mockResolvedValue(detail)

    renderPage()

    const archiveButton = await screen.findByRole('button', { name: /本周训练与恢复节奏/ })
    await user.click(archiveButton)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(mocks.fetchReportDetail).toHaveBeenCalledWith('token-1', 'rpt_analysis_1')
  })
})
