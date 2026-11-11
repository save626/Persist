import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UIContext, type UIContextValue } from '../context/ui-context'
import { MockDataContext, type MockDataContextValue } from '../context/mock-data-context'
import { INITIAL_SETTINGS } from '../data/settings'
import type { MockSettings } from '../types'
import { SettingsPage } from './SettingsPage'

const UI_VALUE: UIContextValue = {
  quickOpen: false,
  openQuickRecord: vi.fn(),
  closeQuickRecord: vi.fn(),
  toast: null,
  showToast: vi.fn(),
}

const ACCOUNT_DELETE_RESULT: Awaited<ReturnType<MockDataContextValue['deleteServerAccount']>> = {
  deleted: true,
  deletedAt: 1_762_761_600_000,
  counts: {
    profile: 1,
    settings: 1,
    planItems: 1,
    studyRecords: 0,
    fitnessSessions: 0,
    dietEntries: 0,
    waterLogs: 0,
    goals: 0,
    longTermPlans: 0,
    analysisReports: 0,
    jobRuns: 0,
    syncOps: 1,
    devices: 1,
    backupFiles: 2,
  },
}

// vitest 未开启 globals，RTL 的自动清理不会生效，这里显式清理避免用例间 DOM 叠加。
afterEach(cleanup)

function buildContextValue(
  settings: MockSettings,
  updateSettings: (patch: Partial<MockSettings>) => void,
  overrides: Partial<MockDataContextValue> = {},
): MockDataContextValue {
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
    profile: {
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
    },
    updateProfile: vi.fn(),
    settings,
    updateSettings,
    resetSettings: vi.fn(),
    aiConsent: true,
    setAiConsent: vi.fn(),
    eveningReview: null,
    setEveningReview: vi.fn(),
    reports: [],
    setReports: vi.fn(),
    snapshot: null,
    createMockSnapshot: vi.fn(),
    appendStudyRecords: vi.fn(),
    replaceMockData: vi.fn(),
    clearLocalData: vi.fn(async () => {}),
    syncStatus: {
      enabled: false,
      pending: 0,
      lastSyncAt: null,
      online: true,
      syncing: false,
      error: null,
      needsAttention: false,
      state: '未开启',
    },
    syncRecoveryCode: null,
    syncDeviceLabel: '本机',
    syncToken: null,
    enableSync: vi.fn(async () => {}),
    disableSync: vi.fn(async () => {}),
    restoreSync: vi.fn(async () => {}),
    revokeSync: vi.fn(async () => {}),
    deleteServerAccount: vi.fn(async () => {
      throw new Error('not used in brief tests')
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

/** 用受控 settings 重渲染，模拟真实的 updateSettings 行为。 */
function Harness({
  initial,
  onUpdate,
  contextOverrides,
}: {
  initial: MockSettings
  onUpdate: (patch: Partial<MockSettings>) => void
  contextOverrides?: Partial<MockDataContextValue>
}) {
  const [settings, setSettings] = useState(initial)
  const value = useMemo(
    () =>
      buildContextValue(
        settings,
        (patch) => {
          onUpdate(patch)
          setSettings((current) => ({ ...current, ...patch }))
        },
        contextOverrides,
      ),
    [contextOverrides, onUpdate, settings],
  )
  return (
    <MemoryRouter initialEntries={['/settings']}>
      <UIContext.Provider value={UI_VALUE}>
        <MockDataContext.Provider value={value}>
          <SettingsPage />
        </MockDataContext.Provider>
      </UIContext.Provider>
    </MemoryRouter>
  )
}

function renderSettings(
  initial: MockSettings = INITIAL_SETTINGS,
  contextOverrides: Partial<MockDataContextValue> = {},
) {
  const updateSettings = vi.fn()
  render(
    <Harness initial={initial} onUpdate={updateSettings} contextOverrides={contextOverrides} />,
  )
  return { updateSettings }
}

function briefToggle() {
  return screen.getByRole('checkbox', { name: '每日简报' })
}

function briefTimeTrigger() {
  return screen.getByLabelText('每日简报时间')
}

describe('SettingsPage 每日简报', () => {
  it('默认关闭，时间默认 21:00，并展示归属与留存说明', () => {
    renderSettings()

    expect(screen.getByRole('heading', { name: '每日简报' })).toBeInTheDocument()
    expect(screen.getByText('05')).toBeInTheDocument()
    expect(briefToggle()).not.toBeChecked()
    expect(briefTimeTrigger()).toHaveTextContent('21:00')
    expect(screen.getByText('默认关闭')).toBeInTheDocument()
    expect(screen.getByText('每天自动生成服务端简报')).toBeInTheDocument()
    expect(screen.getByText(/365 天后自动删除/)).toBeInTheDocument()
    expect(screen.getByText(/关闭后不再生成，也不会删除已经生成的报告/)).toBeInTheDocument()
  })

  it('打开开关时写入 dailyBrief.enabled=true', async () => {
    const user = userEvent.setup()
    const { updateSettings } = renderSettings()

    await user.click(briefToggle())

    expect(updateSettings).toHaveBeenCalledWith({
      dailyBrief: { enabled: true, at: '21:00' },
    })
    expect(briefToggle()).toBeChecked()
    expect(screen.getByText('已开启')).toBeInTheDocument()
  })

  it('通过统一定时弹层修改时间时写入 dailyBrief.at', async () => {
    const user = userEvent.setup()
    const { updateSettings } = renderSettings()

    await user.click(briefTimeTrigger())
    await user.click(screen.getByRole('button', { name: '07 时' }))
    await user.click(screen.getByRole('button', { name: '30 分' }))
    await user.click(screen.getByRole('button', { name: '确定' }))

    expect(updateSettings).toHaveBeenCalledWith({
      dailyBrief: { enabled: false, at: '07:30' },
    })
    expect(briefTimeTrigger()).toHaveTextContent('07:30')
  })

  it('取消统一定时弹层时不写入时间', async () => {
    const user = userEvent.setup()
    const { updateSettings } = renderSettings()

    await user.click(briefTimeTrigger())
    await user.click(screen.getByRole('button', { name: '07 时' }))
    await user.click(screen.getByRole('button', { name: '30 分' }))
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(updateSettings).not.toHaveBeenCalled()
    expect(briefTimeTrigger()).toHaveTextContent('21:00')
  })
  it('旧快照没有 dailyBrief 时按默认值展示', () => {
    renderSettings({
      reminders: INITIAL_SETTINGS.reminders,
      summaryOnly: true,
      sources: { fitness: true, diet: true, study: true, profile: true },
    })

    expect(briefToggle()).not.toBeChecked()
    expect(briefTimeTrigger()).toHaveTextContent('21:00')
    expect(screen.getByText('默认关闭')).toBeInTheDocument()
  })
})

describe('SettingsPage 账号删除', () => {
  it('已绑定账号时先删服务端，成功后再清空本机', async () => {
    const user = userEvent.setup()
    const deleteServerAccount = vi.fn(async () => ACCOUNT_DELETE_RESULT)
    const clearLocalData = vi.fn(async () => {})
    vi.mocked(UI_VALUE.showToast).mockClear()
    renderSettings(INITIAL_SETTINGS, {
      syncToken: 'token-delete',
      syncStatus: {
        enabled: true,
        pending: 0,
        lastSyncAt: '2026-11-10 16:00',
        online: true,
        syncing: false,
        error: null,
        needsAttention: false,
        state: '已同步',
      },
      deleteServerAccount,
      clearLocalData,
    })

    expect(screen.getByRole('heading', { name: '删除同步账号与全部数据' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '删除账号与数据' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('永久删除同步账号与全部数据？')
    await user.click(screen.getByRole('button', { name: '永久删除' }))

    await waitFor(() => expect(clearLocalData).toHaveBeenCalledTimes(1))
    expect(deleteServerAccount).toHaveBeenCalledTimes(1)
    expect(deleteServerAccount.mock.invocationCallOrder[0]).toBeLessThan(
      clearLocalData.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
    expect(UI_VALUE.showToast).toHaveBeenCalledWith('同步账号和本机数据已永久删除')
  })

  it('服务端删除失败时不调用本机清空，并提示可重试', async () => {
    const user = userEvent.setup()
    const deleteServerAccount = vi.fn(async () => {
      throw new Error('服务端暂时不可用')
    })
    const clearLocalData = vi.fn(async () => {})
    vi.mocked(UI_VALUE.showToast).mockClear()
    renderSettings(INITIAL_SETTINGS, {
      syncToken: 'token-delete',
      deleteServerAccount,
      clearLocalData,
    })

    await user.click(screen.getByRole('button', { name: '删除账号与数据' }))
    await user.click(screen.getByRole('button', { name: '永久删除' }))

    await waitFor(() =>
      expect(UI_VALUE.showToast).toHaveBeenCalledWith(
        '删除账号失败，本机数据未清空：服务端暂时不可用',
      ),
    )
    expect(clearLocalData).not.toHaveBeenCalled()
  })
})
