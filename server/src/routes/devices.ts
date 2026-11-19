import type { Db } from '../db/driver.js'
import { errorBody } from '../contract.js'
import type { RateLimiter } from '../rate-limit.js'
import {
  parseDeviceRegisterBody,
  parseDeviceRestoreBody,
  parseDeviceRevokeBody,
  type DeviceRevokeBody,
} from '@persist/shared/contract/sync'
import { recordAuditEvent } from '../audit/audit-log.js'
import {
  registerAccount,
  resetRecoveryCode,
  restoreAccount,
  revokeDevice,
} from '../sync/accounts.js'
import { countActiveUsers } from '../db/repositories/devices.js'
import type { ServerConfig } from '../config.js'
import { enforceRateLimit, requireDevice } from './guards.js'
import type { FastifyInstance } from 'fastify'

/**
 * 账号与设备接口（设计文档 §7.1 / §10）：
 * - POST /api/v1/devices                 首次开启同步：建账号 + 第一台设备
 * - POST /api/v1/devices/restore         凭恢复码换新设备令牌
 * - POST /api/v1/devices/revoke          吊销本机（或指定设备）
 * - POST /api/v1/devices/recovery-code/reset  手动换一张恢复码（旧码立即作废）
 *
 * 所有响应都带 `cache-control: no-store`：令牌与恢复码不允许被任何中间层缓存。
 */

export interface AccountRouteOptions {
  db: Db
  config: ServerConfig
  limiter: RateLimiter
  now: () => number
}

const NO_STORE = 'no-store'

export function registerDeviceRoutes(app: FastifyInstance, options: AccountRouteOptions): void {
  app.post('/api/v1/devices', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return reply

    // 账号总额上限（默认 0 = 不限）。放在参数校验之前：满额时不必先解析请求体。
    // 只在「新注册」这一条路上拦，`/devices/restore`（凭恢复码换机）与已有设备不受影响。
    const maxAccounts = options.config.registrationMaxAccounts
    if (maxAccounts > 0) {
      const active = countActiveUsers(options.db)
      if (active >= maxAccounts) {
        request.log.warn(
          { active, maxAccounts },
          'device registration refused: account cap reached',
        )
        return reply
          .header('cache-control', NO_STORE)
          .code(409)
          .send(
            errorBody(
              'registration_closed',
              `本服务最多允许 ${maxAccounts} 个账号，当前已满。用恢复码在本机登录，或联系管理员。`,
            ),
          )
      }
    }

    const parsed = parseDeviceRegisterBody(request.body)
    if (!parsed.ok) {
      return reply.code(400).send(errorBody('invalid_request', parsed.message))
    }

    const result = registerAccount(options.db, {
      label: parsed.value.label ?? null,
      now: options.now,
    })
    recordAuditEvent(options.db, {
      userId: result.userId,
      action: 'device.create',
      target: result.deviceId,
      ip: request.ip,
      now: options.now,
    })
    return reply.header('cache-control', NO_STORE).code(201).send(result)
  })

  app.post('/api/v1/devices/restore', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return reply

    const parsed = parseDeviceRestoreBody(request.body)
    if (!parsed.ok) {
      return reply.code(400).send(errorBody('invalid_request', parsed.message))
    }

    const restored = restoreAccount(options.db, {
      recoveryCode: parsed.value.recoveryCode,
      label: parsed.value.label ?? null,
      now: options.now,
    })
    if (!restored.ok) {
      // 恢复码错误与账号不存在给同一个响应，不告诉探测者「这个码对但账号没了」。
      return reply
        .header('cache-control', NO_STORE)
        .code(400)
        .send(errorBody('invalid_recovery_code', '恢复码无效，请检查后重试。'))
    }
    recordAuditEvent(options.db, {
      userId: restored.credentials.userId,
      action: 'device.restore',
      target: restored.credentials.deviceId,
      ip: request.ip,
      now: options.now,
    })
    return reply.header('cache-control', NO_STORE).code(200).send(restored.credentials)
  })

  app.post('/api/v1/devices/revoke', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return reply

    const auth = requireDevice(options.db, request, reply, options.now)
    if (!auth) return reply

    const parsed = parseDeviceRevokeBody(request.body)
    if (!parsed.ok) {
      return reply.code(400).send(errorBody('invalid_request', parsed.message))
    }

    const target = (parsed.value as DeviceRevokeBody).deviceId ?? auth.deviceId
    const revoked = revokeDevice(options.db, {
      userId: auth.userId,
      deviceId: target,
      now: options.now,
    })
    if (!revoked) {
      return reply.code(404).send(errorBody('device_not_found', '设备不存在或已被吊销。'))
    }
    recordAuditEvent(options.db, {
      userId: auth.userId,
      action: 'device.revoke',
      target,
      // 吊销自己与吊销别的设备在事后看是两件事：前者通常是换机，后者通常是在止损。
      detail: { self: target === auth.deviceId },
      ip: request.ip,
      now: options.now,
    })
    return reply.header('cache-control', NO_STORE).code(200).send({
      revoked: true,
      deviceId: target,
    })
  })

  /**
   * 手动换一张恢复码。
   *
   * 存在的理由是「开放注册已关闭」这个事实：换机只剩恢复码一条路，恢复码弄丢就
   * 永久锁死账号。新码只在这里返回一次，服务端只存哈希。
   *
   * 三点约束（详见 `sync/accounts.ts` 的 `resetRecoveryCode`）：
   * ① 端点**可重复调用**，响应丢了就再点一次，旧码每次立即作废；
   * ② 其他设备还在用时返回 409，要换码先吊销其他设备；
   * ③ 不提供「旧码宽限期」——两个同时有效的恢复码等于凭证面翻倍。
   */
  app.post('/api/v1/devices/recovery-code/reset', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return reply

    const auth = requireDevice(options.db, request, reply, options.now)
    if (!auth) return reply

    const result = resetRecoveryCode(options.db, { userId: auth.userId })
    if (!result.ok) {
      return reply
        .header('cache-control', NO_STORE)
        .code(409)
        .send(
          errorBody(
            'other_devices_active',
            `这个账号还有 ${result.activeDevices} 台设备在用。请先吊销其他设备，再重新生成恢复码。`,
          ),
        )
    }

    recordAuditEvent(options.db, {
      userId: auth.userId,
      action: 'device.recovery_reset',
      target: auth.deviceId,
      ip: request.ip,
      now: options.now,
    })
    return reply
      .header('cache-control', NO_STORE)
      .code(200)
      .send({ recoveryCode: result.recoveryCode })
  })
}
