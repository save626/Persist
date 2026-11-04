import type {
  DataSource,
  FitnessSessionState,
  Meal,
  MockSettings,
  ProfileData,
  StudyRecord,
  WaterLogEntry,
} from '../types'
import { summarizeFitness } from './fitness'
import type { ReportDigest } from './report-types'

/**
 * 报告摘要（digest）的唯一构造入口。
 *
 * 规则必须与 `/reports` 页面一致：
 * - 只有用户已授权（`aiConsent`）且对应来源开关打开时，该模块才有值；
 * - 未授权的模块保持 null，绝不用 0 或空数组顶替（否则模型会把「未授权」误读成「没有记录」）。
 *
 * 报告页与今日页晨间简报共用这一份实现，避免两处规则随时间漂移。
 */
export interface ReportDigestInput {
  aiConsent: boolean
  settings: Pick<MockSettings, 'sources'>
  profile: ProfileData
  fitnessSession: FitnessSessionState | null
  studyRecords: StudyRecord[]
  meals: Meal[]
  waterLiters: number
  waterLog: WaterLogEntry[]
}

export const DIGEST_SOURCE_LABELS: Record<DataSource, string> = {
  fitness: '训练',
  study: '学习',
  diet: '饮食',
  profile: '档案',
}

export function buildReportDigest(input: ReportDigestInput): ReportDigest {
  const { aiConsent, settings } = input
  const enabled = (source: DataSource) => aiConsent && settings.sources[source]
  const digest: ReportDigest = { fitness: null, study: null, diet: null, profile: null }

  if (enabled('fitness')) {
    const exercises = input.fitnessSession?.exercises ?? []
    const summary = summarizeFitness(exercises)
    const exerciseNames = Array.from(
      new Set(exercises.map((exercise) => exercise.name.trim())),
    )
      .filter((name) => name.length > 0)
      .slice(0, 6)
    digest.fitness = {
      hasSession: Boolean(input.fitnessSession),
      exerciseCount: exercises.length,
      doneSets: summary.doneSets,
      totalSets: summary.totalSets,
      strengthVolumeKg: summary.strengthVolume,
      durationMinutes: summary.durationMinutes,
      distanceKm: summary.distanceKm,
      exerciseNames,
    }
  }

  if (enabled('study')) {
    const studyRecords = input.studyRecords
    digest.study = {
      recordCount: studyRecords.length,
      englishCount: studyRecords.filter((record) => record.category === 'english').length,
      mathCount: studyRecords.filter((record) => record.category === 'math').length,
      totalMinutes: studyRecords.reduce((total, record) => total + record.duration, 0),
    }
  }

  if (enabled('diet')) {
    digest.diet = {
      mealCount: input.meals.filter((meal) => meal.entries.length > 0).length,
      foodEntryCount: input.meals.reduce((total, meal) => total + meal.entries.length, 0),
      waterLiters: input.waterLiters,
      waterEvents: input.waterLog.length + 1,
    }
  }

  if (enabled('profile')) digest.profile = { ...input.profile, aiConsent: true }

  return digest
}

export function hasDigestSources(digest: ReportDigest): boolean {
  return Boolean(digest.fitness || digest.study || digest.diet || digest.profile)
}

export function digestSourceLabels(digest: ReportDigest): string[] {
  return (['fitness', 'study', 'diet', 'profile'] as const)
    .filter((source) => digest[source] !== null)
    .map((source) => DIGEST_SOURCE_LABELS[source])
}

/** 用于缓存指纹：摘要内容（也就是实际发送给模型的数据）变化后，旧缓存必须失效。 */
export function digestFingerprint(digest: ReportDigest): string {
  return JSON.stringify(digest)
}
