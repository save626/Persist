import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { EvidenceSheet } from '../components/EvidenceSheet'
import { Icon } from '../components/Icon'
import { PageSheet } from '../components/PageSheet'
import { useMockData } from '../context/mock-data-context'
import { useUI } from '../context/ui-context'
import {
  EXERCISE_KIND_LABELS,
  EXERCISE_KIND_OPTIONS,
  describeWorkoutSet,
  formatRecordedWorkout,
  formatTrainingSummary,
  getExerciseKind,
  summarizeFitness,
  type RecordedWorkout,
} from '../lib/fitness'
import {
  buildHistorySessions,
  type HistorySessionRow,
  type HistorySetRow,
} from '../lib/fitness-history'
import { useNewRecordParam } from '../lib/use-new-record-param'
import type {
  Exercise,
  ExerciseKind,
  ExerciseTemplate,
  FitnessSessionState,
  SessionStatus,
} from '../types'

interface WorkoutTemplate {
  id: string
  name: string
  planName: string
  focus: string
  equipment: string
  duration: number
  description: string
  exercises: Exercise[]
}

const INITIAL_EXERCISES: Exercise[] = [
  {
    id: 'bench-press',
    name: '杠铃平板卧推',
    muscle: '胸',
    equipment: '杠铃',
    targetReps: '8–10 次',
    rest: '90 秒',
    sets: [
      { id: 'bench-1', weight: 60, reps: 8, rpe: 7, done: true },
      { id: 'bench-2', weight: 60, reps: 8, rpe: 7.5, done: true },
      { id: 'bench-3', weight: 60, reps: 7, rpe: 8, done: true },
      { id: 'bench-4', weight: 60, reps: 8, rpe: 8, done: false },
    ],
  },
  {
    id: 'incline-press',
    name: '上斜哑铃卧推',
    muscle: '胸 / 肩前束',
    equipment: '哑铃',
    targetReps: '10–12 次',
    rest: '75 秒',
    sets: [
      { id: 'incline-1', weight: 22.5, reps: 10, done: false },
      { id: 'incline-2', weight: 22.5, reps: 10, done: false },
      { id: 'incline-3', weight: 22.5, reps: 9, done: false },
    ],
  },
  {
    id: 'cable-pushdown',
    name: '绳索下压',
    muscle: '三头',
    equipment: '绳索',
    targetReps: '12–15 次',
    rest: '60 秒',
    sets: [
      { id: 'pushdown-1', weight: 25, reps: 12, done: false },
      { id: 'pushdown-2', weight: 25, reps: 12, done: false },
      { id: 'pushdown-3', weight: 25, reps: 11, done: false },
    ],
  },
  {
    id: 'lateral-raise',
    name: '哑铃侧平举',
    muscle: '肩中束',
    equipment: '哑铃',
    targetReps: '15 次',
    rest: '45 秒',
    sets: [
      { id: 'lateral-1', weight: 8, reps: 15, done: false },
      { id: 'lateral-2', weight: 8, reps: 15, done: false },
      { id: 'lateral-3', weight: 8, reps: 14, done: false },
      { id: 'lateral-4', weight: 8, reps: 12, done: false },
    ],
  },
]

const EXERCISE_LIBRARY: ExerciseTemplate[] = [
  {
    id: 'pec-fly',
    name: '绳索夹胸',
    kind: 'strength',
    muscle: '胸',
    equipment: '绳索',
    targetReps: '12–15 次',
    rest: '60 秒',
    setCount: 3,
    weight: 15,
    reps: 12,
  },
  {
    id: 'shoulder-press',
    name: '坐姿哑铃推肩',
    kind: 'strength',
    muscle: '肩',
    equipment: '哑铃',
    targetReps: '8–10 次',
    rest: '75 秒',
    setCount: 3,
    weight: 16,
    reps: 10,
  },
  {
    id: 'pull-up',
    name: '辅助引体向上',
    kind: 'strength',
    muscle: '背',
    equipment: '器械',
    targetReps: '6–8 次',
    rest: '90 秒',
    setCount: 4,
    weight: 25,
    reps: 8,
  },
  {
    id: 'goblet-squat',
    name: '高脚杯深蹲',
    kind: 'strength',
    muscle: '腿',
    equipment: '哑铃',
    targetReps: '10–12 次',
    rest: '90 秒',
    setCount: 3,
    weight: 20,
    reps: 12,
  },
  {
    id: 'outdoor-run',
    name: '跑步',
    kind: 'distance',
    muscle: '有氧',
    equipment: '跑鞋',
    targetReps: '5 km',
    rest: '按需',
    setCount: 1,
    distanceKm: 5,
    durationMinutes: 30,
  },
  {
    id: 'jump-rope',
    name: '跳绳',
    kind: 'duration',
    muscle: '有氧',
    equipment: '跳绳',
    targetReps: '12 分钟',
    rest: '60 秒',
    setCount: 1,
    durationMinutes: 12,
  },
  {
    id: 'cycling',
    name: '骑行',
    kind: 'distance',
    muscle: '有氧',
    equipment: '自行车',
    targetReps: '10 km',
    rest: '按需',
    setCount: 1,
    distanceKm: 10,
    durationMinutes: 35,
  },
  {
    id: 'football',
    name: '足球',
    kind: 'duration',
    muscle: '球类',
    equipment: '球场',
    targetReps: '60 分钟',
    rest: '按需',
    setCount: 1,
    durationMinutes: 60,
  },
  {
    id: 'hiking',
    name: '爬山',
    kind: 'duration',
    muscle: '户外',
    equipment: '登山鞋',
    targetReps: '90 分钟',
    rest: '按需',
    setCount: 1,
    durationMinutes: 90,
  },
]

const WEEK_VOLUME = [
  { day: '一', value: 62, label: '6,240 kg' },
  { day: '二', value: 0, label: '休息' },
  { day: '三', value: 74, label: '7,380 kg' },
  { day: '四', value: 46, label: '4,800 kg' },
  { day: '五', value: 82, label: '8,120 kg' },
  { day: '六', value: 0, label: '休息' },
  { day: '日', value: 58, label: '今日进行中' },
]

const MUSCLE_GROUPS = [
  { label: '胸部', value: 42 },
  { label: '肩部', value: 26 },
  { label: '三头', value: 20 },
  { label: '背部', value: 12 },
]

