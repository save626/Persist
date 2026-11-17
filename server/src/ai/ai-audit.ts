import { createHash } from 'node:crypto'
import type { Db } from '../db/driver.js'

/**
 * AI 调用审计（P0 Step 2）。
 *
 * 只回答一个运维问题：**「谁、什么时候、调了什么、结果如何」**。用于事后定位
 * 「额度被谁吃掉」「某个 key 是不是泄露了」「上游是不是一直失败」。
 *
 * 三条硬约束：
 * 1. **不记请求正文**。档案、对话、报告事实包里全是使用者的健康数据，落盘就等于
 *    在服务端复制了一份业务数据，且 `app.ts` 的既有原则是请求体从不进日志。
 * 2. **不记 IP 明文**，只存 sha256 前 16 位。注意这不是匿名化——IPv4 空间足够小，
 *    穷举可还原。它只用于「同源聚类」，不承诺不可逆，文档里写清楚，不假装。
 * 3. **写审计失败不影响请求**。审计是旁路：库写不进去（磁盘满、锁超时）时，
 *    宁可丢一条审计，也不能让一次正常调用变成 500。
 */

export const AI_CALL_RESULTS = [
  'ok',
  'ai_failed',
  'timeout',
  'invalid_response',
  'client_closed',
  'quota_exceeded',
] as const

export type AiCallResult = (typeof AI_CALL_RESULTS)[number]

export interface AiCallRecord {
  /** 计数归属；门未识别身份时传 null，落 `anonymous`。 */
  keyId?: string | null
  route: string
  result: AiCallResult
  httpStatus: number
  model?: string | null
  latencyMs?: number | null
  /** 本次调用实际花掉的 token（P0 Step 3）；拿不到 usage 时留空，不写 0 假装知道。 */
  promptTokens?: number | null
  completionTokens?: number | null
  /** 调用方 IP；内部转哈希后落库，明文不落盘。 */
  ip?: string | null
  now: () => number
}

/** IP 哈希：sha256 前 16 位十六进制。用于聚类，不用于承诺匿名（见文件头）。 */
export function hashIp(ip: string | null | undefined): string | null {
  const value = ip?.trim()
  if (!value) return null
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)
}

/**
 * 写一条审计。永远不抛错：失败时调用 `onError` 交给路由记日志（如果有）。
 */
export function recordAiCall(
  db: Db,
  record: AiCallRecord,
  onError?: (error: unknown) => void,
): void {
  try {
    db.prepare(
      `INSERT INTO ai_calls
         (key_id, route, model, result, http_status, prompt_tokens, completion_tokens,
          latency_ms, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.keyId?.trim() || 'anonymous',
      record.route,
      record.model ?? null,
      record.result,
      Math.trunc(record.httpStatus),
      toTokenColumn(record.promptTokens),
      toTokenColumn(record.completionTokens),
      record.latencyMs === null || record.latencyMs === undefined
        ? null
        : Math.trunc(record.latencyMs),
      hashIp(record.ip),
      Math.trunc(record.now()),
    )
  } catch (error) {
    onError?.(error)
  }
}

/** token 列：缺省留 NULL，不要用 0 冒充「上游说这次是 0」。 */
function toTokenColumn(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  return Math.max(0, Math.trunc(value))
}

export interface AiCallRow {
  id: number
  key_id: string
  route: string
  model: string | null
  result: string
  http_status: number
  prompt_tokens: number | null
  completion_tokens: number | null
  latency_ms: number | null
  ip_hash: string | null
  created_at: number
}

/**
 * 保留期清理（P0-4）：删除 `created_at < cutoff` 的审计，返回删除条数。
 *
 * 为什么要分批：`ai_calls` 是唯一会无界增长的表（配额只限「每天多少」，不限「总共多少」）。
 * 单条 `DELETE ... WHERE created_at < ?` 在攒了几万行后会长时间持有写锁，把同一时刻的
 * AI 请求卡在 `SQLITE_BUSY` 上。这里每轮最多 500 行，轮次之间让出事件循环，
 * 锁的持有时间从「秒级」降到「毫秒级」。
 *
 * 不做的事：不顺手清 `ai_usage`（那是按天的汇总，几十行，删了反而丢掉历史成本曲线），
 * 也不删 `job_runs`（每天一行）。
 */
export const AI_AUDIT_PRUNE_BATCH = 500

export function pruneAiCalls(db: Db, cutoff: number, batchSize = AI_AUDIT_PRUNE_BATCH): number {
  const limit = Math.max(1, Math.trunc(batchSize))
  const cutoffMs = Math.trunc(cutoff)
  // 用 id 做 IN 子查询而不是 DELETE ... LIMIT：后者需要 SQLITE_ENABLE_UPDATE_DELETE_LIMIT
  // 编译选项，Node 自带的那份不保证开启。
  const statement = db.prepare(
    `DELETE FROM ai_calls
      WHERE id IN (SELECT id FROM ai_calls WHERE created_at < ? ORDER BY id LIMIT ?)`,
  )
  let total = 0
  // 上限只为防御「cutoff 传错把全表扫空」这种不可恢复的意外：最多清 50 万行/次，剩下的下次继续。
  for (let round = 0; round < 1_000; round += 1) {
    const changes = Number(statement.run(cutoffMs, limit).changes)
    total += changes
    if (changes < limit) break
  }
  return total
}

/** 读最近若干条审计，供排查与测试使用。 */
export function listRecentAiCalls(db: Db, limit = 20): AiCallRow[] {
  const rows = db
    .prepare<AiCallRow>(
      `SELECT id, key_id, route, model, result, http_status, prompt_tokens, completion_tokens,
              latency_ms, ip_hash, created_at
         FROM ai_calls ORDER BY id DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.trunc(limit)))
  return rows
}
