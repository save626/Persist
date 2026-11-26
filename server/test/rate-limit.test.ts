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

  it('容量硬上限：超出 maxKeys 后拒绝新 key，过期桶被 sweep 后可复用', () => {
    let now = 0
    const limiter = createRateLimiter({
      max: 1,
      windowMs: 1_000,
      maxKeys: 2,
      sweepIntervalMs: 500,
      now: () => now,
    })
    expect(limiter.take('a').allowed).toBe(true)
    expect(limiter.take('b').allowed).toBe(true)
    // 两个桶都在窗口内，第三个新 key 被容量上限挡住（不影响已有 key）
    expect(limiter.take('c').allowed).toBe(false)
    // 窗口滑过 + sweep 间隔到达：a 的桶被清理，c 可以进来
    now = 1_500
    expect(limiter.take('c').allowed).toBe(true)
  })
})
