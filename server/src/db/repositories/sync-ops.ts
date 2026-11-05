import type { Db } from '../driver.js'

/**
 * 同步幂等：每个 push 批次带一个客户端生成的 `opId`，重放同一 opId 时直接返回上次结果，
 * 不重复应用。表里只存结果摘要（各实体最终 rev / 跳过原因），不存实体正文。
 */

export interface SyncOpRecord {
  opId: string
  deviceId: string
  userId: string
  appliedAt: number
  /** 上次 push 的响应体（JSON 字符串），重放时原样返回。 */
  resultJson: string
}

export function findSyncOp(db: Db, opId: string): SyncOpRecord | null {
  const row = db
    .prepare<{
      op_id: string
      device_id: string
      user_id: string
      applied_at: number
      result_json: string
    }>('SELECT op_id, device_id, user_id, applied_at, result_json FROM sync_ops WHERE op_id = ?')
    .get(opId)
  if (!row) return null
  return {
    opId: row.op_id,
    deviceId: row.device_id,
    userId: row.user_id,
    appliedAt: Number(row.applied_at),
    resultJson: row.result_json,
  }
}

export function recordSyncOp(db: Db, record: SyncOpRecord): void {
  db.prepare(
    `INSERT INTO sync_ops (op_id, device_id, user_id, applied_at, result_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    record.opId,
    record.deviceId,
    record.userId,
    Math.trunc(record.appliedAt),
    record.resultJson,
  )
}

export function countSyncOps(db: Db): number {
  const row = db.prepare<{ total: number }>('SELECT COUNT(*) AS total FROM sync_ops').get()
  return row ? Number(row.total) : 0
}
