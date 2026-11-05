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
  revokeDevice as revokeDeviceRow,
} from '../db/repositories/devices.js'
import type { DeviceCredentials, DeviceRegisterResponse } from './contract.js'

/**
 * 账号相关的业务动作：注册、凭恢复码恢复、吊销设备。
 * 恢复码固定不变（用户只抄一次），换设备时只轮换令牌——
 * 这一点与设计文档「建议轮换」不同，理由写在 docs 的步骤 12 说明里：
 * 恢复码轮换一旦响应丢失，用户手里的纸条就作废了，自用工具的收益不抵风险。
 */

export function registerAccount(
  db: Db,
  options: { label: string | null; now: () => number },
): DeviceRegisterResponse {
  const userId = createUserId()
  const deviceId = createDeviceId()
  const token = generateToken()
  const recoveryCode = generateRecoveryCode()
  const timestamp = options.now()

  db.transaction(() => {
    createUser(db, { id: userId, recoveryHash: hashRecoveryCode(recoveryCode), now: timestamp })
    createDevice(db, {
      id: deviceId,
      userId,
      tokenHash: hashToken(token),
      label: options.label,
      now: timestamp,
    })
  })

  return { userId, deviceId, token, recoveryCode }
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
