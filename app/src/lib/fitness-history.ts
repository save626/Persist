import type { Exercise, FitnessSessionRecord, WorkoutSet } from '../types'
import { inferExerciseKind, summarizeFitness } from './fitness'
import { dateKeyLabel, sortFitnessHistoryDesc } from './history'

/**
 * 训练历史列表的视图模型（8d / 步骤 11）。
 *
 * 数据来源是 `fitnessHistory` 里的真实完成记录，不再是页面里的 `HISTORY` 演示常量。
 * 这里只做「记录 → 可渲染行」的纯计算，日期格式化、排序、空值兜底都放在这里，
 * 页面只负责渲染，便于单测覆盖（含训练中途未完成的组不应算进历史）。
 */

/** 历史明细里的一行组数据；按动作类型只填有意义的字段。 */
export interface HistorySetRow {
  weight?: number
  reps?: number
  durationMinutes?: number
  distanceKm?: number
  rpe?: number
}

export interface HistoryExerciseRow {
  name: string
  muscle: string
  sets: HistorySetRow[]
}

export interface HistorySessionRow {
  id: string
  date: string
  weekday: string
  title: string
  detail: string
  duration: string
  volume: string
  sets: string
  exercises: HistoryExerciseRow[]
}

/** 生成历史行时只需要模板 id 与名称，不依赖模板的完整定义。 */
export interface HistoryTemplateRef {
  id: string
  name: string
}

const MAX_DETAIL_EXERCISES = 3
const FALLBACK_TITLE = '自由训练'

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
}

/** 训练用时文案：不足 1 分钟按秒显示，避免「完成即 0 min」看不出真实情况。 */
export function formatSessionDuration(elapsedSeconds: number): string {
  const seconds = Math.max(0, Math.round(elapsedSeconds))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.round(seconds / 60)} min`
}

function setRow(kind: ReturnType<typeof inferExerciseKind>, set: WorkoutSet): HistorySetRow {
  if (kind === 'strength') {
    return { weight: set.weight, reps: set.reps, rpe: set.rpe }
  }
  if (kind === 'duration') {
    return { durationMinutes: set.durationMinutes, rpe: set.rpe }
  }
  return { distanceKm: set.distanceKm, durationMinutes: set.durationMinutes, rpe: set.rpe }
}

function doneExercises(exercises: Exercise[]): Exercise[] {
  return exercises
    .map((exercise) => ({ ...exercise, sets: exercise.sets.filter((set) => set.done) }))
    .filter((exercise) => exercise.sets.length > 0)
}

/**
 * 把完成记录转成历史列表行：最近完成在前；只统计已完成的组，
 * 模板被删除或 id 对不上时标题退回「自由训练」，不让整行消失。
 */
export function buildHistorySessions(
  records: FitnessSessionRecord[],
  templates: HistoryTemplateRef[],
): HistorySessionRow[] {
  return sortFitnessHistoryDesc(records).map((record) => {
    const exercises = doneExercises(record.exercises)
    const summary = summarizeFitness(exercises)
    const label = dateKeyLabel(record.date)
    const title = templates.find((template) => template.id === record.templateId)?.name
    const names = exercises.map((exercise) => exercise.name)
    const detail = names.length
      ? names.length > MAX_DETAIL_EXERCISES
        ? `${names.slice(0, MAX_DETAIL_EXERCISES).join(' · ')} 等 ${names.length} 个动作`
        : names.join(' · ')
      : FALLBACK_TITLE

    return {
      id: record.id,
      date: label.date,
      weekday: label.weekday,
      title: title ?? FALLBACK_TITLE,
      detail,
      duration: formatSessionDuration(record.elapsedSeconds),
      volume: summary.strengthVolume > 0 ? `${formatNumber(summary.strengthVolume)} kg` : '—',
      sets: `${summary.doneSets} 组`,
      exercises: exercises.map((exercise) => {
        const kind = inferExerciseKind(exercise)
        return {
          name: exercise.name,
          muscle: exercise.muscle,
          sets: exercise.sets.map((set) => setRow(kind, set)),
        }
      }),
    }
  })
}
