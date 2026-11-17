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
         (key_id, route, model, result, http_status, latency_ms, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.keyId?.trim() || 'anonymous',
      record.route,
      record.model ?? null,
      record.result,
      Math.trunc(record.httpStatus),
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

export interface AiCallRow {
  id: number
  key_id: string
  route: string
  model: string | null
  result: string
  http_status: number
  latency_ms: number | null
  ip_hash: string | null
  created_at: number
}

/** 读最近若干条审计，供排查与测试使用。 */
export function listRecentAiCalls(db: Db, limit = 20): AiCallRow[] {
  const rows = db
    .prepare<AiCallRow>(
      `SELECT id, key_id, route, model, result, http_status, latency_ms, ip_hash, created_at
         FROM ai_calls ORDER BY id DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.trunc(limit)))
  return rows
}