const WORKOUT_TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'upper-a',
    name: '上肢力量 A',
    planName: '上肢力量训练',
    focus: '胸 · 肩 · 三头',
    equipment: '杠铃 / 哑铃 / 绳索',
    duration: 45,
    description: '以卧推为主项，控制推举与手臂动作的完成质量。',
    exercises: INITIAL_EXERCISES,
  },
  {
    id: 'lower-b',
    name: '下肢力量 B',
    planName: '下肢力量训练',
    focus: '股四头 · 臀 · 后链',
    equipment: '杠铃 / 腿举机 / 哑铃',
    duration: 50,
    description: '深蹲与髋铰链并重，最后一组保留 1–2 次余力。',
    exercises: [
      {
        id: 'back-squat',
        name: '杠铃深蹲',
        muscle: '股四头 / 臀',
        equipment: '杠铃',
        targetReps: '6–8 次',
        rest: '120 秒',
        sets: [
          { id: 'squat-1', weight: 70, reps: 8, rpe: 7.5, done: false },
          { id: 'squat-2', weight: 70, reps: 8, rpe: 8, done: false },
          { id: 'squat-3', weight: 70, reps: 7, rpe: 8, done: false },
          { id: 'squat-4', weight: 70, reps: 6, rpe: 8.5, done: false },
        ],
      },
      {
        id: 'romanian-deadlift',
        name: '罗马尼亚硬拉',
        muscle: '腘绳肌 / 臀',
        equipment: '杠铃',
        targetReps: '8–10 次',
        rest: '90 秒',
        sets: [
          { id: 'rdl-1', weight: 60, reps: 10, done: false },
          { id: 'rdl-2', weight: 60, reps: 10, done: false },
          { id: 'rdl-3', weight: 60, reps: 9, done: false },
        ],
      },
      {
        id: 'leg-press',
        name: '腿举',
        muscle: '股四头 / 臀',
        equipment: '腿举机',
        targetReps: '12–15 次',
        rest: '75 秒',
        sets: [
          { id: 'leg-press-1', weight: 100, reps: 12, done: false },
          { id: 'leg-press-2', weight: 100, reps: 12, done: false },
          { id: 'leg-press-3', weight: 100, reps: 11, done: false },
        ],
      },
      {
        id: 'leg-curl',
        name: '坐姿腿弯举',
        muscle: '腘绳肌',
        equipment: '器械',
        targetReps: '12 次',
        rest: '60 秒',
        sets: [
          { id: 'leg-curl-1', weight: 35, reps: 12, done: false },
          { id: 'leg-curl-2', weight: 35, reps: 12, done: false },
          { id: 'leg-curl-3', weight: 35, reps: 11, done: false },
        ],
      },
    ],
  },
  {
    id: 'push-day',
    name: '推 · 胸肩三头',
    planName: '推日胸肩三头',
    focus: '胸 · 肩 · 三头',
    equipment: '杠铃 / 哑铃 / 绳索',
    duration: 50,
    description: '围绕水平推、垂直推和肩部孤立动作安排推日训练。',
    exercises: [
      {
        id: 'incline-barbell',
        name: '上斜杠铃卧推',
        muscle: '上胸 / 肩前束',
        equipment: '杠铃',
        targetReps: '8–10 次',
        rest: '90 秒',
        sets: [
          { id: 'incline-barbell-1', weight: 45, reps: 10, done: false },
          { id: 'incline-barbell-2', weight: 45, reps: 9, done: false },
          { id: 'incline-barbell-3', weight: 45, reps: 8, done: false },
        ],
      },
      {
        id: 'seated-shoulder',
        name: '坐姿哑铃推肩',
        muscle: '肩',
        equipment: '哑铃',
        targetReps: '8–10 次',
        rest: '75 秒',
        sets: [
          { id: 'shoulder-1', weight: 16, reps: 10, done: false },
          { id: 'shoulder-2', weight: 16, reps: 10, done: false },
          { id: 'shoulder-3', weight: 16, reps: 8, done: false },
        ],
      },
      {
        id: 'cable-fly',
        name: '绳索夹胸',
        muscle: '胸',
        equipment: '绳索',
        targetReps: '12–15 次',
        rest: '60 秒',
        sets: [
          { id: 'fly-1', weight: 15, reps: 12, done: false },
          { id: 'fly-2', weight: 15, reps: 12, done: false },
          { id: 'fly-3', weight: 15, reps: 12, done: false },
        ],
      },
    ],
  },
  {
    id: 'pull-day',
    name: '拉 · 背二头',
    planName: '拉日背二头',
    focus: '背 · 后肩 · 二头',
    equipment: '杠铃 / 器械 / 哑铃',
    duration: 50,
    description: '先完成垂直拉与水平拉，再用弯举补充手臂训练量。',
    exercises: [
      {
        id: 'assisted-pull-up',
        name: '辅助引体向上',
        muscle: '背阔肌',
        equipment: '辅助器械',
        targetReps: '6–8 次',
        rest: '90 秒',
        sets: [
          { id: 'pull-up-1', weight: 25, reps: 8, done: false },
          { id: 'pull-up-2', weight: 25, reps: 8, done: false },
          { id: 'pull-up-3', weight: 25, reps: 7, done: false },
          { id: 'pull-up-4', weight: 25, reps: 6, done: false },
        ],
      },
      {
        id: 'barbell-row',
        name: '杠铃划船',
        muscle: '中背 / 背阔肌',
        equipment: '杠铃',
        targetReps: '8–10 次',
        rest: '90 秒',
        sets: [
          { id: 'row-1', weight: 50, reps: 10, done: false },
          { id: 'row-2', weight: 50, reps: 9, done: false },
          { id: 'row-3', weight: 50, reps: 8, done: false },
        ],
      },
      {
        id: 'face-pull',
        name: '绳索面拉',
        muscle: '后肩 / 上背',
        equipment: '绳索',
        targetReps: '12–15 次',
        rest: '60 秒',
        sets: [
          { id: 'face-pull-1', weight: 15, reps: 15, done: false },
          { id: 'face-pull-2', weight: 15, reps: 15, done: false },
          { id: 'face-pull-3', weight: 15, reps: 14, done: false },
        ],
      },
      {
        id: 'dumbbell-curl',
        name: '哑铃弯举',
        muscle: '二头',
        equipment: '哑铃',
        targetReps: '10–12 次',
        rest: '60 秒',
        sets: [
          { id: 'curl-1', weight: 10, reps: 12, done: false },
          { id: 'curl-2', weight: 10, reps: 11, done: false },
          { id: 'curl-3', weight: 10, reps: 10, done: false },
        ],
      },
    ],
  },
]

const DEFAULT_ELAPSED_SECONDS = 12 * 60 + 48

function createFitnessSession(
  template: WorkoutTemplate = WORKOUT_TEMPLATES[0],
  elapsedSeconds = DEFAULT_ELAPSED_SECONDS,
): FitnessSessionState {
  return {
    activeTemplateId: template.id,
    exercises: cloneTemplateExercises(template),
    sessionStatus: 'active',
    elapsedSeconds,
  }
}

