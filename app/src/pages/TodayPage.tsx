import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import {
  EveningReviewSheet,
  MorningBriefSheet,
  PlanEditorSheet,
  TimelineSheet,
  type TimelineEvent,
} from '../components/TodaySheets'
import { useMockData } from '../context/mock-data-context'
import { useUI } from '../context/ui-context'
import { cn } from '../lib/cn'
import { formatCountdown } from '../lib/countdown'
import { summarizeFitness } from '../lib/fitness'
import { formatGoalDate, goalToTimestamp } from '../lib/goals'
import type { Goal, Meal, StudyRecord } from '../types'

function todayLabel() {
  const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date())
    .replace(/\s/g, '')
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(new Date())
  return `${date} · ${weekday}`
}

function dateInputValue(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function mealTotals(meal: Meal) {
  return meal.entries.reduce(
    (total, entry) => ({
      calories: total.calories + entry.calories,
      protein: total.protein + entry.protein,
      carbs: total.carbs + entry.carbs,
    }),
    { calories: 0, protein: 0, carbs: 0 },
  )
}

function studyRecordDetail(record: StudyRecord) {
  if (record.category === 'english') {
    const parts = [record.source, `新学 ${record.newWords ?? 0}`, `复习 ${record.reviewWords ?? 0}`]
    if (record.accuracy) parts.push(`正确率 ${record.accuracy}%`)
    return parts.join(' · ')
  }

  const parts = [record.source]
  if (record.chapter) parts.push(record.chapter)
  if (record.questions) parts.push(`${record.questions} 题`)
  if (record.wrong) parts.push(`错 ${record.wrong}`)
  return parts.join(' · ')
}

function GoalCard({
  goal,
  now,
  onEdit,
}: {
  goal: Goal
  now: number
  onEdit: (goal: Goal) => void
}) {
  const countdown = formatCountdown(goalToTimestamp(goal), now)
  const arrived = countdown === '已到达'
  return (
    <button
      className={cn('countdown', goal.tone === 'alt' && 'alt', !goal.enabled && 'is-disabled')}
      type="button"
      onClick={() => onEdit(goal)}
      aria-label={`编辑重要目标：${goal.title}`}
    >
      <span className="countdown-head">
        <span className="countdown-kind">
          <Icon name={goal.tone === 'alt' ? 'spark' : 'clock'} className="icon-sm" />
          重要目标
        </span>
        <span className="countdown-tag">{goal.id === 'goal-1' ? '目标 01' : '目标 02'}</span>
      </span>
      <span className="countdown-main">
        <span className="countdown-name">{goal.title}</span>
        {goal.enabled ? (
          <span className="countdown-time">
            <span>{countdown}</span>
            {!arrived && <span className="countdown-unit">后到达</span>}
          </span>
        ) : (
          <span className="countdown-time is-paused">已停用</span>
        )}
      </span>
      <span className="countdown-meta">
        <span>{formatGoalDate(goal)}</span>
        <span>{goal.enabled ? '自定义日期' : '仍会保留'}</span>
      </span>
    </button>
  )
}

function GoalEditor({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { updateGoal } = useMockData()
  const { showToast } = useUI()
  const [title, setTitle] = useState(goal.title)
  const [date, setDate] = useState(goal.date)
  const [time, setTime] = useState(goal.time)
  const [enabled, setEnabled] = useState(goal.enabled)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!title.trim() || !date || !time) return
    updateGoal(goal.id, { title: title.trim(), date, time, enabled })
    showToast('重要目标已更新')
    onClose()
  }

  return (
    <div
      className="backdrop open"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="sheet goal-editor"
        aria-labelledby="goalEditorTitle"
        role="dialog"
        aria-modal="true"
        onSubmit={handleSubmit}
      >
        <div className="handle" />
        <div className="sheet-head">
          <h2 id="goalEditorTitle">
            {goal.id === 'goal-1' ? '编辑重要目标 01' : '编辑重要目标 02'}
          </h2>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={onClose}>
            <Icon name="close" className="icon-sm" />
          </button>
        </div>
        <div className="goal-form">
          <label className="form-field">
            <span>目标名称</span>
            <input
              className="form-input"
              value={title}
              maxLength={24}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </label>
          <div className="form-grid">
            <label className="form-field">
              <span>目标日期</span>
              <input
                className="form-input"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>目标时间</span>
              <input
                className="form-input"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          </div>
          <label className="toggle-row">
            <span className="toggle-copy">
              <strong>在今日页启用此目标</strong>
              <small>关闭后仍保留目标与日期</small>
            </span>
            <input
              className="toggle-input"
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span className="toggle-ui" aria-hidden="true" />
          </label>
          <div className="form-actions">
            <button className="btn secondary" type="button" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" type="submit">
              保存目标
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export function TodayPage() {
  const {
    goals,
    planItems,
    setPlanItems,
    waterLiters,
    waterLog,
    meals,
    studyRecords,
    fitnessSession,
    profile,
    settings,
    aiConsent,
    eveningReview,
    setEveningReview,
  } = useMockData()
  const { openQuickRecord, showToast } = useUI()
  const navigate = useNavigate()
  const [now, setNow] = useState(() => Date.now())

  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [planEditorOpen, setPlanEditorOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const doneCount = planItems.filter((item) => item.done).length
  const planProgress = planItems.length ? (doneCount / planItems.length) * 100 : 0
  const waterProgress = Math.min(100, (waterLiters / 2) * 100)
  const waterDisplayLiters = (Math.round(waterLiters * 10) / 10).toFixed(1)
  const [dateLabel] = useState(() => todayLabel())
  const [calendar] = useState(() => {
    const today = dateInputValue()
    const week = Array.from({ length: 7 }, (_, index) => {
      const date = new Date()
      date.setHours(12, 0, 0, 0)
      date.setDate(date.getDate() - (6 - index))
      const dateKey = dateInputValue(date)
      return {
        dateKey,
        label: String(date.getDate()),
        isToday: dateKey === today,
      }
    })
    return { today, week }
  })
  const { today, week } = calendar
  const todayMeals = useMemo(() => meals.filter((meal) => meal.entries.length > 0), [meals])
  const todayStudyRecords = useMemo(
    () => studyRecords.filter((record) => record.date === today),
    [studyRecords, today],
  )
  const totalCalories = useMemo(
    () => todayMeals.reduce((total, meal) => total + mealTotals(meal).calories, 0),
    [todayMeals],
  )
  const studyMinutes = todayStudyRecords.reduce((total, record) => total + record.duration, 0)
  const studyProgress = Math.min(100, (studyMinutes / 90) * 100)
  const calorieProgress = Math.min(100, (totalCalories / 2_100) * 100)
  const fitnessMetrics = useMemo(() => {
    const exercises = fitnessSession?.exercises ?? []
    const summary = summarizeFitness(exercises)
    return {
      ...summary,
      elapsedMinutes: Math.max(0, Math.round((fitnessSession?.elapsedSeconds ?? 0) / 60)),
    }
  }, [fitnessSession])
  const waterRecordCount = waterLiters > 0 ? 1 + waterLog.length : waterLog.length
  const fitnessRecordCount = fitnessMetrics.doneSets > 0 ? 1 : 0
  const recordCount =
    todayMeals.length + todayStudyRecords.length + waterRecordCount + fitnessRecordCount
  const caloriesDisplay = totalCalories.toLocaleString('zh-CN')
  const waterGap = Math.max(0, 2 - waterLiters)
  const aiObservation =
    waterGap > 0.05
      ? `今天已记录 ${todayMeals.length} 餐、${studyMinutes} 分钟学习。饮水还差约 ${Math.round(waterGap * 1000)} ml，先分两次补齐，不需要临时增加训练强度。`
      : `今天已记录 ${todayMeals.length} 餐、${studyMinutes} 分钟学习，饮水已达到目标。接下来只需要守住训练和晚间学习质量。`
  const updatedAt = waterLog.at(-1)?.time ?? (todayStudyRecords[0]?.startTime || '08:10')
  const weekSummary = useMemo(() => {
    const bars = week.map(({ dateKey, label, isToday }) => {
      const hasStudy = studyRecords.some((record) => record.date === dateKey)
      const hasMeal = isToday && todayMeals.length > 0
      const hasWater = isToday && waterLiters > 0
      const hasFitness = isToday && fitnessMetrics.doneSets > 0
      const signalCount = [hasStudy, hasMeal, hasWater, hasFitness].filter(Boolean).length
      return {
        dateKey,
        label,
        height: signalCount > 0 ? Math.min(100, 18 + signalCount * 20) : 4,
        complete: signalCount > 0,
        isToday,
      }
    })
    return {
      bars,
      completeDays: bars.filter((bar) => bar.complete).length,
    }
  }, [fitnessMetrics.doneSets, studyRecords, todayMeals.length, waterLiters, week])

  const planEvents = useMemo<TimelineEvent[]>(
    () =>
      planItems.map<TimelineEvent>((item) => ({
        time: item.time,
        title: item.name,
        detail: item.detail,
        value: item.done ? '已完成' : '待完成',
        tone: item.actionable
          ? 'fitness'
          : item.kind === 'food'
            ? 'food'
            : item.kind === 'study'
              ? 'study'
              : item.kind === 'water'
                ? 'water'
                : 'default',
      })),
    [planItems],
  )

  const recordEvents = useMemo<TimelineEvent[]>(() => {
    const waterEvents: TimelineEvent[] =
      waterLiters > 0
        ? [
            {
              time: '15:40',
              title: '饮水',
              detail: `午后补水 · 今日累计 ${waterDisplayLiters} L`,
              value: '1.2 L',
              tone: 'water',
            },
            ...waterLog.map((entry) => ({
              time: entry.time,
              title: '饮水',
              detail: `今日累计 ${waterDisplayLiters} L`,
              value: `+${entry.milliliters} ml`,
              tone: 'water' as const,
            })),
          ]
        : []

    const mealEvents = todayMeals.map<TimelineEvent>((meal) => {
      const totals = mealTotals(meal)
      const foods = meal.entries
        .slice(0, 2)
        .map((entry) => entry.name)
        .join('、')
      return {
        time: meal.time,
        title: meal.label,
        detail: `${foods} · 蛋白质 ${totals.protein} g · 碳水 ${totals.carbs} g`,
        value: `${totals.calories} kcal`,
        tone: 'food',
      }
    })

    const studyEvents = todayStudyRecords.map<TimelineEvent>((record) => ({
      time: record.startTime,
      title: record.category === 'english' ? '英语学习' : '高数学习',
      detail: studyRecordDetail(record),
      value: `${record.duration} min`,
      tone: 'study',
    }))

    const fitnessEvents: TimelineEvent[] =
      fitnessMetrics.doneSets > 0
        ? [
            {
              time: '18:30',
              title: '训练记录',
              detail:
                `完成 ${fitnessMetrics.doneSets} / ${fitnessMetrics.totalSets} 组` +
                (fitnessMetrics.elapsedMinutes
                  ? ` · 会话 ${fitnessMetrics.elapsedMinutes} 分钟`
                  : '') +
                (fitnessMetrics.durationMinutes
                  ? ` · 运动 ${fitnessMetrics.durationMinutes} 分钟`
                  : '') +
                (fitnessMetrics.distanceKm
                  ? ` · 距离 ${fitnessMetrics.distanceKm.toLocaleString('zh-CN')} km`
                  : ''),
              value:
                fitnessSession?.sessionStatus === 'completed'
                  ? '已完成'
                  : [
                      fitnessMetrics.strengthVolume
                        ? `${fitnessMetrics.strengthVolume.toLocaleString('zh-CN')} kg`
                        : '',
                      fitnessMetrics.durationMinutes
                        ? `${fitnessMetrics.durationMinutes.toLocaleString('zh-CN')} min`
                        : '',
                      fitnessMetrics.distanceKm
                        ? `${fitnessMetrics.distanceKm.toLocaleString('zh-CN')} km`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || `${fitnessMetrics.doneSets} 组`,
              tone: 'fitness',
            },
          ]
        : []

    return [...waterEvents, ...mealEvents, ...studyEvents, ...fitnessEvents].sort((left, right) =>
      right.time.localeCompare(left.time),
    )
  }, [
    fitnessMetrics,
    fitnessSession?.sessionStatus,
    todayMeals,
    todayStudyRecords,
    waterDisplayLiters,
    waterLiters,
    waterLog,
  ])

  const timelineEvents = useMemo(
    () =>
      [...recordEvents, ...planEvents].sort((left, right) => right.time.localeCompare(left.time)),
    [planEvents, recordEvents],
  )

  const recentRecordEvents = recordEvents.slice(0, 4)

  const togglePlanItem = (id: string) => {
    setPlanItems((items) =>
      items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    )
  }

  return (
    <>
      <header className="head">
        <div className="heading">
          <div className="eyebrow">{dateLabel}</div>
          <h1>
            今天，先稳住
            <br />
            自己的节奏。
          </h1>
          <p className="subtitle">不必把一天塞满。完成真正重要的几件事，就已经很好。</p>
        </div>
        <div className="head-actions">
          <span className="status">
            <span className="dot" />
            进行中
          </span>
          <button className="btn secondary" type="button" onClick={() => setPlanEditorOpen(true)}>
            <Icon name="edit" className="icon-sm" />
            编辑计划
          </button>
          <button
            className="btn secondary today-report-action"
            type="button"
            onClick={() => navigate('/reports')}
          >
            <Icon name="spark" className="icon-sm" />
            AI 报告
          </button>
          <button className="btn primary" type="button" onClick={openQuickRecord}>
            <Icon name="plus" className="icon-sm" />
            快速记录
          </button>
        </div>
      </header>

      <section className="progress" aria-label="今日进度">
        <div className="progress-head">
          <span className="label">今日进度</span>
          <span className="count-note">今天已经留下 {recordCount} 条记录</span>
        </div>
        <div className="metrics">
          <div className="metric">
            <div className="metric-title">
              <Icon name="check" className="icon-sm" />
              计划完成
            </div>
            <div className="metric-value">
              <span className="metric-number">
                {doneCount} / {planItems.length}
              </span>
            </div>
            <div className="track">
              <span style={{ width: `${planProgress}%` }} />
            </div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <Icon name="food" className="icon-sm" />
              饮食摄入
            </div>
            <div className="metric-value">
              <span className="metric-number">{caloriesDisplay}</span>
              <span className="metric-denom">/ 2,100 kcal</span>
            </div>
            <div className="track">
              <span style={{ width: `${calorieProgress}%` }} />
            </div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <Icon name="water" className="icon-sm" />
              饮水
            </div>
            <div className="metric-value">
              <span className="metric-number">{waterDisplayLiters}</span>
              <span className="metric-denom">/ 2.0 L</span>
            </div>
            <div className="track">
              <span style={{ width: `${waterProgress}%` }} />
            </div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <Icon name="study" className="icon-sm" />
              学习
            </div>
            <div className="metric-value">
              <span className="metric-number">{studyMinutes}</span>
              <span className="metric-denom">/ 90 min</span>
            </div>
            <div className="track">
              <span style={{ width: `${studyProgress}%` }} />
            </div>
          </div>
        </div>
      </section>

      <section className="countdowns" aria-label="两个重要目标倒计时">
        {goals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} now={now} onEdit={setEditingGoal} />
        ))}
      </section>

      <div className="content">
        <div className="primary-column">
          <section className="panel plan-panel" aria-labelledby="planTitle">
            <div className="panel-head">
              <div>
                <div className="panel-title-row">
                  <h2 className="panel-title" id="planTitle">
                    今日安排
                  </h2>
                  <span className="badge">
                    {doneCount} / {planItems.length}
                  </span>
                </div>
                <p className="panel-sub">只保留真正重要的安排，剩下的留给生活。</p>
              </div>
              <button className="btn quiet" type="button" onClick={() => setPlanEditorOpen(true)}>
                调整
                <Icon name="chev" className="icon-sm" />
              </button>
            </div>
            <div className="plan-list">
              {planItems.map((item) => (
                <article className={item.done ? 'plan-item done' : 'plan-item'} key={item.id}>
                  <button
                    className="check"
                    type="button"
                    aria-label={`标记${item.name}`}
                    aria-pressed={item.done}
                    onClick={() => togglePlanItem(item.id)}
                  >
                    <Icon name="check" />
                  </button>
                  <div className="plan-copy">
                    <div className="plan-top">
                      <span className={`kind${item.kind === 'default' ? '' : ` ${item.kind}`}`} />
                      <span className="plan-name">{item.name}</span>
                      <span className="plan-time">{item.time}</span>
                    </div>
                    <p className="plan-detail">{item.detail}</p>
                  </div>
                  {item.actionable && !item.done && (
                    <button
                      className="start"
                      type="button"
                      onClick={() => navigate('/fitness?new=1')}
                    >
                      开始
                      <Icon name="chev" />
                    </button>
                  )}
                </article>
              ))}
            </div>
            <div className="plan-foot">
              <button className="link" type="button" onClick={() => setPlanEditorOpen(true)}>
                添加一项安排
                <Icon name="plus" />
              </button>
              <button className="link" type="button" onClick={() => navigate('/plans')}>
                长期计划
                <Icon name="chev" />
              </button>
            </div>
          </section>

          <section className="panel timeline-panel" aria-labelledby="timeTitle">
            <div className="panel-head">
              <div>
                <h2 className="panel-title" id="timeTitle">
                  最近记录
                </h2>
                <p className="panel-sub">不需要写得完整，真实比完美更有用。</p>
              </div>
              <button className="btn quiet" type="button" onClick={() => setTimelineOpen(true)}>
                查看全部
                <Icon name="chev" className="icon-sm" />
              </button>
            </div>
            <div className="timeline-list">
              {recentRecordEvents.length > 0 ? (
                recentRecordEvents.map((event, index) => (
                  <article className="event" key={`${event.time}-${event.title}-${index}`}>
                    <time>{event.time}</time>
                    <span className={`event-dot ${event.tone}`}>
                      <Icon
                        name={
                          event.tone === 'food'
                            ? 'food'
                            : event.tone === 'study'
                              ? 'study'
                              : event.tone === 'water'
                                ? 'water'
                                : 'fitness'
                        }
                      />
                    </span>
                    <div className="event-copy">
                      <div className="event-title">{event.title}</div>
                      <div className="event-desc">{event.detail}</div>
                    </div>
                    <span className="event-val">{event.value}</span>
                  </article>
                ))
              ) : (
                <div className="surface-note">
                  <Icon name="clock" className="icon-sm" />
                  <span>今天还没有记录。先完成一个最小动作，时间线会自动出现。</span>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="secondary-column">
          <section className="ai" aria-labelledby="aiTitle">
            <div className="ai-top">
              <span className="ai-badge">
                <Icon name="spark" />
                AI 观察
              </span>
              <span className="updated">{updatedAt} 更新</span>
            </div>
            <h2 id="aiTitle">把训练放在今天的第一优先级。</h2>
            <p>{aiObservation}</p>
            <div className="ai-foot">
              <span className="ai-source">基于今日 {recordCount} 条记录</span>
              <button className="link" type="button" onClick={() => setBriefOpen(true)}>
                晨间简报
                <Icon name="chev" />
              </button>
            </div>
          </section>

          <section className="panel week" aria-labelledby="weekTitle">
            <div className="side-head">
              <div>
                <h2 id="weekTitle">近 7 天记录</h2>
                <p>观察节奏，而不是追求全勤。</p>
              </div>
              <span className="week-total">{weekSummary.completeDays} / 7 天</span>
            </div>
            <div className="chart" aria-label="最近七天记录完整度">
              {weekSummary.bars.map((day) => (
                <div className={day.isToday ? 'day today' : 'day'} key={day.dateKey}>
                  <div className="bar-track">
                    <span className="bar" style={{ height: `${day.height}%` }} />
                  </div>
                  <span>{day.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="review" aria-labelledby="reviewTitle">
            <div className="review-kicker">
              <Icon name="clock" className="icon-sm" />
              晚间复盘
            </div>
            <h2 id="reviewTitle">
              {eveningReview ? '今天的复盘已经记录。' : '今天的记录，已经足够开始复盘。'}
            </h2>
            <p>
              {eveningReview
                ? `精力 ${eveningReview.energy} / 5 · ${eveningReview.state}${eveningReview.note ? ` · ${eveningReview.note}` : ''}`
                : '用 2 分钟补充精力和状态，再让 AI 帮你回看这一天。'}
            </p>
            <button className="review-btn" type="button" onClick={() => setReviewOpen(true)}>
              {eveningReview ? '更新今日复盘' : '结束今日'}
              <Icon name="chev" />
            </button>
          </section>
        </aside>
      </div>

      {editingGoal && <GoalEditor goal={editingGoal} onClose={() => setEditingGoal(null)} />}
      {planEditorOpen && (
        <PlanEditorSheet
          items={planItems}
          onClose={() => setPlanEditorOpen(false)}
          onSave={(items) => {
            setPlanItems(items)
            setPlanEditorOpen(false)
            showToast('今日计划已更新')
          }}
        />
      )}
      {timelineOpen && (
        <TimelineSheet events={timelineEvents} onClose={() => setTimelineOpen(false)} />
      )}
      {briefOpen && (
        <MorningBriefSheet
          planItems={planItems}
          waterLiters={waterLiters}
          waterLog={waterLog}
          meals={meals}
          studyRecords={studyRecords}
          fitnessSession={fitnessSession}
          sleepHours={profile.sleepHours}
          aiConsent={aiConsent}
          settings={settings}
          profile={profile}
          onClose={() => setBriefOpen(false)}
        />
      )}
      {reviewOpen && (
        <EveningReviewSheet
          initialReview={eveningReview}
          onClose={() => setReviewOpen(false)}
          onSave={(review) => {
            setEveningReview(review)
            setReviewOpen(false)
            showToast(`已保存今日复盘 · 精力 ${review.energy}/5`)
          }}
        />
      )}
    </>
  )
}
