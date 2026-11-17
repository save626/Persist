import type { Db } from '../db/driver.js'
import { hashIp } from '../ai/ai-audit.js'

/**
 * 数据操作审计（P5-2）。
 *
 * `ai_calls` 回答的是「谁调了模型」，这里的表回答另一半问题：**「账号与数据被怎么动过」**
 * ——建设备、吊销设备、删账号、建快照、恢复快照、导出。这些动作此前只有 journald
 * 上的一行日志，日志滚掉就再也查不到；而它们恰恰是「数据没了是从哪一步开始的」
 * 这类溯源问题的关键证据。
 *
 * 四条硬约束（与 `ai_calls` 同源，理由也相同）：
 * 1. **不记正文**：导出与备份都涉及全量业务数据，`detail_json` 只放计数、文件名、配置值
 *    这类必要字段，绝不塞实体内容。
 * 2. **不记 IP 明文**，只存 sha256 前 16 位。这不是匿名化：IPv4 空间足够小，穷举可还原。
 *    它只用于「同源聚类」，文档里写清楚，不假装不可逆。
 * 3. **不抛错**：审计是旁路。库写不进去（磁盘满、锁超时）时宁可丢一条审计，
 *    也不能让一次正常的删除 / 恢复变成 500。
 * 4. **账号删除后置空而非删行**：见 `deleteAccount` 里的 `UPDATE audit_log`。
 *    事件本身是运维事实，但不应继续指向具体账号。
 */

/** 动作清单。新增动作要同步测试里的白名单，避免「写了但没人查」的孤儿值。 */
export const AUDIT_ACTIONS = [
  'device.create',
  'device.restore',
  'device.revoke',
  'account.delete',
  'backup.create',
  'backup.restore',
  'export.read',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_RESULTS = ['ok', 'denied', 'error'] as const

export type AuditResult = (typeof AUDIT_RESULTS)[number]

export const AUDIT_ACTORS = ['user', 'system'] as const

export type AuditActor = (typeof AUDIT_ACTORS)[number]

export interface AuditRecord {
  /** 归属账号；删账号事件传 null（那时账号已经不存在了）。 */
  userId?: string | null
  action: AuditAction
  /** 作用对象：设备 ID、快照文件名等。没有合适对象时留空。 */
  target?: string | null
  result?: AuditResult
  actor?: AuditActor
  /** 小体量结构化补充（计数、字节数、文件名）。**不要放实体内容**。 */
  detail?: Record<string, unknown> | null
  /** 调用方 IP；内部转哈希后落库，明文不落盘。 */
  ip?: string | null
  now: () => number
}

/** `detail_json` 的上限：超了就整条丢弃而不是截断——截断出来的半段 JSON 无法解析。 */
const MAX_DETAIL_CHARS = 2_000

export const AUDIT_LOG_PRUNE_BATCH = 500

function serializeDetail(detail: Record<string, unknown> | null | undefined): string | null {
  if (!detail) return null
  try {
    const text = JSON.stringify(detail)
    if (!text || text.length > MAX_DETAIL_CHARS) return null
    return text
  } catch {
    // 循环引用之类的意外：宁可不要 detail，也不能让整条审计写不进去。
    return null
  }
}

/**
 * 写一条审计。永远不抛错；失败时调用 `onError` 交给调用方记日志（如果有）。
 */
export function recordAuditEvent(
  db: Db,
  record: AuditRecord,
  onError?: (error: unknown) => void,
): void {
  try {
    db.prepare(
      `INSERT INTO audit_log
         (user_id, actor, action, target, result, detail_json, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.userId ?? null,
      record.actor ?? 'user',
      record.action,
      record.target ?? null,
      record.result ?? 'ok',
      serializeDetail(record.detail),
      hashIp(record.ip),
      Math.trunc(record.now()),
    )
  } catch (error) {
    onError?.(error)
  }
}

/**
 * 按保留期删 `audit_log`。与 `pruneAiCalls` 同一套分批做法：
 * `rowid IN (SELECT ... LIMIT ?)` 循环到删空，避免单条长 DELETE 持写锁。
 *
 * 用 `rowid` 而不是 `id`：`id` 是 `INTEGER PRIMARY KEY`，两者等价，但 `rowid` 在任何
 * 没有显式主键别名的情况下都不会错——这张表以后若改成 `WITHOUT ROWID` 就必须回头看这里。
 */
export function pruneAuditLog(db: Db, cutoff: number, batchSize = AUDIT_LOG_PRUNE_BATCH): number {
  const limit = Math.max(1, Math.trunc(batchSize))
  const cutoffMs = Math.trunc(cutoff)
  const statement = db.prepare(
    `DELETE FROM audit_log
      WHERE rowid IN (SELECT rowid FROM audit_log WHERE created_at < ? LIMIT ?)`,
  )
  let total = 0
  // 上限只防御「cutoff 传错把全表扫空」这种不可恢复的意外。
  for (let round = 0; round < 1_000; round += 1) {
    const changes = Number(statement.run(cutoffMs, limit).changes)
    total += changes
    if (changes < limit) break
  }
  return total
}
