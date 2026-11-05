import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ConfirmDialog, PageSheet } from '../components/PageSheet'
import { useMockData } from '../context/mock-data-context'
import { useUI } from '../context/ui-context'
import { useNewRecordParam } from '../lib/use-new-record-param'
import type { StudyCategory, StudyRecord } from '../types'

type Filter = 'all' | StudyCategory

const DAILY_TARGET = 90

function todayInputValue(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const WEEK_TREND = [
  { label: '二', english: 28, math: 20 },
  { label: '三', english: 38, math: 28 },
  { label: '四', english: 30, math: 22 },
  { label: '五', english: 46, math: 34 },
  { label: '六', english: 40, math: 34 },
  { label: '一', english: 52, math: 36 },
  { label: '今天', english: 35, math: 20 },
]

function displayDate(value: string) {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date)
}

function categoryName(category: StudyCategory) {
  return category === 'english' ? '英语' : '高数'
}

const EMPTY_RECORD: StudyRecord = {
  id: '',
  category: 'english',
  source: '',
  date: todayInputValue(),
  startTime: '',
  duration: 30,
  note: '',
  newWords: 0,
  reviewWords: 0,
  accuracy: 0,
  listening: 0,
  chapter: '',
  questions: 0,
  wrong: 0,
}

function StudyEditor({
  record,
  onClose,
  onSave,
  onDelete,
}: {
  record: StudyRecord | null
  onClose: () => void
  onSave: (record: StudyRecord) => void
  onDelete?: () => void
}) {
  const [draft, setDraft] = useState<StudyRecord>(record ?? { ...EMPTY_RECORD })
  const [error, setError] = useState('')

  const patch = (values: Partial<StudyRecord>) => setDraft((current) => ({ ...current, ...values }))

  /** 来源是科目相关的（英语是单词书、高数是练习/错题），换科后旧来源留着会张冠李戴。 */
  const chooseCategory = (category: StudyCategory) => {
    if (category === draft.category) return
    patch({ category, source: '' })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft.source.trim()) {
      setError('请填写学习来源，例如百词斩、不背单词或高数练习。')
      return
    }
    if (!draft.date || !draft.startTime) {
      setError('请补全记录日期和开始时间。')
      return
    }
    if (!Number.isFinite(Number(draft.duration)) || Number(draft.duration) <= 0) {
      setError('学习时长需要大于 0 分钟。')
      return
    }
    if (draft.accuracy && (draft.accuracy < 0 || draft.accuracy > 100)) {
      setError('正确率需要在 0–100 之间。')
      return
    }
    onSave({
      ...draft,
      id: draft.id || `study-${Date.now()}`,
      source: draft.source.trim(),
      note: draft.note.trim(),
      duration: Math.round(Number(draft.duration)),
      newWords: Number(draft.newWords) || 0,
      reviewWords: Number(draft.reviewWords) || 0,
      accuracy: Number(draft.accuracy) || 0,
      listening: Number(draft.listening) || 0,
      questions: Number(draft.questions) || 0,
      wrong: Number(draft.wrong) || 0,
    })
  }

  return (
    <PageSheet
      title={record ? '编辑学习记录' : '新增学习记录'}
      subtitle="这里只记录投入与结果，不在 Persist 内重建单词书。"
      onClose={onClose}
      className="study-sheet"
    >
      <form className="surface-form" onSubmit={handleSubmit}>
        <div className="study-category-picker" role="group" aria-label="学习分类">
          {(['english', 'math'] as const).map((category) => (
            <button
              className={
                draft.category === category
                  ? 'study-category-option active'
                  : 'study-category-option'
              }
              type="button"
              key={category}
              onClick={() => chooseCategory(category)}
            >
              <span className="study-category-mark">
                <Icon name={category === 'english' ? 'study' : 'spark'} />
              </span>
              <span>
                <strong>{categoryName(category)}</strong>
                <small>{category === 'english' ? '单词、听力与真题' : '章节、题量与错题'}</small>
              </span>
              {draft.category === category && <Icon name="check" className="icon-sm" />}
            </button>
          ))}
        </div>

        <div className="surface-form-grid">
          <label className="form-field">
            <span>学习来源</span>
            <input
              className="form-input"
              value={draft.source}
              list="study-sources"
              placeholder={draft.category === 'english' ? '例如：百词斩' : '例如：高数练习'}
              onChange={(event) => patch({ source: event.target.value })}
            />
            <datalist id="study-sources">
              {draft.category === 'english' ? (
                <>
                  <option value="百词斩" />
                  <option value="不背单词" />
                  <option value="英语真题" />
                  <option value="听力精练" />
                </>
              ) : (
                <>
                  <option value="高数练习" />
                  <option value="错题整理" />
                  <option value="课程学习" />
                </>
              )}
            </datalist>
          </label>
          <label className="form-field">
            <span>学习时长 / min</span>
            <input
              className="form-input"
              type="number"
              min="1"
              inputMode="numeric"
              value={draft.duration}
              onChange={(event) => patch({ duration: Number(event.target.value) })}
            />
          </label>
          <label className="form-field">
            <span>日期</span>
            <input
              className="form-input"
              type="date"
              value={draft.date}
              onChange={(event) => patch({ date: event.target.value })}
            />
          </label>
          <label className="form-field">
            <span>开始时间</span>
            <input
              className="form-input"
              type="time"
              value={draft.startTime}
              onChange={(event) => patch({ startTime: event.target.value })}
            />
          </label>
        </div>

        {draft.category === 'english' ? (
          <div className="study-metric-form">
            <label className="form-field">
              <span>新学单词</span>
              <input
                className="form-input"
                type="number"
                min="0"
                inputMode="numeric"
                value={draft.newWords}
                onChange={(event) => patch({ newWords: Number(event.target.value) })}
              />
            </label>
            <label className="form-field">
              <span>复习单词</span>
              <input
                className="form-input"
                type="number"
                min="0"
                inputMode="numeric"
                value={draft.reviewWords}
                onChange={(event) => patch({ reviewWords: Number(event.target.value) })}
              />
            </label>
            <label className="form-field">
              <span>正确率 / %</span>
              <input
                className="form-input"
                type="number"
                min="0"
                max="100"
                inputMode="numeric"
                value={draft.accuracy}
                onChange={(event) => patch({ accuracy: Number(event.target.value) })}
              />
            </label>
            <label className="form-field">
              <span>听力 / min</span>
              <input
                className="form-input"
                type="number"
                min="0"
                inputMode="numeric"
                value={draft.listening}
                onChange={(event) => patch({ listening: Number(event.target.value) })}
              />
            </label>
          </div>
        ) : (
          <div className="study-metric-form">
            <label className="form-field study-chapter-field">
              <span>章节</span>
              <input
                className="form-input"
                value={draft.chapter}
                placeholder="例如：极限与连续"
                onChange={(event) => patch({ chapter: event.target.value })}
              />
            </label>
            <label className="form-field">
              <span>练习题量</span>
              <input
                className="form-input"
                type="number"
                min="0"
                inputMode="numeric"
                value={draft.questions}
                onChange={(event) => patch({ questions: Number(event.target.value) })}
              />
            </label>
            <label className="form-field">
              <span>错题数</span>
              <input
                className="form-input"
                type="number"
                min="0"
                inputMode="numeric"
                value={draft.wrong}
                onChange={(event) => patch({ wrong: Number(event.target.value) })}
              />
            </label>
          </div>
        )}

        <label className="form-field">
          <span>备注</span>
          <textarea
            className="form-input"
            value={draft.note}
            placeholder="记录状态、难点或需要复盘的内容（可选）"
            onChange={(event) => patch({ note: event.target.value })}
          />
        </label>

        {error && <p className="surface-error">{error}</p>}
        <div className="surface-note">
          <Icon name="lock" className="icon-sm" />
          <span>数据保存在本机浏览器（IndexedDB），清除站点数据或更换浏览器会丢失。</span>
        </div>
        <div className="surface-form-actions">
          {onDelete ? (
            <button className="study-form-delete" type="button" onClick={onDelete}>
              删除记录
            </button>
          ) : (
            <span />
          )}
          <div className="surface-form-actions-right">
            <button className="btn secondary" type="button" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" type="submit">
              {record ? '保存修改' : '添加记录'}
            </button>
          </div>
        </div>
      </form>
    </PageSheet>
  )
}

