import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import type { PersistDatabase } from '../src/db/index.js'
import { openPersistDatabase } from '../src/db/index.js'

/**
 * 账号接口测试：注册、恢复、吊销、限流与 401 路径。
 * 全部走 app.inject（不起端口），库用 :memory:，测试之间互不影响。
 */

function setup(env: Record<string, string> = {}): {
  app: FastifyInstance
  db: PersistDatabase
} {
  // 本文件的多数用例测注册/恢复/吊销机制，默认放开账号数；
  // 账号上限专项用例通过 ...env 显式传 PERSIST_REGISTRATION_MAX_ACCOUNTS=1 覆盖。
  const config = loadConfig({
    DEEPSEEK_API_KEY: '',
    PERSIST_REGISTRATION_MAX_ACCOUNTS: '0',
    ...env,
  } as unknown as NodeJS.ProcessEnv)
  const db = openPersistDatabase({ path: ':memory:' })
  const app = buildApp({ config, db })
  return { app, db }
}

async function close(app: FastifyInstance, db: PersistDatabase): Promise<void> {
  await app.close()
  db.db.close()
}

interface Credentials {
  userId: string
  deviceId: string
  token: string
  recoveryCode: string
}

async function register(
  app: FastifyInstance,
  payload: Record<string, unknown> = {},
): Promise<Credentials> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/devices', payload })
  expect(response.statusCode).toBe(201)
  return response.json<Credentials>()
}

describe('POST /api/v1/devices', () => {
  it('注册返回令牌与恢复码，库里只存哈希', async () => {
    const { app, db } = setup()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/devices',
        payload: { label: '  本机  Chrome  ' },
      })
      expect(response.statusCode).toBe(201)
      expect(response.headers['cache-control']).toBe('no-store')

      const body = response.json<Credentials>()
      expect(body.token).toMatch(/^pst_[A-Za-z0-9_-]{40,}$/)
      expect(body.recoveryCode).toMatch(/^[0-9a-f]{32}$/)
      expect(body.userId).toMatch(/^usr_/)
      expect(body.deviceId).toMatch(/^dev_/)

      const user = db.db
        .prepare<{ recovery_hash: string }>('SELECT recovery_hash FROM users WHERE id = ?')
        .get(body.userId)
      expect(user?.recovery_hash).not.toBe(body.recoveryCode)
      expect(user?.recovery_hash).toMatch(/^[0-9a-f]{64}$/)

      const device = db.db
        .prepare<{ token_hash: string; label: string }>(
          'SELECT token_hash, label FROM devices WHERE id = ?',
        )
        .get(body.deviceId)
      expect(device?.token_hash).not.toBe(body.token)
      expect(device?.token_hash).toMatch(/^[0-9a-f]{64}$/)
      // 首尾空白合并掉，中间多余空格压成一个（只用于展示，不参与鉴权）
      expect(device?.label).toBe('本机 Chrome')
    } finally {
      await close(app, db)
    }
  })

  it('每次注册都是独立账号', async () => {
    const { app, db } = setup()
    try {
      const first = await register(app)
      const second = await register(app)
      expect(first.userId).not.toBe(second.userId)
      expect(first.token).not.toBe(second.token)
      expect(first.recoveryCode).not.toBe(second.recoveryCode)
    } finally {
      await close(app, db)
    }
  })

  it('账号总额上限：满额后拒绝新注册，但恢复码换机仍可用', async () => {
    const { app, db } = setup({ PERSIST_REGISTRATION_MAX_ACCOUNTS: '1' })
    try {
      const first = await register(app)
      const refused = await app.inject({ method: 'POST', url: '/api/v1/devices', payload: {} })
      expect(refused.statusCode).toBe(409)
      expect(refused.json<{ error: { code: string } }>().error.code).toBe('registration_closed')

      // 同一账号凭恢复码换新设备不受上限影响——否则上限一开就把自己锁在门外。
      const restored = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: first.recoveryCode, label: 'tablet' },
      })
      expect(restored.statusCode).toBe(200)
      expect(restored.json<{ userId: string }>().userId).toBe(first.userId)
    } finally {
      await close(app, db)
    }
  })

  it('显式 0 时不限制账号数（多账号部署的显式选择）', async () => {
    const { app, db } = setup({ PERSIST_REGISTRATION_MAX_ACCOUNTS: '0' })
    try {
      await register(app)
      await register(app)
    } finally {
      await close(app, db)
    }
  })

  it('并发注册在写锁下不会突破账号上限（TOCTOU）', async () => {
    const { app, db } = setup({ PERSIST_REGISTRATION_MAX_ACCOUNTS: '1' })
    try {
      const [a, b] = await Promise.all([
        app.inject({ method: 'POST', url: '/api/v1/devices', payload: {} }),
        app.inject({ method: 'POST', url: '/api/v1/devices', payload: {} }),
      ])
      const statuses = [a.statusCode, b.statusCode].sort()
      // 恰好一个成功、一个因满额被拒；绝不允许两个都 201。
      expect(statuses).toEqual([201, 409])
    } finally {
      await close(app, db)
    }
  })

  it('拒绝非法请求体', async () => {
    const { app, db } = setup()
    try {
      const longLabel = await app.inject({
        method: 'POST',
        url: '/api/v1/devices',
        payload: { label: 'x'.repeat(41) },
      })
      expect(longLabel.statusCode).toBe(400)
      expect(longLabel.json().error.code).toBe('invalid_request')

      const arrayBody = await app.inject({
        method: 'POST',
        url: '/api/v1/devices',
        payload: [1, 2, 3],
      })
      expect(arrayBody.statusCode).toBe(400)
      expect(arrayBody.json().error.code).toBe('invalid_request')
    } finally {
      await close(app, db)
    }
  })

  it('超出同步接口限流返回 429 与 retry-after', async () => {
    const { app, db } = setup({ SYNC_RATE_LIMIT_MAX: '2' })
    try {
      await register(app)
      await register(app)
      const overflow = await app.inject({ method: 'POST', url: '/api/v1/devices', payload: {} })
      expect(overflow.statusCode).toBe(429)
      expect(overflow.json().error.code).toBe('rate_limited')
      expect(Number(overflow.headers['retry-after'])).toBeGreaterThan(0)
    } finally {
      await close(app, db)
    }
  })
})

