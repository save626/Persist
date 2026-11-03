import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../src/rate-limit.js'

describe('createRateLimiter', () => {
  it('窗口内允许到上限，之后拒绝并给出重试时间', () => {
    let now = 1_000
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000, now: () => now })
    expect(limiter.take('1.1.1.1')).toMatchObject({ allowed: true, remaining: 1 })
    now += 1_000
    expect(limiter.take('1.1.1.1')).toMatchObject({ allowed: true, remaining: 0 })
    const blocked = limiter.take('1.1.1.1')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBe(59_000)
  })

  it('不同 key 互不影响，窗口滑过后恢复', () => {
    let now = 0
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000, now: () => now })
    expect(limiter.take('a').allowed).toBe(true)
    expect(limiter.take('b').allowed).toBe(true)
    expect(limiter.take('a').allowed).toBe(false)
    now = 1_000
    expect(limiter.take('a').allowed).toBe(true)
  })

  it('reset 清空计数', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000, now: () => 0 })
    limiter.take('a')
    expect(limiter.take('a').allowed).toBe(false)
    limiter.reset()
    expect(limiter.take('a').allowed).toBe(true)
  })
})
