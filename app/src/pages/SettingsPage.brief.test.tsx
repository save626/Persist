import { cleanup, render, screen } from '@testing-library/react'
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

// vitest 未开启 globals，RTL 的自动清理不会生效，这里显式清理避免用例间 DOM 叠加。
afterEach(cleanup)

function buildContextValue(
  settings: MockSettings,
  updateSettings: (patch: Partial<MockSettings>) => void,
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
    syncNow: vi.fn(),
    longTermPlans: [],
    addLongTermPlan: vi.fn(),
    updateLongTermPlan: vi.fn(),
    archiveLongTermPlan: vi.fn(),
    activatePlan: vi.fn(),
  }
}

/** 用受控 settings 重渲染，模拟真实的 updateSettings 行为。 */
function Harness({
  initial,
  onUpdate,
}: {
  initial: MockSettings
  onUpdate: (patch: Partial<MockSettings>) => void
}) {
  const [settings, setSettings] = useState(initial)
  const value = useMemo(
    () =>
      buildContextValue(settings, (patch) => {
        onUpdate(patch)
        setSettings((current) => ({ ...current, ...patch }))
      }),
    [onUpdate, settings],
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

function renderSettings(initial: MockSettings = INITIAL_SETTINGS) {
  const updateSettings = vi.fn()
  render(<Harness initial={initial} onUpdate={updateSettings} />)
  return { updateSettings }
}

function briefToggle() {
  return screen.getByRole('checkbox', { name: '每日简报' })
}

function briefTimeInput() {
  return screen.getByLabelText('每日简报时间')
}

describe('SettingsPage 每日简报', () => {
  it('默认关闭，时间默认 21:00，并展示归属与留存说明', () => {
    renderSettings()

    expect(screen.getByRole('heading', { name: '每日简报' })).toBeInTheDocument()
    expect(screen.getByText('05')).toBeInTheDocument()
    expect(briefToggle()).not.toBeChecked()
    expect(briefTimeInput()).toHaveValue('21:00')
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

  it('修改时间时写入 dailyBrief.at', async () => {
    const { updateSettings } = renderSettings()

    fireTimeChange('07:30')

    expect(updateSettings).toHaveBeenCalledWith({
      dailyBrief: { enabled: false, at: '07:30' },
    })
    expect(briefTimeInput()).toHaveValue('07:30')
  })

  it('非法时间回落到 21:00 并给出提示', async () => {
    const { updateSettings } = renderSettings()

    fireTimeChange('')

    expect(updateSettings).toHaveBeenCalledWith({
      dailyBrief: { enabled: false, at: '21:00' },
    })
    expect(screen.getByRole('alert')).toHaveTextContent('时间格式无效，已改回 21:00。')
    expect(briefTimeInput()).toHaveValue('21:00')
  })

  it('旧快照没有 dailyBrief 时按默认值展示', () => {
    renderSettings({
      reminders: INITIAL_SETTINGS.reminders,
      summaryOnly: true,
      sources: { fitness: true, diet: true, study: true, profile: true },
    })

    expect(briefToggle()).not.toBeChecked()
    expect(briefTimeInput()).toHaveValue('21:00')
    expect(screen.getByText('默认关闭')).toBeInTheDocument()
  })
})

/** `<input type="time">` 的受控 value 只能整体替换，用 change 事件模拟用户输入。 */
function fireTimeChange(value: string) {
  const input = briefTimeInput() as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
