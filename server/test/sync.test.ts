import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import type { PersistDatabase } from '../src/db/index.js'
import { countSyncOps, openPersistDatabase } from '../src/db/index.js'
import { SCHEMA_VERSION } from '../src/db/migrations.js'

/**
 * 同步接口测试：push 幂等 / LWW / 非法实体、bootstrap 事务、pull 游标翻页、鉴权与限流。
 * 表结构已由 db-repositories.test.ts 覆盖，这里只验证 HTTP 层与业务编排。
 */

interface Env {
  app: FastifyInstance
  db: PersistDatabase
}

function setup(env: Record<string, string> = {}): Env {
  const config = loadConfig({ DEEPSEEK_API_KEY: '', ...env } as unknown as NodeJS.ProcessEnv)
  const db = openPersistDatabase({ path: ':memory:' })
  const app = buildApp({ config, db })
  return { app, db }
}

async function close({ app, db }: Env): Promise<void> {
  await app.close()
  db.db.close()
}

interface Account {
  userId: string
  token: string
  recoveryCode: string
}

async function register(app: FastifyInstance): Promise<Account> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/devices', payload: {} })
  expect(response.statusCode).toBe(201)
  return response.json<Account>()
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

function push(
  app: FastifyInstance,
  token: string,
  opId: string,
  entities: Record<string, unknown>[],
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: auth(token),
    payload: { opId, entities },
  })
}

function pull(app: FastifyInstance, token: string, query = 'since=0') {
  return app.inject({ method: 'GET', url: `/api/v1/sync/pull?${query}`, headers: auth(token) })
}

const planItem = {
  kind: 'plan_item',
  id: 'pi_1',
  updatedAt: 1_000,
  data: { id: 'pi_1', date: '2026-11-05', kind: 'study', title: '高数第三章', done: true },
}

