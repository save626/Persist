import type { Goal } from '../types'

const CHINA_TIME_OFFSET = '+08:00'

export function goalToTimestamp(goal: Goal): number {
  return new Date(`${goal.date}T${goal.time}:00${CHINA_TIME_OFFSET}`).getTime()
}

export function formatGoalDate(goal: Goal): string {
  const [year, month, day] = goal.date.split('-').map(Number)
  return `${year}年${month}月${day}日 ${goal.time}`
}
