import type { Db } from '../db/driver.js'
import { errorBody } from '../contract.js'
import type { RateLimiter } from '../rate-limit.js'
import {
  parseDeviceRegisterBody,
  parseDeviceRestoreBody,
  parseDeviceRevokeBody,
  type DeviceRevokeBody,
} from '@persist/shared/contract/sync'
import { registerAccount, restoreAccount, revokeDevice } from '../sync/accounts.js'
import { enforceRateLimit, requireDevice } from './guards.js'
import type { FastifyInstance } from 'fastify'

/**
 * 账号与设备接口（设计文档 §7.1 / §10）：
 * - POST /api/v1/devices          首次开启同步：建账号 + 第一台设备
 * - POST /api/v1/devices/restore  凭恢复码换新设备令牌
 * - POST /api/v1/devices/revoke   吊销本机（或指定设备）
 *
 * 所有响应都带 `cache-control: no-store`：令牌与恢复码不允许被任何中间层缓存。
 */

export interface AccountRouteOptions {
  db: Db
  limiter: RateLimiter
  now: () => number
}

const NO_STORE = 'no-store'

export function registerDeviceRoutes(app: FastifyInstance, options: AccountRouteOptions): void {
  app.post('/api/v1/devices', async (request, reply) => {
    if (!enforceRateLimit(options.limiter, request, reply)) return reply

    const parsed = parseDeviceRegisterBody(request.body)
    if (!parsed.ok) {
      return reply.code(400).send(errorBody('invalid_request', parsed.message))
    }

    const result = registerAccount(options.db, {
      label: parsed.value.label ?? null,
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
    return reply.header('cache-control', NO_STORE).code(200).send({
      revoked: true,
      deviceId: target,
    })
  })
}
