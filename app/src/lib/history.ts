import type {
  DietDay,
  FitnessSessionRecord,
  FitnessSessionState,
  Meal,
  PlanItem,
  WaterLogEntry,
} from '../types'
import { toIsoDate } from './long-term-plan'

/**
 * 数据历史化（8d）的日期与按日读写工具。
 *
 * 约定：
 * - 所有「日」都指浏览器本地时区的自然日，格式统一为 `YYYY-MM-DD`；
 *   不能用 `toISOString().slice(0, 10)`，否则 UTC+8 的 23:00 之后会被算到第二天。
 * - 这些函数都是纯函数，页面与 Provider 共用，日期来自参数而不是 `new Date()`，
 *   便于单测直接注入日期验证跨日行为。
 */

/** 本地时区的自然日键（`YYYY-MM-DD`）。 */
export function todayDateKey(now: Date = new Date()): string {
  return toIsoDate(now)
}

/** 在日期键上加减天数；非法键原样返回，避免把脏数据扩散成 `NaN-NaN-NaN`。 */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match || !Number.isInteger(days)) return dateKey
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

/**
 * 闭区间日期序列（含首尾），按时间升序返回。
 * 起止倒置时返回空数组：调用方传反了宁可没有数据，也不要算出负长度的窗口。
 */
export function dateKeysBetween(startKey: string, endKey: string): string[] {
  const keys: string[] = []
  let cursor = startKey
  for (let guard = 0; guard < 3_660 && cursor <= endKey; guard += 1) {
    keys.push(cursor)
    const next = addDaysToDateKey(cursor, 1)
    if (next === cursor) break
    cursor = next
  }
  return keys
}

/** 取某一天的饮食台账；没有记录时返回空数组（而不是四个空餐次）。 */
export function mealsForDate(dietDays: DietDay[], date: string): Meal[] {
  return dietDays.find((day) => day.date === date)?.meals ?? []
}

/**
 * 写入某一天的饮食台账：目标日不存在就追加，存在就整体替换；
 * 替换后 `meals` 为空的日期会被移除，避免历史里堆一串空壳。
 */
export function patchMealsForDate(
  dietDays: DietDay[],
  date: string,
  updater: (meals: Meal[]) => Meal[],
): DietDay[] {
  const current = mealsForDate(dietDays, date)
  const nextMeals = updater(current)
  const others = dietDays.filter((day) => day.date !== date)
  return nextMeals.length === 0 ? others : [...others, { date, meals: nextMeals }]
}

/** 取某一天的饮水记录；保持写入顺序（也就是操作顺序）。 */
export function waterForDate(waterLog: WaterLogEntry[], date: string): WaterLogEntry[] {
  return waterLog.filter((entry) => entry.date === date)
}

/** 取某一天的今日计划；顺序沿用计划列表自身顺序。 */
export function planItemsForDate(planItems: PlanItem[], date: string): PlanItem[] {
  return planItems.filter((item) => item.date === date)
}

/**
 * 写入某一天的今日计划。只替换目标日的条目，其他日期原样保留，
 * 并保持「先出现日期在前、同日期保持传入顺序」的稳定顺序。
 */
export function patchPlanItemsForDate(
  planItems: PlanItem[],
  date: string,
  updater: (items: PlanItem[]) => PlanItem[],
): PlanItem[] {
  const nextItems = updater(planItemsForDate(planItems, date))
  const others = planItems.filter((item) => item.date !== date)
  return nextItems.length === 0 ? others : [...others, ...nextItems]
}

/** 一次训练归档成一条历史记录：日期取完成当天，`completedAt` 保留精确时刻。 */
export function createFitnessSessionRecord(
  session: FitnessSessionState,
  now: Date = new Date(),
): FitnessSessionRecord {
  return {
    id: `workout-${now.getTime()}`,
    date: todayDateKey(now),
    completedAt: now.toISOString(),
    templateId: session.activeTemplateId,
    elapsedSeconds: session.elapsedSeconds,
    exercises: session.exercises,
  }
}

/** 历史列表统一按「最近完成优先」排序；`completedAt` 相同则按 id 兜底，保证顺序稳定。 */
export function sortFitnessHistoryDesc(records: FitnessSessionRecord[]): FitnessSessionRecord[] {
  return [...records].sort((left, right) => {
    if (left.completedAt === right.completedAt) return right.id.localeCompare(left.id)
    return right.completedAt.localeCompare(left.completedAt)
  })
}
