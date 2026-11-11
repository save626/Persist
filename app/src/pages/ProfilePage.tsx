import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TimePickerField } from '../components/DateTimePicker'
import { Icon } from '../components/Icon'
import { PageSheet } from '../components/PageSheet'
import { useMockData } from '../context/mock-data-context'
import { useUI } from '../context/ui-context'
import { calculateProfileCompleteness } from '../data/profile'
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
                value={draft.age}
                onChange={(event) => patch({ age: Number(event.target.value) })}
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
                value={draft.height}
                onChange={(event) => patch({ height: Number(event.target.value) })}
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
                value={draft.weight}
                onChange={(event) => patch({ weight: Number(event.target.value) })}
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
                value={draft.targetWeight}
                onChange={(event) => patch({ targetWeight: Number(event.target.value) })}
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
                value={draft.sleepHours}
                onChange={(event) => patch({ sleepHours: Number(event.target.value) })}
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
  const { profile, updateProfile, settings, updateSettings } = useMockData()
  const [editorStep, setEditorStep] = useState<number | null>(null)
  const completeness = calculateProfileCompleteness(profile)
  const recordsConsent = settings.sources.study && settings.sources.fitness
  const bmi = profile.height ? profile.weight / (profile.height / 100) ** 2 : 0
  const sleepsEnough = profile.sleepHours >= 7
  const missing = useMemo(() => {
    const items: string[] = []
    if (!profile.allergies) items.push('过敏与忌口')
    if (!profile.bedtime) items.push('通常入睡时间')
    if (!profile.stress) items.push('近期压力状态')
    return items
  }, [profile])

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
      </header>

      <section className="profile-hero" aria-labelledby="profileHeroTitle">
        <div className="profile-identity">
          <span className="profile-avatar-lg">我</span>
          <div>
            <span className="profile-kicker">PERSIST PROFILE</span>
            <h2 id="profileHeroTitle">个人档案</h2>
            <p>
              {profile.age} 岁 · {profile.height} cm · 当前目标：{profile.goal}
            </p>
            <div className="profile-chip-row">
              <span>持续记录 7 天</span>
              <span>{profile.frequency}</span>
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
            <strong>{completeness >= 90 ? '档案已足够完整' : '基础资料已可用'}</strong>
            <span>
              {missing.length
                ? `补充${missing.join('、')}后，建议会更精确。`
                : '可以继续随记录变化更新身体和目标数据。'}
            </span>
            <button type="button" onClick={() => setEditorStep(missing.length ? 2 : 0)}>
              继续完善 <Icon name="chev" className="icon-sm" />
            </button>
          </div>
        </div>
        <div className="profile-hero-stats">
          <div>
            <span>当前体重</span>
            <strong>
              {profile.weight}
              <small> kg</small>
            </strong>
            <small>目标 {profile.targetWeight} kg</small>
          </div>
          <div>
            <span>BMI</span>
            <strong>{bmi.toFixed(1)}</strong>
            <small>仅作趋势参考</small>
          </div>
          <div>
            <span>平均睡眠</span>
            <strong>
              {profile.sleepHours}
              <small> h</small>
            </strong>
            <small className={sleepsEnough ? 'good' : ''}>
              {sleepsEnough ? '达到恢复基线' : '建议优先补足'}
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
              <button className="profile-edit-btn" type="button" onClick={() => setEditorStep(0)}>
                <Icon name="edit" className="icon-sm" />
                编辑
              </button>
            </div>
            <div className="profile-details-grid">
              <ProfileRow label="年龄" value={`${profile.age} 岁`} />
              <ProfileRow label="身高" value={`${profile.height} cm`} />
              <ProfileRow label="当前体重" value={`${profile.weight} kg`} />
              <ProfileRow label="目标体重" value={`${profile.targetWeight} kg`} />
              <ProfileRow label="当前目标" value={profile.goal} />
              <ProfileRow label="记录起点" value="2026 年 10 月" />
            </div>
            <div className="profile-goal-strip">
              <span>
                <Icon name="spark" className="icon-sm" />
                阶段目标
              </span>
              <strong>{profile.goal}</strong>
              <small>建议每 4–6 周复核一次</small>
            </div>
          </section>

          <section className="panel profile-section-card" aria-labelledby="profileTrainingTitle">
            <div className="panel-head">
              <div>
                <h2 className="panel-title" id="profileTrainingTitle">
                  训练背景
                </h2>
                <p className="panel-sub">用于控制动作选择、训练量与恢复建议。</p>
              </div>
              <button className="profile-edit-btn" type="button" onClick={() => setEditorStep(1)}>
                <Icon name="edit" className="icon-sm" />
                编辑
              </button>
            </div>
            <div className="profile-details-grid">
              <ProfileRow label="经验" value={profile.experience} />
              <ProfileRow label="可执行频率" value={profile.frequency} />
              <ProfileRow label="器械条件" value={profile.equipment} />
              <ProfileRow label="偏好" value="力量训练 · 上肢优先" />
            </div>
            <div className="profile-training-note">
              <span className="profile-note-mark">
                <Icon name="fitness" />
              </span>
              <div>
                <strong>建议从当前频率继续</strong>
                <p>现有计划与每周 4 次训练匹配，暂不需要通过增加天数提升效果。</p>
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
              <button className="profile-edit-btn" type="button" onClick={() => setEditorStep(2)}>
                <Icon name="edit" className="icon-sm" />
                编辑
              </button>
            </div>
            <div className="profile-details-grid">
              <ProfileRow label="饮食偏好" value={profile.dietPreference} />
              <ProfileRow label="过敏与忌口" value={profile.allergies} empty={!profile.allergies} />
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
              <span className="profile-count">{14 - missing.length}/14</span>
            </div>
            <div className="profile-checklist-list">
              <div className="done">
                <span>
                  <Icon name="check" />
                </span>
                <p>
                  <strong>基础身体资料</strong>
                  <small>年龄、身高、体重与目标</small>
                </p>
              </div>
              <div className="done">
                <span>
                  <Icon name="check" />
                </span>
                <p>
                  <strong>训练背景</strong>
                  <small>经验、频率与器械条件</small>
                </p>
              </div>
              <div className="done">
                <span>
                  <Icon name="check" />
                </span>
                <p>
                  <strong>饮食偏好</strong>
                  <small>已记录主要饮食方式</small>
                </p>
              </div>
              <div className={profile.bedtime && profile.stress && profile.allergies ? 'done' : ''}>
                <span>
                  {profile.bedtime && profile.stress && profile.allergies ? (
                    <Icon name="check" />
                  ) : (
                    '3'
                  )}
                </span>
                <p>
                  <strong>作息与忌口</strong>
                  <small>{missing.length ? `待补充：${missing.join('、')}` : '信息已完整'}</small>
                </p>
              </div>
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
                <strong>今天</strong>
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
