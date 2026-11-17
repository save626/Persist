import type { Db } from '../db/driver.js'

/**
 * AI 调用的日配额（P0 Step 2 次数 / Step 3 token）。
 *
 * 为什么需要它：凭据门（Step 1）只解决「拿不到 key 的人不能调用」，但 key 被内联在 APK
 * 里，反编译就能提取。一旦泄露，攻击者可以用作者的 Key 无限调用，账单仍然是作者的。
 * 配额是唯一的止损手段——它不阻止滥用，但把「无限」变成「每天有限」。
 *
 * 两维上限，缺一不可：
 * - **次数**管滥用频率（脚本刷接口）；
 * - **token** 管真实成本。100 次里可以是 100 条短对话，也可以是几十份长报告，
 *   只数次数等于放开了费用。
 *
 * 归属口径按 `keyId`，不按账号、不按设备：
 * - 与同步开关解耦（同步关闭时 AI 仍可用，见 P0 §5 决策表）；
 * - 轮换 key 即换一套计数，不需要清理历史；
 * - 门未识别身份时（`off` / `warn` 模式）归到 `anonymous`，保证「把门关掉」不能绕过配额。
 *
 * 次数是**预占**：请求进入网关就 +1，失败不退还。理由是失败请求同样消耗了
 * 作者的钱（上游可能已经计费），且「失败可退」会给攻击者一个把配额刷回来的口子。
 *
 * token 无法预占（生成前不知道会长多少），所以是**事后记账 + 事前判余**：
 * 进门时比对「已记账的量」，出门时把这次实际用量加进去。代价是最后一个请求可以把
 * 当日总量顶过上限一截（最多一次请求的量，输入受 `maxPromptChars` 约束、输出受
 * `max_tokens` 约束）；个人使用量级下这比「按估算预留」更简单也更准。
 * 失败请求漏记的部分（流被中途 abort 时拿不到 usage）同样是**少算**，不会多算。
 */

/** 门没有识别出身份时的计数归属。 */
export const ANONYMOUS_KEY_ID = 'anonymous'

export interface AiQuotaOptions {
  /** 计数归属；空值归到 `anonymous`。 */
  keyId?: string | null
  /** 每日请求次数上限；`<= 0` 表示这一维不设限。 */
  requestLimit: number
  /** 每日 token 上限（输入 + 输出）；`<= 0` 表示这一维不设限。 */
  tokenLimit?: number
  now: () => number
}

/** 被拒的原因：便于给出「明天恢复」之外更具体的文案，也便于日志区分。 */
export type AiQuotaReason = 'requests' | 'tokens'

export interface AiQuotaDecision {
  allowed: boolean
  /** 仅 `allowed === false` 时有值。 */
  reason?: AiQuotaReason
  /** 本次请求之后的当日已用次数（被拒时是当前已用数）。 */
  used: number
  limit: number
  /** 当日已记账 token（被拒时是当前值）。 */
  tokensUsed: number
  tokenLimit: number
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
  /** 输入 + 输出，配额判余用的是这个数。 */
  tokens: number
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
  const promptTokens = row ? Number(row.prompt_tokens) : 0
  const completionTokens = row ? Number(row.completion_tokens) : 0
  return {
    day,
    requests: row ? Number(row.requests) : 0,
    promptTokens,
    completionTokens,
    tokens: promptTokens + completionTokens,
    updatedAt: row ? Number(row.updated_at) : null,
  }
}

/** 任一维度有上限即视为启用配额；两个都关掉时不写库（回滚路径不该留下空行）。 */
export function isAiQuotaEnabled(limits: { requestLimit: number; tokenLimit: number }): boolean {
  return bounds(limits.requestLimit) > 0 || bounds(limits.tokenLimit) > 0
}

function bounds(value: number | undefined): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
  return numeric > 0 ? numeric : 0
}

