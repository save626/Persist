import type { Exercise, ExerciseKind, WorkoutSet } from '../types'

export const EXERCISE_KIND_LABELS: Record<ExerciseKind, string> = {
  strength: '力量',
  duration: '时长',
  distance: '距离',
}

export const EXERCISE_KIND_OPTIONS: ExerciseKind[] = ['strength', 'duration', 'distance']

export interface FitnessSummary {
  totalSets: number
  doneSets: number
  strengthVolume: number
  durationMinutes: number
  distanceKm: number
  averageRpe: number
  progress: number
}

export interface WorkoutSetDisplay {
  primaryLabel: string
  primaryValue: string
  secondaryLabel: string
  secondaryValue: string
}

export interface RecordedWorkout {
  exerciseName: string
  kind: ExerciseKind
  set: Omit<WorkoutSet, 'id' | 'done'>
}

export function isExerciseKind(value: unknown): value is ExerciseKind {
  return value === 'strength' || value === 'duration' || value === 'distance'
}

function positive(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function inferExerciseKind(
  exercise: Pick<Exercise, 'kind' | 'sets'>,
): ExerciseKind {
  if (isExerciseKind(exercise.kind)) return exercise.kind

  const sets = exercise.sets
  if (sets.some((set) => positive(set.distanceKm) > 0)) return 'distance'

  const hasStrengthValue = sets.some(
    (set) => set.weight !== undefined || set.reps !== undefined,
  )
  const hasDuration = sets.some((set) => positive(set.durationMinutes) > 0)
  if (hasDuration && !hasStrengthValue) return 'duration'

  return 'strength'
}

export function getExerciseKind(exercise: Pick<Exercise, 'kind' | 'sets'>): ExerciseKind {
  return inferExerciseKind(exercise)
}

export function summarizeFitness(exercises: Exercise[]): FitnessSummary {
  let totalSets = 0
  let doneSets = 0
  let strengthVolume = 0
  let durationMinutes = 0
  let distanceKm = 0
  let rpeTotal = 0
  let rpeCount = 0

  exercises.forEach((exercise) => {
    const kind = getExerciseKind(exercise)
    exercise.sets.forEach((set) => {
      totalSets += 1
      if (!set.done) return

      doneSets += 1
      if (typeof set.rpe === 'number' && Number.isFinite(set.rpe)) {
        rpeTotal += set.rpe
        rpeCount += 1
      }

      if (kind === 'strength') {
        strengthVolume += positive(set.weight) * positive(set.reps)
      } else {
        durationMinutes += positive(set.durationMinutes)
        if (kind === 'distance') distanceKm += positive(set.distanceKm)
      }
    })
  })

  return {
    totalSets,
    doneSets,
    strengthVolume,
    durationMinutes,
    distanceKm,
    averageRpe: rpeCount ? rpeTotal / rpeCount : 0,
    progress: totalSets ? (doneSets / totalSets) * 100 : 0,
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

export function describeWorkoutSet(
  exercise: Pick<Exercise, 'kind' | 'sets'> & { muscle?: string },
  set: WorkoutSet,
): WorkoutSetDisplay {
  const kind = getExerciseKind(exercise)

  if (kind === 'duration') {
    return {
      primaryLabel: '时长',
      primaryValue: `${formatNumber(positive(set.durationMinutes))} min`,
      secondaryLabel: '类型',
      secondaryValue: exercise.muscle || '运动',
    }
  }

  if (kind === 'distance') {
    return {
      primaryLabel: '距离',
      primaryValue: `${formatNumber(positive(set.distanceKm))} km`,
      secondaryLabel: '时长',
      secondaryValue: positive(set.durationMinutes)
        ? `${formatNumber(positive(set.durationMinutes))} min`
        : '—',
    }
  }

  return {
    primaryLabel: '重量',
    primaryValue: positive(set.weight) ? `${formatNumber(positive(set.weight))} kg` : '自重',
    secondaryLabel: '次数',
    secondaryValue: positive(set.reps) ? `${formatNumber(positive(set.reps))} 次` : '—',
  }
}

export function formatRecordedWorkout(
  kind: ExerciseKind,
  set: Omit<WorkoutSet, 'id' | 'done'>,
) {
  if (kind === 'duration') return `${formatNumber(positive(set.durationMinutes))} 分钟`
  if (kind === 'distance') {
    const distance = `${formatNumber(positive(set.distanceKm))} km`
    return positive(set.durationMinutes)
      ? `${distance} · ${formatNumber(positive(set.durationMinutes))} 分钟`
      : distance
  }

  const weight = positive(set.weight)
  const reps = positive(set.reps)
  return weight
    ? `${formatNumber(weight)} kg × ${formatNumber(reps)} 次`
    : `自重 × ${formatNumber(reps)} 次`
}

export function formatTrainingSummary(exercises: Exercise[]) {
  const summary = summarizeFitness(exercises)
  const parts = [`${exercises.length} 个动作`, `完成 ${summary.doneSets} 组`]

  if (summary.strengthVolume > 0) {
    parts.push(`力量容量 ${formatNumber(summary.strengthVolume)} kg`)
  }
  if (summary.durationMinutes > 0) {
    parts.push(`累计运动 ${formatNumber(summary.durationMinutes)} 分钟`)
  }
  if (summary.distanceKm > 0) {
    parts.push(`距离 ${formatNumber(summary.distanceKm)} km`)
  }

  return parts.join('，')
}