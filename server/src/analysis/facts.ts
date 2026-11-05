import type { Db } from '../db/driver.js'
import { currentRev } from '../db/repositories/sync-seq.js'
import { localDateKey, addDays, daysBetween, startOfWeek } from './time.js'
import type {
  AnalysisConsent,
  AnalysisConsentModule,
  AnalysisRangeDays,
  FactsCoverage,
  FactsDay,
  FactsDietDay,
  FactsFitnessDay,
  FactsPlan,
  FactsPlanDay,
  FactsProfile,
  FactsStudyDay,
  FactsTotals,
  FactsTrend,
  FactsWeek,
  ReportFactsV2,
} from '@persist/shared/contract/analysis'

/**
 * 服务端事实聚合（P4 §8.1）。
 *
 * 这是步骤 13 的核心：所有数字都在这里由 SQL 算出，模型只拿到结果、只负责写文字。
 * 三个原则：
 * 1. 只读拆出来的列（date / category / calories / …），不解 payload 大 JSON；
 * 2. 未授权模块整体为 null（不是 0），模型与前端都不能把它说成「零记录」；
 * 3. 空窗口如实给 null/0，不用「参考值」补齐，避免报告看起来有数据其实没有。
 */

export interface BuildFactsOptions {
  rangeDays: AnalysisRangeDays
  /** 毫秒时间戳；测试注入固定值。 */
  now: number
}

interface DayBucket {
  fitness?: FactsFitnessDay
  study?: FactsStudyDay
  diet?: FactsDietDay
  waterMl?: number
  plan?: FactsPlanDay
}

interface WindowAggregate {
  buckets: Map<string, DayBucket>
  totals: FactsTotals
  coverage: FactsCoverage
}

interface FitnessRow {
  date: string
  sessions: number
  sets: number | null
  volume_kg: number | null
  minutes: number | null
}

interface StudyRow {
  date: string
  category: string
  minutes: number | null
}

interface DietRow {
  date: string
  entries: number
  meals: number
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}

interface WaterRow {
  date: string
  milliliters: number | null
}

interface PlanItemRow {
  date: string
  total: number
  done: number | null
}

