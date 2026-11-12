import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TimePickerField } from '../components/DateTimePicker'
import { Icon } from '../components/Icon'
import { PageSheet } from '../components/PageSheet'
import { useMockData } from '../context/mock-data-context'
import { useUI } from '../context/ui-context'
import { calculateProfileCompleteness, countProfileFields } from '../data/profile'
import { cn } from '../lib/cn'
import {
  isProfileNumberInRange,
  PROFILE_NUMBER_RULES,
  type ProfileNumberField,
} from '../lib/profile-rules'
import type { ProfileData } from '../types'

const STEPS = [
  { title: '基础资料', detail: '身体数据与阶段目标' },
  { title: '训练背景', detail: '经验、频率与器械条件' },
  { title: '饮食与作息', detail: '偏好、忌口与恢复状态' },
]

// 数值范围与提示语统一来自 lib/profile-rules.ts，和 AI 写回档案用的是同一套规则。
function rangeError(field: ProfileNumberField, value: number) {
  return isProfileNumberInRange(field, value) ? '' : PROFILE_NUMBER_RULES[field].message
}

function validateStep(step: number, profile: ProfileData) {
  if (step === 0) {
    const numberError =
      rangeError('age', profile.age) ||
      rangeError('height', profile.height) ||
      rangeError('weight', profile.weight) ||
      rangeError('targetWeight', profile.targetWeight)
    if (numberError) return numberError
    if (!profile.goal.trim()) return '请填写当前最重要的阶段目标。'
  }
  if (step === 1) {
    if (!profile.experience.trim() || !profile.frequency.trim() || !profile.equipment.trim()) {
      return '请补全训练经验、频率和器械条件。'
    }
  }
  if (step === 2) {
    if (!profile.dietPreference.trim()) return '请填写饮食偏好。'
    const sleepError = rangeError('sleepHours', profile.sleepHours)
    if (sleepError) return sleepError
  }
  return ''
}

