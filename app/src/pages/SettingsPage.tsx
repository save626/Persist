import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { TimePickerField } from '../components/DateTimePicker'
import { Icon } from '../components/Icon'
import { ConfirmDialog, PageSheet } from '../components/PageSheet'
import { useMockData } from '../context/mock-data-context'
import { useRuntimeMode } from '../context/runtime-mode-context'
import { useUI } from '../context/ui-context'
import {
  countMockRecords,
  parseMockBackupJson,
  parseStudyCsv,
  serializeMockBackup,
} from '../lib/mock-data-transfer'
import { createCompleteMockData } from '../data/complete-mock-data'
import { exportTextFile, formatBytes } from '../lib/file-export'
import { useNetworkOnline } from '../lib/network-status'
import { checkServerHealth, type ServerHealth } from '../lib/server-health'
import {
  DEFAULT_DAILY_BRIEF_AT,
  normalizeDailyBriefSettings,
  parseDailyBriefAt,
} from '../lib/analysis-contract'
import type { DataSource, Reminder, ReminderId } from '../types'

type AiState = 'idle' | 'testing' | 'connected' | 'error'
type InfoSheet = 'privacy' | 'deploy' | null

const SOURCE_COPY: Record<DataSource, { title: string; detail: string }> = {
  fitness: { title: '训练记录', detail: '动作、组数、重量与 RPE' },
  diet: { title: '饮食饮水', detail: '餐次、热量、营养与饮水量' },
  study: { title: '学习记录', detail: '英语与高数的时长、数量和掌握度' },
  profile: { title: '个人档案摘要', detail: '目标、身体数据与训练偏好' },
}

function timeLabel(value: string) {
  if (!value) return '未设置'
  const [hour, minute] = value.split(':').map(Number)
  const suffix = hour >= 12 ? '下午' : '上午'
  const displayHour = hour % 12 || 12
  return `${suffix} ${displayHour}:${String(minute).padStart(2, '0')}`
}

function backupDateStamp(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function snapshotTimeLabel(value: string) {
  const date = new Date(value)
  const today = new Date()
  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  if (date.toDateString() === today.toDateString()) return `今天 ${time}`
  return `${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)} ${time}`
}

/** 32 位恢复码按 4 组 × 8 位展示，便于抄写；存储与传输始终是不带空格的原始值。 */
function recoveryCodeLabel(code: string | null) {
  if (!code) return '尚未生成'
  return code.toUpperCase().replace(/(.{8})(?=.)/g, '$1 ')
}

function syncErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '同步操作失败，请稍后重试。'
}

