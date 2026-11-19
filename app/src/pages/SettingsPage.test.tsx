import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UIContext, type UIContextValue } from '../context/ui-context'
import { RuntimeModeContext } from '../context/runtime-mode-context'
import { getRuntimeModeConfig, type RuntimeMode } from '../lib/runtime-mode'
import { MockDataContext, type MockDataContextValue } from '../context/mock-data-context'
import { INITIAL_SETTINGS } from '../data/settings'
import type { MockSettings } from '../types'
import type { SyncErrorKind } from '../lib/sync-client'
import { resetAiRuntimeCredential, setAiRuntimeCredential } from '../lib/ai-credential'
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
    reports: 0,
    analysisReports: 0,
    jobRuns: 0,
    syncOps: 1,
    devices: 1,
    backupFiles: 2,
  },
}

// vitest 未开启 globals，RTL 的自动清理不会生效，这里显式清理避免用例间 DOM 叠加。
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // 设备令牌是模块级状态，用例之间必须清掉，否则「有凭据 / 没凭据」会互相污染。
  resetAiRuntimeCredential()
})

function buildContextValue(
  settings: MockSettings,
  updateSettings: (patch: Partial<MockSettings>) => void,
  overrides: Partial<MockDataContextValue> = {},
): MockDataContextValue {
  return {
    goals: [],
    addGoal: vi.fn(),
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
    latestEveningReview: null,
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
      errorKind: null,
      state: '未开启',
    },
    syncRecoveryCode: null,
    syncDeviceLabel: '本机',
    syncToken: null,
    enableSync: vi.fn(async () => {}),
    disableSync: vi.fn(async () => {}),
    restoreSync: vi.fn(async () => {}),
    revokeSync: vi.fn(async () => {}),
    resetRecoveryCode: vi.fn(async () => 'f'.repeat(32)),
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
  mode = 'owner',
}: {
  initial: MockSettings
  onUpdate: (patch: Partial<MockSettings>) => void
  contextOverrides?: Partial<MockDataContextValue>
  mode?: RuntimeMode
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
        <RuntimeModeContext.Provider value={getRuntimeModeConfig(mode)}>
          <MockDataContext.Provider value={value}>
            <SettingsPage />
          </MockDataContext.Provider>
        </RuntimeModeContext.Provider>
      </UIContext.Provider>
    </MemoryRouter>
  )
}