describe('POST /api/v1/devices/restore', () => {
  it('接受带空格 / 大写的恢复码，换发新令牌且复用同一账号', async () => {
    const { app, db } = setup()
    try {
      const first = await register(app)
      const userToken = first.token
      const pretty = first.recoveryCode
        .toUpperCase()
        .replace(/(.{8})/g, '$1 ')
        .trim()

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: pretty, label: '新手机' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')

      const restored = response.json<{ userId: string; deviceId: string; token: string }>()
      expect(restored.userId).toBe(first.userId)
      expect(restored.deviceId).not.toBe(first.deviceId)
      expect(restored.token).not.toBe(userToken)
      expect(response.json()).not.toHaveProperty('recoveryCode')

      // 原设备令牌仍然有效，恢复不踢掉旧设备
      const pull = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/pull?since=0',
        headers: { authorization: `Bearer ${userToken}` },
      })
      expect(pull.statusCode).toBe(200)
    } finally {
      await close(app, db)
    }
  })

  it('恢复码格式或内容不对一律 400，且不透露账号是否存在', async () => {
    const { app, db } = setup()
    try {
      const registerOnce = await register(app)
      const fake = registerOnce.recoveryCode.replace(/^./, (c) => (c === '0' ? '1' : '0'))

      for (const payload of [
        { recoveryCode: 'not-a-code' },
        { recoveryCode: '0'.repeat(32) },
        { recoveryCode: fake },
        {},
        { recoveryCode: 123 },
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/devices/restore',
          payload,
        })
        expect(response.statusCode).toBe(400)
        expect(['invalid_recovery_code', 'invalid_request']).toContain(response.json().error.code)
      }
    } finally {
      await close(app, db)
    }
  })

  it('吊销后仍可用恢复码回到同一账号', async () => {
    const { app, db } = setup()
    try {
      const first = await register(app)
      const revoked = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/revoke',
        headers: { authorization: `Bearer ${first.token}` },
        payload: {},
      })
      expect(revoked.statusCode).toBe(200)

      const restore = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: first.recoveryCode },
      })
      expect(restore.statusCode).toBe(200)
      expect(restore.json().userId).toBe(first.userId)
    } finally {
      await close(app, db)
    }
  })
})

