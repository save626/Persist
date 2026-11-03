export function formatCountdown(targetAt: number, now = Date.now()): string {
  const remaining = Math.max(0, targetAt - now)
  if (remaining <= 0) return '已到达'

  const totalSeconds = Math.floor(remaining / 1000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) {
    return `${days}天 ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }

  if (totalSeconds >= 3_600) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
