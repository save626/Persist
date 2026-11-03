import { describe, expect, it } from 'vitest'
import { formatCountdown } from './countdown'

const NOW = Date.UTC(2026, 9, 27, 8, 0, 0)

describe('formatCountdown', () => {
  it('shows days and hours for targets more than one day away', () => {
    const target = NOW + (2 * 86_400 + 3 * 3_600 + 4 * 60) * 1_000
    expect(formatCountdown(target, NOW)).toBe('2天 03:04')
  })

  it('shows hours, minutes and seconds within the final day', () => {
    const target = NOW + (3 * 3_600 + 4 * 60 + 5) * 1_000
    expect(formatCountdown(target, NOW)).toBe('03:04:05')
  })

  it('shows minutes and seconds within the final hour', () => {
    const target = NOW + (4 * 60 + 5) * 1_000
    expect(formatCountdown(target, NOW)).toBe('04:05')
  })

  it('caps arrived targets at zero', () => {
    expect(formatCountdown(NOW, NOW)).toBe('已到达')
    expect(formatCountdown(NOW - 10_000, NOW)).toBe('已到达')
  })
})