describe('POST /api/v1/devices/revoke', () => {
  it('吊销本机后旧令牌立即失效', async () => {
    const { app, db } = setup()
    try {
      const first = await register(app)
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/revoke',
        headers: { authorization: `Bearer ${first.token}` },
        payload: {},
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ revoked: true, deviceId: first.deviceId })

      const pull = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/pull?since=0',
        headers: { authorization: `Bearer ${first.token}` },
      })
      expect(pull.statusCode).toBe(401)
      expect(pull.json().error.code).toBe('unauthorized')
    } finally {
      await close(app, db)
    }
  })

  it('可以按 deviceId 吊销同账号的其他设备', async () => {
    const { app, db } = setup()
    try {
      const first = await register(app)
      const restored = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: first.recoveryCode },
      })
      const second = restored.json<{ deviceId: string; token: string }>()

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/revoke',
        headers: { authorization: `Bearer ${second.token}` },
        payload: { deviceId: first.deviceId },
      })
      expect(response.statusCode).toBe(200)

      const stalePull = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/pull?since=0',
        headers: { authorization: `Bearer ${first.token}` },
      })
      expect(stalePull.statusCode).toBe(401)

      const ownPull = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/pull?since=0',
        headers: { authorization: `Bearer ${second.token}` },
      })
      expect(ownPull.statusCode).toBe(200)
    } finally {
      await close(app, db)
    }
  })

  it('吊销不存在或别人的设备返回 404，未授权返回 401', async () => {
    const { app, db } = setup()
    try {
      const first = await register(app)
      const other = await register(app)

      const foreign = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/revoke',
        headers: { authorization: `Bearer ${first.token}` },
        payload: { deviceId: other.deviceId },
      })
      expect(foreign.statusCode).toBe(404)
      expect(foreign.json().error.code).toBe('device_not_found')

      const anonymous = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/revoke',
        payload: {},
      })
      expect(anonymous.statusCode).toBe(401)

      const bogus = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/revoke',
        headers: { authorization: 'Bearer pst_not_a_real_token' },
        payload: {},
      })
      expect(bogus.statusCode).toBe(401)
    } finally {
      await close(app, db)
    }
  })
})

/**
 * 恢复码重置。
 *
 * 它存在的唯一理由：开放注册已关闭，换机只剩恢复码一条路，而恢复码只显示一次、
 * 只存哈希——弄丢就永久锁死账号。这里要证明三件事：换出来的码能用、旧的确实作废、
 * 以及「响应丢了也能自愈」（端点可重复调用）。
 */
