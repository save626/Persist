import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { ConfirmDialog, PageSheet } from '../components/PageSheet'
import { useMockData } from '../context/mock-data-context'
import { useUI } from '../context/ui-context'
import {
  countMockRecords,
  parseMockBackupJson,
  parseStudyCsv,
  serializeMockBackup,
} from '../lib/mock-data-transfer'
import { createCompleteMockData } from '../data/complete-mock-data'
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
    eveningReview,
    reports,
    longTermPlans,
    snapshot,
    createMockSnapshot,
    appendStudyRecords,
    replaceMockData,
    clearLocalData: clearAllLocalData,
  } = useMockData()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { reminders, summaryOnly, sources } = settings
  const [aiState, setAiState] = useState<AiState>('idle')
  const [savedAt, setSavedAt] = useState('刚刚')
  const [saving, setSaving] = useState(false)
  const [importName, setImportName] = useState('')
  const [importError, setImportError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [infoSheet, setInfoSheet] = useState<InfoSheet>(null)

  const enabledReminderCount = reminders.filter((reminder) => reminder.enabled).length
  const sourceCount = useMemo(() => Object.values(sources).filter(Boolean).length, [sources])

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

  const testConnection = () => {
    if (aiState === 'testing') return
    setAiState('testing')
    window.setTimeout(() => {
      setAiState('connected')
      showToast('Mock 连接测试完成：服务端代理可用')
    }, 950)
  }

  const exportMockData = () => {
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
        eveningReview,
        reports,
        longTermPlans,
      })
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `persist-mock-backup-${backupDateStamp()}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      showToast(`Mock 数据备份已导出 · 含 ${payload.data.longTermPlans.length} 个长期计划`)
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
        setSavedAt('已导入 Mock 备份')
        const planCount = data.longTermPlans?.length ?? 0
        showToast(
          `Mock 备份已导入 · ${countMockRecords(data)} 条记录（含 ${planCount} 个长期计划）`,
        )
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
    showToast(`Mock 快照已生成 · ${next.recordCount} 条记录`)
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
    setSavedAt('已清空 Mock 设置')
    showToast('本地 Mock 设置已清空，示例记录仍会保留')
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
        setSavedAt('本机数据已清空')
        showToast('本机数据已清空 · 已恢复初始示例数据')
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '未知错误'
        setSavedAt('清空失败')
        showToast(`清空失败：${message}`)
      })
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
            <h2>记录保存在设备端，敏感密钥不进入浏览器。</h2>
            <p>
              当前为前端 Mock：记录已保存在本机浏览器（IndexedDB），AI 请求仍由你的小型服务器代理
              DeepSeek。
            </p>
          </div>
        </div>
        <div className="settings-hero-stats">
          <div>
            <span>提醒开启</span>
            <strong>{enabledReminderCount} / 3</strong>
            <small>可按训练日调整</small>
          </div>
          <div>
            <span>AI 数据范围</span>
            <strong>{sourceCount} / 4</strong>
            <small>默认仅发摘要</small>
          </div>
          <div>
            <span>存储方式</span>
            <strong>设备本地</strong>
            <small>云同步预留</small>
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
              <span className="settings-card-tag">{enabledReminderCount} 项开启</span>
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
                  <label className="settings-time-field">
                    <span>提醒时间</span>
                    <input
                      type="time"
                      value={reminder.time}
                      disabled={!reminder.enabled}
                      aria-label={`${reminder.title}时间`}
                      onChange={(event) =>
                        updateReminder(reminder.id, { time: event.target.value })
                      }
                    />
                    <small>{timeLabel(reminder.time)}</small>
                  </label>
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
                {aiState === 'testing'
                  ? '测试中'
                  : aiState === 'connected'
                    ? 'Mock 可用'
                    : aiState === 'error'
                      ? '连接失败'
                      : '待配置'}
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
                {aiState === 'testing' ? '测试连接中…' : '测试 Mock 连接'}
              </button>
            </div>

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
                  <small>不发送餐次照片、原始备注或完整历史明细</small>
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
              <button className="settings-data-action" type="button" onClick={exportMockData}>
                <span>
                  <Icon name="today" />
                </span>
                <span>
                  <strong>导出 JSON 备份</strong>
                  <small>包含当前 Mock 记录、设置与长期计划</small>
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
                  <small>{importName || 'JSON 恢复 Mock 备份；CSV 追加学习记录'}</small>
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
              <li>
                <Icon name="check" className="icon-sm" />
                照片只作为餐次附件，不发送给分析服务
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
                <p>为 Android 部署预留。</p>
              </div>
            </div>
            <div className="settings-device-list">
              <div>
                <span>当前环境</span>
                <strong>桌面浏览器 Mock</strong>
              </div>
              <div>
                <span>目标设备</span>
                <strong>Android · 数据线部署</strong>
              </div>
              <div>
                <span>云服务器</span>
                <strong className="muted-value">未连接</strong>
              </div>
              <div>
                <span>本地数据库</span>
                <strong className="muted-value">后端阶段接入</strong>
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

          <section className="settings-danger-card" aria-labelledby="dangerTitle">
            <span className="settings-kicker">DANGER ZONE</span>
            <h2 id="dangerTitle">清空本地 Mock 设置</h2>
            <p>
              只重置本页设置，不会删除示例训练、饮食和学习记录。正式版会提供更细的数据删除范围。
            </p>
            <button
              className="settings-danger-button"
              type="button"
              onClick={() => setConfirmClear(true)}
            >
              清空本地 Mock 设置
            </button>
          </section>

          <section className="settings-danger-card" aria-labelledby="clearDataTitle">
            <span className="settings-kicker">RESET · LOCAL DATA</span>
            <h2 id="clearDataTitle">清空本机数据</h2>
            <p>
              删除本机浏览器里的全部记录、设置、长期计划与快照，并恢复初始示例数据。此操作不可撤销，建议先导出
              JSON 备份。
            </p>
            <button
              className="settings-danger-button"
              type="button"
              onClick={() => setConfirmClearAll(true)}
            >
              清空本机数据
            </button>
          </section>

          <div className="settings-version">
            <span>Persist v0.1.0</span>
            <span>Frontend Mock · 2026</span>
          </div>
        </aside>
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="清空本地 Mock 设置？"
          description="提醒、AI 授权与导入选择会恢复为关闭状态。业务记录不会被删除，清空后的设置会保存在本机。"
          confirmLabel="确认清空"
          danger
          onClose={() => setConfirmClear(false)}
          onConfirm={clearMockSettings}
        />
      )}

      {confirmClearAll && (
        <ConfirmDialog
          title="清空本机数据？"
          description="本机浏览器里的全部记录、设置、长期计划与快照都会被删除，并恢复初始示例数据。此操作无法撤销，建议先导出 JSON 备份。"
          confirmLabel="确认清空"
          danger
          onClose={() => setConfirmClearAll(false)}
          onConfirm={clearEverything}
        />
      )}

      {infoSheet === 'privacy' && (
        <PageSheet
          title="数据使用说明"
          subtitle="当前是前端 Mock；下面是正式接入 AI 时遵循的数据边界。"
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
              <h3>照片与备注按最小范围处理</h3>
              <p>
                饮食照片只作为餐次本地附件，不参与热量估算，也不随分析摘要上传。原始备注默认排除，除非你在未来版本中单独授权。
              </p>
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
          subtitle="第一版先保留接口边界，后端阶段再逐项实现。"
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
                      通过环境变量保存 `DEEPSEEK_API_KEY`，不要把密钥写入前端构建产物或公开仓库。
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
                    <p>只接受 HTTPS 请求，限制请求体和响应体大小，拒绝不必要的字段与附件。</p>
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