describe('POST /api/v1/sync/push', () => {
  it('写入实体后可从 pull 原样读回（含单行 profile）', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      const profile = {
        kind: 'profile',
        updatedAt: 900,
        data: { age: 30, height: 175, goal: '减脂', aiConsent: true },
      }

      const response = await push(env.app, account.token, 'op-1', [profile, planItem])
      expect(response.statusCode).toBe(200)
      const result = response.json()
      expect(result.applied).toBe(2)
      expect(result.skipped).toEqual([])
      expect(result.serverRev).toBeGreaterThanOrEqual(2)

      const page = await pull(env.app, account.token)
      expect(page.statusCode).toBe(200)
      const body = page.json()
      expect(body.entities).toHaveLength(2)
      expect(body.hasMore).toBe(false)
      expect(body.nextSince).toBe(result.serverRev)

      const single = body.entities.find((entity: { kind: string }) => entity.kind === 'profile')
      expect(single.id).toBeNull()
      expect(single.deleted).toBe(false)
      expect(single.data).toMatchObject({ age: 30, goal: '减脂' })

      const item = body.entities.find((entity: { kind: string }) => entity.kind === 'plan_item')
      expect(item.id).toBe('pi_1')
      expect(item.data).toMatchObject({ title: '高数第三章', done: true })
      expect(item.updatedAt).toBe(1_000)
    } finally {
      await close(env)
    }
  })

  it('同一 opId 重试回放上次结果，不重复写', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      const first = await push(env.app, account.token, 'op-retry', [planItem])
      const second = await push(env.app, account.token, 'op-retry', [planItem])

      expect(second.statusCode).toBe(200)
      expect(second.json()).toEqual(first.json())
      expect(countSyncOps(env.db.db)).toBe(1)
      expect((await pull(env.app, account.token)).json().entities).toHaveLength(1)
    } finally {
      await close(env)
    }
  })

  it('别的账号不能复用同一个 opId', async () => {
    const env = setup()
    try {
      const first = await register(env.app)
      const second = await register(env.app)
      await push(env.app, first.token, 'op-shared', [planItem])

      const stolen = await push(env.app, second.token, 'op-shared', [planItem])
      expect(stolen.statusCode).toBe(400)
      expect(stolen.json().error.code).toBe('invalid_request')
    } finally {
      await close(env)
    }
  })

  it('LWW：旧的 updatedAt 被跳过为 stale，新版本保留', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      await push(env.app, account.token, 'op-new', [
        { ...planItem, updatedAt: 2_000, data: { ...planItem.data, done: false } },
      ])
      const stale = await push(env.app, account.token, 'op-old', [
        { ...planItem, updatedAt: 1_000, data: { ...planItem.data, done: true } },
      ])

      expect(stale.statusCode).toBe(200)
      expect(stale.json().applied).toBe(0)
      expect(stale.json().skipped).toEqual([{ kind: 'plan_item', id: 'pi_1', reason: 'stale' }])

      const page = (await pull(env.app, account.token)).json()
      expect(page.entities[0].data.done).toBe(false)
      expect(page.entities[0].updatedAt).toBe(2_000)
    } finally {
      await close(env)
    }
  })

  it('业务字段非法只跳过单条，不影响同批其他实体', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      const invalid = {
        kind: 'diet_entry',
        id: 'd_1',
        updatedAt: 1_500,
        data: { id: 'd_1', meal: 'breakfast' }, // 缺 date
      }

      const response = await push(env.app, account.token, 'op-mixed', [planItem, invalid])
      expect(response.statusCode).toBe(200)
      const result = response.json()
      expect(result.applied).toBe(1)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0]).toMatchObject({ kind: 'diet_entry', id: 'd_1', reason: 'invalid' })
      expect(typeof result.skipped[0].message).toBe('string')

      const page = (await pull(env.app, account.token)).json()
      expect(page.entities.map((entity: { kind: string }) => entity.kind)).toEqual(['plan_item'])
    } finally {
      await close(env)
    }
  })

  it('删除写成墓碑，pull 读到 deleted 且不带 payload', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      await push(env.app, account.token, 'op-add', [planItem])
      const removed = await push(env.app, account.token, 'op-del', [
        { kind: 'plan_item', id: 'pi_1', updatedAt: 3_000, deleted: true },
      ])
      expect(removed.statusCode).toBe(200)
      expect(removed.json().applied).toBe(1)

      const page = (await pull(env.app, account.token)).json()
      expect(page.entities).toHaveLength(1)
      expect(page.entities[0]).toMatchObject({ id: 'pi_1', deleted: true, data: null })
      expect(page.entities[0].rev).toBeGreaterThan(0)
    } finally {
      await close(env)
    }
  })

  it('删除服务端从未见过的行返回 missing', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      const response = await push(env.app, account.token, 'op-missing', [
        { kind: 'plan_item', id: 'never', updatedAt: 3_000, deleted: true },
      ])
      expect(response.json().applied).toBe(0)
      expect(response.json().skipped).toEqual([
        { kind: 'plan_item', id: 'never', reason: 'missing' },
      ])
    } finally {
      await close(env)
    }
  })

  it('id 可以放在 data 里（前端状态切片就是这么存的）', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      const response = await push(env.app, account.token, 'op-data-id', [
        {
          kind: 'study_record',
          updatedAt: 1_200,
          data: { id: 's_1', date: '2026-11-05', category: 'english', duration: 30 },
        },
      ])
      expect(response.json().applied).toBe(1)

      const page = (await pull(env.app, account.token)).json()
      expect(page.entities[0].id).toBe('s_1')
    } finally {
      await close(env)
    }
  })

  it('请求形状不对整批 400', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      const cases: Record<string, unknown>[] = [
        { entities: [planItem] },
        { opId: 'x'.repeat(129), entities: [planItem] },
        { opId: 'op-empty', entities: [] },
        { opId: 'op-kind', entities: [{ kind: 'unknown', updatedAt: 1_000, data: {} }] },
        { opId: 'op-time', entities: [{ kind: 'plan_item', updatedAt: '1', data: {} }] },
        { opId: 'op-many', entities: Array.from({ length: 501 }, () => planItem) },
      ]
      for (const payload of cases) {
        const response = await env.app.inject({
          method: 'POST',
          url: '/api/v1/sync/push',
          headers: auth(account.token),
          payload,
        })
        expect(response.statusCode).toBe(400)
        expect(response.json().error.code).toBe('invalid_request')
      }
    } finally {
      await close(env)
    }
  })
})

