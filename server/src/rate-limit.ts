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
  /**
   * 容量硬上限：不同 key 的数量超过它时，拒绝新 key 而不是无限建桶（默认 10 000）。
   * 防止攻击者用大量伪造来源 IP 撑爆内存（2026-11-25 安全审查）。
   */
  maxKeys?: number
  /**
   * 过期桶清理间隔（毫秒，默认 60 000）。0 表示不自动清理。
   * 清理由 take() 触发，不额外起定时器——保持单进程、无后台句柄。
   */
  sweepIntervalMs?: number
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
  const maxKeys = Math.max(1, Math.floor(options.maxKeys ?? 10_000))
  const sweepIntervalMs = Math.max(0, Math.floor(options.sweepIntervalMs ?? 60_000))
  const buckets = new Map<string, { startedAt: number; count: number }>()
  let lastSweep = now()

  /** 惰性清理过期桶：只在间隔到达时扫描一次，不引入 setInterval 句柄。 */
  function sweep(current: number): void {
    if (sweepIntervalMs === 0 || current - lastSweep < sweepIntervalMs) return
    lastSweep = current
    for (const [key, bucket] of buckets) {
      if (current - bucket.startedAt >= windowMs) buckets.delete(key)
    }
  }

  function take(key: string): RateLimitDecision {
    const current = now()
    sweep(current)
    const bucket = buckets.get(key)
    if (!bucket || current - bucket.startedAt >= windowMs) {
      // 容量硬上限：新 key 超限时按「拒绝」处理， retryAfterMs 给一个窗口值让客户端退避。
      if (!bucket && buckets.size >= maxKeys) {
        return { allowed: false, remaining: 0, retryAfterMs: windowMs }
      }
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