function ProfileEditor({
  profile,
  initialStep,
  onClose,
  onSave,
}: {
  profile: ProfileData
  initialStep: number
  onClose: () => void
  onSave: (profile: ProfileData) => void
}) {
  const [draft, setDraft] = useState(profile)
  const [step, setStep] = useState(initialStep)
  const [error, setError] = useState('')

  const patch = (values: Partial<ProfileData>) => setDraft((current) => ({ ...current, ...values }))

  const next = () => {
    const message = validateStep(step, draft)
    if (message) {
      setError(message)
      return
    }
    setError('')
    if (step < STEPS.length - 1) setStep(step + 1)
    else onSave(draft)
  }

  return (
    <PageSheet
      title="完善个人档案"
      subtitle="信息越完整，训练、饮食与学习建议越有上下文。所有内容都可以稍后修改。"
      onClose={onClose}
      className="profile-sheet"
    >
      <div className="profile-stepper" aria-label="建档步骤">
        {STEPS.map((item, index) => (
          <button
            className={cn(index === step && 'active', index < step && 'done')}
            type="button"
            key={item.title}
            onClick={() => {
              if (index <= step) setStep(index)
            }}
          >
            <span>{index < step ? <Icon name="check" /> : index + 1}</span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="surface-form">
          <div className="surface-form-grid">
            <label className="form-field">
              <span>年龄</span>
              <input
                className="form-input"
                type="number"
                min="14"
                max="100"
                value={draft.age || ''}
                onChange={(event) => patch({ age: Number(event.target.value) || 0 })}
              />
            </label>
            <label className="form-field">
              <span>身高 / cm</span>
              <input
                className="form-input"
                type="number"
                min="120"
                max="230"
                step="0.5"
                value={draft.height || ''}
                onChange={(event) => patch({ height: Number(event.target.value) || 0 })}
              />
            </label>
            <label className="form-field">
              <span>当前体重 / kg</span>
              <input
                className="form-input"
                type="number"
                min="35"
                max="250"
                step="0.1"
                value={draft.weight || ''}
                onChange={(event) => patch({ weight: Number(event.target.value) || 0 })}
              />
            </label>
            <label className="form-field">
              <span>目标体重 / kg</span>
              <input
                className="form-input"
                type="number"
                min="35"
                max="250"
                step="0.1"
                value={draft.targetWeight || ''}
                onChange={(event) => patch({ targetWeight: Number(event.target.value) || 0 })}
              />
            </label>
          </div>
          <label className="form-field">
            <span>当前最重要的目标</span>
            <input
              className="form-input"
              value={draft.goal}
              placeholder="例如：增肌、减脂、改善体态或提升精力"
              onChange={(event) => patch({ goal: event.target.value })}
            />
          </label>
          <p className="profile-form-hint">
            身体数据只用于计算趋势和合理范围，不用于给出医疗诊断。
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="surface-form">
          <div className="surface-form-grid">
            <label className="form-field">
              <span>训练经验</span>
              <input
                className="form-input"
                value={draft.experience}
                onChange={(event) => patch({ experience: event.target.value })}
              />
            </label>
            <label className="form-field">
              <span>可执行频率</span>
              <input
                className="form-input"
                value={draft.frequency}
                onChange={(event) => patch({ frequency: event.target.value })}
              />
            </label>
          </div>
          <label className="form-field">
            <span>器械条件</span>
            <input
              className="form-input"
              value={draft.equipment}
              placeholder="商业健身房、家庭哑铃、徒手等"
              onChange={(event) => patch({ equipment: event.target.value })}
            />
          </label>
          <div className="profile-choice-group" role="group" aria-label="训练频率快捷选择">
            {['每周 2 次', '每周 3 次', '每周 4 次', '每周 5 次'].map((value) => (
              <button
                className={draft.frequency === value ? 'active' : ''}
                type="button"
                key={value}
                onClick={() => patch({ frequency: value })}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="surface-note">
            <Icon name="fitness" className="icon-sm" />
            <span>建议只填写真实可以长期执行的频率，不按理想状态设置。</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="surface-form">
          <label className="form-field">
            <span>饮食偏好</span>
            <input
              className="form-input"
              value={draft.dietPreference}
              placeholder="例如：高蛋白、素食、低碳水"
              onChange={(event) => patch({ dietPreference: event.target.value })}
            />
          </label>
          <label className="form-field">
            <span>过敏与忌口</span>
            <input
              className="form-input"
              value={draft.allergies}
              placeholder="没有可以留空，或在填写后明确记录"
              onChange={(event) => patch({ allergies: event.target.value })}
            />
          </label>
          <div className="surface-form-grid">
            <TimePickerField
              className="form-field"
              triggerClassName="form-input"
              label="通常入睡时间"
              value={draft.bedtime}
              onChange={(bedtime) => patch({ bedtime })}
            />
            <label className="form-field">
              <span>平均睡眠 / 小时</span>
              <input
                className="form-input"
                type="number"
                min="3"
                max="14"
                step="0.1"
                value={draft.sleepHours || ''}
                onChange={(event) => patch({ sleepHours: Number(event.target.value) || 0 })}
              />
            </label>
          </div>
          <label className="form-field">
            <span>近期压力状态</span>
            <select
              className="form-input"
              value={draft.stress}
              onChange={(event) => patch({ stress: event.target.value })}
            >
              <option value="">请选择</option>
              <option value="较低">较低，节奏稳定</option>
              <option value="中等">中等，偶有波动</option>
              <option value="较高">较高，容易疲惫</option>
            </select>
          </label>
          <label className="toggle-row">
            <span className="toggle-copy">
              <strong>允许 AI 使用这份档案</strong>
              <small>仅用于生成训练、饮食和学习建议，可随时关闭。</small>
            </span>
            <input
              className="toggle-input"
              type="checkbox"
              checked={draft.aiConsent}
              onChange={(event) => patch({ aiConsent: event.target.checked })}
            />
            <span className="toggle-ui" />
          </label>
        </div>
      )}

      {error && <p className="surface-error">{error}</p>}
      <div className="surface-form-actions profile-sheet-actions">
        <button
          className="btn secondary"
          type="button"
          onClick={
            step === 0
              ? onClose
              : () => {
                  setError('')
                  setStep(step - 1)
                }
          }
        >
          {step === 0 ? '稍后继续' : '上一步'}
        </button>
        <div className="surface-form-actions-right">
          <span className="profile-step-count">
            {step + 1} / {STEPS.length}
          </span>
          <button className="btn primary" type="button" onClick={next}>
            {step === STEPS.length - 1 ? '保存档案' : '继续'}
          </button>
        </div>
      </div>
    </PageSheet>
  )
}

function ProfileRow({
  label,
  value,
  empty = false,
}: {
  label: string
  value: string
  empty?: boolean
}) {
  return (
    <div className="profile-row">
      <span>{label}</span>
      <strong className={empty ? 'empty' : ''}>{value || '待补充'}</strong>
    </div>
  )
}

export function ProfilePage() {
  const { showToast } = useUI()
  const navigate = useNavigate()
  const {
    profile,
    updateProfile,
    settings,
    updateSettings,
    studyRecords,
    dietDays,
    waterHistory,
    fitnessHistory,
    planHistory,
  } = useMockData()
  const [editorStep, setEditorStep] = useState<number | null>(null)
  const completeness = calculateProfileCompleteness(profile)
  const filledFields = countProfileFields(profile)
  const recordsConsent = settings.sources.study && settings.sources.fitness
  const hasWeight = profile.weight > 0
  const hasHeight = profile.height > 0
  const hasSleep = profile.sleepHours > 0
  const bmi = hasHeight && hasWeight ? profile.weight / (profile.height / 100) ** 2 : null
  const sleepsEnough = hasSleep && profile.sleepHours >= 7
  const identityParts = [
    profile.age > 0 ? `${profile.age} 岁` : '',
    hasHeight ? `${profile.height} cm` : '',
    profile.goal.trim() ? `当前目标：${profile.goal}` : '',
  ].filter((item): item is string => Boolean(item))

  const recordDates = useMemo(() => {
    const dates = [
      ...studyRecords.map((record) => record.date),
      ...dietDays
        .filter((day) => day.meals.some((meal) => meal.entries.length > 0))
        .map((day) => day.date),
      ...waterHistory.map((entry) => entry.date),
      ...fitnessHistory.map((record) => record.date),
      ...planHistory.filter((item) => item.done).map((item) => item.date),
    ]
    return [...new Set(dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort()
  }, [dietDays, fitnessHistory, planHistory, studyRecords, waterHistory])
  const earliestRecordDate = recordDates[0] ?? null
  const latestRecordDate = recordDates.at(-1) ?? null
  const recordStartLabel = earliestRecordDate
    ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(
        new Date(`${earliestRecordDate}T12:00:00`),
      )
    : null
  const latestRecordLabel = latestRecordDate
    ? new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(
        new Date(`${latestRecordDate}T12:00:00`),
      )
    : null

  const fieldGroups = useMemo(() => {
    const base = [
      profile.age > 0 ? '' : '年龄',
      profile.height > 0 ? '' : '身高',
      profile.weight > 0 ? '' : '当前体重',
      profile.targetWeight > 0 ? '' : '目标体重',
      profile.goal.trim() ? '' : '当前目标',
    ].filter(Boolean)
    const training = [
      profile.experience.trim() ? '' : '训练经验',
      profile.frequency.trim() ? '' : '可执行频率',
      profile.equipment.trim() ? '' : '器械条件',
    ].filter(Boolean)
    const diet = [profile.dietPreference.trim() ? '' : '饮食偏好'].filter(Boolean)
    const recovery = [
      profile.allergies.trim() ? '' : '过敏与忌口',
      profile.bedtime.trim() ? '' : '通常入睡时间',
      profile.sleepHours > 0 ? '' : '平均睡眠',
      profile.stress.trim() ? '' : '近期压力',
    ].filter(Boolean)
    return [
      { label: '基础身体资料', detail: '年龄、身高、体重、目标体重与当前目标', missing: base },
      { label: '训练背景', detail: '经验、频率与器械条件', missing: training },
      { label: '饮食偏好', detail: '日常饮食方式', missing: diet },
      { label: '作息与忌口', detail: '睡眠、入睡时间、过敏与压力', missing: recovery },
    ]
  }, [profile])
  const missing = fieldGroups.flatMap((group) => group.missing)
  const isBlankStart = completeness === 0 && recordDates.length === 0

  const exportProfile = () => {
    const payload = {
      app: 'Persist',
      version: '0.1.0',
      exportedAt: new Date().toISOString(),
      profile,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'persist-profile.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    showToast('个人档案副本已导出')
  }

  return (
    <>
      <header className="head">
        <div className="heading">
          <div className="eyebrow">个人档案 · AI 上下文</div>
          <h1>
            先了解你，
            <br />
            再给出建议。
          </h1>
          <p className="subtitle">
            身体数据、训练背景、饮食偏好和恢复状态共同构成建议上下文。哪些内容可以交给
            AI，由你决定。
          </p>
        </div>
        {!isBlankStart && (
          <div className="head-actions">
            <span className="profile-local-badge">
              <Icon name="lock" className="icon-sm" />
              本地优先
            </span>
            <button
              className="btn secondary profile-onboard-action"
              type="button"
              onClick={() => navigate('/plans?onboard=1')}
            >
              <Icon name="spark" className="icon-sm" />
              AI 建档
            </button>
            <button className="btn primary" type="button" onClick={() => setEditorStep(0)}>
              <Icon name="edit" className="icon-sm" />
              完善档案
            </button>
          </div>
        )}
      </header>

      {isBlankStart ? (
        <section className="panel profile-empty-state" aria-labelledby="profileEmptyTitle">
          <div className="panel-head">
            <div>
              <h2 className="panel-title" id="profileEmptyTitle">
                还没有个人档案
              </h2>
              <p className="panel-sub">不预填年龄、身高、体重、训练偏好或 AI 授权。</p>
            </div>
          </div>
          <div className="surface-note">
            <Icon name="lock" className="icon-sm" />
            <span>档案只保存在本机；填写真实资料后再显示完整度与建议上下文。</span>
          </div>
          <div className="surface-form-actions">
            <div className="surface-form-actions-right">
              <button
                className="btn secondary"
                type="button"
                onClick={() => navigate('/plans?onboard=1')}
              >
                <Icon name="spark" className="icon-sm" />
                AI 建档
              </button>
              <button className="btn primary" type="button" onClick={() => setEditorStep(0)}>
                <Icon name="edit" className="icon-sm" />
                完善档案
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="profile-hero" aria-labelledby="profileHeroTitle">
            <div className="profile-identity">
              <span className="profile-avatar-lg">我</span>
              <div>
                <span className="profile-kicker">PERSIST PROFILE</span>
                <h2 id="profileHeroTitle">个人档案</h2>
                <p>{identityParts.length ? identityParts.join(' · ') : '尚未填写档案'}</p>
                <div className="profile-chip-row">
                  {recordDates.length > 0 && <span>累计记录 {recordDates.length} 天</span>}
                  {profile.frequency.trim() && <span>{profile.frequency}</span>}
                  <span>档案仅本地可见</span>
                </div>
              </div>
            </div>
            <div className="profile-completion">
              <div
                className="profile-completion-ring"
                style={{
                  background: `conic-gradient(var(--green) 0 ${completeness}%, rgba(255,255,255,.45) ${completeness}% 100%)`,
                }}
              >
                <div>
                  <strong>{completeness}%</strong>
                  <span>完整度</span>
                </div>
              </div>
              <div className="profile-completion-copy">
                <strong>
                  {completeness === 0
                    ? '尚未填写档案'
                    : completeness >= 90
                      ? '档案已足够完整'
                      : '档案信息待补充'}
                </strong>
                <span>
                  {missing.length
                    ? completeness === 0
                      ? '填写真实资料后，这里会显示可用的建议上下文。'
                      : `补充${missing.join('、')}后，建议会更精确。`
                    : '可以继续随记录变化更新身体和目标数据。'}
                </span>
                <button type="button" onClick={() => setEditorStep(0)}>
                  继续完善 <Icon name="chev" className="icon-sm" />
                </button>
              </div>
            </div>
            <div className="profile-hero-stats">
              <div>
                <span>当前体重</span>
                <strong>
                  {hasWeight ? profile.weight : '未填写'}
                  {hasWeight && <small> kg</small>}
                </strong>
                <small>
                  {profile.targetWeight > 0 ? `目标 ${profile.targetWeight} kg` : '目标体重未填写'}
                </small>
              </div>
              <div>
                <span>BMI</span>
                <strong>{bmi === null ? '未填写' : bmi.toFixed(1)}</strong>
                <small>{bmi === null ? '填写身高与体重后计算' : '仅作趋势参考'}</small>
              </div>
              <div>
                <span>平均睡眠</span>
                <strong>
                  {hasSleep ? profile.sleepHours : '未填写'}
                  {hasSleep && <small> h</small>}
                </strong>
                <small className={sleepsEnough ? 'good' : ''}>
                  {!hasSleep
                    ? '填写后显示恢复基线'
                    : sleepsEnough
                      ? '达到恢复基线'
                      : '低于 7 小时基线'}
                </small>
              </div>
            </div>
          </section>

          <div className="profile-layout">
            <div className="profile-main-column">
              <section className="panel profile-section-card" aria-labelledby="profileBaseTitle">
                <div className="panel-head">
                  <div>
                    <h2 className="panel-title" id="profileBaseTitle">
                      基础资料
                    </h2>
                    <p className="panel-sub">改变目标时同步更新，不需要重新填写全部档案。</p>
                  </div>
                  <button
                    className="profile-edit-btn"
                    type="button"
                    onClick={() => setEditorStep(0)}
                  >
                    <Icon name="edit" className="icon-sm" />
                    编辑
                  </button>
                </div>
                <div className="profile-details-grid">
                  <ProfileRow
                    label="年龄"
                    value={profile.age > 0 ? `${profile.age} 岁` : ''}
                    empty={profile.age <= 0}
                  />
                  <ProfileRow
                    label="身高"
                    value={hasHeight ? `${profile.height} cm` : ''}
                    empty={!hasHeight}
                  />
                  <ProfileRow
                    label="当前体重"
                    value={hasWeight ? `${profile.weight} kg` : ''}
                    empty={!hasWeight}
                  />
                  <ProfileRow
                    label="目标体重"
                    value={profile.targetWeight > 0 ? `${profile.targetWeight} kg` : ''}
                    empty={profile.targetWeight <= 0}
                  />
                  <ProfileRow label="当前目标" value={profile.goal} empty={!profile.goal.trim()} />
                  {recordStartLabel && <ProfileRow label="记录起点" value={recordStartLabel} />}
                </div>
                <div className="profile-goal-strip">
                  <span>
                    <Icon name="spark" className="icon-sm" />
                    阶段目标
                  </span>
                  <strong>{profile.goal.trim() || '尚未设置'}</strong>
                  <small>
                    {profile.goal.trim() ? '建议每 4–6 周复核一次' : '填写当前目标后显示复核提示'}
                  </small>
                </div>
              </section>

              <section
                className="panel profile-section-card"
                aria-labelledby="profileTrainingTitle"
              >
                <div className="panel-head">
                  <div>
                    <h2 className="panel-title" id="profileTrainingTitle">
                      训练背景
                    </h2>
                    <p className="panel-sub">用于控制动作选择、训练量与恢复建议。</p>
                  </div>
                  <button
                    className="profile-edit-btn"
                    type="button"
                    onClick={() => setEditorStep(1)}
                  >
                    <Icon name="edit" className="icon-sm" />
                    编辑
                  </button>
                </div>
                <div className="profile-details-grid">
                  <ProfileRow
                    label="经验"
                    value={profile.experience}
                    empty={!profile.experience.trim()}
                  />
                  <ProfileRow
                    label="可执行频率"
                    value={profile.frequency}
                    empty={!profile.frequency.trim()}
                  />
                  <ProfileRow
                    label="器械条件"
                    value={profile.equipment}
                    empty={!profile.equipment.trim()}
                  />
                </div>
                <div className="profile-training-note">
                  <span className="profile-note-mark">
                    <Icon name="fitness" />
                  </span>
                  <div>
                    <strong>
                      {profile.frequency.trim()
                        ? `当前可执行频率：${profile.frequency}`
                        : '补充训练背景后显示建议'}
                    </strong>
                    <p>
                      {profile.frequency.trim()
                        ? '建议先按已填写频率执行，再根据真实训练记录调整。'
                        : '填写经验、频率和器械条件后，训练建议才会有真实上下文。'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="panel profile-section-card" aria-labelledby="profileDietTitle">
                <div className="panel-head">
                  <div>
                    <h2 className="panel-title" id="profileDietTitle">
                      饮食与作息
                    </h2>
                    <p className="panel-sub">用于提供更贴近实际的饮食和恢复建议。</p>
                  </div>
                  <button
                    className="profile-edit-btn"
                    type="button"
                    onClick={() => setEditorStep(2)}
                  >
                    <Icon name="edit" className="icon-sm" />
                    编辑
                  </button>
                </div>
                <div className="profile-details-grid">
                  <ProfileRow label="饮食偏好" value={profile.dietPreference} />
                  <ProfileRow
                    label="过敏与忌口"
                    value={profile.allergies}
                    empty={!profile.allergies}
                  />
                  <ProfileRow label="通常入睡" value={profile.bedtime} empty={!profile.bedtime} />
                  <ProfileRow label="近期压力" value={profile.stress} empty={!profile.stress} />
                </div>
              </section>
            </div>

            <aside className="profile-side-column">
              <section className="profile-ai-card" aria-labelledby="profileAiTitle">
                <div className="profile-ai-head">
                  <span>
                    <Icon name="spark" />
                  </span>
                  <div>
                    <small>AI DATA CONSENT</small>
                    <h2 id="profileAiTitle">AI 数据授权</h2>
                  </div>
                </div>
                <p>允许 DeepSeek 通过服务端代理读取已勾选的档案与记录，用于生成综合分析与建议。</p>
                <label className="toggle-row">
                  <span className="toggle-copy">
                    <strong>使用个人档案</strong>
                    <small>身体数据、训练与饮食偏好</small>
                  </span>
                  <input
                    className="toggle-input"
                    type="checkbox"
                    checked={profile.aiConsent}
                    onChange={(event) => {
                      updateProfile({ aiConsent: event.target.checked })
                      showToast(event.target.checked ? '已允许 AI 使用个人档案' : '已关闭档案授权')
                    }}
                  />
                  <span className="toggle-ui" />
                </label>
                <label className="toggle-row">
                  <span className="toggle-copy">
                    <strong>引用学习与训练记录</strong>
                    <small>仅发送生成报告所需的摘要</small>
                  </span>
                  <input
                    className="toggle-input"
                    type="checkbox"
                    checked={recordsConsent}
                    onChange={(event) => {
                      const enabled = event.target.checked
                      updateSettings({
                        sources: {
                          ...settings.sources,
                          study: enabled,
                          fitness: enabled,
                        },
                      })
                      showToast(enabled ? '已允许引用学习与训练记录' : '已关闭学习与训练记录授权')
                    }}
                  />
                  <span className="toggle-ui" />
                </label>
                <div className="profile-privacy-line">
                  <Icon name="lock" className="icon-sm" />
                  <span>DeepSeek API Key 只保存在服务端，不进入手机端或浏览器。</span>
                </div>
              </section>

              <section className="panel profile-checklist" aria-labelledby="profileChecklistTitle">
                <div className="panel-head">
                  <div>
                    <h2 className="panel-title" id="profileChecklistTitle">
                      完善清单
                    </h2>
                    <p className="panel-sub">完成后 AI 分析会减少默认假设。</p>
                  </div>
                  <span className="profile-count">已填 {filledFields}/13</span>
                </div>
                <div className="profile-checklist-list">
                  {fieldGroups.map((group, index) => (
                    <div className={group.missing.length === 0 ? 'done' : ''} key={group.label}>
                      <span>
                        {group.missing.length === 0 ? <Icon name="check" /> : String(index + 1)}
                      </span>
                      <p>
                        <strong>{group.label}</strong>
                        <small>
                          {group.missing.length
                            ? `待补充：${group.missing.join('、')}`
                            : `${group.detail} · 信息已完整`}
                        </small>
                      </p>
                    </div>
                  ))}
                </div>
                <button
                  className="profile-checklist-action"
                  type="button"
                  onClick={() => setEditorStep(2)}
                >
                  继续完善档案 <Icon name="chev" className="icon-sm" />
                </button>
              </section>

              <section className="panel profile-data-card" aria-labelledby="profileDataTitle">
                <div className="panel-head">
                  <div>
                    <h2 className="panel-title" id="profileDataTitle">
                      档案数据
                    </h2>
                    <p className="panel-sub">第一版通过本地 Mock 维护。</p>
                  </div>
                </div>
                <div className="profile-data-list">
                  <div>
                    <span>存储位置</span>
                    <strong>当前设备</strong>
                  </div>
                  <div>
                    <span>最近更新</span>
                    <strong>{latestRecordLabel ?? '尚无记录'}</strong>
                  </div>
                  <div>
                    <span>导出格式</span>
                    <strong>JSON</strong>
                  </div>
                </div>
                <button className="profile-export" type="button" onClick={exportProfile}>
                  <Icon name="undo" className="icon-sm" />
                  导出档案副本
                </button>
              </section>
            </aside>
          </div>
        </>
      )}

      {editorStep !== null && (
        <ProfileEditor
          key={`${editorStep}-${completeness}`}
          profile={profile}
          initialStep={editorStep}
          onClose={() => setEditorStep(null)}
          onSave={(nextProfile) => {
            updateProfile(nextProfile)
            setEditorStep(null)
            showToast('个人档案已保存')
          }}
        />
      )}
    </>
  )
}
