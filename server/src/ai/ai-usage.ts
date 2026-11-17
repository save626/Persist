import type { Db } from '../db/driver.js'

/**
 * AI 调用的日配额（P0 Step 2）。
 *
 * 为什么需要它：凭据门（Step 1）只解决「拿不到 key 的人不能调用」，但 key 被内联在 APK
 * 里，反编译就能提取。一旦泄露，攻击者可以用作者的 Key 无限调用，账单仍然是作者的。
 * 配额是唯一的止损手段——它不阻止滥用，但把「无限」变成「每天有限」。
 *
 * 归属口径按 `keyId`，不按账号、不按设备：
 * - 与同步开关解耦（同步关闭时 AI 仍可用，见 P0 §5 决策表）；
 * - 轮换 key 即换一套计数，不需要清理历史；
 * - 门未识别身份时（`off` / `warn` 模式）归到 `anonymous`，保证「把门关掉」不能绕过配额。
 *
 * 计数口径是**预占**：请求进入网关就 +1，失败不退还。理由是失败请求同样消耗了
 * 作者的钱（上游可能已经计费），且「失败可退」会给攻击者一个把配额刷回来的口子。
 * 代价是上游长时间故障时会白白吃额度，个人使用量级下可接受，也能靠调高上限缓解。
 */

/** 门没有识别出身份时的计数归属。 */
export const ANONYMOUS_KEY_ID = 'anonymous'

export interface AiQuotaOptions {
  /** 计数归属；空值归到 `anonymous`。 */
  keyId?: string | null
  /** 每日上限；`<= 0` 表示关闭配额（只计数不拦截变成不计数，见下）。 */
  limit: number
  now: () => number
}

export interface AiQuotaDecision {
  allowed: boolean
  /** 本次请求之后的当日已用次数（被拒时是当前已用数）。 */
  used: number
  limit: number
  /** 额度重置时刻（次日零点，服务器本地时区）。用于 429 的 `retry-after`。 */
  resetAt: number
}

/**
 * 服务器本地日期，`YYYY-MM-DD`。
 *
 * 刻意用本地日期而不是 UTC：使用者在 CST，UTC 的日界落在早上 8 点，
 * 会让「今天用了多少」和直觉差半天。依赖服务器时区（生产为 CST）。
 */
export function localDayKey(nowMs: number): string {
  const date = new Date(nowMs)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 次日零点（本地时区）的时间戳。用 Date 的日期进位，自动处理月末与夏令时。 */
export function nextLocalMidnight(nowMs: number): number {
  const date = new Date(nowMs)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime()
}

export interface AiUsageSnapshot {
  day: string
  requests: number
  promptTokens: number
  completionTokens: number
  updatedAt: number | null
}

/** 读当日用量；没有记录时返回全 0（不写库）。 */
export function readAiUsage(
  db: Db,
  options: { keyId?: string | null; now: () => number },
): AiUsageSnapshot {
  const nowMs = options.now()
  const day = localDayKey(nowMs)
  const keyId = normalizeKeyId(options.keyId)
  const row = db
    .prepare<{
      requests: number
      prompt_tokens: number
      completion_tokens: number
      updated_at: number
    }>(
      'SELECT requests, prompt_tokens, completion_tokens, updated_at FROM ai_usage WHERE key_id = ? AND day = ?',
    )
    .get(keyId, day)
  return {
    day,
    requests: row ? Number(row.requests) : 0,
    promptTokens: row ? Number(row.prompt_tokens) : 0,
    completionTokens: row ? Number(row.completion_tokens) : 0,
    updatedAt: row ? Number(row.updated_at) : null,
  }
}

/**
 * 预占一次额度。
 *
 * 「读当前值 → 判断 → 加一」放在一个事务里，避免并发请求都读到 99 然后同时放行，
 * 把 100 次的上限突破成 N 次。SQLite 单写入者的特性让这个事务足够短且不会死锁。
 *
 * `limit <= 0` 时直接放行且**不写库**：这是「关闭配额」的语义，不应该在库里堆积无意义行。
 */
export function reserveAiQuota(db: Db, options: AiQuotaOptions): AiQuotaDecision {
  const nowMs = options.now()
  const resetAt = nextLocalMidnight(nowMs)
  const limit = Math.max(0, Math.trunc(options.limit))
  if (limit === 0) return { allowed: true, used: 0, limit: 0, resetAt }

  const keyId = normalizeKeyId(options.keyId)
  const day = localDayKey(nowMs)

  return db.transaction(() => {
    const row = db
      .prepare<{ requests: number }>('SELECT requests FROM ai_usage WHERE key_id = ? AND day = ?')
      .get(keyId, day)
    const used = row ? Number(row.requests) : 0
    if (used >= limit) return { allowed: false, used, limit, resetAt }

    db.prepare(
      `INSERT INTO ai_usage (key_id, day, requests, prompt_tokens, completion_tokens, updated_at)
       VALUES (?, ?, 1, 0, 0, ?)
       ON CONFLICT(key_id, day) DO UPDATE SET requests = requests + 1, updated_at = excluded.updated_at`,
    ).run(keyId, day, nowMs)

    return { allowed: true, used: used + 1, limit, resetAt }
  })
}

function normalizeKeyId(keyId: string | null | undefined): string {
  const value = keyId?.trim()
  return value && value.length > 0 ? value : ANONYMOUS_KEY_ID
}