describe('POST /api/v1/devices/recovery-code/reset', () => {
  it('换出新恢复码：旧码立即失效，新码仍能换回同一账号', async () => {
    const { app, db } = setup()
    try {
      const credentials = await register(app, { label: '本机' })

      const reset = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/recovery-code/reset',
        headers: { authorization: `Bearer ${credentials.token}` },
      })
      expect(reset.statusCode).toBe(200)
      expect(reset.headers['cache-control']).toBe('no-store')

      const body = reset.json<{ recoveryCode: string }>()
      expect(body.recoveryCode).toMatch(/^[0-9a-f]{32}$/)
      expect(body.recoveryCode).not.toBe(credentials.recoveryCode)

      // 库里仍然只有哈希。
      const user = db.db
        .prepare<{ recovery_hash: string }>('SELECT recovery_hash FROM users WHERE id = ?')
        .get(credentials.userId)
      expect(user?.recovery_hash).not.toBe(body.recoveryCode)
      expect(user?.recovery_hash).toMatch(/^[0-9a-f]{64}$/)

      // 旧码立刻作废。
      const stale = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: credentials.recoveryCode },
      })
      expect(stale.statusCode).toBe(400)
      expect(stale.json<{ error: { code: string } }>().error.code).toBe('invalid_recovery_code')

      // 新码换得回同一个账号。
      const fresh = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: body.recoveryCode },
      })
      expect(fresh.statusCode).toBe(200)
      expect(fresh.json<{ userId: string }>().userId).toBe(credentials.userId)
    } finally {
      await close(app, db)
    }
  })

  it('端点可重复调用：再点一次就换一个码，上一个立刻作废（响应丢了也能自愈）', async () => {
    const { app, db } = setup()
    try {
      const credentials = await register(app)

      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/recovery-code/reset',
        headers: { authorization: `Bearer ${credentials.token}` },
      })
      expect(first.statusCode).toBe(200)
      const firstCode = first.json<{ recoveryCode: string }>().recoveryCode

      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/recovery-code/reset',
        headers: { authorization: `Bearer ${credentials.token}` },
      })
      expect(second.statusCode).toBe(200)
      const secondCode = second.json<{ recoveryCode: string }>().recoveryCode
      expect(secondCode).not.toBe(firstCode)

      const reused = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: firstCode },
      })
      expect(reused.statusCode).toBe(400)

      const latest = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: secondCode },
      })
      expect(latest.statusCode).toBe(200)
    } finally {
      await close(app, db)
    }
  })

  it('其他设备还在用时返回 409，不换码', async () => {
    const { app, db } = setup()
    try {
      const credentials = await register(app)
      // 凭恢复码再换一台设备，于是这个账号有 2 台未吊销设备。
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: credentials.recoveryCode, label: '第二台' },
      })
      expect(second.statusCode).toBe(200)

      const reset = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/recovery-code/reset',
        headers: { authorization: `Bearer ${credentials.token}` },
      })
      expect(reset.statusCode).toBe(409)
      expect(reset.json<{ error: { code: string } }>().error.code).toBe('other_devices_active')

      // 被拒时不能把码换掉：原恢复码仍然有效。
      const stillValid = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: credentials.recoveryCode },
      })
      expect(stillValid.statusCode).toBe(200)
    } finally {
      await close(app, db)
    }
  })

  it('吊销其他设备后即可换码', async () => {
    const { app, db } = setup()
    try {
      const credentials = await register(app)
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: credentials.recoveryCode, label: '第二台' },
      })
      expect(second.statusCode).toBe(200)
      const secondDeviceId = second.json<{ deviceId: string }>().deviceId

      const revoke = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/revoke',
        headers: { authorization: `Bearer ${credentials.token}` },
        payload: { deviceId: secondDeviceId },
      })
      expect(revoke.statusCode).toBe(200)

      const reset = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/recovery-code/reset',
        headers: { authorization: `Bearer ${credentials.token}` },
      })
      expect(reset.statusCode).toBe(200)
    } finally {
      await close(app, db)
    }
  })

  it('无有效令牌返回 401，且不换码', async () => {
    const { app, db } = setup()
    try {
      const credentials = await register(app)

      const anonymous = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/recovery-code/reset',
      })
      expect(anonymous.statusCode).toBe(401)

      const bogus = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/recovery-code/reset',
        headers: { authorization: 'Bearer pst_not_a_real_token' },
      })
      expect(bogus.statusCode).toBe(401)

      const stillValid = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/restore',
        payload: { recoveryCode: credentials.recoveryCode },
      })
      expect(stillValid.statusCode).toBe(200)
    } finally {
      await close(app, db)
    }
  })

  it('审计留一行 device.recovery_reset', async () => {
    const { app, db } = setup()
    try {
      const credentials = await register(app)
      const reset = await app.inject({
        method: 'POST',
        url: '/api/v1/devices/recovery-code/reset',
        headers: { authorization: `Bearer ${credentials.token}` },
      })
      expect(reset.statusCode).toBe(200)

      const rows = db.db
        .prepare<{ action: string; result: string; target: string | null }>(
          'SELECT action, result, target FROM audit_log WHERE user_id = ? ORDER BY id',
        )
        .all(credentials.userId)
      const resetRow = rows.find((row) => row.action === 'device.recovery_reset')
      expect(resetRow).toBeDefined()
      expect(resetRow?.result).toBe('ok')
      expect(resetRow?.target).toBe(credentials.deviceId)
    } finally {
      await close(app, db)
    }
  })
})