function renderSettings(
  initial: MockSettings = INITIAL_SETTINGS,
  contextOverrides: Partial<MockDataContextValue> = {},
  mode: RuntimeMode = 'owner',
) {
  const updateSettings = vi.fn()
  render(
    <Harness
      initial={initial}
      onUpdate={updateSettings}
      contextOverrides={contextOverrides}
      mode={mode}
    />,
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
  it('默认关闭且时间未设置，并展示归属与留存说明', () => {
    renderSettings()

    expect(screen.getByRole('heading', { name: '每日简报' })).toBeInTheDocument()
    expect(screen.getByText('05')).toBeInTheDocument()
    expect(briefToggle()).not.toBeChecked()
    expect(briefTimeTrigger()).toHaveTextContent('请选择时间')
    expect(briefTimeTrigger()).toBeDisabled()
    expect(screen.getAllByText('未设置').length).toBeGreaterThan(0)
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

    await user.click(briefToggle())
    await user.click(briefTimeTrigger())
    await user.click(screen.getByRole('button', { name: '07 时' }))
    await user.click(screen.getByRole('button', { name: '30 分' }))
    await user.click(screen.getByRole('button', { name: '确定' }))

    expect(updateSettings).toHaveBeenCalledWith({
      dailyBrief: { enabled: true, at: '07:30' },
    })
    expect(briefTimeTrigger()).toHaveTextContent('07:30')
  })

  it('取消统一定时弹层时不写入时间', async () => {
    const user = userEvent.setup()
    const { updateSettings } = renderSettings()

    await user.click(briefToggle())
    updateSettings.mockClear()
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
    expect(briefTimeTrigger()).toHaveTextContent('请选择时间')
    expect(briefTimeTrigger()).toBeDisabled()
    expect(screen.getAllByText('未设置').length).toBeGreaterThan(0)
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
        errorKind: null,
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

describe('SettingsPage 同步失败文案（P5-4）', () => {
  const ENABLED_SYNC = {
    enabled: true,
    pending: 0,
    lastSyncAt: '2026-11-17 12:00',
    online: true,
    syncing: false,
    needsAttention: false,
    errorKind: null as SyncErrorKind | null,
    state: '已同步' as const,
  }

  it('限流（429）说明会自动重试，而不是让用户自己反复点', () => {
    renderSettings(INITIAL_SETTINGS, {
      syncStatus: {
        ...ENABLED_SYNC,
        error: '请求过于频繁，请稍后再试。',
        errorKind: 'rate-limited',
      },
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('请求过于频繁，服务端已安排自动重试')
    expect(alert).toHaveTextContent('本机记录不受影响')
    // 服务端原文不该同时出现：两句话叠在一起会让人以为要手动处理。
    expect(screen.queryByText('请求过于频繁，请稍后再试。')).not.toBeInTheDocument()
  })

  it('令牌失效（401）仍然是「用恢复码重新绑定」，不混进限流文案', () => {
    renderSettings(INITIAL_SETTINGS, {
      syncStatus: {
        ...ENABLED_SYNC,
        error: '设备令牌已失效，请用恢复码重新绑定本机。',
        errorKind: 'unauthorized',
        needsAttention: true,
      },
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('设备令牌已失效，本机数据不会被清空')
    expect(alert).not.toHaveTextContent('自动重试')
  })

  it('普通失败照旧展示服务端原因，不被限流分支吞掉', () => {
    renderSettings(INITIAL_SETTINGS, {
      syncStatus: {
        ...ENABLED_SYNC,
        error: '本地有一条变更无法同步：记录格式不合法。',
        errorKind: 'invalid',
      },
    })

    expect(screen.getByRole('alert')).toHaveTextContent('记录格式不合法')
  })

  /*
   * P5-7：徽标原先只按 `pending` 推导，队列空着就写「已同步」，旁边文案却说
   * 「已安排自动重试」/「令牌失效」，两句话互相打脸。这里锁住「失败态不能说已同步」。
   */
  it.each(['重试中', '需要处理'] as const)('失败态徽标（%s）标红，不再宣称已同步', (state) => {
    renderSettings(INITIAL_SETTINGS, {
      syncStatus: {
        ...ENABLED_SYNC,
        state,
        error: '请求过于频繁，请稍后再试。',
        errorKind: 'rate-limited',
      },
    })

    // 页面里还有一个 AI 卡片的徽标，必须限定在同步卡片内取。
    const pill = document.querySelector('.settings-sync-card .settings-service-pill')
    expect(pill).toHaveTextContent(state)
    expect(pill?.className).toContain('error')
    expect(pill).not.toHaveTextContent('已同步')
  })
})

/**
 * P5-5：guest 的数据是持久的（独立 IndexedDB，`persist: true`），从介绍页再进来
 * 看到的是上次留下的记录。这里锁的是「说法跟行为一致」——不静默清空，但也不许
 * 用「清空本机数据」这种听起来像清库的措辞；demo 是只读快照，删除按钮只会弹
 * 「仅可查看」，属于假按钮，干脆不渲染。
 */
describe('SettingsPage 危险操作的模式口径', () => {
  it('guest 说「重新开始体验」，并如实声明数据只留在本机浏览器', () => {
    renderSettings(INITIAL_SETTINGS, {}, 'guest')

    expect(screen.getByRole('heading', { name: '重新开始体验' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '清空本机数据' })).not.toBeInTheDocument()
    expect(screen.getByText(/只保存在这台设备的浏览器里，不会上传到服务器/)).toBeInTheDocument()
  })

  it('guest 确认后走同一条清空链路，并给出「回到空白状态」而不是「恢复空白初始状态」', async () => {
    const user = userEvent.setup()
    const clearLocalData = vi.fn(async () => {})
    const showToast = vi.mocked(UI_VALUE.showToast)
    showToast.mockClear()
    renderSettings(INITIAL_SETTINGS, { clearLocalData }, 'guest')

    await user.click(screen.getByRole('button', { name: '重新开始体验' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('重新开始体验？')

    await user.click(screen.getByRole('button', { name: '重新开始' }))

    await waitFor(() => expect(clearLocalData).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('体验数据已清空 · 已回到空白状态'))
  })

  it('demo 不渲染任何删除按钮', () => {
    renderSettings(INITIAL_SETTINGS, {}, 'demo')

    expect(screen.queryByRole('heading', { name: '清空本机设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '重新开始体验' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '清空本机数据' })).not.toBeInTheDocument()
  })

  it('owner 保持原文案与确认弹层', async () => {
    const user = userEvent.setup()
    renderSettings()

    expect(screen.getByRole('heading', { name: '清空本机设置' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '清空本机数据' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '清空本机数据' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('清空本机数据？')
  })
})

/**
 * 「测试服务端连接」必须把对话链路一起测。
 *
 * P5-9 的教训：健康检查 200、真机对话 `Failed to fetch`，而按钮那时显示「正常」。
 * 所以这里的断言不是「按钮能不能变绿」，而是「绿之前有没有真的走过 /api/chat」。
 */
describe('SettingsPage 服务端连接检查', () => {
  const HEALTH_OK = { status: 'ok', service: 'persist-server', ai: 'deepseek', db: 'ok' }

  function stubServer(chat: () => Response | Promise<Response>) {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        if (url.endsWith('/api/chat')) return chat()
        return new Response(JSON.stringify(HEALTH_OK), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    return calls
  }

  function sse(frames: string[]) {
    return new Response(frames.map((frame) => `data: ${frame}\n\n`).join(''), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    })
  }

  it('owner 下健康检查与对话探针都过，才说「服务端在线」', async () => {
    const user = userEvent.setup()
    setAiRuntimeCredential(`pst_${'a'.repeat(43)}`)
    const calls = stubServer(() => sse(['{"type":"stage","stage":"collect"}', '{"type":"done"}']))
    renderSettings()

    await user.click(screen.getByRole('button', { name: '测试服务端连接' }))

    await waitFor(() => expect(screen.getByText(/对话链路可用/)).toBeInTheDocument())
    expect(screen.getByText('服务端在线')).toBeInTheDocument()
    expect(calls.some((url) => url.endsWith('/api/chat'))).toBe(true)
  })

  it('带着凭据却被拒（401）时给「对话链路异常」，而不是显示一切正常', async () => {
    const user = userEvent.setup()
    setAiRuntimeCredential(`pst_${'b'.repeat(43)}`)
    stubServer(
      () =>
        new Response(JSON.stringify({ error: { code: 'ai_unauthorized' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    renderSettings()

    await user.click(screen.getByRole('button', { name: '测试服务端连接' }))

    await waitFor(() => expect(screen.getByText('对话链路异常')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('401')
    expect(screen.getByRole('alert')).toHaveTextContent('静默退回')
  })

  it('本来就没凭据时给「待绑定账号」，不要把「还没注册」报成故障', async () => {
    const user = userEvent.setup()
    stubServer(
      () =>
        new Response(JSON.stringify({ error: { code: 'ai_unauthorized' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    renderSettings()

    await user.click(screen.getByRole('button', { name: '测试服务端连接' }))

    await waitFor(() => expect(screen.getByText('待绑定账号')).toBeInTheDocument())
    expect(screen.getByText(/还没有可用的 AI 凭据/)).toBeInTheDocument()
  })

  it('demo 不测对话链路：那种模式下不调服务端 AI，401 是预期而不是故障', async () => {
    const user = userEvent.setup()
    const calls = stubServer(() => sse(['{"type":"done"}']))
    renderSettings(INITIAL_SETTINGS, {}, 'demo')

    await user.click(screen.getByRole('button', { name: '测试服务端连接' }))

    await waitFor(() => expect(screen.getByText(/不调用服务端对话/)).toBeInTheDocument())
    expect(calls.some((url) => url.endsWith('/api/chat'))).toBe(false)
  })
})

/**
 * 重新生成恢复码。
 *
 * 它是破坏性操作（旧码立即作废），所以核心断言是**确认之前不许动服务端**——
 * 点错一次就等于把唯一的换机凭据作废掉。
 */
describe('SettingsPage 重新生成恢复码', () => {
  const enabledStatus = {
    enabled: true,
    pending: 0,
    lastSyncAt: '2026-11-19 09:00',
    online: true,
    syncing: false,
    error: null,
    needsAttention: false,
    errorKind: null,
    state: '已同步' as const,
  }

  it('先确认再换码：没确认前不调用服务端', async () => {
    const user = userEvent.setup()
    const resetRecoveryCode = vi.fn(async () => 'c'.repeat(32))
    renderSettings(INITIAL_SETTINGS, {
      syncStatus: enabledStatus,
      syncRecoveryCode: 'b'.repeat(32),
      resetRecoveryCode,
    })

    await user.click(screen.getByRole('button', { name: '重新生成恢复码' }))

    expect(screen.getByText('重新生成恢复码？')).toBeInTheDocument()
    expect(resetRecoveryCode).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '生成新恢复码' }))

    await waitFor(() => expect(resetRecoveryCode).toHaveBeenCalledTimes(1))
  })

  it('取消确认就不换码', async () => {
    const user = userEvent.setup()
    const resetRecoveryCode = vi.fn(async () => 'c'.repeat(32))
    renderSettings(INITIAL_SETTINGS, {
      syncStatus: enabledStatus,
      syncRecoveryCode: 'b'.repeat(32),
      resetRecoveryCode,
    })

    await user.click(screen.getByRole('button', { name: '重新生成恢复码' }))
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(resetRecoveryCode).not.toHaveBeenCalled()
  })

  it('服务端拒绝时把原因原样告诉用户（还有其他设备在用）', async () => {
    const user = userEvent.setup()
    vi.mocked(UI_VALUE.showToast).mockClear()
    const resetRecoveryCode = vi.fn(async () => {
      throw new Error('这个账号还有 2 台设备在用。请先吊销其他设备，再重新生成恢复码。')
    })
    renderSettings(INITIAL_SETTINGS, {
      syncStatus: enabledStatus,
      syncRecoveryCode: 'b'.repeat(32),
      resetRecoveryCode,
    })

    await user.click(screen.getByRole('button', { name: '重新生成恢复码' }))
    await user.click(screen.getByRole('button', { name: '生成新恢复码' }))

    await waitFor(() =>
      expect(vi.mocked(UI_VALUE.showToast)).toHaveBeenCalledWith(
        expect.stringContaining('这个账号还有 2 台设备在用'),
      ),
    )
  })
})
