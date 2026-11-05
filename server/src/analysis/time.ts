/**
 * 分析用的日期工具：一律按 Asia/Shanghai 取「今天」，日期键是 YYYY-MM-DD。
 *
 * 不能用 `new Date().toISOString().slice(0, 10)`：服务器跑在 UTC 时，北京时间 00:00–08:00
 * 会被算成前一天，聚合窗口整体错位。这里用 Intl 取北京时间的年月日，再按纯字符串做
 * 加减天数（UTC 正午做锚点，绕开夏令时/闰秒）。
 */

const SHANGHAI_TZ = 'Asia/Shanghai'
const DAY_MS = 86_400_000

export interface LocalTimeParts {
  /** YYYY-MM-DD */
  date: string
  hour: number
  minute: number
}

/** 北京时间下这个时刻的年月日与时分。 */
export function localTimeParts(now: number): LocalTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now))
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const hourText = value('hour') === '24' ? '00' : value('hour')
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number.parseInt(hourText, 10),
    minute: Number.parseInt(value('minute'), 10),
  }
}

export function localDateKey(now: number): string {
  return localTimeParts(now).date
}

function toUtcStamp(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number]
  return Date.UTC(year, month - 1, day, 12, 0, 0)
}

function fromUtcStamp(stamp: number): string {
  const date = new Date(stamp)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 在日期键上加减天数；`delta` 为负表示往前。 */
export function addDays(dateKey: string, delta: number): string {
  return fromUtcStamp(toUtcStamp(dateKey) + Math.trunc(delta) * DAY_MS)
}

/** 两个日期键之间相差的天数（正数表示 `later` 更晚）。 */
export function daysBetween(earlier: string, later: string): number {
  return Math.round((toUtcStamp(later) - toUtcStamp(earlier)) / DAY_MS)
}

/** 周一为一周之首（前端周计划、周复盘都用这个口径）。 */
export function startOfWeek(dateKey: string): string {
  const stamp = toUtcStamp(dateKey)
  const weekday = (new Date(stamp).getUTCDay() + 6) % 7
  return fromUtcStamp(stamp - weekday * DAY_MS)
}

/** `HH:MM` → 一天中的分钟数；格式非法返回 null。 */
export function minutesOfDay(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!match) return null
  return Number.parseInt(match[1] as string, 10) * 60 + Number.parseInt(match[2] as string, 10)
}