export function SettingsPage() {
  const { showToast } = useUI()
  const {
    goals,
    planItems,
    waterLog,
    studyRecords,
    dietDays,
    fitnessSession,
    fitnessHistory,
    profile,
    settings,
    updateSettings,
    resetSettings,
    aiConsent,
    setAiConsent,
    // 导出要带上「最近一次」的复盘，包括昨天填的那份：备份不能因为跨日丢用户写过的内容。
    latestEveningReview,
    reports,
    longTermPlans,
    snapshot,
    createMockSnapshot,
    appendStudyRecords,
    replaceMockData,
    clearLocalData: clearAllLocalData,
    syncStatus,
    syncRecoveryCode,
    syncDeviceLabel,
    syncToken,
    enableSync,
    disableSync,
    restoreSync,
    revokeSync,
    deleteServerAccount,
    syncNow,
  } = useMockData()
  const runtime = useRuntimeMode()
  const networkOnline = useNetworkOnline()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { reminders, summaryOnly, sources } = settings
  const [aiState, setAiState] = useState<AiState>('idle')
  const [aiHealth, setAiHealth] = useState<ServerHealth | null>(null)
  const [savedAt, setSavedAt] = useState('尚未保存')
  const [saving, setSaving] = useState(false)
  const [importName, setImportName] = useState('')
  const [importError, setImportError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [infoSheet, setInfoSheet] = useState<InfoSheet>(null)
  const [syncBusy, setSyncBusy] = useState<
    null | 'toggle' | 'sync' | 'restore' | 'revoke' | 'delete'
  >(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreCode, setRestoreCode] = useState('')
  const [restoreError, setRestoreError] = useState('')
  const [copiedCode, setCopiedCode] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [briefTimeError, setBriefTimeError] = useState(false)

  const enabledReminderCount = reminders.filter((reminder) => reminder.enabled).length
  /**
   * guest 的数据是持久的（`storageDbName: 'persist-app-guest'`，`persist: true`）：
   * 从介绍页再进来看到的是上次留下的记录。这是 P5-5 确认过的语义——访客的浏览器
   * 归访客，悄悄抹掉反而像「点了没保存」。所以这里只改说法的诚实度，不改行为：
   * 卡片从「清空本机数据」变成「重新开始体验」，明确这是访客主动重开，而不是清库。
   */
  const isGuest = runtime.mode === 'guest'
  /** demo 是只读快照（`readOnly` + `persist: false`）：任何删除按钮都只会弹「仅可查看」，是假按钮。 */
  const isDemo = runtime.mode === 'demo'
  const resetTargetLabel = '空白初始状态'
  const sourceCount = useMemo(() => Object.values(sources).filter(Boolean).length, [sources])
  // 旧快照没有 dailyBrief：normalize 会补「关闭 + 21:00」，不需要提升 state schema 版本。
  const dailyBrief = normalizeDailyBriefSettings(settings.dailyBrief)

  const toggleDailyBrief = (enabled: boolean) => {
    updateSettings({ dailyBrief: { ...dailyBrief, enabled } })
    setSavedAt('有未保存修改')
  }

  const updateDailyBriefTime = (value: string) => {
    const parsed = parseDailyBriefAt(value)
    if (!parsed) {
      // 空值或非法时间：按契约回落到默认 21:00，并给出可见提示，避免静默保存坏值。
      setBriefTimeError(true)
      updateSettings({ dailyBrief: { ...dailyBrief, at: DEFAULT_DAILY_BRIEF_AT } })
      return
    }
    setBriefTimeError(false)
    updateSettings({ dailyBrief: { ...dailyBrief, at: parsed } })
    setSavedAt('有未保存修改')
  }

  const updateReminder = (id: ReminderId, patch: Partial<Reminder>) => {
    updateSettings({
      reminders: reminders.map((reminder) =>
        reminder.id === id ? { ...reminder, ...patch } : reminder,
      ),
    })
    setSavedAt('有未保存修改')
  }

  const saveSettings = (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    window.setTimeout(() => {
      setSaving(false)
      setSavedAt('刚刚保存')
      showToast('设置已保存到本机')
    }, 650)
  }

  /**
   * 真的打一次 `/api/health`，并在健康检查通过后接着打一次 `/api/chat` 探针。
   *
   * 改之前这里是个 `setTimeout(950)` 之后无条件成功的占位：不发请求，却显示
   * 「服务端代理可用」。一个永远通过的测试比没有测试更糟——它会让「连不上服务端」
   * 这种真问题看起来像已经排除过了。现在按健康检查的几种结局分别给话术，
   * 见 `lib/server-health.ts`。
   *
   * 第二阶段（探针）是 P5-9 之后加的：那次的故障是 `/api/chat` 的 SSE 丢了 CORS 头，
   * 健康检查 200、真机对话 `Failed to fetch`，客户端又静默回退——按钮当时显示「正常」，
   * 而实际上对话根本用不了。所以只要这个模式真的会调服务端 AI，就必须把聊天链路一起测；
   * 探针不打模型、不占配额，可以随便点。
   */
  const testConnection = async () => {
    if (aiState === 'testing') return
    setAiState('testing')
    setAiHealth(null)
    const health = await checkServerHealth({ checkChat: runtime.ai.chat })
    setAiHealth(health)
    // `connected` / `error` 只是 CSS 用的两档，真实区别由 `aiHealth.kind` 决定文案。
    setAiState(health.kind === 'ready' ? 'connected' : 'error')
    showToast(
      health.kind === 'ready'
        ? '服务端连接正常'
        : health.kind === 'chat-no-credential'
          ? '服务端连通 · 这台设备还没有 AI 凭据'
          : '连接检查未通过，原因见下方',
    )
  }

  /** 徽标文案按健康检查的结局分档；未点过按钮时是「未测试」，不是「待配置」——密钥不在这个页面上配。 */
  const aiPillLabel =
    aiState === 'testing'
      ? '测试中'
      : aiHealth?.kind === 'ready'
        ? '服务端在线'
        : aiHealth?.kind === 'ai-disabled'
          ? '模型未配置'
          : aiHealth?.kind === 'degraded'
            ? '服务端降级'
            : aiHealth?.kind === 'chat-no-credential'
              ? '待绑定账号'
              : aiHealth?.kind === 'chat-failed'
                ? '对话链路异常'
                : aiHealth
                  ? '连接失败'
                  : '未测试'

  /**
   * 导出本机备份。
   * 手机上（Capacitor WebView）浏览器下载对 blob 是静默忽略的，所以这里必须
   * 按真实出口换话术：桌面是「已导出」，APK 是「已复制到剪贴板」。
   * 什么都不成时抛错，绝不能报成功。
   */
  const exportLocalBackup = async () => {
    try {
      const payload = serializeMockBackup({
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
        eveningReview: latestEveningReview,
        reports,
        longTermPlans,
      })
      const fileName = `persist-backup-${backupDateStamp()}.json`
      const outcome = await exportTextFile(fileName, JSON.stringify(payload, null, 2))
      const planCount = payload.data.longTermPlans.length
      showToast(
        outcome.kind === 'downloaded'
          ? `数据备份已导出 · 含 ${planCount} 个长期计划`
          : `备份已复制到剪贴板 · ${formatBytes(outcome.bytes)}，请粘贴保存为 .json`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      showToast(`导出失败：${message}`)
    }
  }

  const selectImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = event.target.files?.[0]
    if (!file) return
    setImportName(file.name)
    setImportError('')

    try {
      const extension = file.name.split('.').pop()?.toLowerCase()
      if (extension === 'xlsx' || extension === 'xls') {
        throw new Error('Excel 暂不支持直接解析，请在 Excel 中另存为 UTF-8 CSV 后再导入')
      }
      if (extension !== 'json' && extension !== 'csv') {
        throw new Error('仅支持 Persist JSON 备份或 UTF-8 CSV 学习记录')
      }

      const text = await file.text()
      if (extension === 'json') {
        const data = parseMockBackupJson(text)
        replaceMockData(data)
        setSavedAt('已导入备份')
        const planCount = data.longTermPlans?.length ?? 0
        showToast(`备份已导入 · ${countMockRecords(data)} 条记录（含 ${planCount} 个长期计划）`)
      } else {
        const records = parseStudyCsv(text)
        appendStudyRecords(records)
        setSavedAt('已追加学习记录')
        showToast(`CSV 导入成功 · 已追加 ${records.length} 条学习记录`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件解析失败'
      setImportError(message)
      showToast(`导入失败：${message}`)
    } finally {
      input.value = ''
    }
  }

  const generateSnapshot = () => {
    const next = createMockSnapshot()
    setSavedAt('快照已更新')
    showToast(`本机快照已生成 · ${next.recordCount} 条记录`)
  }

  const loadCompleteDemoData = () => {
    const data = createCompleteMockData()
    replaceMockData(data)
    setImportName('')
    setImportError('')
    setAiState('idle')
    setSavedAt('已加载完整演示数据')
    showToast(`完整演示数据已加载 · ${data.studyRecords.length} 条学习记录`)
  }

  const clearMockSettings = () => {
    setConfirmClear(false)
    resetSettings()
    setImportName('')
    setImportError('')
    setAiState('idle')
    setSavedAt('已清空本机设置')
    showToast('本地设置已清空，训练、饮食、学习与计划记录仍会保留')
  }

  /** 全量清空：删本机 IndexedDB 记录 + 内存态回到初始基线（含快照），成功后刷新也不会复现旧数据。 */
  const clearEverything = () => {
    setConfirmClearAll(false)
    setImportName('')
    setImportError('')
    setAiState('idle')
    setSavedAt('正在清空本机数据…')
    void clearAllLocalData()
      .then(() => {
        setSavedAt(isGuest ? '已重新开始' : '本机数据已清空')
        // 同步开着时服务端那份不会被删，下一轮拉取会把记录取回本机：
        // 不说明白就是一句新的假话（看起来清空了，5 秒后又回来）。
        showToast(
          isGuest
            ? '体验数据已清空 · 已回到空白状态'
            : syncStatus.enabled
              ? `本机数据已清空 · 同步开启中，稍后会从服务器取回`
              : `本机数据已清空 · 已恢复${resetTargetLabel}`,
        )
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '未知错误'
        setSavedAt('清空失败')
        showToast(`清空失败：${message}`)
      })
  }

  /** 开关同步：开启后由引擎先全量上传，再按 5 秒防抖增量同步。 */
  const toggleSync = (next: boolean) => {
    if (syncBusy) return
    setSyncBusy('toggle')
    void (next ? enableSync() : disableSync())
      .then(() => {
        setSavedAt(next ? '同步已开启' : '同步已关闭')
        showToast(next ? '数据同步已开启 · 正在保存第一份副本' : '数据同步已关闭 · 本机数据保留')
      })
      .catch((error: unknown) => showToast(`同步操作失败：${syncErrorMessage(error)}`))
      .finally(() => setSyncBusy(null))
  }

  const copyRecoveryCode = () => {
    if (!syncRecoveryCode) return
    const markCopied = () => {
      setCopiedCode(true)
      window.setTimeout(() => setCopiedCode(false), 1600)
    }
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(syncRecoveryCode.toUpperCase())
        .then(markCopied)
        .catch(() => showToast('复制失败，请手动抄写恢复码'))
    } else {
      showToast('当前环境不支持自动复制，请手动抄写恢复码')
    }
  }

  const bindWithRecoveryCode = () => {
    if (syncBusy) return
    const code = restoreCode.replace(/\s+/g, '').toLowerCase()
    if (!/^[0-9a-f]{32}$/.test(code)) {
      setRestoreError('恢复码应为 32 位十六进制字符，可在已绑定设备的设置页查看。')
      return
    }
    setRestoreError('')
    setSyncBusy('restore')
    void restoreSync(code)
      .then(() => {
        setRestoreOpen(false)
        setRestoreCode('')
        setSavedAt('已绑定同步账号')
        showToast('已用恢复码绑定本机 · 正在拉取服务器副本')
      })
      .catch((error: unknown) => setRestoreError(syncErrorMessage(error)))
      .finally(() => setSyncBusy(null))
  }

  const syncImmediately = () => {
    if (syncBusy) return
    setSyncBusy('sync')
    void syncNow()
      .then((status) => {
        if (status.needsAttention) {
          showToast('同步失败：设备令牌已失效，请用恢复码重新绑定本机')
        } else if (status.error) {
          showToast(`同步失败：${status.error}`)
        } else if (!status.online) {
          showToast('当前离线，联网后会自动补传')
        } else if (status.pending > 0) {
          showToast(`仍有 ${status.pending} 条待同步，稍后再试`)
        } else {
          showToast('已同步到自建服务器')
        }
      })
      .catch((error: unknown) => showToast(`同步失败：${syncErrorMessage(error)}`))
      .finally(() => setSyncBusy(null))
  }

  const revokeThisDevice = () => {
    setConfirmRevoke(false)
    if (syncBusy) return
    setSyncBusy('revoke')
    void revokeSync()
      .then(() => {
        setSavedAt('本机同步已吊销')
        showToast('本机同步已吊销 · 本机数据保留')
      })
      .catch((error: unknown) => showToast(`吊销失败：${syncErrorMessage(error)}`))
      .finally(() => setSyncBusy(null))
  }

  /**
   * 两段式删除：先删服务端账号，成功后再清空本机数据。
   * 服务端失败时不动本机；服务端成功但本机清空失败时保留可单独重试的清空入口。
   */
  const deleteAccountEverywhere = () => {
    setConfirmDeleteAccount(false)
    if (syncBusy) return
    setImportName('')
    setImportError('')
    setAiState('idle')
    setSavedAt('正在删除服务端账号…')
    setSyncBusy('delete')
    void (async () => {
      let serverDeleted = false
      try {
        await deleteServerAccount()
        serverDeleted = true
        setSavedAt('服务端账号已删除，正在清空本机数据…')
        await clearAllLocalData()
        setSavedAt('账号与本地数据已删除')
        showToast('同步账号和本机数据已永久删除')
      } catch (error) {
        const message = syncErrorMessage(error)
        if (serverDeleted) {
          setSavedAt('本机数据清空失败')
          showToast(`服务端账号已删除，但本机数据清空失败：${message}`)
        } else {
          setSavedAt('删除账号失败')
          showToast(`删除账号失败，本机数据未清空：${message}`)
        }
      } finally {
        setSyncBusy(null)
      }
    })()
  }

  return (
    <form className="settings-page" onSubmit={saveSettings}>
      <header className="head settings-head">
        <div className="heading">
          <div className="eyebrow">PREFERENCES · LOCAL FIRST</div>
          <h1>把记录放在身边。</h1>
          <p className="subtitle">
            调整提醒、AI 授权与数据管理。第一版优先保证本地可用，云服务只在需要时参与。
          </p>
        </div>
        <div className="head-actions settings-head-actions">
          <span className="settings-save-state">
            <span className="dot" />
            {savedAt}
          </span>
          <button className="btn primary" type="submit" disabled={saving}>
            <Icon name="check" className="icon-sm" />
            {saving ? '保存中…' : '保存设置'}
          </button>
        </div>
      </header>

      <section className="settings-hero" aria-label="本地优先设置概览">
        <div className="settings-hero-main">
          <span className="settings-hero-mark">
            <Icon name="lock" />
          </span>
          <div>
            <span className="settings-kicker">LOCAL-FIRST RECORD</span>
            <h2>记录默认保存在设备端，敏感密钥不进入浏览器。</h2>
            <p>
              记录默认保存在本机浏览器（IndexedDB），AI 请求仍由你的小型服务器代理
              DeepSeek；只有手动开启数据同步后，增量副本才会写入你的自建服务器。
            </p>
          </div>
        </div>
        <div className="settings-hero-stats">
          <div>
            <span>提醒开启</span>
            <strong>{enabledReminderCount > 0 ? enabledReminderCount + ' / 3' : '未设置'}</strong>
            <small>可按训练日调整</small>
          </div>
          <div>
            <span>AI 数据范围</span>
            <strong>{sourceCount > 0 ? sourceCount + ' / 4' : '未设置'}</strong>
            <small>默认仅发摘要</small>
          </div>
          <div>
            <span>存储方式</span>
            <strong>{syncStatus.enabled ? '本机 + 自建服务器' : '设备本地'}</strong>
            <small>{syncStatus.enabled ? syncStatus.state : '同步默认关闭'}</small>
          </div>
        </div>
      </section>

      <div className="settings-layout">
        <div className="settings-main-column">
          <section className="panel settings-card" aria-labelledby="reminderTitle">
            <div className="settings-card-head">
              <div>
                <span className="settings-section-index">01</span>
                <h2 id="reminderTitle">提醒</h2>
                <p>只在真正需要行动时出现，不用通知制造连续性压力。</p>
              </div>
              <span className="settings-card-tag">
                {enabledReminderCount > 0 ? enabledReminderCount + ' 项开启' : '未设置'}
              </span>
            </div>
            <div className="settings-reminder-list">
              {reminders.map((reminder) => (
                <div
                  className={
                    reminder.enabled ? 'settings-reminder-row' : 'settings-reminder-row is-off'
                  }
                  key={reminder.id}
                >
                  <span className="settings-reminder-icon">
                    <Icon name={reminder.icon} />
                  </span>
                  <span className="settings-reminder-copy">
                    <strong>{reminder.title}</strong>
                    <small>{reminder.detail}</small>
                  </span>
                  <TimePickerField
                    className="settings-time-field"
                    label="提醒时间"
                    ariaLabel={`${reminder.title}时间`}
                    value={reminder.time}
                    disabled={!reminder.enabled}
                    helper={timeLabel(reminder.time)}
                    onChange={(time) => updateReminder(reminder.id, { time })}
                  />
                  <label className="settings-switch">
                    <input
                      className="toggle-input"
                      type="checkbox"
                      checked={reminder.enabled}
                      aria-label={`启用${reminder.title}`}
                      onChange={(event) =>
                        updateReminder(reminder.id, { enabled: event.target.checked })
                      }
                    />
                    <span className="toggle-ui" />
                  </label>
                </div>
              ))}
            </div>
            <div className="settings-reminder-foot">
              <Icon name="clock" className="icon-sm" />
              <span>Android 通知权限和免打扰时段将在设备封装阶段接入。</span>
            </div>
          </section>

          <section
            className="panel settings-card settings-ai-card"
            aria-labelledby="aiServiceTitle"
          >
            <div className="settings-card-head">
              <div>
                <span className="settings-section-index">02</span>
                <h2 id="aiServiceTitle">AI 与 DeepSeek</h2>
                <p>浏览器只调用你的服务器；API Key 仅保存在服务端环境变量中。</p>
              </div>
              <span className={`settings-service-pill ${aiState}`}>
                <span className="dot" />
                {aiPillLabel}
              </span>
            </div>

            <div className="settings-service-panel">
              <div className="settings-service-route">
                <span>请求路径</span>
                <strong>Persist App → 自托管服务器 → DeepSeek API</strong>
                <small>模型：DeepSeek Chat · 密钥状态：未进入前端</small>
              </div>
              <button
                className="btn secondary"
                type="button"
                disabled={aiState === 'testing'}
                onClick={testConnection}
              >
                {aiState === 'testing' ? '测试连接中…' : '测试服务端连接'}
              </button>
            </div>

            {/*
              结果必须落在页面上，不能只弹 toast：toast 两秒就没了，
              而「服务端返回 503」这种事用户需要一边看着一边去查。
            */}
            {aiHealth &&
              (aiHealth.kind === 'ready' ? (
                <p className="settings-inline-note settings-ai-health">
                  <Icon name="check" className="icon-sm" />
                  {aiHealth.message}
                </p>
              ) : (
                <p className="surface-error settings-ai-health" role="alert">
                  {aiHealth.message}
                </p>
              ))}

            <div className="settings-toggle-stack">
              <label className="toggle-row">
                <span className="toggle-copy">
                  <strong>允许生成综合分析与建议</strong>
                  <small>汇总今日训练、饮食、学习与目标进度</small>
                </span>
                <input
                  className="toggle-input"
                  type="checkbox"
                  checked={aiConsent}
                  onChange={(event) => {
                    setAiConsent(event.target.checked)
                    setSavedAt('有未保存修改')
                  }}
                />
                <span className="toggle-ui" />
              </label>
              <label className="toggle-row">
                <span className="toggle-copy">
                  <strong>仅发送聚合摘要</strong>
                  <small>不发送原始备注或完整历史明细</small>
                </span>
                <input
                  className="toggle-input"
                  type="checkbox"
                  checked={summaryOnly}
                  onChange={(event) => {
                    updateSettings({ summaryOnly: event.target.checked })
                    setSavedAt('有未保存修改')
                  }}
                />
                <span className="toggle-ui" />
              </label>
            </div>

            <div className="settings-source-grid" aria-label="允许 AI 使用的数据">
              {(Object.keys(SOURCE_COPY) as DataSource[]).map((source) => (
                <label
                  className={sources[source] ? 'settings-source active' : 'settings-source'}
                  key={source}
                >
                  <input
                    type="checkbox"
                    checked={sources[source]}
                    onChange={(event) => {
                      updateSettings({ sources: { ...sources, [source]: event.target.checked } })
                      setSavedAt('有未保存修改')
                    }}
                  />
                  <span className="settings-source-check">
                    <Icon name="check" className="icon-sm" />
                  </span>
                  <span>
                    <strong>{SOURCE_COPY[source].title}</strong>
                    <small>{SOURCE_COPY[source].detail}</small>
                  </span>
                </label>
              ))}
            </div>

            <p className="settings-inline-note">
              <Icon name="lock" className="icon-sm" />
              前端不会保存 API Key；正式连接前还需在服务器配置访问白名单、速率限制与请求日志策略。
            </p>
          </section>

          <section className="panel settings-card" aria-labelledby="dataTitle">
            <div className="settings-card-head">
              <div>
                <span className="settings-section-index">03</span>
                <h2 id="dataTitle">数据与备份</h2>
                <p>先保证数据可带走，再讨论同步与自动化。</p>
              </div>
            </div>
            <div className="settings-data-actions">
              <button
                className="settings-data-action"
                type="button"
                onClick={() => {
                  void exportLocalBackup()
                }}
              >
                <span>
                  <Icon name="today" />
                </span>
                <span>
                  <strong>导出 JSON 备份</strong>
                  <small>包含当前本机记录、设置与长期计划</small>
                </span>
                <Icon name="chev" className="icon-sm" />
              </button>
              <button className="settings-data-action" type="button" onClick={loadCompleteDemoData}>
                <span>
                  <Icon name="today" />
                </span>
                <span>
                  <strong>加载完整演示数据</strong>
                  <small>填充训练、饮食、学习、档案、复盘与报告</small>
                </span>
                <Icon name="chev" className="icon-sm" />
              </button>
              <button
                className="settings-data-action"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <span>
                  <Icon name="study" />
                </span>
                <span>
                  <strong>导入 CSV / JSON</strong>
                  <small>{importName || 'JSON 恢复本机备份；CSV 追加学习记录'}</small>
                </span>
                <Icon name="chev" className="icon-sm" />
              </button>
              <input
                ref={fileInputRef}
                className="settings-file-input"
                type="file"
                accept=".csv,.json"
                onChange={selectImportFile}
              />
            </div>
            {importError && (
              <p className="surface-error" role="alert">
                {importError}
              </p>
            )}
            <div className="settings-backup-row">
              <div>
                <span>最近一次本地快照</span>
                <strong>
                  {snapshot
                    ? `${snapshotTimeLabel(snapshot.createdAt)} · ${snapshot.recordCount} 条记录`
                    : '尚未生成快照'}
                </strong>
              </div>
              <button className="btn quiet" type="button" onClick={generateSnapshot}>
                立即生成快照
              </button>
            </div>
          </section>

          <section className="panel settings-card settings-sync-card" aria-labelledby="syncTitle">
            <div className="settings-card-head">
              <div>
                <span className="settings-section-index">04</span>
                <h2 id="syncTitle">数据同步</h2>
                <p>关掉就是纯本机；打开后只在你的自建服务器留一份增量副本。</p>
              </div>
              <span
                className={`settings-service-pill ${
                  syncStatus.state === '重试中' || syncStatus.state === '需要处理'
                    ? 'error'
                    : syncStatus.enabled
                      ? 'connected'
                      : 'idle'
                }`}
              >
                <span className="dot" />
                {syncStatus.state === '待同步' && syncStatus.pending > 0
                  ? `待同步 ${syncStatus.pending}`
                  : syncStatus.state}
              </span>
            </div>

            <div className="settings-sync-body">
              <label className="toggle-row">
                <span className="toggle-copy">
                  <strong>跨设备同步</strong>
                  <small>默认关闭；开启后本机仍是主要数据源，服务器只做增量备份</small>
                </span>
                <input
                  className="toggle-input"
                  type="checkbox"
                  checked={syncStatus.enabled}
                  disabled={syncBusy !== null || !runtime.sync}
                  aria-label="跨设备同步"
                  onChange={(event) => toggleSync(event.target.checked)}
                />
                <span className="toggle-ui" />
              </label>

              {syncStatus.needsAttention && (
                <p className="surface-error" role="alert">
                  设备令牌已失效，本机数据不会被清空。请用恢复码重新绑定本机。
                </p>
              )}
              {/*
                限流（429）必须与普通网络失败分开说：它自己会退避重试，用户不需要做任何事；
                而「同步失败」这四个字会让人以为要去点按钮或换网络。401 走上面那条分支。
              */}
              {!syncStatus.needsAttention && syncStatus.errorKind === 'rate-limited' && (
                <p className="surface-error" role="alert">
                  请求过于频繁，服务端已安排自动重试（间隔从 5 秒起逐次翻倍，最长 5
                  分钟一次）；本机记录不受影响。
                </p>
              )}
              {!syncStatus.needsAttention &&
                syncStatus.error &&
                syncStatus.errorKind !== 'rate-limited' && (
                  <p className="surface-error" role="alert">
                    {syncStatus.error}
                  </p>
                )}
              {syncStatus.enabled && !syncStatus.online && (
                <p className="settings-inline-note">
                  <Icon name="clock" className="icon-sm" />
                  当前处于离线状态，恢复网络后会自动补传；本机记录不受影响。
                </p>
              )}

              {syncStatus.enabled ? (
                <>
                  <div className="settings-sync-code">
                    <div className="settings-sync-code-head">
                      <span>恢复码</span>
                      <button
                        className="btn quiet"
                        type="button"
                        disabled={!syncRecoveryCode}
                        onClick={copyRecoveryCode}
                      >
                        <Icon name={copiedCode ? 'check' : 'today'} className="icon-sm" />
                        {copiedCode ? '已复制' : '复制'}
                      </button>
                    </div>
                    <code>{recoveryCodeLabel(syncRecoveryCode)}</code>
                    <small>
                      在新设备上用恢复码找回同一账号。服务端只保存哈希，请自行抄写保存，不要截图外发。
                    </small>
                  </div>

                  <div className="settings-sync-meta">
                    <div>
                      <span>本机设备</span>
                      <strong>{syncDeviceLabel || '未命名设备'}</strong>
                    </div>
                    <div>
                      <span>最近同步</span>
                      <strong>{syncStatus.lastSyncAt ?? '尚未同步'}</strong>
                    </div>
                    <div>
                      <span>待发变更</span>
                      <strong>{syncStatus.pending > 0 ? `${syncStatus.pending} 条` : '无'}</strong>
                    </div>
                  </div>

                  <div className="settings-sync-actions">
                    <button
                      className="btn secondary"
                      type="button"
                      disabled={syncBusy !== null || syncStatus.syncing || !syncStatus.online}
                      onClick={syncImmediately}
                    >
                      {syncBusy === 'sync' || syncStatus.syncing ? '同步中…' : '立即同步'}
                    </button>
                    <button
                      className="settings-danger-button"
                      type="button"
                      disabled={syncBusy !== null}
                      onClick={() => setConfirmRevoke(true)}
                    >
                      吊销本机
                    </button>
                  </div>

                  <p className="settings-inline-note">
                    <Icon name="lock" className="icon-sm" />
                    服务器只保存增量副本：记录内容、更新时间与删除标记；不保存恢复码明文，也不保存
                    AI
                    对话内容。关闭同步只停止上传，不会删除本机记录，也不会删除服务器上的已存副本——要彻底删除请用「删除账号」。
                  </p>
                </>
              ) : (
                <p className="settings-sync-disclosure">
                  {runtime.sync
                    ? '数据副本会存到自建服务器（当前为内网调试环境，尚未备案完成）。开启后本机每次写入会在 5 秒内增量上传；关闭后不再发起任何同步请求。'
                    : '桌面演示 / 体验模式不创建同步账号，也不向服务器上传任何业务数据。'}
                </p>
              )}

              <div className="settings-sync-restore">
                <button
                  className="settings-outline-button"
                  type="button"
                  disabled={!runtime.sync}
                  aria-expanded={restoreOpen}
                  onClick={() => {
                    setRestoreOpen((open) => !open)
                    setRestoreError('')
                  }}
                >
                  {restoreOpen ? '收起恢复码绑定' : '用恢复码绑定已有账号'}
                  <Icon name="chev" className="icon-sm" />
                </button>
                {restoreOpen && (
                  <div className="settings-sync-restore-body">
                    <label>
                      <span>恢复码（32 位十六进制）</span>
                      <input
                        value={restoreCode}
                        maxLength={39}
                        placeholder="例如 0A1B2C3D 4E5F6A7B…"
                        aria-label="恢复码"
                        onChange={(event) => {
                          setRestoreCode(event.target.value)
                          setRestoreError('')
                        }}
                      />
                    </label>
                    {restoreError && (
                      <p className="surface-error" role="alert">
                        {restoreError}
                      </p>
                    )}
                    <button
                      className="btn primary"
                      type="button"
                      disabled={syncBusy === 'restore'}
                      onClick={bindWithRecoveryCode}
                    >
                      {syncBusy === 'restore' ? '绑定中…' : '绑定到本机'}
                    </button>
                    <small>
                      绑定后以服务器副本为准合并到本机；不会清空本机已有记录。换账号时会丢弃旧账号未发出的变更。
                    </small>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="panel settings-card settings-brief-card" aria-labelledby="briefTitle">
            <div className="settings-card-head">
              <div>
                <span className="settings-section-index">05</span>
                <h2 id="briefTitle">每日简报</h2>
                <p>服务器按固定时间汇总最近 7 天记录，生成一份简报并存进服务端归档。</p>
              </div>
              <span className="settings-card-tag">{dailyBrief.enabled ? '已开启' : '未设置'}</span>
            </div>

            <div className="settings-brief-body">
              <label className="toggle-row">
                <span className="toggle-copy">
                  <strong>每天自动生成服务端简报</strong>
                  <small>需要先开启跨设备同步；关闭后不再生成，也不会删除已经生成的报告</small>
                </span>
                <input
                  className="toggle-input"
                  type="checkbox"
                  checked={dailyBrief.enabled}
                  disabled={!runtime.sync}
                  aria-label="每日简报"
                  onChange={(event) => toggleDailyBrief(event.target.checked)}
                />
                <span className="toggle-ui" />
              </label>

              <TimePickerField
                className="settings-time-field settings-brief-time"
                label="生成时间"
                ariaLabel="每日简报时间"
                value={dailyBrief.enabled ? dailyBrief.at : ''}
                disabled={!runtime.sync || !dailyBrief.enabled}
                helper={dailyBrief.enabled ? timeLabel(dailyBrief.at) : '未设置'}
                onChange={updateDailyBriefTime}
              />

              {briefTimeError && (
                <p className="surface-error" role="alert">
                  时间格式无效，已改回 {DEFAULT_DAILY_BRIEF_AT}。
                </p>
              )}

              <p className="settings-inline-note">
                <Icon name="clock" className="icon-sm" />
                {runtime.sync
                  ? '到点后服务器汇总最近 7 天的训练、饮食、学习与个人档案摘要，报告写入服务端归档；服务端报告保留 365 天后自动删除。'
                  : '桌面体验模式固定使用本地规则，不启用服务端每日简报。'}
              </p>
            </div>
          </section>
        </div>

        <aside className="settings-side-column">
          <section className="settings-privacy-card" aria-labelledby="privacyTitle">
            <div className="settings-privacy-head">
              <span>
                <Icon name="lock" />
              </span>
              <div>
                <span className="settings-kicker">PRIVACY BY DEFAULT</span>
                <h2 id="privacyTitle">你决定哪些数据参与分析。</h2>
              </div>
            </div>
            <ul>
              <li>
                <Icon name="check" className="icon-sm" />
                原始记录默认只保存在设备端
              </li>
              <li>
                <Icon name="check" className="icon-sm" />
                每次 AI 请求只组装必要摘要
              </li>
              <li>
                <Icon name="check" className="icon-sm" />
                你可以随时撤销 AI 数据授权
              </li>
            </ul>
            <button type="button" onClick={() => setInfoSheet('privacy')}>
              查看数据使用说明
              <Icon name="chev" className="icon-sm" />
            </button>
          </section>

          <section className="panel settings-device-card" aria-labelledby="deviceTitle">
            <div className="settings-card-head compact">
              <div>
                <h2 id="deviceTitle">设备与服务</h2>
                <p>本机运行环境与自建服务器的连接状态。</p>
              </div>
            </div>
            <div className="settings-device-list">
              <div>
                <span>运行模式</span>
                <strong>{runtime.label}</strong>
              </div>
              <div>
                <span>目标设备</span>
                <strong>Android · 数据线部署</strong>
              </div>
              <div>
                <span>云服务器</span>
                <strong
                  className={
                    runtime.sync && syncStatus.enabled && syncStatus.lastSyncAt
                      ? undefined
                      : 'muted-value'
                  }
                >
                  {/* 不写「已连接」，也不写具体时间：`online` 只是 navigator.onLine（设备有网 ≠
                      服务器可达），而 lastSyncAt 是动态值，放进视觉基线会天天漂。 */}
                  {!runtime.sync
                    ? '本次运行不启用'
                    : syncStatus.enabled
                      ? '自建 · 已开启同步'
                      : '自建 · 未开启同步'}
                </strong>
              </div>
              <div>
                <span>本地数据库</span>
                <strong>浏览器 IndexedDB</strong>
              </div>
            </div>
            <button
              className="settings-outline-button"
              type="button"
              onClick={() => setInfoSheet('deploy')}
            >
              自托管部署说明
              <Icon name="chev" className="icon-sm" />
            </button>
          </section>

          {!isDemo && (
            <section className="settings-danger-card" aria-labelledby="dangerTitle">
              <span className="settings-kicker">DANGER ZONE</span>
              <h2 id="dangerTitle">清空本机设置</h2>
              <p>
                只重置本页设置，不会删除训练、饮食、学习和计划记录。正式版会提供更细的数据删除范围。
              </p>
              <button
                className="settings-danger-button"
                type="button"
                onClick={() => setConfirmClear(true)}
              >
                清空本机设置
              </button>
            </section>
          )}

          {syncToken && (
            <section className="settings-danger-card" aria-labelledby="deleteAccountTitle">
              <span className="settings-kicker">DELETE · ACCOUNT</span>
              <h2 id="deleteAccountTitle">删除同步账号与全部数据</h2>
              <p>
                需要联网。会先永久删除自建服务器上的当前账号、同步副本、分析归档与可清理快照，成功后清空本机浏览器数据。此操作不可撤销，建议先导出
                JSON 备份。
              </p>
              <button
                className="settings-danger-button"
                type="button"
                disabled={syncBusy !== null || !syncStatus.online || !networkOnline}
                onClick={() => setConfirmDeleteAccount(true)}
              >
                {syncBusy === 'delete' ? '删除中…' : '删除账号与数据'}
              </button>
            </section>
          )}
          {!isDemo && (
            <section className="settings-danger-card" aria-labelledby="clearDataTitle">
              <span className="settings-kicker">
                {isGuest ? 'RESET · GUEST DATA' : 'RESET · LOCAL DATA'}
              </span>
              <h2 id="clearDataTitle">{isGuest ? '重新开始体验' : '清空本机数据'}</h2>
              <p>
                {isGuest
                  ? '体验数据只保存在这台设备的浏览器里，不会上传到服务器。下次从介绍页再进来，看到的还是你留下的记录；点这里可以清掉它们，回到空白状态。'
                  : `删除本机浏览器里的全部记录、设置、长期计划与快照，并恢复到${resetTargetLabel}。此操作不可撤销，建议先导出 JSON 备份。`}
              </p>
              <button
                className="settings-danger-button"
                type="button"
                onClick={() => setConfirmClearAll(true)}
              >
                {isGuest ? '重新开始体验' : '清空本机数据'}
              </button>
            </section>
          )}

          <div className="settings-version">
            <span>Persist v0.1.0</span>
            <span>自托管 · 2026</span>
          </div>
        </aside>
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="清空本机设置？"
          description="提醒、AI 授权与导入选择会恢复为关闭状态。业务记录不会被删除，清空后的设置会保存在本机。"
          confirmLabel="确认清空"
          danger
          onClose={() => setConfirmClear(false)}
          onConfirm={clearMockSettings}
        />
      )}

      {confirmClearAll && (
        <ConfirmDialog
          title={isGuest ? '重新开始体验？' : '清空本机数据？'}
          description={
            isGuest
              ? '会删掉这台浏览器里的全部体验记录（训练、饮食、学习、档案与设置），回到空白状态。此操作无法撤销。'
              : `本机浏览器里的全部记录、设置、长期计划与快照都会被删除，并恢复到${resetTargetLabel}。此操作无法撤销，建议先导出 JSON 备份。${
                  syncStatus.enabled ? '服务端副本不会被删除，下一轮同步会把记录取回本机。' : ''
                }`
          }
          confirmLabel={isGuest ? '重新开始' : '确认清空'}
          danger
          onClose={() => setConfirmClearAll(false)}
          onConfirm={clearEverything}
        />
      )}

      {confirmDeleteAccount && (
        <ConfirmDialog
          title="永久删除同步账号与全部数据？"
          description="系统会先删除自建服务器上的当前账号和可清理快照，再清空本机浏览器里的全部记录、设置、长期计划与快照。此操作无法撤销，建议先导出 JSON 备份。"
          confirmLabel="永久删除"
          danger
          onClose={() => setConfirmDeleteAccount(false)}
          onConfirm={deleteAccountEverywhere}
        />
      )}
      {confirmRevoke && (
        <ConfirmDialog
          title="吊销本机同步？"
          description="本机令牌会立即失效并停止后续同步，本机数据不会被删除。再次开启会创建新账号；若想继续使用原账号，请在那之前抄好恢复码。"
          confirmLabel="确认吊销"
          danger
          onClose={() => setConfirmRevoke(false)}
          onConfirm={revokeThisDevice}
        />
      )}

      {infoSheet === 'privacy' && (
        <PageSheet
          title="数据使用说明"
          subtitle="下面是 AI 请求、服务端记录与同步各自实际遵循的数据边界。"
          onClose={() => setInfoSheet(null)}
          className="mock-detail-sheet"
        >
          <div className="info-sheet-stack">
            <div className="info-sheet-block">
              <h3>原始记录优先留在本机</h3>
              <p>
                训练、饮食、饮水和学习记录默认由当前设备维护。AI
                分析不会自动复制完整数据库，也不会在后台持续同步。
              </p>
              <ul className="info-sheet-list">
                <li>
                  <Icon name="check" className="icon-sm" />
                  只有你主动生成简报或复盘时才组装请求。
                </li>
                <li>
                  <Icon name="check" className="icon-sm" />
                  可以按训练、饮食、学习、档案分别关闭授权。
                </li>
                <li>
                  <Icon name="check" className="icon-sm" />
                  关闭授权只影响后续请求，不删除原始记录。
                </li>
              </ul>
            </div>
            <div className="info-sheet-block">
              <h3>API Key 只保存在服务端</h3>
              <p>
                浏览器和 Android 客户端都通过你的服务器代理请求
                DeepSeek。服务端环境变量保存密钥，前端代码和下载备份中不会出现 API Key。
              </p>
            </div>
            <div className="info-sheet-block">
              <h3>服务端只留 30 天调用记录</h3>
              <p>
                每次 AI 调用会在你的自建服务器留下一条记录：时间、接口、模型、结果、token 用量与 IP
                哈希。不保存请求内容，也不保存生成的文字；记录保留 30
                天后自动删除，要长期留证只能改服务端配置。
              </p>
            </div>
            <div className="info-sheet-block">
              <h3>备注按最小范围处理</h3>
              <p>原始备注默认排除，除非你在未来版本中单独授权。饮食餐次只记录文字与营养数据。</p>
            </div>
          </div>
          <div className="surface-form-actions">
            <button className="btn primary" type="button" onClick={() => setInfoSheet(null)}>
              我知道了
            </button>
          </div>
        </PageSheet>
      )}

      {infoSheet === 'deploy' && (
        <PageSheet
          title="自托管部署说明"
          subtitle="下面四条是服务端实际生效的边界；改任何一条都要同步改服务器配置。"
          onClose={() => setInfoSheet(null)}
          className="mock-detail-sheet"
        >
          <div className="info-sheet-stack">
            <div className="info-sheet-block">
              <h3>最小部署清单</h3>
              <p>
                小型云服务器只需要提供受控的 AI 代理接口，不保存业务数据库；原始记录仍以客户端为主。
              </p>
              <div className="deploy-steps">
                <div className="deploy-step">
                  <span>01</span>
                  <div>
                    <strong>配置服务端密钥</strong>
                    <p>
                      通过环境变量保存 <code>DEEPSEEK_API_KEY</code>
                      ，不要把密钥写入前端构建产物或公开仓库。
                    </p>
                  </div>
                </div>
                <div className="deploy-step">
                  <span>02</span>
                  <div>
                    <strong>限制请求来源</strong>
                    <p>配置允许的来源白名单，并按设备或用户设置速率限制，避免代理被滥用。</p>
                  </div>
                </div>
                <div className="deploy-step">
                  <span>03</span>
                  <div>
                    <strong>启用 HTTPS 与大小限制</strong>
                    <p>
                      上线前启用 HTTPS，并限制请求体与响应体大小，拒绝不必要的字段与附件。当前为
                      HTTP 内网调试，正式对外前必须完成证书与域名切换。
                    </p>
                  </div>
                </div>
                <div className="deploy-step">
                  <span>04</span>
                  <div>
                    <strong>日志脱敏与到期清理</strong>
                    <p>日志不记录密钥、完整档案或原始备注，并为必要的错误日志设置保留期限。</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="info-sheet-block">
              <h3>客户端连接方式</h3>
              <p>
                浏览器与 Android
                都只访问同一个代理地址。具体域名、鉴权和设备部署方式将在后端阶段结合你的服务器环境确定。
              </p>
            </div>
          </div>
          <div className="surface-form-actions">
            <button className="btn primary" type="button" onClick={() => setInfoSheet(null)}>
              返回设置
            </button>
          </div>
        </PageSheet>
      )}
    </form>
  )
}
