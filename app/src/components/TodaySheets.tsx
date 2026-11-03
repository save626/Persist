import { useState, type FormEvent } from 'react'
import type {
  EveningReviewPayload,
  FitnessSessionState,
  Meal,
  PlanItem,
  PlanKind,
  StudyRecord,
} from '../types'
import { Icon } from './Icon'
import { PageSheet } from './PageSheet'

const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  default: '普通安排',
  food: '饮食',
  water: '饮水',
  study: '学习',
}

function planKindLabel(kind: PlanKind) {
  return PLAN_KIND_LABEL[kind]
}

export function PlanEditorSheet({
  items,
  onSave,
  onClose,
}: {
  items: PlanItem[]
  onSave: (items: PlanItem[]) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => items.map((item) => ({ ...item })))
  const [error, setError] = useState('')

  const patchItem = (id: string, patch: Partial<PlanItem>) => {
    setDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    setError('')
  }

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= draft.length) return
    setDraft((current) => {
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const addItem = () => {
    const next: PlanItem = {
      id: `plan-${Date.now()}`,
      name: '新的安排',
      time: '20:00',
      detail: '补充这项安排的具体内容',
      kind: 'default',
      done: false,
    }
    setDraft((current) => [...current, next])
    setError('')
  }

  const removeItem = (id: string) => {
    setDraft((current) => current.filter((item) => item.id !== id))
    setError('')
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (draft.some((item) => !item.name.trim() || !item.time)) {
      setError('每项安排都需要名称和时间。')
      return
    }
    onSave(
      draft.map((item) => ({
        ...item,
        name: item.name.trim(),
        detail: item.detail.trim(),
      })),
    )
  }

  return (
    <PageSheet
      title="编辑今日安排"
      subtitle="调整顺序、时间与类型，也可以删除不再重要的安排。"
      onClose={onClose}
      className="mock-detail-sheet plan-editor-sheet"
    >
      <form className="surface-form" onSubmit={submit}>
        <div className="mock-planner-list">
          {draft.map((item, index) => (
            <article className="mock-planner-row" key={item.id}>
              <div className="mock-planner-head">
                <span className="mock-planner-order">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{item.name || '未命名安排'}</strong>
                  <small>{item.time || '未设置时间'} · {planKindLabel(item.kind)}</small>
                </div>
                <div className="mock-icon-actions">
                  <button
                    type="button"
                    aria-label={`上移${item.name}`}
                    disabled={index === 0}
                    onClick={() => moveItem(index, -1)}
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`下移${item.name}`}
                    disabled={index === draft.length - 1}
                    onClick={() => moveItem(index, 1)}
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                  <button
                    className="danger"
                    type="button"
                    aria-label={`删除${item.name}`}
                    onClick={() => removeItem(item.id)}
                  >
                    <Icon name="close" className="icon-sm" />
                  </button>
                </div>
              </div>

              <div className="surface-form-grid">
                <label className="form-field">
                  <span>安排名称</span>
                  <input
                    className="form-input"
                    value={item.name}
                    onChange={(event) => patchItem(item.id, { name: event.target.value })}
                  />
                </label>
                <label className="form-field">
                  <span>时间</span>
                  <input
                    className="form-input"
                    type="time"
                    value={item.time}
                    onChange={(event) => patchItem(item.id, { time: event.target.value })}
                  />
                </label>
                <label className="form-field">
                  <span>类型</span>
                  <select
                    className="form-input"
                    value={item.kind}
                    onChange={(event) =>
                      patchItem(item.id, { kind: event.target.value as PlanKind })
                    }
                  >
                    {(Object.keys(PLAN_KIND_LABEL) as PlanKind[]).map((kind) => (
                      <option key={kind} value={kind}>
                        {PLAN_KIND_LABEL[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>详情</span>
                  <input
                    className="form-input"
                    value={item.detail}
                    onChange={(event) => patchItem(item.id, { detail: event.target.value })}
                  />
                </label>
              </div>

              <label className="mock-inline-check">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(event) => patchItem(item.id, { done: event.target.checked })}
                />
                <span>已经完成</span>
              </label>
            </article>
          ))}
        </div>

        <button className="mock-add-row" type="button" onClick={addItem}>
          <Icon name="plus" className="icon-sm" />
          添加一项安排
        </button>
        {error && <p className="surface-error">{error}</p>}
        <div className="surface-form-actions">
          <button className="btn quiet" type="button" onClick={onClose}>
            取消
          </button>
          <div className="surface-form-actions-right">
            <button className="btn secondary" type="button" onClick={addItem}>
              新增
            </button>
            <button className="btn primary" type="submit">
              保存计划
            </button>
          </div>
        </div>
      </form>
    </PageSheet>
  )
}

export interface TimelineEvent {
  time: string
  title: string
  detail: string
  value: string
  tone: 'water' | 'food' | 'study' | 'fitness' | 'default'
}

export function TimelineSheet({
  events,
  onClose,
}: {
  events: TimelineEvent[]
  onClose: () => void
}) {
  return (
    <PageSheet
      title="今日完整时间线"
      subtitle="按记录时间排列。这里展示的是当前前端 Mock 会话中的活动。"
      onClose={onClose}
      className="mock-detail-sheet"
    >
      <div className="mock-timeline">
        {events.map((event, index) => (
          <article className="mock-timeline-row" key={`${event.time}-${event.title}-${index}`}>
            <time>{event.time}</time>
            <span className={`mock-timeline-dot ${event.tone}`} />
            <div>
              <strong>{event.title}</strong>
              <p>{event.detail}</p>
            </div>
            <span className="mock-timeline-value">{event.value}</span>
          </article>
        ))}
      </div>
      <div className="surface-note">
        <Icon name="clock" className="icon-sm" />
        <span>时间线只用于回看，不会自动判断某一项是否“应该完成”。</span>
      </div>
    </PageSheet>
  )
}

function localDateValue() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function MorningBriefSheet({
  planItems,
  waterLiters,
  waterLog,
  meals,
  studyRecords,
  fitnessSession,
  sleepHours,
  onClose,
}: {
  planItems: PlanItem[]
  waterLiters: number
  waterLog: Array<{ id: string; milliliters: number; time: string }>
  meals: Meal[]
  studyRecords: StudyRecord[]
  fitnessSession: FitnessSessionState | null
  sleepHours: number
  onClose: () => void
}) {
  const today = localDateValue()
  const todayMeals = meals.filter((meal) => meal.entries.length > 0)
  const todayStudyRecords = studyRecords.filter((record) => record.date === today)
  const studyMinutes = todayStudyRecords.reduce((total, record) => total + record.duration, 0)
  const doneSets =
    fitnessSession?.exercises.reduce(
      (total, exercise) => total + exercise.sets.filter((set) => set.done).length,
      0,
    ) ?? 0
  const waterGap = Math.max(0, 2 - waterLiters)
  const waterGapMilliliters = Math.round(waterGap * 1000)
  const waterRecordCount = waterLiters > 0 ? waterLog.length + 1 : waterLog.length
  const recordCount = todayMeals.length + todayStudyRecords.length + waterRecordCount + (doneSets > 0 ? 1 : 0)
  const pendingPlans = planItems.filter((item) => !item.done).sort((left, right) => left.time.localeCompare(right.time))
  const trainingPlan = pendingPlans.find((item) => item.actionable || item.name.includes('训练'))
  const studyPlan = pendingPlans.find((item) => item.kind === 'study')
  const nextPlan = pendingPlans[0]

  let priorityTitle = '今天的关键安排已经推进。'
  let priorityDetail = `已留下 ${recordCount} 条记录，接下来按自己的节奏补齐饮水与晚间复盘即可。`
  if (trainingPlan) {
    priorityTitle = `先完成${trainingPlan.name}，再处理学习任务。`
    priorityDetail = `训练计划在 ${trainingPlan.time}。${waterGapMilliliters > 0 ? `当前饮水还差约 ${waterGapMilliliters} ml，建议午后分两次补齐。` : '饮水已经达标，保持现有节奏即可。'}`
  } else if (waterGapMilliliters > 0) {
    priorityTitle = `先把饮水缺口补上，再安排学习。`
    priorityDetail = `当前饮水 ${waterLiters.toFixed(1)} L，还差约 ${waterGapMilliliters} ml。不需要临时提高训练强度。`
  } else if (studyPlan) {
    priorityTitle = `把${studyPlan.name}放进一个固定时间块。`
    priorityDetail = '今天更值得守住一次完整投入，而不是继续叠加新的学习任务。'
  } else if (nextPlan) {
    priorityTitle = `先完成${nextPlan.name}。`
    priorityDetail = `这是当前最早的一项待办，计划在 ${nextPlan.time}。`
  }

  const morningTitle = todayMeals.length > 0 ? '上午：保持常规记录' : '上午：先补一份早餐记录'
  const morningDetail =
    todayMeals.length > 0
      ? '早餐已经记录，不需要为了完整性额外补造数据。'
      : '只记录真实吃下的内容，不为了热量数字额外加餐。'

  const afternoonTitle = waterGapMilliliters > 0 ? `下午：补水 ${waterGapMilliliters} ml` : '下午：保持补水节奏'
  const afternoonDetail =
    waterGapMilliliters > 0
      ? '分成两次记录更容易完成，也能避免晚间集中饮水。'
      : '饮水已经达标，按口渴程度小口补充即可。'

  const eveningTitle = trainingPlan
    ? `晚间：守住${trainingPlan.name}`
    : studyPlan
      ? `晚间：完成${studyPlan.name}`
      : '晚间：做一次轻量复盘'
  const eveningDetail = trainingPlan
    ? '优先完成计划组数，不追求临时加重。'
    : studyPlan
      ? '完成既定内容即可，不为未完成的计划追加压力。'
      : '用两分钟记录精力和状态，再结束今天。'

  return (
    <PageSheet
      title="晨间简报"
      subtitle="结合昨日记录与今天的重要目标，给出一条低压力行动建议。"
      onClose={onClose}
      className="mock-detail-sheet"
    >
      <div className="mock-brief-lead">
        <span className="mock-brief-mark"><Icon name="spark" /></span>
        <div>
          <span>今日优先级</span>
          <h3>{priorityTitle}</h3>
          <p>{priorityDetail}</p>
        </div>
      </div>
      <div className="mock-kpi-grid">
        <div className="mock-kpi"><span>今日记录</span><strong>{recordCount} 条</strong><small>饮食、饮水、学习与训练</small></div>
        <div className="mock-kpi"><span>睡眠</span><strong>{sleepHours.toFixed(1)} h</strong><small>来自个人档案</small></div>
        <div className="mock-kpi"><span>饮水缺口</span><strong>{waterGapMilliliters} ml</strong><small>{waterGapMilliliters > 0 ? '建议午后补齐' : '今日已达标'}</small></div>
      </div>
      <div className="mock-detail-section">
        <div className="mock-detail-section-head">
          <span className="mock-section-mark"><Icon name="today" className="icon-sm" /></span>
          <div><h3>今天的建议节奏</h3><p>不增加额外负担，只把关键动作排进现实时间。</p></div>
        </div>
        <div className="mock-detail-list">
          <article className="mock-detail-row"><span className="mock-detail-index">01</span><div><strong>{morningTitle}</strong><p>{morningDetail}</p></div><span className="mock-detail-value">{todayMeals.length} 餐</span></article>
          <article className="mock-detail-row"><span className="mock-detail-index">02</span><div><strong>{afternoonTitle}</strong><p>{afternoonDetail}</p></div><span className="mock-detail-value">{waterGapMilliliters > 0 ? '2 次' : '已达标'}</span></article>
          <article className="mock-detail-row"><span className="mock-detail-index">03</span><div><strong>{eveningTitle}</strong><p>{eveningDetail}</p></div><span className="mock-detail-value">{studyMinutes > 0 ? `${studyMinutes + 20} min` : '20 min'}</span></article>
        </div>
      </div>
      <div className="surface-note"><Icon name="lock" className="icon-sm" /><span>这是前端 Mock 简报。接入 DeepSeek 后，仍会先展示摘要范围并遵循你的授权设置。</span></div>
    </PageSheet>
  )
}


export function EveningReviewSheet({
  initialReview,
  onSave,
  onClose,
}: {
  initialReview?: EveningReviewPayload | null
  onSave: (review: EveningReviewPayload) => void
  onClose: () => void
}) {
  const [energy, setEnergy] = useState(initialReview?.energy ?? 3)
  const [state, setState] = useState(initialReview?.state ?? '节奏稳定')
  const [note, setNote] = useState(initialReview?.note ?? '')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSave({ energy, state, note: note.trim() })
  }

  return (
    <PageSheet
      title="结束今日"
      subtitle="用一分钟留下精力、状态与一句备注，作为明日建议的上下文。"
      onClose={onClose}
      className="mock-detail-sheet"
    >
      <form className="surface-form" onSubmit={submit}>
        <label className="form-field">
          <span>今天结束时，精力如何？</span>
          <div className="mock-energy-scale" role="group" aria-label="今日精力">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                className={energy === value ? 'active' : ''}
                type="button"
                key={value}
                aria-pressed={energy === value}
                onClick={() => setEnergy(value)}
              >
                <strong>{value}</strong>
                <small>{value === 1 ? '耗尽' : value === 3 ? '一般' : value === 5 ? '充沛' : ''}</small>
              </button>
            ))}
          </div>
        </label>
        <label className="form-field">
          <span>整体状态</span>
          <select className="form-input" value={state} onChange={(event) => setState(event.target.value)}>
            <option>节奏稳定</option>
            <option>训练偏累</option>
            <option>专注度不错</option>
            <option>计划被打断</option>
            <option>需要早点休息</option>
          </select>
        </label>
        <label className="form-field">
          <span>今日备注</span>
          <textarea
            className="form-input"
            rows={4}
            placeholder="例如：下午状态一般，但完成了最重要的训练。"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="surface-note"><Icon name="lock" className="icon-sm" /><span>复盘只保存在当前 Mock 会话。正式版本会先让你确认 AI 可读取哪些内容。</span></div>
        <div className="surface-form-actions">
          <button className="btn quiet" type="button" onClick={onClose}>暂时不结束</button>
          <button className="btn primary" type="submit"><Icon name="check" className="icon-sm" />保存复盘</button>
        </div>
      </form>
    </PageSheet>
  )
}