function recordDetail(record: StudyRecord) {
  if (record.category === 'english') {
    const values = [`新学 ${record.newWords ?? 0}`, `复习 ${record.reviewWords ?? 0}`]
    if (record.accuracy) values.push(`正确率 ${record.accuracy}%`)
    if (record.listening) values.push(`听力 ${record.listening} min`)
    return values.join(' · ')
  }
  return `${record.chapter || '未填写章节'} · 练习 ${record.questions ?? 0} 题 · 错题 ${record.wrong ?? 0} 道`
}

export function StudyPage() {
  const { showToast } = useUI()
  const { studyRecords: records, setStudyRecords: setRecords } = useMockData()
  const navigate = useNavigate()
  const newRecord = useNewRecordParam()
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<StudyRecord | 'new' | null>(null)
  const [deleting, setDeleting] = useState<StudyRecord | null>(null)
  const [aiOpen, setAiOpen] = useState(false)

  // 地址栏的 ?new=1 直接派生出「新建」表单，不再用 effect 复制状态。
  const sheetEditing: StudyRecord | 'new' | null = editing ?? (newRecord.active ? 'new' : null)
  const closeEditor = () => {
    setEditing(null)
    newRecord.clear()
  }

  const today = todayInputValue()
  const todayRecords = useMemo(
    () =>
      records
        .filter((record) => record.date === today)
        .sort((a, b) => b.startTime.localeCompare(a.startTime)),
    [records, today],
  )
  const visibleRecords = useMemo(
    () => todayRecords.filter((record) => filter === 'all' || record.category === filter),
    [filter, todayRecords],
  )
  const englishMinutes = todayRecords
    .filter((record) => record.category === 'english')
    .reduce((total, record) => total + record.duration, 0)
  const mathMinutes = todayRecords
    .filter((record) => record.category === 'math')
    .reduce((total, record) => total + record.duration, 0)
  const englishCount = todayRecords.filter((record) => record.category === 'english').length
  const mathCount = todayRecords.filter((record) => record.category === 'math').length
  const mathWrong = todayRecords.reduce((total, record) => total + (record.wrong ?? 0), 0)
  const totalMinutes = englishMinutes + mathMinutes
  const targetProgress = Math.min(100, (totalMinutes / DAILY_TARGET) * 100)
  const englishShare = totalMinutes ? Math.round((englishMinutes / totalMinutes) * 100) : 0
  const mathShare = totalMinutes ? 100 - englishShare : 0
  const recentRecords = records
    .filter((record) => record.date !== today)
    .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`))
    .slice(0, 4)
  const weekTrend = WEEK_TREND.map((day, index) =>
    index === WEEK_TREND.length - 1 ? { ...day, english: englishMinutes, math: mathMinutes } : day,
  )

  const saveRecord = (record: StudyRecord) => {
    const exists = records.some((item) => item.id === record.id)
    setRecords((current) =>
      exists
        ? current.map((item) => (item.id === record.id ? record : item))
        : [record, ...current],
    )
    showToast(exists ? '学习记录已更新' : '学习记录已添加')
    closeEditor()
  }

  return (
    <>
      <header className="head">
        <div className="heading">
          <div className="eyebrow">学习 · 统计记录</div>
          <h1>
            记录投入，
            <br />
            而不是追赶数字。
          </h1>
          <p className="subtitle">
            英语与高数统一记录。单词背诵继续在外部 App 完成，这里只留下结果和复盘线索。
          </p>
        </div>
        <div className="head-actions study-head-actions">
          <span className="study-status">
            <span />
            今日记录 {todayRecords.length} 条
          </span>
          <button className="btn primary" type="button" onClick={() => setEditing('new')}>
            <Icon name="plus" className="icon-sm" />
            新增记录
          </button>
        </div>
      </header>

      <section className="progress" aria-label="今日学习概览">
        <div className="progress-head">
          <span className="label">今日学习</span>
          <span className="count-note">目标 {DAILY_TARGET} min · Mock 数据</span>
        </div>
        <div className="metrics study-metrics">
          <div className="metric">
            <div className="metric-title">
              <Icon name="study" className="icon-sm" />
              累计投入
            </div>
            <div className="metric-value">
              <span className="metric-number">{totalMinutes}</span>
              <span className="metric-denom">/ {DAILY_TARGET} min</span>
            </div>
            <div className="metric-bar">
              <span style={{ width: `${targetProgress}%` }} />
            </div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <span className="study-dot english" />
              英语
            </div>
            <div className="metric-value">
              <span className="metric-number">{englishMinutes}</span>
              <span className="metric-denom">min</span>
            </div>
            <div className="study-metric-note">占今日 {englishShare}%</div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <span className="study-dot math" />
              高数
            </div>
            <div className="metric-value">
              <span className="metric-number">{mathMinutes}</span>
              <span className="metric-denom">min</span>
            </div>
            <div className="study-metric-note">错题 {mathWrong} 道</div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <Icon name="spark" className="icon-sm" />
              连续记录
            </div>
            <div className="metric-value">
              <span className="metric-number">7</span>
              <span className="metric-denom">天</span>
            </div>
            <div className="study-metric-note">保持真实，不补造数据</div>
          </div>
        </div>
      </section>

      <div className="study-layout">
        <div className="study-main-column">
          <section className="panel study-records-panel" aria-labelledby="studyRecordsTitle">
            <div className="panel-head study-panel-head">
              <div>
                <h2 className="panel-title" id="studyRecordsTitle">
                  今日时间线
                </h2>
                <p className="panel-sub">按实际完成时间记录，可随时修改来源与结果。</p>
              </div>
              <div className="segmented" aria-label="学习分类筛选">
                {(
                  [
                    ['all', '全部'],
                    ['english', '英语'],
                    ['math', '高数'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    className={filter === value ? 'active' : ''}
                    type="button"
                    key={value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {visibleRecords.length ? (
              <div className="study-timeline">
                {visibleRecords.map((record) => (
                  <article className="study-timeline-row" key={record.id}>
                    <time>{record.startTime}</time>
                    <span className={`study-line-dot ${record.category}`} />
                    <div className="study-record-main">
                      <div className="study-record-title">
                        <span className={`study-kind ${record.category}`}>
                          {categoryName(record.category)}
                        </span>
                        <strong>{record.source}</strong>
                        <span>{record.duration} min</span>
                      </div>
                      <p>{recordDetail(record)}</p>
                      {record.note && <small>{record.note}</small>}
                    </div>
                    <button
                      className="study-edit"
                      type="button"
                      aria-label={`编辑 ${record.source} 学习记录`}
                      onClick={() => setEditing(record)}
                    >
                      <Icon name="edit" className="icon-sm" />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="surface-empty study-empty">
                <Icon name="study" />
                <strong>这个分类今天还没有记录</strong>
                <p>切换分类查看其他记录，或补一条真实完成的学习投入。</p>
                <button className="btn secondary" type="button" onClick={() => setFilter('all')}>
                  查看全部记录
                </button>
              </div>
            )}
          </section>

          <section className="panel study-trend-panel" aria-labelledby="studyTrendTitle">
            <div className="panel-head">
              <div>
                <h2 className="panel-title" id="studyTrendTitle">
                  近 7 天趋势
                </h2>
                <p className="panel-sub">用投入变化观察节奏，不以单日高低评价状态。</p>
              </div>
              <span className="study-trend-total">
                本周 {weekTrend.reduce((total, day) => total + day.english + day.math, 0)} min
              </span>
            </div>
            <div className="study-chart">
              {weekTrend.map((day, index) => {
                const total = day.english + day.math
                return (
                  <div
                    className={
                      index === weekTrend.length - 1 ? 'study-chart-day today' : 'study-chart-day'
                    }
                    key={day.label}
                  >
                    <span className="study-chart-value">{total}</span>
                    <div className="study-chart-track">
                      <span className="study-chart-math" style={{ height: `${day.math}%` }} />
                      <span className="study-chart-english" style={{ height: `${day.english}%` }} />
                    </div>
                    <span>{day.label}</span>
                  </div>
                )
              })}
            </div>
            <div className="study-chart-legend">
              <span>
                <i className="english" />
                英语
              </span>
              <span>
                <i className="math" />
                高数
              </span>
            </div>
          </section>
        </div>

        <aside className="study-side-column">
          <section className="panel study-allocation" aria-labelledby="studyAllocationTitle">
            <div className="panel-head">
              <div>
                <h2 className="panel-title" id="studyAllocationTitle">
                  投入结构
                </h2>
                <p className="panel-sub">今日英语与高数的相对占比。</p>
              </div>
            </div>
            <div className="study-allocation-body">
              <div
                className="study-ring"
                style={{
                  background: `conic-gradient(var(--green) 0 ${englishShare}%, #b9c9d5 ${englishShare}% 100%)`,
                }}
              >
                <div>
                  <strong>{totalMinutes}</strong>
                  <span>min</span>
                </div>
              </div>
              <div className="study-allocation-list">
                <div>
                  <span>
                    <i className="english" />
                    英语
                  </span>
                  <strong>{englishShare}%</strong>
                  <small>{englishMinutes} min</small>
                </div>
                <div>
                  <span>
                    <i className="math" />
                    高数
                  </span>
                  <strong>{mathShare}%</strong>
                  <small>{mathMinutes} min</small>
                </div>
              </div>
            </div>
          </section>
          <section className="study-ai" aria-labelledby="studyAiTitle">
            <div className="study-ai-head">
              <span className="study-ai-icon">
                <Icon name="spark" />
              </span>
              <div>
                <span>Persist AI · 学习观察</span>
                <h2 id="studyAiTitle">今天已经足够形成一次小复盘。</h2>
              </div>
            </div>
            <p>
              {totalMinutes
                ? `今天已记录英语 ${englishMinutes} 分钟、高数 ${mathMinutes} 分钟。${mathWrong ? `高数错题共 ${mathWrong} 道，晚间复盘可以先整理错题，不必重做整套练习。` : '当前没有登记高数错题，可以按原计划结束学习。'}`
                : '今天还没有学习记录。先补一条真实投入，再让分析建立在可核对的数据上。'}
            </p>
            <button
              className="study-ai-toggle"
              type="button"
              onClick={() => setAiOpen((open) => !open)}
            >
              查看分析依据 <Icon name="chev" className={aiOpen ? 'icon-sm open' : 'icon-sm'} />
            </button>
            {aiOpen && (
              <div className="study-ai-evidence">
                <div>
                  <span>时间范围</span>
                  <strong>今天 00:00–现在</strong>
                </div>
                <div>
                  <span>使用记录</span>
                  <strong>
                    英语 {englishCount} 条 · 高数 {mathCount} 条
                  </strong>
                </div>
                <div>
                  <span>数据状态</span>
                  <strong>仅为前端 Mock 分析</strong>
                </div>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => navigate('/reports')}
                >
                  前往 AI 报告
                </button>
              </div>
            )}
          </section>

          <section className="panel study-recent" aria-labelledby="studyRecentTitle">
            <div className="panel-head">
              <div>
                <h2 className="panel-title" id="studyRecentTitle">
                  最近记录
                </h2>
                <p className="panel-sub">跨天回看，保留来源差异。</p>
              </div>
            </div>
            <div className="study-recent-list">
              {recentRecords.map((record) => (
                <button type="button" key={record.id} onClick={() => setEditing(record)}>
                  <span className={`study-recent-mark ${record.category}`}>
                    <Icon name="study" />
                  </span>
                  <span>
                    <strong>{record.source}</strong>
                    <small>
                      {displayDate(record.date)} · {categoryName(record.category)}
                    </small>
                  </span>
                  <span>
                    {record.duration}
                    <small> min</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {sheetEditing && (
        <StudyEditor
          key={sheetEditing === 'new' ? 'new' : sheetEditing.id}
          record={sheetEditing === 'new' ? null : sheetEditing}
          onClose={closeEditor}
          onSave={saveRecord}
          onDelete={sheetEditing === 'new' ? undefined : () => setDeleting(sheetEditing)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="删除这条学习记录？"
          description={`${categoryName(deleting.category)} · ${deleting.source} · ${deleting.duration} min。删除后只影响本机保存的数据。`}
          confirmLabel="删除记录"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            setRecords((current) => current.filter((record) => record.id !== deleting.id))
            setDeleting(null)
            closeEditor()
            showToast('学习记录已删除')
          }}
        />
      )}
    </>
  )
}
