/**
 * 极简按 IP 滑动窗口限流。
 *
 * 目的只是防止单个 IP 把 DeepSeek 额度刷爆（公网 IP 直接暴露、没有登录体系），
 * 不做分布式共享：单进程单机，重启即清零，够用且没有额外依赖。
 */

export interface RateLimiterOptions {
  max: number
  windowMs: number
  now?: () => number
}

export interface RateLimitDecision {
  allowed: boolean
  /** 窗口内剩余次数（拒绝时为 0） */
  remaining: number
  /** 建议的 Retry-After，毫秒 */
  retryAfterMs: number
}

export interface RateLimiter {
  take(key: string): RateLimitDecision
  /** 仅测试用：清空全部计数 */
  reset(): void
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const max = Math.max(1, Math.floor(options.max))
  const windowMs = Math.max(1, Math.floor(options.windowMs))
  const now = options.now ?? (() => Date.now())
  const buckets = new Map<string, { startedAt: number; count: number }>()

  function take(key: string): RateLimitDecision {
    const current = now()
    const bucket = buckets.get(key)
    if (!bucket || current - bucket.startedAt >= windowMs) {
      buckets.set(key, { startedAt: current, count: 1 })
      return { allowed: true, remaining: max - 1, retryAfterMs: 0 }
    }
    if (bucket.count < max) {
      bucket.count += 1
      return { allowed: true, remaining: max - bucket.count, retryAfterMs: 0 }
    }
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, windowMs - (current - bucket.startedAt)),
    }
  }

  return {
    take,
    reset() {
      buckets.clear()
    },
  }
}
