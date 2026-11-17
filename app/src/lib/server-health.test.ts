import { describe, expect, it } from 'vitest'
import {
  SERVER_HEALTH_ENDPOINT,
  checkServerHealth,
  type CheckServerHealthOptions,
} from './server-health'
import type { FetchLike } from './ai-report-client'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  return { calls, fetchImpl }
}

const readyBody = {
  status: 'ok',
  service: 'persist-server',
  ai: 'deepseek',
  model: 'deepseek-chat',
  db: 'ok',
  version: 4,
}

function check(handler: Parameters<typeof stubFetch>[0], extra: CheckServerHealthOptions = {}) {
  const stub = stubFetch(handler)
  return checkServerHealth({ fetchImpl: stub.fetchImpl, ...extra }).then((health) => ({
    health,
    calls: stub.calls,
  }))
}

describe('checkServerHealth', () => {
  it('status ok + ai deepseek 才算就绪，并把 schema 版本写进结论', async () => {
    const { health, calls } = await check(() => jsonResponse(readyBody))

    expect(health.kind).toBe('ready')
    expect(health.version).toBe(4)
    expect(health.message).toContain('DeepSeek 已配置')
    expect(health.message).toContain('schema v4')
    expect(calls[0]?.url).toBe(SERVER_HEALTH_ENDPOINT)
    expect(calls[0]?.init?.method).toBe('GET')
  })

  it('版本号缺失时只是不说版本，不影响就绪判定', async () => {
    const { health } = await check(() => jsonResponse({ ...readyBody, version: undefined }))

    expect(health.kind).toBe('ready')
    expect(health.version).toBeNull()
    expect(health.message).not.toContain('schema')
  })

  it('模型密钥没配时单独成一类，不要笼统说「连接失败」', async () => {
    const { health } = await check(() => jsonResponse({ ...readyBody, ai: 'disabled' }))

    expect(health.kind).toBe('ai-disabled')
    expect(health.version).toBe(4)
    expect(health.message).toContain('模型密钥')
  })

  it('数据库降级优先于模型状态：库坏了说「没配密钥」会把人引偏', async () => {
    const { health } = await check(() =>
      jsonResponse({ ...readyBody, status: 'degraded', db: 'error', ai: 'disabled' }),
    )

    expect(health.kind).toBe('degraded')
    expect(health.message).toContain('数据库')
  })

  it('非 200 按不可达处理，并带上状态码', async () => {
    const { health } = await check(() =>
      jsonResponse({ error: { code: 'ai_unavailable' } }, 503),
    )

    expect(health.kind).toBe('unreachable')
    expect(health.message).toContain('503')
  })

  it('返回 HTML（反代错误页）时不要当成 JSON 崩掉', async () => {
    const { health } = await check(
      () =>
        new Response('<html>502 Bad Gateway</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    )

    expect(health.kind).toBe('unreachable')
    expect(health.message).toContain('不是 JSON')
  })

  it('JSON 不是对象时也不认', async () => {
    const { health } = await check(() => jsonResponse(['ok']))

    expect(health.kind).toBe('unreachable')
    expect(health.message).toContain('结构')
  })

  it('网络直接失败时给「连不上」，不是超时', async () => {
    const { health } = await check(() => {
      throw new TypeError('fetch failed')
    })

    expect(health.kind).toBe('unreachable')
    expect(health.message).toContain('连不上服务端')
    expect(health.message).not.toContain('超时')
  })

  it('请求挂住时会自己中断，按钮不会永远停在「测试中」', async () => {
    // 只在 signal 被 abort 时才 reject：这样测的是超时逻辑本身，而不是一个立刻失败的 fetch。
    const hang: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })

    const health = await checkServerHealth({ fetchImpl: hang, timeoutMs: 20 })

    expect(health.kind).toBe('unreachable')
    expect(health.message).toContain('超时')
  })
})