function cloneTemplateExercises(template: WorkoutTemplate) {
  return template.exercises.map((exercise) => ({
    ...exercise,
    id: `${template.id}-${exercise.id}`,
    sets: exercise.sets.map((set, index) => ({
      ...set,
      id: `${template.id}-${exercise.id}-${index + 1}`,
    })),
  }))
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function dateLabel() {
  const date = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
    .format(new Date())
    .replace(/\s/g, '')
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(new Date())
  return `${date} · ${weekday}`
}

const QUICK_MOVEMENTS: Array<{
  name: string
  kind: ExerciseKind
  durationMinutes?: number
  distanceKm?: number
}> = [
  { name: '跑步', kind: 'distance', durationMinutes: 30, distanceKm: 5 },
  { name: '跳绳', kind: 'duration', durationMinutes: 12 },
  { name: '骑行', kind: 'distance', durationMinutes: 35, distanceKm: 10 },
  { name: '足球', kind: 'duration', durationMinutes: 60 },
  { name: '爬山', kind: 'duration', durationMinutes: 90 },
]

function RecordSetSheet({
  exercises,
  initialExerciseId,
  onClose,
  onSave,
}: {
  exercises: Exercise[]
  initialExerciseId: string
  onClose: () => void
  onSave: (workout: RecordedWorkout) => void
}) {
  const initialExercise =
    exercises.find((exercise) => exercise.id === initialExerciseId) ?? exercises[0]
  const initialSet = initialExercise?.sets.at(-1)
  const [exerciseName, setExerciseName] = useState(initialExercise?.name ?? '')
  const [kind, setKind] = useState<ExerciseKind>(
    initialExercise ? getExerciseKind(initialExercise) : 'strength',
  )
  const [weight, setWeight] = useState(
    initialSet?.weight !== undefined ? String(initialSet.weight) : '',
  )
  const [reps, setReps] = useState(initialSet?.reps !== undefined ? String(initialSet.reps) : '')
  const [durationMinutes, setDurationMinutes] = useState(
    initialSet?.durationMinutes !== undefined ? String(initialSet.durationMinutes) : '',
  )
  const [distanceKm, setDistanceKm] = useState(
    initialSet?.distanceKm !== undefined ? String(initialSet.distanceKm) : '',
  )
  const [rpe, setRpe] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const prefillExercise = (exercise: Exercise) => {
    const previous = exercise.sets.at(-1)
    setKind(getExerciseKind(exercise))
    setWeight(previous?.weight !== undefined ? String(previous.weight) : '')
    setReps(previous?.reps !== undefined ? String(previous.reps) : '')
    setDurationMinutes(
      previous?.durationMinutes !== undefined ? String(previous.durationMinutes) : '',
    )
    setDistanceKm(previous?.distanceKm !== undefined ? String(previous.distanceKm) : '')
    setError('')
  }

  const handleNameChange = (value: string) => {
    setExerciseName(value)
    const matched = exercises.find(
      (exercise) => exercise.name.trim().toLowerCase() === value.trim().toLowerCase(),
    )
    if (matched) prefillExercise(matched)
  }

  const applyQuickMovement = (movement: (typeof QUICK_MOVEMENTS)[number]) => {
    setExerciseName(movement.name)
    const matched = exercises.find((exercise) => exercise.name === movement.name)
    if (matched) {
      prefillExercise(matched)
      return
    }
    setKind(movement.kind)
    setWeight('')
    setReps('')
    setDurationMinutes(
      movement.durationMinutes !== undefined ? String(movement.durationMinutes) : '',
    )
    setDistanceKm(movement.distanceKm !== undefined ? String(movement.distanceKm) : '')
    setError('')
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = exerciseName.trim()
    if (!trimmedName) {
      setError('请填写动作名称')
      return
    }

    const parsedRpe = rpe.trim() ? Number(rpe) : undefined
    if (
      parsedRpe !== undefined &&
      (!Number.isFinite(parsedRpe) || parsedRpe < 1 || parsedRpe > 10)
    ) {
      setError('RPE 应在 1 到 10 之间')
      return
    }

    if (kind === 'strength') {
      const parsedReps = Number(reps)
      const parsedWeight = weight.trim() ? Number(weight) : undefined
      if (!Number.isFinite(parsedReps) || parsedReps <= 0) {
        setError('请填写有效的次数')
        return
      }
      if (parsedWeight !== undefined && (!Number.isFinite(parsedWeight) || parsedWeight < 0)) {
        setError('重量不能小于 0，自重训练可留空')
        return
      }
      onSave({
        exerciseName: trimmedName,
        kind,
        set: { weight: parsedWeight, reps: parsedReps, rpe: parsedRpe },
      })
      return
    }

    if (kind === 'duration') {
      const parsedDuration = Number(durationMinutes)
      if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
        setError('请填写有效的运动时长')
        return
      }
      onSave({
        exerciseName: trimmedName,
        kind,
        set: { durationMinutes: parsedDuration, rpe: parsedRpe },
      })
      return
    }

    const parsedDistance = Number(distanceKm)
    const parsedDuration = durationMinutes.trim() ? Number(durationMinutes) : undefined
    if (!Number.isFinite(parsedDistance) || parsedDistance <= 0) {
      setError('请填写有效的运动距离')
      return
    }
    if (parsedDuration !== undefined && (!Number.isFinite(parsedDuration) || parsedDuration <= 0)) {
      setError('运动时长必须大于 0，或留空')
      return
    }
    onSave({
      exerciseName: trimmedName,
      kind,
      set: { distanceKm: parsedDistance, durationMinutes: parsedDuration, rpe: parsedRpe },
    })
  }

  return (
    <div
      className="backdrop open"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="sheet fit-record-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recordSetTitle"
        onSubmit={handleSubmit}
      >
        <div className="handle" />
        <div className="sheet-head">
          <div>
            <h2 id="recordSetTitle">记录运动</h2>
            <p className="fit-sheet-sub">
              可自由填写动作名称，也可记录跑步、骑行、跳绳等非力量运动。
            </p>
          </div>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={onClose}>
            <Icon name="close" className="icon-sm" />
          </button>
        </div>

        <div className="fit-record-form">
          <label className="form-field">
            <span>动作名称</span>
            <input
              className="form-input"
              list="fitness-record-exercise-options"
              placeholder="例如：周末爬山、夜跑、足球"
              value={exerciseName}
              onChange={(event) => handleNameChange(event.target.value)}
              autoFocus
            />
            <datalist id="fitness-record-exercise-options">
              {exercises.map((exercise) => (
                <option key={exercise.id} value={exercise.name} />
              ))}
            </datalist>
          </label>

          <div className="fit-quick-picks" aria-label="运动快捷填入">
            <span>快捷填入</span>
            {QUICK_MOVEMENTS.map((movement) => (
              <button
                type="button"
                key={movement.name}
                onClick={() => applyQuickMovement(movement)}
              >
                {movement.name}
              </button>
            ))}
          </div>

          <div className="form-field">
            <span>记录方式</span>
            <div className="segmented fit-kind-segmented" role="group" aria-label="记录方式">
              {EXERCISE_KIND_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option}
                  className={kind === option ? 'active' : ''}
                  aria-pressed={kind === option}
                  onClick={() => {
                    setKind(option)
                    setError('')
                  }}
                >
                  {EXERCISE_KIND_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="fit-record-grid">
            {kind === 'strength' && (
              <>
                <label className="form-field">
                  <span>重量 / kg</span>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    step="0.5"
                    inputMode="decimal"
                    placeholder="自重可留空"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>次数</span>
                  <input
                    className="form-input"
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={reps}
                    onChange={(event) => setReps(event.target.value)}
                  />
                </label>
              </>
            )}

            {kind === 'duration' && (
              <label className="form-field">
                <span>时长 / min</span>
                <input
                  className="form-input"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="decimal"
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(event.target.value)}
                />
              </label>
            )}

            {kind === 'distance' && (
              <>
                <label className="form-field">
                  <span>距离 / km</span>
                  <input
                    className="form-input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={distanceKm}
                    onChange={(event) => setDistanceKm(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>运动时长 / min（可选）</span>
                  <input
                    className="form-input"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="decimal"
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(event.target.value)}
                  />
                </label>
              </>
            )}

            <label className="form-field">
              <span>RPE（可选）</span>
              <input
                className="form-input"
                type="number"
                min="1"
                max="10"
                step="0.5"
                inputMode="decimal"
                placeholder="7.5"
                value={rpe}
                onChange={(event) => setRpe(event.target.value)}
              />
            </label>
          </div>

          {error && (
            <p className="fit-form-error" role="alert">
              {error}
            </p>
          )}

          <div className="form-actions">
            <button className="btn secondary" type="button" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" type="submit">
              保存记录
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function templateMetric(template: ExerciseTemplate) {
  const kind = template.kind ?? 'strength'
  if (kind === 'duration') return `${template.durationMinutes ?? 0} min`
  if (kind === 'distance') return `${template.distanceKm ?? 0} km`
  return template.weight !== undefined ? `${template.weight} kg` : '自重'
}

function AddExerciseSheet({
  onClose,
  onAdd,
}: {
  onClose: () => void
  onAdd: (template: ExerciseTemplate) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ExerciseKind>('strength')
  const [weight, setWeight] = useState('20')
  const [reps, setReps] = useState('10')
  const [durationMinutes, setDurationMinutes] = useState('30')
  const [distanceKm, setDistanceKm] = useState('5')
  const [setCount, setSetCount] = useState('1')
  const [error, setError] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = name.trim()
    const parsedSetCount = Number(setCount)
    if (!trimmedName) {
      setError('请填写动作名称')
      return
    }
    if (!Number.isInteger(parsedSetCount) || parsedSetCount < 1 || parsedSetCount > 20) {
      setError('计划组数应为 1 到 20 之间的整数')
      return
    }

    let targetReps = ''
    let parsedWeight: number | undefined
    let parsedReps: number | undefined
    let parsedDuration: number | undefined
    let parsedDistance: number | undefined

    if (kind === 'strength') {
      parsedReps = Number(reps)
      parsedWeight = weight.trim() ? Number(weight) : undefined
      if (!Number.isFinite(parsedReps) || parsedReps <= 0) {
        setError('请填写有效的目标次数')
        return
      }
      if (parsedWeight !== undefined && (!Number.isFinite(parsedWeight) || parsedWeight < 0)) {
        setError('重量不能小于 0，自重训练可留空')
        return
      }
      targetReps = `${parsedReps} 次`
    } else if (kind === 'duration') {
      parsedDuration = Number(durationMinutes)
      if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
        setError('请填写有效的运动时长')
        return
      }
      targetReps = `${parsedDuration} 分钟`
    } else {
      parsedDistance = Number(distanceKm)
      parsedDuration = durationMinutes.trim() ? Number(durationMinutes) : undefined
      if (!Number.isFinite(parsedDistance) || parsedDistance <= 0) {
        setError('请填写有效的目标距离')
        return
      }
      targetReps = `${parsedDistance} km`
    }

    onAdd({
      id: `custom-${Date.now()}`,
      name: trimmedName,
      kind,
      muscle: kind === 'strength' ? '自定义力量' : kind === 'duration' ? '时长运动' : '距离运动',
      equipment: '自定义',
      targetReps,
      rest: '按需',
      setCount: parsedSetCount,
      weight: parsedWeight,
      reps: parsedReps,
      durationMinutes: parsedDuration,
      distanceKm: parsedDistance,
    })
  }

  return (
    <div
      className="backdrop open"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="sheet fit-library-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exerciseLibraryTitle"
      >
        <div className="handle" />
        <div className="sheet-head">
          <div>
            <h2 id="exerciseLibraryTitle">添加训练动作</h2>
            <p className="fit-sheet-sub">动作名称可自由填写；下方常用动作仅用于快捷添加。</p>
          </div>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={onClose}>
            <Icon name="close" className="icon-sm" />
          </button>
        </div>

        <form className="fit-custom-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>动作名称</span>
            <input
              className="form-input"
              placeholder="例如：周末爬山、夜跑、和朋友踢球"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError('')
              }}
            />
          </label>

          <div className="form-field">
            <span>记录方式</span>
            <div className="segmented fit-kind-segmented" role="group" aria-label="记录方式">
              {EXERCISE_KIND_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option}
                  className={kind === option ? 'active' : ''}
                  aria-pressed={kind === option}
                  onClick={() => {
                    setKind(option)
                    setError('')
                  }}
                >
                  {EXERCISE_KIND_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="fit-record-grid">
            {kind === 'strength' && (
              <>
                <label className="form-field">
                  <span>默认重量 / kg</span>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    step="0.5"
                    inputMode="decimal"
                    placeholder="自重可留空"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>目标次数</span>
                  <input
                    className="form-input"
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={reps}
                    onChange={(event) => setReps(event.target.value)}
                  />
                </label>
              </>
            )}

            {kind === 'duration' && (
              <label className="form-field">
                <span>目标时长 / min</span>
                <input
                  className="form-input"
                  type="number"
                  min="1"
                  inputMode="decimal"
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(event.target.value)}
                />
              </label>
            )}

            {kind === 'distance' && (
              <>
                <label className="form-field">
                  <span>目标距离 / km</span>
                  <input
                    className="form-input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={distanceKm}
                    onChange={(event) => setDistanceKm(event.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>预计时长 / min</span>
                  <input
                    className="form-input"
                    type="number"
                    min="1"
                    inputMode="decimal"
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(event.target.value)}
                  />
                </label>
              </>
            )}

            <label className="form-field">
              <span>计划组数 / 次</span>
              <input
                className="form-input"
                type="number"
                min="1"
                max="20"
                inputMode="numeric"
                value={setCount}
                onChange={(event) => setSetCount(event.target.value)}
              />
            </label>
          </div>

          {error && (
            <p className="fit-form-error" role="alert">
              {error}
            </p>
          )}

          <div className="form-actions">
            <button className="btn secondary" type="button" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" type="submit">
              加入今日动作
            </button>
          </div>
        </form>

        <div className="fit-library-divider">
          <div>
            <h3>常用快捷添加</h3>
            <p>沿用已有训练结构，或直接加入一项户外运动。</p>
          </div>
        </div>

        <div className="fit-library-list">
          {EXERCISE_LIBRARY.map((template) => {
            const kind = template.kind ?? 'strength'
            return (
              <button
                className="fit-library-row"
                type="button"
                key={template.id}
                onClick={() => onAdd(template)}
              >
                <span className="fit-library-icon">
                  <Icon name="fitness" />
                </span>
                <span className="fit-library-copy">
                  <strong>{template.name}</strong>
                  <small>
                    {EXERCISE_KIND_LABELS[kind]} · {template.muscle} · {template.setCount} 组
                  </small>
                </span>
                <span className="fit-library-weight">{templateMetric(template)}</span>
                <Icon name="plus" className="icon-sm" />
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
function FullHistorySheet({
  sessions,
  onSelect,
  onClose,
}: {
  sessions: HistorySessionRow[]
  onSelect: (session: HistorySessionRow) => void
  onClose: () => void
}) {
  return (
    <PageSheet
      title="训练历史"
      subtitle="选择一次训练，查看当时的动作、组数与主观强度。"
      onClose={onClose}
      className="mock-detail-sheet"
    >
      {sessions.length === 0 ? (
        <div className="surface-note">
          <Icon name="fitness" className="icon-sm" />
          <span>还没有训练记录。完成一次训练后，这里会出现当天的动作与组数。</span>
        </div>
      ) : (
        <div className="full-history-list">
          {sessions.map((session) => (
            <button
              className="full-history-row"
              type="button"
              key={session.id}
              onClick={() => onSelect(session)}
            >
              <span className="full-history-date">
                <strong>{session.date}</strong>
                <small>{session.weekday}</small>
              </span>
              <span className="full-history-copy">
                <strong>{session.title}</strong>
                <small>{session.detail}</small>
              </span>
              <span className="full-history-stats">
                <span>{session.duration}</span>
                <span>{session.sets}</span>
                <span>{session.volume}</span>
              </span>
              <Icon name="chev" className="icon-sm" />
            </button>
          ))}
        </div>
      )}
    </PageSheet>
  )
}

function setLineValues(set: HistorySetRow): string[] {
  const values: string[] = []
  if (set.weight !== undefined) values.push(`${set.weight} kg`)
  if (set.reps !== undefined) values.push(`${set.reps} 次`)
  if (set.durationMinutes !== undefined) values.push(`${set.durationMinutes} min`)
  if (set.distanceKm !== undefined) values.push(`${set.distanceKm} km`)
  return values
}

function HistoryDetailSheet({
  session,
  onClose,
}: {
  session: HistorySessionRow
  onClose: () => void
}) {
  const allSets = session.exercises.flatMap((exercise) => exercise.sets)
  const rpeSets = allSets.filter((set) => set.rpe !== undefined)
  const averageRpe = rpeSets.length
    ? (rpeSets.reduce((total, set) => total + (set.rpe ?? 0), 0) / rpeSets.length).toFixed(1)
    : '—'

  return (
    <PageSheet
      title={session.title}
      subtitle={`${session.date} · ${session.weekday} · ${session.detail}`}
      onClose={onClose}
      className="mock-detail-sheet"
    >
      <div className="history-detail-metrics">
        <div>
          <span>训练时长</span>
          <strong>{session.duration}</strong>
        </div>
        <div>
          <span>训练容量</span>
          <strong>{session.volume}</strong>
        </div>
        <div>
          <span>完成组数</span>
          <strong>{session.sets}</strong>
        </div>
        <div>
          <span>平均 RPE</span>
          <strong>{averageRpe}</strong>
        </div>
      </div>
      <div className="mock-detail-section">
        <div className="mock-detail-section-head">
          <span className="mock-section-mark">
            <Icon name="fitness" className="icon-sm" />
          </span>
          <div>
            <h3>动作与组数</h3>
            <p>力量组看重量与次数，有氧组看时长与距离；RPE 为当时记录的主观强度。</p>
          </div>
        </div>
        <div className="history-exercise-list">
          {session.exercises.map((exercise) => (
            <article className="history-exercise" key={exercise.name}>
              <div className="history-exercise-head">
                <strong>{exercise.name}</strong>
                <span>
                  {exercise.muscle} · {exercise.sets.length} 组
                </span>
              </div>
              <div className="history-set-lines">
                {exercise.sets.map((set, index) => (
                  <div className="history-set-line" key={`${exercise.name}-${index}`}>
                    <strong>#{index + 1}</strong>
                    {setLineValues(set).map((value) => (
                      <span key={value}>{value}</span>
                    ))}
                    <span>{set.rpe ? `RPE ${set.rpe}` : 'RPE —'}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
      <div className="surface-note">
        <Icon name="lock" className="icon-sm" />
        <span>这是完成训练时保存的真实记录，切换今日模板或应用新建议都不会改写它。</span>
      </div>
    </PageSheet>
  )
}
export function FitnessPage() {
  const { showToast } = useUI()
  const { setPlanItems, fitnessSession, setFitnessSession, archiveFitnessSession, fitnessHistory } =
    useMockData()
  const newRecord = useNewRecordParam()
  const initialSession = useMemo(() => createFitnessSession(), [])
  const session = fitnessSession ?? initialSession
  const activeTemplate =
    WORKOUT_TEMPLATES.find((template) => template.id === session.activeTemplateId) ??
    WORKOUT_TEMPLATES[0]
  const exercises = session.exercises
  const sessionStatus: SessionStatus = session.sessionStatus
  const elapsedSeconds = session.elapsedSeconds
  const updateSession = (updater: (current: FitnessSessionState) => FitnessSessionState) => {
    setFitnessSession((current) => updater(current ?? initialSession))
  }
  const [recordOpen, setRecordOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedHistory, setSelectedHistory] = useState<HistorySessionRow | null>(null)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [selectedExerciseId, setSelectedExerciseId] = useState('')

  // 历史列表由真实的完成记录派生：完成训练时已归档，刷新后仍然可读。
  const historySessions = useMemo(
    () => buildHistorySessions(fitnessHistory, WORKOUT_TEMPLATES),
    [fitnessHistory],
  )

  // 地址栏的 ?new=1 直接派生出「记录运动」弹层，不再用 effect 复制状态。
  const recordSheetOpen = recordOpen || newRecord.active
  const closeRecordSheet = () => {
    setRecordOpen(false)
    newRecord.clear()
  }

  useEffect(() => {
    if (sessionStatus !== 'active') return
    const timer = window.setInterval(() => {
      setFitnessSession((current) => {
        const base = current ?? initialSession
        return { ...base, elapsedSeconds: base.elapsedSeconds + 1 }
      })
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [initialSession, sessionStatus, setFitnessSession])

  const stats = useMemo(() => summarizeFitness(exercises), [exercises])

  const toggleSet = (exerciseId: string, setId: string) => {
    updateSession((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) =>
        exercise.id === exerciseId
          ? {
              ...exercise,
              sets: exercise.sets.map((set) =>
                set.id === setId ? { ...set, done: !set.done } : set,
              ),
            }
          : exercise,
      ),
    }))
  }

  const addSet = (exerciseId: string) => {
    updateSession((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => {
        if (exercise.id !== exerciseId) return exercise
        const previous = exercise.sets.at(-1)
        const kind = getExerciseKind(exercise)
        const nextSet =
          kind === 'duration'
            ? {
                durationMinutes: previous?.durationMinutes ?? 30,
                rpe: previous?.rpe,
              }
            : kind === 'distance'
              ? {
                  distanceKm: previous?.distanceKm ?? 5,
                  durationMinutes: previous?.durationMinutes,
                  rpe: previous?.rpe,
                }
              : {
                  weight: previous?.weight,
                  reps: previous?.reps ?? 10,
                  rpe: previous?.rpe,
                }
        return {
          ...exercise,
          sets: [
            ...exercise.sets,
            {
              id: `${exercise.id}-${exercise.sets.length + 1}-${Date.now()}`,
              ...nextSet,
              done: false,
            },
          ],
        }
      }),
    }))
    showToast('已加入一条记录，完成后记得勾选')
  }

  const openRecordSheet = (exerciseId = exercises[0]?.id ?? '') => {
    if (sessionStatus === 'completed') {
      showToast('今日训练已完成')
      return
    }
    setSelectedExerciseId(exerciseId)
    setRecordOpen(true)
  }

  const saveRecordedSet = (workout: RecordedWorkout) => {
    const normalizedName = workout.exerciseName.trim()
    const now = Date.now()

    updateSession((current) => {
      const existing = current.exercises.find(
        (exercise) =>
          exercise.name.trim().toLowerCase() === normalizedName.toLowerCase() &&
          getExerciseKind(exercise) === workout.kind,
      )

      if (existing) {
        return {
          ...current,
          exercises: current.exercises.map((exercise) =>
            exercise.id === existing.id
              ? {
                  ...exercise,
                  kind: workout.kind,
                  sets: [
                    ...exercise.sets,
                    {
                      id: `${exercise.id}-${exercise.sets.length + 1}-${now}`,
                      ...workout.set,
                      done: true,
                    },
                  ],
                }
              : exercise,
          ),
        }
      }

      const targetReps =
        workout.kind === 'strength'
          ? `${workout.set.reps ?? 0} 次`
          : workout.kind === 'duration'
            ? `${workout.set.durationMinutes ?? 0} 分钟`
            : `${workout.set.distanceKm ?? 0} km`
      const muscle =
        workout.kind === 'strength'
          ? '自定义力量'
          : workout.kind === 'duration'
            ? '时长运动'
            : '距离运动'

      return {
        ...current,
        exercises: [
          ...current.exercises,
          {
            id: `custom-${now}`,
            name: normalizedName,
            kind: workout.kind,
            muscle,
            equipment: '自定义',
            targetReps,
            rest: '按需',
            sets: [
              {
                id: `custom-set-${now}`,
                ...workout.set,
                done: true,
              },
            ],
          },
        ],
      }
    })
    closeRecordSheet()
    showToast(`已记录 ${formatRecordedWorkout(workout.kind, workout.set)} · ${normalizedName}`)
  }

  const addExercise = (template: ExerciseTemplate) => {
    const kind = template.kind ?? 'strength'
    const now = Date.now()
    updateSession((current) => ({
      ...current,
      exercises: [
        ...current.exercises,
        {
          id: `${template.id}-${now}`,
          name: template.name,
          kind,
          muscle: template.muscle,
          equipment: template.equipment,
          targetReps: template.targetReps,
          rest: template.rest,
          sets: Array.from({ length: template.setCount }, (_, index) => ({
            id: `${template.id}-${index + 1}-${now}`,
            ...(kind === 'strength'
              ? { weight: template.weight, reps: template.reps }
              : kind === 'duration'
                ? { durationMinutes: template.durationMinutes }
                : {
                    distanceKm: template.distanceKm,
                    durationMinutes: template.durationMinutes,
                  }),
            done: false,
          })),
        },
      ],
    }))
    setLibraryOpen(false)
    showToast(`已添加 ${template.name}`)
  }

  const applyTemplate = (template: WorkoutTemplate) => {
    if (template.id === activeTemplate.id) {
      showToast(`当前已使用 ${template.name}`)
      return
    }
    setFitnessSession(createFitnessSession(template, 0))
    setSelectedExerciseId('')
    setPlanItems((items) =>
      items.map((item) =>
        item.id === 'training'
          ? {
              ...item,
              name: template.planName,
              detail: `${template.duration} 分钟 · ${template.focus}`,
              done: false,
            }
          : item,
      ),
    )
    showToast(`已切换到 ${template.name}，当前训练已重置`)
  }

  const completeSession = () => {
    if (sessionStatus === 'completed') return
    if (stats.doneSets === 0) {
      showToast('至少完成一组后再结束训练')
      return
    }
    const completed: FitnessSessionState = { ...session, sessionStatus: 'completed' }
    setFitnessSession(completed)
    // 归档进训练历史：日期取完成当天，记录里保留当时的动作与套组快照。
    archiveFitnessSession(completed)
    setPlanItems((items) =>
      items.map((item) => (item.id === 'training' ? { ...item, done: true } : item)),
    )
    showToast(`训练完成 · ${formatTrainingSummary(exercises)}`)
  }

  return (
    <>
      <header className="head">
        <div className="heading">
          <div className="eyebrow">
            {dateLabel()} · {activeTemplate.name}
          </div>
          <h1>
            训练，留下
            <br />
            可见的进步。
          </h1>
          <p className="subtitle">自由记录力量、跑步、骑行或球类运动，让每一种投入都有迹可循。</p>
        </div>
        <div className="head-actions">
          <span className="status">
            <span className="dot" />
            {sessionStatus === 'active'
              ? `训练中 · ${formatElapsed(elapsedSeconds)}`
              : '今日训练已完成'}
          </span>
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              document.getElementById('templatesSection')?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
              })
              showToast('可在下方切换今日训练模板')
            }}
          >
            <Icon name="today" className="icon-sm" />
            训练模板
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={sessionStatus === 'completed'}
            onClick={completeSession}
          >
            <Icon name="check" className="icon-sm" />
            {sessionStatus === 'active' ? '完成训练' : '训练已完成'}
          </button>
        </div>
      </header>

      <section className="progress" aria-label="今日训练进度">
        <div className="progress-head">
          <span className="label">今日训练进度</span>
          <span className="count-note">
            {activeTemplate.name} · 计划 {activeTemplate.duration} 分钟
          </span>
        </div>
        <div className="metrics">
          <div className="metric">
            <div className="metric-title">
              <Icon name="check" className="icon-sm" />
              完成组数
            </div>
            <div className="metric-value">
              <span className="metric-number">
                {stats.doneSets} / {stats.totalSets}
              </span>
              <span className="metric-denom">组</span>
            </div>
            <div className="track">
              <span style={{ width: `${stats.progress}%` }} />
            </div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <Icon name="fitness" className="icon-sm" />
              力量容量
            </div>
            <div className="metric-value">
              <span className="metric-number">{stats.strengthVolume.toLocaleString('zh-CN')}</span>
              <span className="metric-denom">kg</span>
            </div>
            <div className="track">
              <span style={{ width: `${Math.min(100, stats.strengthVolume / 60)}%` }} />
            </div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <Icon name="clock" className="icon-sm" />
              运动时长
            </div>
            <div className="metric-value">
              <span className="metric-number">{stats.durationMinutes.toLocaleString('zh-CN')}</span>
              <span className="metric-denom">min</span>
            </div>
            <div className="track">
              <span style={{ width: `${Math.min(100, (stats.durationMinutes / 60) * 100)}%` }} />
            </div>
          </div>
          <div className="metric">
            <div className="metric-title">
              <Icon name="spark" className="icon-sm" />
              累计距离
            </div>
            <div className="metric-value">
              <span className="metric-number">{stats.distanceKm.toLocaleString('zh-CN')}</span>
              <span className="metric-denom">km</span>
            </div>
            <div className="track">
              <span style={{ width: `${Math.min(100, (stats.distanceKm / 10) * 100)}%` }} />
            </div>
          </div>
        </div>
      </section>

      <div className="fit-layout">
        <div className="fit-main-column">
          <section className="panel fit-session" aria-labelledby="todayWorkoutTitle">
            <div className="panel-head">
              <div>
                <div className="panel-title-row">
                  <h2 className="panel-title" id="todayWorkoutTitle">
                    今日动作
                  </h2>
                  <span className="badge">
                    {stats.doneSets} / {stats.totalSets}
                  </span>
                </div>
                <p className="panel-sub">力量、跑步、跳绳、骑行等运动都可以自由记录。</p>
              </div>
              <button
                className="btn primary fit-record-btn"
                type="button"
                disabled={sessionStatus === 'completed'}
                onClick={() => openRecordSheet()}
              >
                <Icon name="plus" className="icon-sm" />
                记录运动
              </button>
            </div>

            <div className="fit-session-meta">
              <div className="fit-meta-item">
                <span>训练重点</span>
                <strong>{activeTemplate.focus}</strong>
              </div>
              <div className="fit-meta-item">
                <span>器械条件</span>
                <strong>{activeTemplate.equipment}</strong>
              </div>
              <div className="fit-meta-item">
                <span>建议时长</span>
                <strong>{activeTemplate.duration} 分钟</strong>
              </div>
            </div>

            <div className="fit-exercise-stack">
              {exercises.map((exercise, exerciseIndex) => {
                const exerciseDone = exercise.sets.filter((set) => set.done).length
                const exerciseKind = getExerciseKind(exercise)
                const previewSet = exercise.sets[0] ?? { id: 'preview', done: false }
                const preview = describeWorkoutSet(exercise, previewSet)
                return (
                  <article className="fit-exercise" key={exercise.id}>
                    <header className="fit-exercise-head">
                      <span className="fit-exercise-index">
                        {String(exerciseIndex + 1).padStart(2, '0')}
                      </span>
                      <div className="fit-exercise-copy">
                        <div className="fit-exercise-title-row">
                          <h3>{exercise.name}</h3>
                          <span className="fit-kind-tag">{EXERCISE_KIND_LABELS[exerciseKind]}</span>
                          <span className="fit-muscle-tag">{exercise.muscle}</span>
                        </div>
                        <p>
                          {exerciseDone} / {exercise.sets.length} 组 · 目标 {exercise.targetReps} ·
                          休息 {exercise.rest}
                        </p>
                      </div>
                      <button
                        className="fit-add-set"
                        type="button"
                        disabled={sessionStatus === 'completed'}
                        onClick={() => addSet(exercise.id)}
                      >
                        <Icon name="plus" className="icon-sm" />
                        加一组
                      </button>
                    </header>

                    <div className="fit-set-table">
                      <div className="fit-set-head" aria-hidden="true">
                        <span>组</span>
                        <span>{preview.primaryLabel}</span>
                        <span>{preview.secondaryLabel}</span>
                        <span>强度</span>
                        <span>状态</span>
                      </div>
                      {exercise.sets.map((set, setIndex) => {
                        const display = describeWorkoutSet(exercise, set)
                        return (
                          <div
                            className={set.done ? 'fit-set-row done' : 'fit-set-row'}
                            key={set.id}
                          >
                            <span className="fit-set-index">{setIndex + 1}</span>
                            <span className="fit-set-number fit-set-primary">
                              <span className="fit-set-label">{display.primaryLabel}</span>
                              {display.primaryValue}
                            </span>
                            <span className="fit-set-number fit-set-secondary">
                              <span className="fit-set-label">{display.secondaryLabel}</span>
                              {display.secondaryValue}
                            </span>
                            <span className="fit-set-rpe">
                              <span className="fit-set-label">强度</span>
                              {set.rpe ? `RPE ${set.rpe}` : 'RPE —'}
                            </span>
                            <button
                              className="fit-set-check"
                              type="button"
                              aria-pressed={set.done}
                              aria-label={`${set.done ? '取消' : '标记'}${exercise.name}第 ${setIndex + 1} 组完成`}
                              onClick={() => toggleSet(exercise.id, set.id)}
                            >
                              <Icon name="check" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </article>
                )
              })}
            </div>

            <div className="fit-session-foot">
              <button className="link" type="button" onClick={() => setLibraryOpen(true)}>
                <Icon name="plus" className="icon-sm" />
                添加动作
              </button>
              <span>本次训练的所有修改会随本地数据一起保存</span>
            </div>
          </section>

          <section className="panel fit-history" aria-labelledby="trainingHistoryTitle">
            <div className="panel-head">
              <div>
                <h2 className="panel-title" id="trainingHistoryTitle">
                  最近训练
                </h2>
                <p className="panel-sub">回看完成度，也回看当时的状态。</p>
              </div>
              {historySessions.length > 0 && (
                <button className="btn quiet" type="button" onClick={() => setHistoryOpen(true)}>
                  查看全部
                  <Icon name="chev" className="icon-sm" />
                </button>
              )}
            </div>
            {historySessions.length === 0 ? (
              <div className="surface-note">
                <Icon name="fitness" className="icon-sm" />
                <span>还没有训练记录。完成一次训练后，这里会出现当天的动作与组数。</span>
              </div>
            ) : (
              <div className="fit-history-list">
                {historySessions.slice(0, 3).map((session) => (
                  <button
                    className="fit-history-row"
                    type="button"
                    key={session.id}
                    onClick={() => setSelectedHistory(session)}
                  >
                    <span className="fit-history-date">
                      <strong>{session.date}</strong>
                      <small>{session.weekday}</small>
                    </span>
                    <span className="fit-history-copy">
                      <strong>{session.title}</strong>
                      <small>{session.detail}</small>
                    </span>
                    <span className="fit-history-stats">
                      <span>{session.duration}</span>
                      <span>{session.sets}</span>
                      <span>{session.volume}</span>
                    </span>
                    <Icon name="chev" className="icon-sm" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="fit-side-column">
          <section className="panel fit-week" aria-labelledby="weeklyTrainingTitle">
            <div className="side-head">
              <div>
                <h2 id="weeklyTrainingTitle">近 7 天训练</h2>
                <p>观察节奏，不为中断制造压力。</p>
              </div>
              <span className="week-total">3 次</span>
            </div>
            <div className="fit-volume-chart" aria-label="近七天力量训练容量">
              {WEEK_VOLUME.map((day, index) => (
                <div
                  className={index === 6 ? 'fit-chart-day today' : 'fit-chart-day'}
                  key={day.day}
                >
                  <span className="fit-chart-bar-track" title={day.label}>
                    <span
                      className="fit-chart-bar"
                      style={{ height: `${Math.max(day.value, day.value === 0 ? 2 : 12)}%` }}
                    />
                  </span>
                  <span>{day.day}</span>
                </div>
              ))}
            </div>
            <div className="fit-week-foot">
              <span>本周力量容量</span>
              <strong>18,420 kg</strong>
              <span>比上周 +8%</span>
            </div>
          </section>

          <section className="panel fit-muscles" aria-labelledby="muscleTitle">
            <div className="side-head">
              <div>
                <h2 id="muscleTitle">训练分布</h2>
                <p>按本周已完成组数估算。</p>
              </div>
              <span className="fit-muscle-total">42 组</span>
            </div>
            <div className="fit-muscle-list">
              {MUSCLE_GROUPS.map((group) => (
                <div className="fit-muscle-row" key={group.label}>
                  <div>
                    <span>{group.label}</span>
                    <strong>{group.value}%</strong>
                  </div>
                  <span className="fit-muscle-track">
                    <span style={{ width: `${group.value}%` }} />
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="ai fit-ai" aria-labelledby="fitnessAiTitle">
            <div className="ai-top">
              <span className="ai-badge">
                <Icon name="spark" />
                训练观察
              </span>
              <span className="updated">基于本组记录</span>
            </div>
            <h2 id="fitnessAiTitle">{activeTemplate.name} 的动作节奏稳定，先把完成质量守住。</h2>
            <p>
              今天还剩 {stats.totalSets - stats.doneSets} 组。下一次继续维持当前重量与组数，
              不必为了容量提前加重量。
            </p>
            <div className="ai-foot">
              <span className="ai-source">Mock 建议 · 非医疗意见</span>
              <button className="link" type="button" onClick={() => setEvidenceOpen(true)}>
                查看依据
                <Icon name="chev" />
              </button>
            </div>
          </section>

          <section
            className="panel fit-templates"
            id="templatesSection"
            aria-labelledby="templatesTitle"
          >
            <div className="side-head">
              <div>
                <h2 id="templatesTitle">常用模板</h2>
                <p>切换模板会重置今日训练，并同步今日计划。</p>
              </div>
            </div>
            <div className="fit-template-list">
              {WORKOUT_TEMPLATES.map((template) => {
                const totalSets = template.exercises.reduce(
                  (total, exercise) => total + exercise.sets.length,
                  0,
                )
                return (
                  <button
                    className={
                      template.id === activeTemplate.id
                        ? 'fit-template-row active'
                        : 'fit-template-row'
                    }
                    type="button"
                    key={template.id}
                    aria-pressed={template.id === activeTemplate.id}
                    onClick={() => applyTemplate(template)}
                  >
                    <span className="fit-template-icon">
                      <Icon name="fitness" className="icon-sm" />
                    </span>
                    <span>
                      <strong>{template.name}</strong>
                      <small>
                        {template.exercises.length} 个动作 · {totalSets} 组 · {template.duration}{' '}
                        分钟
                      </small>
                    </span>
                    <Icon name="chev" className="icon-sm" />
                  </button>
                )
              })}
            </div>
          </section>
        </aside>
      </div>

      {recordSheetOpen && (
        <RecordSetSheet
          exercises={exercises}
          initialExerciseId={selectedExerciseId}
          onClose={closeRecordSheet}
          onSave={saveRecordedSet}
        />
      )}
      {libraryOpen && (
        <AddExerciseSheet onClose={() => setLibraryOpen(false)} onAdd={addExercise} />
      )}
      {historyOpen && (
        <FullHistorySheet
          sessions={historySessions}
          onClose={() => setHistoryOpen(false)}
          onSelect={(session) => {
            setHistoryOpen(false)
            setSelectedHistory(session)
          }}
        />
      )}
      {selectedHistory && (
        <HistoryDetailSheet session={selectedHistory} onClose={() => setSelectedHistory(null)} />
      )}
      {evidenceOpen && (
        <EvidenceSheet
          title="训练分析依据"
          subtitle="按今日动作、完成组数、力量容量、运动时长、距离与 RPE 汇总，仅用于解释当前 Mock 建议。"
          metrics={[
            {
              label: '完成组数',
              value: `${stats.doneSets} / ${stats.totalSets}`,
              detail: activeTemplate.name,
            },
            {
              label: '力量容量',
              value: `${stats.strengthVolume.toLocaleString('zh-CN')} kg`,
              detail: '仅统计已完成力量组',
            },
            {
              label: '运动时长',
              value: `${stats.durationMinutes.toLocaleString('zh-CN')} min`,
              detail: `本次会话 ${Math.floor(elapsedSeconds / 60)} min`,
            },
            {
              label: '累计距离',
              value: `${stats.distanceKm.toLocaleString('zh-CN')} km`,
              detail: '来自已完成距离运动',
            },
            {
              label: '平均 RPE',
              value: stats.averageRpe ? stats.averageRpe.toFixed(1) : '—',
              detail: '来自已完成且记录强度的组',
            },
          ]}
          items={[
            {
              title: '运动类型与完成结构',
              detail: `今天共有 ${exercises.length} 个动作，已完成 ${stats.doneSets} 组，仍有 ${stats.totalSets - stats.doneSets} 组待完成。`,
              value: `${stats.progress.toFixed(0)}%`,
            },
            {
              title: '运动量构成',
              detail:
                '力量容量只汇总已完成力量组的重量 × 次数；时长和距离来自已完成的有氧或户外运动，不会混用 kg。',
              value:
                [
                  stats.strengthVolume ? `${stats.strengthVolume.toLocaleString('zh-CN')} kg` : '',
                  stats.durationMinutes
                    ? `${stats.durationMinutes.toLocaleString('zh-CN')} min`
                    : '',
                  stats.distanceKm ? `${stats.distanceKm.toLocaleString('zh-CN')} km` : '',
                ]
                  .filter(Boolean)
                  .join(' · ') || '尚无完成记录',
            },
            {
              title: '当前模板',
              detail: `${activeTemplate.description} 训练重点为 ${activeTemplate.focus}，器械条件为 ${activeTemplate.equipment}。`,
              value: `${activeTemplate.duration} min`,
            },
            {
              title: '历史记录对照',
              detail:
                '最近的训练记录与平均 RPE 会作为后续 DeepSeek 建议的上下文，但不会上传原始备注。',
              value: `${historySessions.length} 次`,
            },
          ]}
          note="当前为前端 Mock 依据。正式接入 DeepSeek 后，只发送训练摘要与你授权的档案字段。"
          onClose={() => setEvidenceOpen(false)}
        />
      )}
    </>
  )
}
