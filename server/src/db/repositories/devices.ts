import type { Db } from '../driver.js'

/**
 * 账号与设备表的读写。
 *
 * 表结构见 `migrations.ts` v1：`users` 存账号与恢复码哈希，`devices` 存设备令牌哈希、
 * 最后活跃时间与吊销时间。一个账号可以有多台设备，但「个人自用工具」的定位下
 * 不提供设备管理页面，只在同步面板显示本机与吊销入口。
 */

export interface UserRecord {
  id: string
  createdAt: number
  recoveryHash: string | null
}

export interface DeviceRecord {
  id: string
  userId: string
  label: string | null
  createdAt: number
  lastSeenAt: number | null
  revokedAt: number | null
}

/** 认证成功后返回给路由的上下文。 */
export interface AuthContext {
  userId: string
  deviceId: string
  label: string | null
}

interface DeviceRow {
  id: string
  user_id: string
  label: string | null
  created_at: number
  last_seen_at: number | null
  revoked_at: number | null
}

function toDevice(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    createdAt: Number(row.created_at),
    lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
  }
}

export function createUser(
  db: Db,
  input: { id: string; recoveryHash: string; now: number },
): UserRecord {
  db.prepare('INSERT INTO users (id, created_at, recovery_hash) VALUES (?, ?, ?)').run(
    input.id,
    Math.trunc(input.now),
    input.recoveryHash,
  )
  return { id: input.id, createdAt: Math.trunc(input.now), recoveryHash: input.recoveryHash }
}

export function createDevice(
  db: Db,
  input: { id: string; userId: string; tokenHash: string; label: string | null; now: number },
): DeviceRecord {
  db.prepare(
    'INSERT INTO devices (id, user_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(input.id, input.userId, input.tokenHash, input.label, Math.trunc(input.now))
  return {
    id: input.id,
    userId: input.userId,
    label: input.label,
    createdAt: Math.trunc(input.now),
    lastSeenAt: null,
    revokedAt: null,
  }
}

/** 换恢复码（当前实现不做轮换，保留给将来需要时用）。 */
export function updateRecoveryHash(db: Db, userId: string, recoveryHash: string): void {
  db.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').run(recoveryHash, userId)
}

export function findUserByRecoveryHash(db: Db, recoveryHash: string): UserRecord | null {
  const row = db
    .prepare<{ id: string; created_at: number; recovery_hash: string | null }>(
      'SELECT id, created_at, recovery_hash FROM users WHERE recovery_hash = ? AND deleted_at IS NULL',
    )
    .get(recoveryHash)
  return row
    ? { id: row.id, createdAt: Number(row.created_at), recoveryHash: row.recovery_hash }
    : null
}

/**
 * 按令牌哈希找设备。吊销的设备、已删除账号（步骤 14）一律当作不存在：
 * 调用方统一回 401，不区分「没这个令牌」和「令牌被吊销」，避免给探测者额外信息。
 */
export function findActiveDevice(db: Db, tokenHash: string): AuthContext | null {
  const row = db
    .prepare<{ id: string; user_id: string; label: string | null }>(
      `SELECT d.id, d.user_id, d.label
         FROM devices d JOIN users u ON u.id = d.user_id
        WHERE d.token_hash = ? AND d.revoked_at IS NULL AND u.deleted_at IS NULL`,
    )
    .get(tokenHash)
  return row ? { userId: row.user_id, deviceId: row.id, label: row.label } : null
}

export function listDevices(db: Db, userId: string): DeviceRecord[] {
  return db
    .prepare<DeviceRow>(
      'SELECT id, user_id, label, created_at, last_seen_at, revoked_at FROM devices WHERE user_id = ? ORDER BY created_at ASC',
    )
    .all(userId)
    .map(toDevice)
}

export function revokeDevice(db: Db, userId: string, deviceId: string, now: number): boolean {
  const result = db
    .prepare(
      'UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    )
    .run(Math.trunc(now), deviceId, userId)
  return result.changes === 1
}

/** 每个认证请求顺手刷新一次最后活跃时间；只在值变化超过 60 s 时才写，避免无意义写放大。 */
export function touchDevice(db: Db, deviceId: string, now: number): void {
  const timestamp = Math.trunc(now)
  db.prepare(
    `UPDATE devices SET last_seen_at = ?
      WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)`,
  ).run(timestamp, deviceId, timestamp - 60_000)
}

export function countUsers(db: Db): number {
  const row = db.prepare<{ total: number }>('SELECT COUNT(*) AS total FROM users').get()
  return row ? Number(row.total) : 0
}

export function countDevices(db: Db, userId?: string): number {
  const row = userId
    ? db
        .prepare<{ total: number }>('SELECT COUNT(*) AS total FROM devices WHERE user_id = ?')
        .get(userId)
    : db.prepare<{ total: number }>('SELECT COUNT(*) AS total FROM devices').get()
  return row ? Number(row.total) : 0
}

/** 14d 删除前的安全预检：只统计未删除账号，避免把已删除账号算成“其他人”。 */
export function countActiveUsers(db: Db): number {
  const row = db
    .prepare<{ total: number }>('SELECT COUNT(*) AS total FROM users WHERE deleted_at IS NULL')
    .get()
  return row ? Number(row.total) : 0
}