describe('POST /api/v1/sync/bootstrap', () => {
  it('一个事务写完，重复上传只会得到 stale', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      const entities = [
        planItem,
        {
          kind: 'goal',
          id: 'g_1',
          updatedAt: 1_100,
          data: { id: 'g_1', date: '2026-11-05', title: '每周三练', enabled: true },
        },
        { kind: 'settings', updatedAt: 1_050, data: { summaryOnly: true } },
      ]

      const first = await env.app.inject({
        method: 'POST',
        url: '/api/v1/sync/bootstrap',
        headers: auth(account.token),
        payload: { entities },
      })
      expect(first.statusCode).toBe(200)
      expect(first.json().applied).toBe(3)

      const again = await env.app.inject({
        method: 'POST',
        url: '/api/v1/sync/bootstrap',
        headers: auth(account.token),
        payload: { entities },
      })
      expect(again.json().applied).toBe(0)
      expect(again.json().skipped).toHaveLength(3)

      const page = (await pull(env.app, account.token)).json()
      expect(page.entities).toHaveLength(3)
    } finally {
      await close(env)
    }
  })

  it('超过单次上限（2000 条）拒绝', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      const response = await env.app.inject({
        method: 'POST',
        url: '/api/v1/sync/bootstrap',
        headers: auth(account.token),
        payload: { entities: Array.from({ length: 2_001 }, () => planItem) },
      })
      expect(response.statusCode).toBe(400)
    } finally {
      await close(env)
    }
  })
})

describe('GET /api/v1/sync/pull', () => {
  it('按 rev 游标翻页，不重不漏', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      const entities = Array.from({ length: 5 }, (_, index) => ({
        kind: 'goal',
        id: `g_${index}`,
        updatedAt: 1_000 + index,
        data: { id: `g_${index}`, date: '2026-11-05', title: `目标 ${index}`, enabled: true },
      }))
      await push(env.app, account.token, 'op-many-goals', entities)

      const seen: string[] = []
      let since = 0
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const page = (await pull(env.app, account.token, `since=${since}&limit=2`)).json()
        expect(page.entities.length).toBeLessThanOrEqual(2)
        seen.push(...page.entities.map((entity: { id: string }) => entity.id))
        if (!page.hasMore) break
        since = page.nextSince
      }
      expect(seen).toHaveLength(5)
      expect(new Set(seen).size).toBe(5)
    } finally {
      await close(env)
    }
  })

  it('limit 越界被夹到合法范围，since 非法按 0 处理', async () => {
    const env = setup()
    try {
      const account = await register(env.app)
      await push(env.app, account.token, 'op-limit', [
        planItem,
        { ...planItem, id: 'pi_2', data: { ...planItem.data, id: 'pi_2' } },
      ])

      expect(
        (await pull(env.app, account.token, 'since=abc&limit=0')).json().entities,
      ).toHaveLength(1)
      expect(
        (await pull(env.app, account.token, 'since=-5&limit=9999')).json().entities,
      ).toHaveLength(2)
    } finally {
      await close(env)
    }
  })

  it('未授权与错误令牌都是 401', async () => {
    const env = setup()
    try {
      const anonymous = await env.app.inject({ method: 'GET', url: '/api/v1/sync/pull?since=0' })
      expect(anonymous.statusCode).toBe(401)
      expect(anonymous.json().error.code).toBe('unauthorized')

      const anonymousPush = await env.app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        payload: { opId: 'op-anon', entities: [planItem] },
      })
      expect(anonymousPush.statusCode).toBe(401)

      const bogus = await pull(env.app, 'pst_bogus')
      expect(bogus.statusCode).toBe(401)
    } finally {
      await close(env)
    }
  })

  it('同步接口按自己的额度限流', async () => {
    const env = setup({ SYNC_RATE_LIMIT_MAX: '3' })
    try {
      const account = await register(env.app)
      await push(env.app, account.token, 'op-rl', [planItem])
      await pull(env.app, account.token)
      const overflow = await pull(env.app, account.token)
      expect(overflow.statusCode).toBe(429)
      expect(overflow.json().error.code).toBe('rate_limited')
    } finally {
      await close(env)
    }
  })
})

describe('GET /api/health', () => {
  it('带有 db 与 version，且库可用时 status 为 ok', async () => {
    const env = setup()
    try {
      const response = await env.app.inject({ method: 'GET', url: '/api/health' })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.status).toBe('ok')
      expect(body.service).toBe('persist-server')
      expect(body.db).toBe('ok')
      expect(body.version).toBe(SCHEMA_VERSION)
      expect(body.ai).toBe('disabled')
    } finally {
      await close(env)
    }
  })
})