/**
 * 预占一次额度。
 *
 * 「读当前值 → 判断 → 加一」放在一个事务里，避免并发请求都读到 99 然后同时放行，
 * 把 100 次的上限突破成 N 次。SQLite 单写入者的特性让这个事务足够短且不会死锁。
 *
 * 两维都关掉时直接放行且**不写库**：这是「关闭配额」的语义，不应该在库里堆积无意义行。
 * 只关掉一维时仍然写库：另一维的判余需要这一行，而且「今天用了几次、花了多少 token」
 * 本身是有用的观测数据。
 */
export function reserveAiQuota(db: Db, options: AiQuotaOptions): AiQuotaDecision {
  const nowMs = options.now()
  const resetAt = nextLocalMidnight(nowMs)
  const limit = bounds(options.requestLimit)
  const tokenLimit = bounds(options.tokenLimit)
  const base = { used: 0, limit, tokensUsed: 0, tokenLimit, resetAt }
  if (limit === 0 && tokenLimit === 0) return { ...base, allowed: true }

  const keyId = normalizeKeyId(options.keyId)
  const day = localDayKey(nowMs)

  return db.transaction(() => {
    const row = db
      .prepare<{ requests: number; prompt_tokens: number; completion_tokens: number }>(
        'SELECT requests, prompt_tokens, completion_tokens FROM ai_usage WHERE key_id = ? AND day = ?',
      )
      .get(keyId, day)
    const used = row ? Number(row.requests) : 0
    const tokensUsed = row ? Number(row.prompt_tokens) + Number(row.completion_tokens) : 0
    const state = { used, limit, tokensUsed, tokenLimit, resetAt }

    // 次数先判：它是硬预占，token 是事后记账，同时超限时按次数报更像使用者的直觉。
    if (limit > 0 && used >= limit) return { ...state, allowed: false, reason: 'requests' as const }
    if (tokenLimit > 0 && tokensUsed >= tokenLimit) {
      return { ...state, allowed: false, reason: 'tokens' as const }
    }

    db.prepare(
      `INSERT INTO ai_usage (key_id, day, requests, prompt_tokens, completion_tokens, updated_at)
       VALUES (?, ?, 1, 0, 0, ?)
       ON CONFLICT(key_id, day) DO UPDATE SET requests = requests + 1, updated_at = excluded.updated_at`,
    ).run(keyId, day, nowMs)

    return { ...state, used: used + 1, allowed: true }
  })
}

export interface AiTokenRecord {
  /** 计数归属；空值归到 `anonymous`。 */
  keyId?: string | null
  promptTokens: number
  completionTokens: number
  now: () => number
}

/**
 * 记账一次调用的真实 token 用量（Step 3）。
 *
 * - 累加而不是覆盖：一次 `/api/chat` 会打两次模型（流式回复 + 结构化抽取），
 *   调用方把两次加好后一次写入，也可以分两次写，结果一样；
 * - 两项都为 0 时直接返回：上游没给 usage（被 abort、老版本响应）时不该写一行空账；
 * - **永不抛错**：记账是旁路，写失败只让配额偏松，不应把正常请求变成 500。
 */
export function addAiTokens(
  db: Db,
  record: AiTokenRecord,
  onError?: (error: unknown) => void,
): void {
  const promptTokens = bounds(record.promptTokens)
  const completionTokens = bounds(record.completionTokens)
  if (promptTokens === 0 && completionTokens === 0) return

  const nowMs = record.now()
  const keyId = normalizeKeyId(record.keyId)
  const day = localDayKey(nowMs)
  try {
    db.prepare(
      `INSERT INTO ai_usage (key_id, day, requests, prompt_tokens, completion_tokens, updated_at)
       VALUES (?, ?, 0, ?, ?, ?)
       ON CONFLICT(key_id, day) DO UPDATE SET
         prompt_tokens     = prompt_tokens + excluded.prompt_tokens,
         completion_tokens = completion_tokens + excluded.completion_tokens,
         updated_at        = excluded.updated_at`,
    ).run(keyId, day, promptTokens, completionTokens, nowMs)
  } catch (error) {
    onError?.(error)
  }
}

function normalizeKeyId(keyId: string | null | undefined): string {
  const value = keyId?.trim()
  return value && value.length > 0 ? value : ANONYMOUS_KEY_ID
}