interface SingleRowPayload {
  payload_json: string
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function readPayload(
  db: Db,
  table: 'profiles' | 'settings',
  userId: string,
): Record<string, unknown> | null {
  const row = db
    .prepare<SingleRowPayload>(
      `SELECT payload_json FROM ${table} WHERE user_id = ? AND deleted_at IS NULL`,
    )
    .get(userId)
  if (!row) return null
  try {
    const parsed: unknown = JSON.parse(row.payload_json)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function readString(payload: Record<string, unknown> | null, field: string): string {
  const value = payload?.[field]
  return typeof value === 'string' ? value : ''
}

function readFinite(
  payload: Record<string, unknown> | null,
  field: string,
  fallback: number,
): number {
  const value = payload?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 授权口径：档案页的 AI 总开关 + 设置页的四个数据源开关。
 *
 * 单用户自建场景默认全开（用户 2026-11-05 明确要求「所有记录都能被 AI 检索分析」），
 * 但「显式关掉」必须生效：`aiConsent === false` 时四个模块全关；某个 `sources.x === false`
 * 时只关掉那一个模块，事实包里就真的没有它的任何数字。
 */
export function readConsent(db: Db, userId: string): AnalysisConsent {
  const profile = readPayload(db, 'profiles', userId)
  const settings = readPayload(db, 'settings', userId)
  const aiConsent = profile?.aiConsent !== false
  const sources = settings?.sources
  const sourceOn = (module: AnalysisConsentModule): boolean => {
    if (!aiConsent) return false
    if (typeof sources !== 'object' || sources === null) return true
    const value = (sources as Record<string, unknown>)[module]
    return value !== false
  }
  return {
    profile: sourceOn('profile'),
    fitness: sourceOn('fitness'),
    diet: sourceOn('diet'),
    study: sourceOn('study'),
  }
}

/** 档案页把 AI 总开关关掉时，服务端直接拒绝分析（403），不生成半份报告。 */
export function isAiConsentOff(db: Db, userId: string): boolean {
  const profile = readPayload(db, 'profiles', userId)
  return profile?.aiConsent === false
}

function collectFitness(
  db: Db,
  userId: string,
  start: string,
  end: string,
  buckets: Map<string, DayBucket>,
): void {
  const rows = db
    .prepare<FitnessRow>(
      `SELECT date,
              COUNT(*) AS sessions,
              SUM(COALESCE(done_sets, total_sets)) AS sets,
              SUM(COALESCE(volume_kg, 0)) AS volume_kg,
              SUM(COALESCE(duration_min, 0)) AS minutes
       FROM fitness_sessions
       WHERE user_id = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL AND status = 'completed'
       GROUP BY date`,
    )
    .all(userId, start, end)
  for (const row of rows) {
    const bucket = ensureBucket(buckets, row.date)
    bucket.fitness = {
      sessions: Number(row.sessions),
      sets: row.sets === null ? null : Math.round(Number(row.sets)),
      volumeKg: row.volume_kg === null ? null : round2(Number(row.volume_kg)),
      minutes: row.minutes === null ? null : Math.round(Number(row.minutes)),
    }
  }
}

function collectStudy(
  db: Db,
  userId: string,
  start: string,
  end: string,
  buckets: Map<string, DayBucket>,
): void {
  const rows = db
    .prepare<StudyRow>(
      `SELECT date, category, SUM(COALESCE(duration_min, 0)) AS minutes
       FROM study_records
       WHERE user_id = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL
       GROUP BY date, category`,
    )
    .all(userId, start, end)
  for (const row of rows) {
    const bucket = ensureBucket(buckets, row.date)
    const minutes = Math.round(Number(row.minutes ?? 0))
    const current: FactsStudyDay = bucket.study ?? {
      minutes: 0,
      byCategory: { english: 0, math: 0 },
    }
    current.minutes += minutes
    if (current.byCategory && (row.category === 'english' || row.category === 'math')) {
      current.byCategory[row.category] += minutes
    }
    bucket.study = current
  }
}

function collectDiet(
  db: Db,
  userId: string,
  start: string,
  end: string,
  buckets: Map<string, DayBucket>,
): void {
  const rows = db
    .prepare<DietRow>(
      `SELECT date,
              COUNT(*) AS entries,
              COUNT(DISTINCT meal) AS meals,
              SUM(COALESCE(calories, 0)) AS calories,
              SUM(COALESCE(protein, 0)) AS protein,
              SUM(COALESCE(carbs, 0)) AS carbs,
              SUM(COALESCE(fat, 0)) AS fat
       FROM diet_entries
       WHERE user_id = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL
       GROUP BY date`,
    )
    .all(userId, start, end)
  for (const row of rows) {
    const bucket = ensureBucket(buckets, row.date)
    bucket.diet = {
      calories: round2(Number(row.calories ?? 0)),
      protein: round2(Number(row.protein ?? 0)),
      carbs: round2(Number(row.carbs ?? 0)),
      fat: round2(Number(row.fat ?? 0)),
      meals: Math.round(Number(row.meals)),
    }
  }
}

function collectWater(
  db: Db,
  userId: string,
  start: string,
  end: string,
  buckets: Map<string, DayBucket>,
): void {
  const rows = db
    .prepare<WaterRow>(
      `SELECT date, SUM(COALESCE(milliliters, 0)) AS milliliters
       FROM water_logs
       WHERE user_id = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL
       GROUP BY date`,
    )
    .all(userId, start, end)
  for (const row of rows) {
    const bucket = ensureBucket(buckets, row.date)
    bucket.waterMl = Math.round(Number(row.milliliters ?? 0))
  }
}

function collectPlanItems(
  db: Db,
  userId: string,
  start: string,
  end: string,
  buckets: Map<string, DayBucket>,
): void {
  const rows = db
    .prepare<PlanItemRow>(
      `SELECT date, COUNT(*) AS total, SUM(done) AS done
       FROM plan_items
       WHERE user_id = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL
       GROUP BY date`,
    )
    .all(userId, start, end)
  for (const row of rows) {
    const bucket = ensureBucket(buckets, row.date)
    bucket.plan = { total: Math.round(Number(row.total)), done: Math.round(Number(row.done ?? 0)) }
  }
}

function ensureBucket(buckets: Map<string, DayBucket>, date: string): DayBucket {
  const existing = buckets.get(date)
  if (existing) return existing
  const created: DayBucket = {}
  buckets.set(date, created)
  return created
}

/**
 * 聚合一个窗口。`consent` 决定哪些模块参与：没授权的模块既不查询也不出现在结果里。
 */
function aggregateWindow(
  db: Db,
  userId: string,
  window: { start: string; end: string },
  consent: AnalysisConsent,
  rangeDays: number,
): WindowAggregate {
  const buckets = new Map<string, DayBucket>()
  if (consent.fitness) collectFitness(db, userId, window.start, window.end, buckets)
  if (consent.study) collectStudy(db, userId, window.start, window.end, buckets)
  if (consent.diet) {
    collectDiet(db, userId, window.start, window.end, buckets)
    collectWater(db, userId, window.start, window.end, buckets)
  }
  if (consent.fitness || consent.study) {
    collectPlanItems(db, userId, window.start, window.end, buckets)
  }
  return {
    buckets,
    totals: computeTotals(buckets, consent, rangeDays),
    coverage: computeCoverage(buckets),
  }
}

function computeTotals(
  buckets: Map<string, DayBucket>,
  consent: AnalysisConsent,
  rangeDays: number,
): FactsTotals {
  let fitnessSessions = 0
  let fitnessMinutes = 0
  let volumeKg = 0
  let studyMinutes = 0
  let waterSum = 0
  let waterDays = 0
  let planTotal = 0
  let planDone = 0
  let dietCalories = 0
  let dietProtein = 0
  let dietDays = 0
  let englishMinutes = 0
  let mathMinutes = 0
  for (const bucket of buckets.values()) {
    if (bucket.fitness) {
      fitnessSessions += bucket.fitness.sessions
      fitnessMinutes += bucket.fitness.minutes ?? 0
      volumeKg += bucket.fitness.volumeKg ?? 0
    }
    if (bucket.study) {
      studyMinutes += bucket.study.minutes
      englishMinutes += bucket.study.byCategory?.english ?? 0
      mathMinutes += bucket.study.byCategory?.math ?? 0
    }
    if (bucket.diet) {
      dietCalories += bucket.diet.calories ?? 0
      dietProtein += bucket.diet.protein ?? 0
      dietDays += 1
    }
    if (typeof bucket.waterMl === 'number') {
      waterSum += bucket.waterMl
      waterDays += 1
    }
    if (bucket.plan) {
      planTotal += bucket.plan.total
      planDone += bucket.plan.done
    }
  }
  const daysWithAnyRecord = buckets.size
  return {
    fitnessSessions: consent.fitness ? fitnessSessions : null,
    fitnessMinutes: consent.fitness ? Math.round(fitnessMinutes) : null,
    volumeKg: consent.fitness ? round2(volumeKg) : null,
    studyMinutes: consent.study ? Math.round(studyMinutes) : null,
    waterAvgMl: consent.diet && waterDays > 0 ? Math.round(waterSum / waterDays) : null,
    planRate:
      consent.fitness || consent.study
        ? planTotal > 0
          ? round1((planDone / planTotal) * 100)
          : null
        : null,
    daysWithAnyRecord,
    daysMissing: Math.max(0, rangeDays - daysWithAnyRecord),
    dietAvgCalories: consent.diet && dietDays > 0 ? round1(dietCalories / dietDays) : null,
    dietAvgProtein: consent.diet && dietDays > 0 ? round1(dietProtein / dietDays) : null,
    studyEnglishMinutes: consent.study ? Math.round(englishMinutes) : null,
    studyMathMinutes: consent.study ? Math.round(mathMinutes) : null,
  }
}

function computeCoverage(buckets: Map<string, DayBucket>): FactsCoverage {
  let fitnessDays = 0
  let studyDays = 0
  let dietDays = 0
  let waterDays = 0
  for (const bucket of buckets.values()) {
    if (bucket.fitness) fitnessDays += 1
    if (bucket.study) studyDays += 1
    if (bucket.diet) dietDays += 1
    if (typeof bucket.waterMl === 'number') waterDays += 1
  }
  return { fitnessDays, studyDays, dietDays, waterDays }
}

function buildWeeks(buckets: Map<string, DayBucket>): FactsWeek[] {
  const weeks = new Map<string, FactsWeek>()
  const waterSums = new Map<string, { sum: number; days: number }>()
  const planCounts = new Map<string, { total: number; done: number }>()
  for (const [date, bucket] of buckets) {
    const weekStart = startOfWeek(date)
    const week: FactsWeek = weeks.get(weekStart) ?? {
      weekStart,
      fitnessSessions: null,
      volumeKg: null,
      studyMinutes: null,
      avgWaterMl: null,
      planRate: null,
    }
    if (bucket.fitness) {
      week.fitnessSessions = (week.fitnessSessions ?? 0) + bucket.fitness.sessions
      week.volumeKg = round2((week.volumeKg ?? 0) + (bucket.fitness.volumeKg ?? 0))
    }
    if (bucket.study) {
      week.studyMinutes = (week.studyMinutes ?? 0) + bucket.study.minutes
    }
    if (typeof bucket.waterMl === 'number') {
      const water = waterSums.get(weekStart) ?? { sum: 0, days: 0 }
      water.sum += bucket.waterMl
      water.days += 1
      waterSums.set(weekStart, water)
    }
    if (bucket.plan) {
      const plan = planCounts.get(weekStart) ?? { total: 0, done: 0 }
      plan.total += bucket.plan.total
      plan.done += bucket.plan.done
      planCounts.set(weekStart, plan)
    }
    weeks.set(weekStart, week)
  }
  for (const [weekStart, water] of waterSums) {
    const week = weeks.get(weekStart)
    if (week) week.avgWaterMl = Math.round(water.sum / water.days)
  }
  for (const [weekStart, plan] of planCounts) {
    const week = weeks.get(weekStart)
    if (week) week.planRate = plan.total > 0 ? round1((plan.done / plan.total) * 100) : null
  }
  return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

function buildDays(buckets: Map<string, DayBucket>, consent: AnalysisConsent): FactsDay[] {
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({
      date,
      fitness: consent.fitness ? (bucket.fitness ?? null) : null,
      study: consent.study ? (bucket.study ?? null) : null,
      diet: consent.diet ? (bucket.diet ?? null) : null,
      waterMl: consent.diet ? (bucket.waterMl ?? null) : null,
      plan: consent.fitness || consent.study ? (bucket.plan ?? null) : null,
    }))
}

function readProfile(db: Db, userId: string, consent: AnalysisConsent): FactsProfile | null {
  if (!consent.profile) return null
  const payload = readPayload(db, 'profiles', userId)
  if (!payload) return null
  return {
    age: readFinite(payload, 'age', 0),
    height: readFinite(payload, 'height', 0),
    weight: readFinite(payload, 'weight', 0),
    targetWeight: readFinite(payload, 'targetWeight', 0),
    goal: readString(payload, 'goal'),
    experience: readString(payload, 'experience'),
    frequency: readString(payload, 'frequency'),
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function readPlan(
  db: Db,
  userId: string,
  consent: AnalysisConsent,
  today: string,
): FactsPlan | null {
  if (!consent.fitness && !consent.study) return null
  const row = db
    .prepare<SingleRowPayload & { status: string }>(
      `SELECT payload_json, status FROM long_term_plans
       WHERE user_id = ? AND deleted_at IS NULL AND status = 'active'
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(userId)
  if (!row) return null
  let payload: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(row.payload_json)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    payload = parsed as Record<string, unknown>
  } catch {
    return null
  }
  if (row.status !== 'active') return null
  const title = typeof payload.title === 'string' ? payload.title : ''
  if (!title) return null
  const targets: FactsPlan['weeklyTargets'] = []
  if (Array.isArray(payload.weeklyTargets)) {
    for (const item of payload.weeklyTargets) {
      if (typeof item !== 'object' || item === null) continue
      const target = item as Record<string, unknown>
      if (
        typeof target.label !== 'string' ||
        typeof target.unit !== 'string' ||
        typeof target.perWeek !== 'number'
      ) {
        continue
      }
      targets.push({ label: target.label, unit: target.unit, perWeek: target.perWeek })
    }
  }
  const planStart =
    typeof payload.startDate === 'string' && DATE_ONLY.test(payload.startDate)
      ? payload.startDate
      : null
  const planEnd =
    typeof payload.endDate === 'string' && DATE_ONLY.test(payload.endDate) ? payload.endDate : today
  let progressPct: number | null = null
  if (planStart && planEnd && planStart <= planEnd) {
    const row2 = db
      .prepare<{ total: number; done: number | null }>(
        `SELECT COUNT(*) AS total, SUM(done) AS done FROM plan_items
         WHERE user_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ?`,
      )
      .get(userId, planStart, planEnd)
    const total = Number(row2?.total ?? 0)
    if (total > 0) progressPct = round1((Number(row2?.done ?? 0) / total) * 100)
  }
  return { title, weeklyTargets: targets, progressPct }
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return round1(((current - previous) / previous) * 100)
}

export function buildAnalysisFacts(
  db: Db,
  userId: string,
  options: BuildFactsOptions,
): ReportFactsV2 {
  const consent = readConsent(db, userId)
  const today = localDateKey(options.now)
  const start = addDays(today, -(options.rangeDays - 1))
  const window = { start, end: today }
  const main = aggregateWindow(db, userId, window, consent, options.rangeDays)

  const previousEnd = addDays(start, -1)
  const previousStart = addDays(previousEnd, -(options.rangeDays - 1))
  const previous = aggregateWindow(
    db,
    userId,
    { start: previousStart, end: previousEnd },
    consent,
    options.rangeDays,
  )

  const granularity = options.rangeDays === 90 ? 'week' : 'day'
  const trend: FactsTrend =
    previous.totals.daysWithAnyRecord > 0
      ? {
          previousRange: { start: previousStart, end: previousEnd },
          fitnessSessionsChangePct: pctChange(
            main.totals.fitnessSessions,
            previous.totals.fitnessSessions,
          ),
          studyMinutesChangePct: pctChange(main.totals.studyMinutes, previous.totals.studyMinutes),
          planRateChangePct: pctChange(main.totals.planRate, previous.totals.planRate),
        }
      : {
          previousRange: null,
          fitnessSessionsChangePct: null,
          studyMinutesChangePct: null,
          planRateChangePct: null,
        }

  return {
    version: 2,
    generatedAt: Math.trunc(options.now),
    type: '综合分析',
    range: { days: options.rangeDays, start, end: today },
    granularity,
    dataRev: currentRev(db),
    profile: readProfile(db, userId, consent),
    plan: readPlan(db, userId, consent, today),
    days: granularity === 'day' ? buildDays(main.buckets, consent) : [],
    weekly: granularity === 'day' && options.rangeDays < 30 ? [] : buildWeeks(main.buckets),
    totals: main.totals,
    trend,
    coverage: main.coverage,
    consent,
  }
}

/** 事实包里有多少个自然日（窗口长度）；报告文案与指标都用到。 */
export function windowLength(facts: ReportFactsV2): number {
  return daysBetween(facts.range.start, facts.range.end) + 1
}
