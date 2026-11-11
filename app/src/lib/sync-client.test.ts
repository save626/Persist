import { describe, expect, it, vi } from 'vitest'
import {
  createSyncClient,
  nextBackoffMs,
  SYNC_RETRY_BASE_MS,
  SYNC_RETRY_MAX_MS,
  SyncRequestError,
} from './sync-client'

type FetchCall = { url: string; init: RequestInit }

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function fakeFetch(responses: Array<Response | Error | (() => Response)>) {
  const calls: FetchCall[] = []
  const queue = responses.slice()
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = queue.shift()
    if (next === undefined) throw new Error('没有预设的响应了')
    if (next instanceof Error) throw next
    return typeof next === 'function' ? next() : next
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

const CREDENTIALS = { userId: 'u1', deviceId: 'd1', token: 't-1' }

describe('createSyncClient', () => {
  it('注册：POST /api/v1/devices，带 label 与 JSON 头，不带令牌', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse({ ...CREDENTIALS, recoveryCode: 'a'.repeat(32) }, 201),
    ])
    const client = createSyncClient({ fetchImpl, baseUrl: 'http://localhost:3100/' })
    const result = await client.register({ label: '桌面浏览器' })

    expect(result.recoveryCode).toHaveLength(32)
    expect(result.userId).toBe('u1')
    expect(calls[0]?.url).toBe('http://localhost:3100/api/v1/devices')
    expect(calls[0]?.init.method).toBe('POST')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
    expect(headers.authorization).toBeUndefined()
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ label: '桌面浏览器' })
  })

  it('注册响应缺 recoveryCode 时判为不可用，避免半截凭据落库', async () => {
    const { fetchImpl } = fakeFetch([jsonResponse(CREDENTIALS, 201)])
    const client = createSyncClient({ fetchImpl })
    await expect(client.register({})).rejects.toMatchObject({
      name: 'SyncRequestError',
      kind: 'invalid',
    })
  })

  it('push 带 Bearer 令牌与 opId，并解析 skipped', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse({
        applied: 1,
        serverRev: 7,
        skipped: [{ kind: 'goal', id: 'g1', reason: 'invalid' }],
      }),
    ])
    const client = createSyncClient({ fetchImpl })
    const result = await client.push('token-1', {
      opId: 'op-1',
      entities: [{ kind: 'goal', id: 'g1', updatedAt: 1, deleted: false, data: { id: 'g1' } }],
    })

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token-1')
    expect(result.applied).toBe(1)
    expect(result.serverRev).toBe(7)
    expect(result.skipped[0]?.reason).toBe('invalid')
  })

  it('pull：GET + since/limit 查询参数，limit 夹到上限、since 不为负', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse({ entities: [], nextSince: 3, hasMore: true }),
    ])
    const client = createSyncClient({ fetchImpl })
    const result = await client.pull('token-1', { since: -5, limit: 99_999 })

    expect(result.nextSince).toBe(3)
    expect(result.hasMore).toBe(true)
    const url = new URL(calls[0]?.url ?? '', 'http://localhost')
    expect(url.pathname).toBe('/api/v1/sync/pull')
    expect(url.searchParams.get('since')).toBe('0')
    expect(url.searchParams.get('limit')).toBe('1000')
  })

  it('restore / revoke 走对应路径并解析响应', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse(CREDENTIALS),
      jsonResponse({ revoked: true, deviceId: 'd1' }),
    ])
    const client = createSyncClient({ fetchImpl })

    expect(await client.restore({ recoveryCode: 'x'.repeat(32), label: '新手机' })).toEqual(
      CREDENTIALS,
    )
    expect(await client.revoke('token-1', {})).toEqual({ revoked: true, deviceId: 'd1' })
    expect(new URL(calls[0]?.url ?? '', 'http://localhost').pathname).toBe(
      '/api/v1/devices/restore',
    )
    expect(new URL(calls[1]?.url ?? '', 'http://localhost').pathname).toBe('/api/v1/devices/revoke')
  })

  it('bootstrap 走全量上传接口', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse({ applied: 2, skipped: [], serverRev: 2 }),
    ])
    const client = createSyncClient({ fetchImpl })
    const result = await client.bootstrap('token-1', { entities: [] })
    expect(result.applied).toBe(2)
    expect(new URL(calls[0]?.url ?? '', 'http://localhost').pathname).toBe('/api/v1/sync/bootstrap')
  })

  it('deleteAccount 使用 DELETE + confirm:true + Bearer，并解析删除结果', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse({
        deleted: true,
        deletedAt: 1_762_761_600_000,
        counts: { profile: 1, settings: 1 },
      }),
    ])
    const client = createSyncClient({ fetchImpl, baseUrl: 'http://localhost:3100/' })
    const result = await client.deleteAccount('token-delete')

    expect(result.deleted).toBe(true)
    expect(result.deletedAt).toBe(1_762_761_600_000)
    expect(calls[0]?.url).toBe('http://localhost:3100/api/v1/account')
    expect(calls[0]?.init.method).toBe('DELETE')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token-delete')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ confirm: true })
  })
})

