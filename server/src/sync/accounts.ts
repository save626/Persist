import {
  hashRecoveryCode,
  hashToken,
  normalizeRecoveryCode,
  createDeviceId,
  createUserId,
  generateRecoveryCode,
  generateToken,
} from '../auth.js'
import type { Db } from '../db/driver.js'
import {
  createDevice,
  createUser,
  findUserByRecoveryHash,
  listDevices,
  revokeDevice as revokeDeviceRow,
  updateRecoveryHash,
} from '../db/repositories/devices.js'
import { countActiveUsers } from '../db/repositories/devices.js'
import type { DeviceCredentials, DeviceRegisterResponse } from '@persist/shared/contract/sync'

/**
 * 账号相关的业务动作：注册、凭恢复码恢复、吊销设备。
 * 恢复码固定不变（用户只抄一次），换设备时只轮换令牌——
 * 这一点与设计文档「建议轮换」不同，理由写在 docs 的步骤 12 说明里：
 * 恢复码轮换一旦响应丢失，用户手里的纸条就作废了，自用工具的收益不抵风险。
 */

/** 账号名额已满。`maxAccounts > 0` 且事务内确认活跃账号数已达上限时抛出。 */
export class RegistrationClosedError extends Error {
  readonly code = 'registration_closed'
  constructor(readonly maxAccounts: number) {
    super(`本服务最多允许 ${maxAccounts} 个账号，当前已满。`)
    this.name = 'RegistrationClosedError'
  }
}

/**
 * 注册新账号 + 第一台设备。
 *
 * `maxAccounts` 的配额检查**在事务内**完成：BEGIN IMMEDIATE 会先拿到写锁，
 * 使「数活跃账号」与「插入新账号」原子化，消除并发注册同时通过检查的 TOCTOU
 * （2026-11-25 安全审查）。`<= 0` 表示不限制。
 */
export function registerAccount(
  db: Db,
  options: { label: string | null; now: () => number; maxAccounts?: number },
): DeviceRegisterResponse {
  const maxAccounts = options.maxAccounts ?? 0
  // 事务返回凭据；仅当检查 + 插入全部成功时才拿到返回值。
  const result = db.transaction(() => {
    if (maxAccounts > 0 && countActiveUsers(db) >= maxAccounts) {
      throw new RegistrationClosedError(maxAccounts)
    }
    const userId = createUserId()
    const deviceId = createDeviceId()
    const token = generateToken()
    const recoveryCode = generateRecoveryCode()
    const timestamp = options.now()

    createUser(db, { id: userId, recoveryHash: hashRecoveryCode(recoveryCode), now: timestamp })
    createDevice(db, {
      id: deviceId,
      userId,
      tokenHash: hashToken(token),
      label: options.label,
      now: timestamp,
    })
    return { userId, deviceId, token, recoveryCode }
  })

  return result
}

export type RestoreResult =
  { ok: true; credentials: DeviceCredentials } | { ok: false; reason: 'invalid_recovery_code' }

export function restoreAccount(
  db: Db,
  options: { recoveryCode: string; label: string | null; now: () => number },
): RestoreResult {
  const normalized = normalizeRecoveryCode(options.recoveryCode)
  if (!normalized) return { ok: false, reason: 'invalid_recovery_code' }

  const user = findUserByRecoveryHash(db, hashRecoveryCode(normalized))
  if (!user) return { ok: false, reason: 'invalid_recovery_code' }

  const deviceId = createDeviceId()
  const token = generateToken()
  createDevice(db, {
    id: deviceId,
    userId: user.id,
    tokenHash: hashToken(token),
    label: options.label,
    now: options.now(),
  })
  return { ok: true, credentials: { userId: user.id, deviceId, token } }
}

export function revokeDevice(
  db: Db,
  options: { userId: string; deviceId: string; now: () => number },
): boolean {
  return revokeDeviceRow(db, options.userId, options.deviceId, options.now())
}

export type ResetRecoveryCodeResult =
  | { ok: true; recoveryCode: string }
  | { ok: false; reason: 'other_devices_active'; activeDevices: number }

/**
 * 手动重置恢复码（用户主动触发，与「换机时自动轮换」是两件不同的事）。
 *
 * **为什么现在需要它**：2026-11-18 开放注册被正式关闭
 * （`PERSIST_REGISTRATION_MAX_ACCOUNTS=1`，生产 `users=1`），换机只剩恢复码这一条路。
 * 恢复码只显示一次、只存哈希，用户弄丢就再也拿不回来——账号会永久锁死，
 * 而唯一的补救是手工改库。仓库里的 `updateRecoveryHash` 早有实现却一直没有调用方。
 *
 * **三条刻意的设计**：
 * ① **可重复调用**：每次调用都换一个新码，旧码立即作废。只要这台设备的令牌还在，
 *    恢复码随时能重新拿——所以「响应丢了 / 忘了抄」不构成死局，再点一次即可。
 *    这正是当初拒绝「换机自动轮换」时担心的那个风险（响应一丢，纸条就废）的解法：
 *    把轮换从「系统悄悄做」改成「用户明确做，且随时能再做一次」。
 * ② **其他设备还在用时拒绝**：多设备场景下，任一设备都能换掉恢复码，等于
 *    一台设备被拿走就能把账号彻底占住。要换码得先把其他设备吊销。
 * ③ **不做「旧码宽限期」**：留两个同时有效的恢复码等于凭证面翻倍，
 *    而「可重复调用」已经把「响应丢失」这个唯一的真实风险兜住了。
 */
export function resetRecoveryCode(db: Db, options: { userId: string }): ResetRecoveryCodeResult {
  const activeDevices = listDevices(db, options.userId).filter(
    (device) => device.revokedAt === null,
  )
  if (activeDevices.length > 1) {
    return { ok: false, reason: 'other_devices_active', activeDevices: activeDevices.length }
  }

  const recoveryCode = generateRecoveryCode()
  updateRecoveryHash(db, options.userId, hashRecoveryCode(recoveryCode))
  return { ok: true, recoveryCode }
}
