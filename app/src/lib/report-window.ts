import type {
  DietDay,
  FitnessSessionRecord,
  FitnessSessionState,
  PlanItem,
  StudyRecord,
  WaterLogEntry,
} from '../types'
import { formatTrainingSummary, summarizeFitness } from './fitness'
import { isDateKeyInWindow, type DateWindow } from './history'

/**
 * 报告窗口事实（8d）：把「只看今天」的切片换成按日历史在窗口内的汇总。
 *
 * 这是报告页与 `ReportDigest` 的唯一数字来源，避免页面显示的计数
 * 和真正发给模型的摘要各算一套。窗口一律以「今天」为最后一天（`createDateWindow`）。
 *
 * 口径说明：
 * - 训练：`fitnessHistory` 中窗口内的归档记录全部计入；进行中的会话尚未归档，
 *   单独补一条（有完成组才算 1 次），完成后它会被归档，不会重复计数。
 * - 学习 / 饮食 / 饮水 / 计划：按 `date` 过滤，窗口外的一律不参与。
 * - 饮水只统计窗口内的记录毫升数，不叠加今日页的演示基线（基线不是一条记录）。
 */
export interface ReportWindowFactsInput {
  window: DateWindow
  fitnessSession: FitnessSessionState | null
  fitnessHistory: FitnessSessionRecord[]
  studyRecords: StudyRecord[]
  dietDays: DietDay[]
  waterHistory: WaterLogEntry[]
  planHistory: PlanItem[]
}

export interface ReportWindowFitnessFacts {
  /** 窗口内是否出现过训练（含进行中的会话）。 */
  hasSession: boolean
  /** 计入「次」的训练次数：已归档记录 + 有完成组的进行中会话。 */
  sessionCount: number
  exerciseCount: number
  doneSets: number
  totalSets: number
  strengthVolumeKg: number
  durationMinutes: number
  distanceKm: number
  exerciseNames: string[]
  /** 与今日页同一套「6 个动作，完成 10 组，…」文案；窗口内没有动作时为空串。 */
  summaryText: string
}

export interface ReportWindowStudyFacts {
  recordCount: number
  englishCount: number
  mathCount: number
  totalMinutes: number
}

export interface ReportWindowDietFacts {
  mealCount: number
  foodEntryCount: number
}

export interface ReportWindowWaterFacts {
  eventCount: number
  liters: number
  dailyAverage: number
}

export interface ReportWindowPlanFacts {
  total: number
  done: number
}

export interface ReportWindowFacts {
  window: DateWindow
  fitness: ReportWindowFitnessFacts
  study: ReportWindowStudyFacts
  diet: ReportWindowDietFacts
  water: ReportWindowWaterFacts
  plan: ReportWindowPlanFacts
}

export function collectReportWindowFacts(input: ReportWindowFactsInput): ReportWindowFacts {
  const { window } = input

  const sessions = input.fitnessHistory.filter((record) => isDateKeyInWindow(record.date, window))
  // 进行中的会话还没有归档；完成训练时它会被写进 fitnessHistory，所以这里只补「未归档」的那一个。
  const activeSession =
    input.fitnessSession?.sessionStatus === 'active' ? input.fitnessSession : null
  const activeSummary = activeSession ? summarizeFitness(activeSession.exercises) : null
  const exercises = [
    ...sessions.flatMap((record) => record.exercises),
    ...(activeSession?.exercises ?? []),
  ]
  const summary = summarizeFitness(exercises)
  const exerciseNames = Array.from(new Set(exercises.map((exercise) => exercise.name.trim())))
    .filter((name) => name.length > 0)
    .slice(0, 6)

  const studyRecords = input.studyRecords.filter((record) => isDateKeyInWindow(record.date, window))
  const meals = input.dietDays
    .filter((day) => isDateKeyInWindow(day.date, window))
    .flatMap((day) => day.meals)
  const waterEntries = input.waterHistory.filter((entry) => isDateKeyInWindow(entry.date, window))
  const waterLiters = waterEntries.reduce((total, entry) => total + entry.milliliters, 0) / 1000
  const planItems = input.planHistory.filter((item) => isDateKeyInWindow(item.date, window))

  return {
    window,
    fitness: {
      hasSession: sessions.length > 0 || activeSession !== null,
      sessionCount: sessions.length + (activeSummary && activeSummary.doneSets > 0 ? 1 : 0),
      exerciseCount: exercises.length,
      doneSets: summary.doneSets,
      totalSets: summary.totalSets,
      strengthVolumeKg: summary.strengthVolume,
      durationMinutes: summary.durationMinutes,
      distanceKm: summary.distanceKm,
      exerciseNames,
      summaryText: exercises.length > 0 ? formatTrainingSummary(exercises) : '',
    },
    study: {
      recordCount: studyRecords.length,
      englishCount: studyRecords.filter((record) => record.category === 'english').length,
      mathCount: studyRecords.filter((record) => record.category === 'math').length,
      totalMinutes: studyRecords.reduce((total, record) => total + record.duration, 0),
    },
    diet: {
      mealCount: meals.filter((meal) => meal.entries.length > 0).length,
      foodEntryCount: meals.reduce((total, meal) => total + meal.entries.length, 0),
    },
    water: {
      eventCount: waterEntries.length,
      liters: waterLiters,
      dailyAverage: window.days > 0 ? waterLiters / window.days : 0,
    },
    plan: {
      total: planItems.length,
      done: planItems.filter((item) => item.done).length,
    },
  }
}
