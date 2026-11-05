import { createEmptyMeals } from '../data/diet'
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

/**
 * 日期键 → 界面文案：`{ date: '11 月 4 日', weekday: '周三' }`。
 * 用本地时区构造日期再格式化，避免 `new Date('YYYY-MM-DD')` 被当成 UTC 而串日；
 * 非法键原样返回 `date`、`weekday` 为空串，交给界面决定怎么兜底。
 */
export function dateKeyLabel(dateKey: string): { date: string; weekday: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return { date: dateKey, weekday: '' }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return {
    date: `${Number(match[2])} 月 ${Number(match[3])} 日`,
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date),
  }
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

/** 报告等场景使用的闭区间「统计窗口」，起止都取本地自然日键。 */
export interface DateWindow {
  startKey: string
  endKey: string
  /** 窗口天数（含首尾），至少 1 天。 */
  days: number
}

/**
 * 以 `endKey` 为最后一天，向前取 `days` 天的闭区间窗口。
 * 天数不是正整数时按 1 天处理，上限 366 天，避免脏参数把窗口拉成十年。
 */
export function createDateWindow(days: number, endKey: string): DateWindow {
  const span = Number.isFinite(days) ? Math.min(366, Math.max(1, Math.trunc(days))) : 1
  return {
    startKey: addDaysToDateKey(endKey, -(span - 1)),
    endKey,
    days: span,
  }
}

/** 日期键是否落在窗口内（闭区间，按字符串比较即可）。 */
export function isDateKeyInWindow(dateKey: string, window: DateWindow): boolean {
  return dateKey >= window.startKey && dateKey <= window.endKey
}

/** 取某一天的饮食台账；没有记录时返回空数组（而不是四个空餐次）。 */
export function mealsForDate(dietDays: DietDay[], date: string): Meal[] {
  return dietDays.find((day) => day.date === date)?.meals ?? []
}

/**
 * 页面用的「某天饮食」：当天还没有记录时给出四个空餐次骨架。
 *
 * 跨日后的第一次打开（本地只留着昨天的 `dietDays`）、或从只含旧日期的备份恢复时，
 * `mealsForDate` 会返回空数组；页面若直接拿 `meals[0]` 或 `meals.map()` 就会
 * 「记录下一餐」点不动、AI 登记的餐次下拉为空。空骨架让这一天从零开始可写，
 * 但只要用户没真写入食物，就不会产生当天的 `dietDays` 记录。
 */
export function dayMeals(dietDays: DietDay[], date: string): Meal[] {
  const meals = mealsForDate(dietDays, date)
  return meals.length > 0 ? meals : createEmptyMeals()
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