describe('失败分类', () => {
  it('401 不可重试，提示令牌失效', async () => {
    const { fetchImpl } = fakeFetch([
      jsonResponse({ error: { code: 'unauthorized', message: '缺少或无效的设备令牌。' } }, 401),
    ])
    const client = createSyncClient({ fetchImpl })
    const error = await client.pull('bad', { since: 0, limit: 10 }).catch((caught) => caught)

    expect(error).toBeInstanceOf(SyncRequestError)
    expect(error.kind).toBe('unauthorized')
    expect(error.retryable).toBe(false)
    expect(error.message).toBe('缺少或无效的设备令牌。')
  })

  it('429 / 5xx 可重试，400 不可重试', async () => {
    const rate = await createSyncClient({
      fetchImpl: fakeFetch([
        jsonResponse({ error: { code: 'rate_limited', message: '慢点' } }, 429),
      ]).fetchImpl,
    })
      .push('t', { opId: 'o', entities: [] })
      .catch((caught) => caught)
    expect(rate.kind).toBe('rate-limited')
    expect(rate.retryable).toBe(true)

    const server = await createSyncClient({
      fetchImpl: fakeFetch([jsonResponse(null, 503)]).fetchImpl,
    })
      .pull('t', { since: 0, limit: 10 })
      .catch((caught) => caught)
    expect(server.kind).toBe('server')
    expect(server.retryable).toBe(true)

    const invalid = await createSyncClient({
      fetchImpl: fakeFetch([
        jsonResponse({ error: { code: 'invalid_request', message: '参数不对' } }, 400),
      ]).fetchImpl,
    })
      .push('t', { opId: 'o', entities: [] })
      .catch((caught) => caught)
    expect(invalid.kind).toBe('invalid')
    expect(invalid.retryable).toBe(false)
  })

  it('网络异常归为 network，可重试', async () => {
    const { fetchImpl } = fakeFetch([new TypeError('Failed to fetch')])
    const error = await createSyncClient({ fetchImpl })
      .pull('t', { since: 0, limit: 10 })
      .catch((caught) => caught)
    expect(error.kind).toBe('network')
    expect(error.retryable).toBe(true)
  })

  it('超时归为 timeout，可重试', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    ) as unknown as typeof fetch
    const error = await createSyncClient({ fetchImpl, timeoutMs: 5 })
      .pull('t', { since: 0, limit: 10 })
      .catch((caught) => caught)
    expect(error.kind).toBe('timeout')
    expect(error.retryable).toBe(true)
  })
})

describe('nextBackoffMs', () => {
  it('5 秒起步、逐次翻倍、封顶 5 分钟', () => {
    expect(nextBackoffMs(0, () => 0)).toBe(SYNC_RETRY_BASE_MS)
    expect(nextBackoffMs(1, () => 0)).toBe(10_000)
    expect(nextBackoffMs(2, () => 0)).toBe(20_000)
    expect(nextBackoffMs(99, () => 0)).toBe(SYNC_RETRY_MAX_MS)
  })

  it('抖动有上限，不会超过封顶', () => {
    const base = nextBackoffMs(0, () => 1)
    expect(base).toBeGreaterThan(SYNC_RETRY_BASE_MS)
    expect(base).toBeLessThanOrEqual(SYNC_RETRY_BASE_MS + 1_000)
    expect(nextBackoffMs(99, () => 1)).toBe(SYNC_RETRY_MAX_MS)
  })
})
