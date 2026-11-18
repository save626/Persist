import { describe, expect, it } from 'vitest'
import {
  CHAT_PROBE_ENDPOINT,
  SERVER_HEALTH_ENDPOINT,
  checkChatLink,
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

function sseResponse(frames: string[], status = 200): Response {
  const body = frames.map((frame) => `data: ${frame}\n\n`).join('')
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
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
  db: 'ok',
}

/** 健康检查 + 探针两个阶段，按 URL 分派；`chat` 不传时对话链路一律成功。 */
function check(
  chat: (init?: RequestInit) => Response | Promise<Response> = () =>
    sseResponse(['{"type":"done"}']),
  extra: CheckServerHealthOptions = {},
  health: () => Response = () => jsonResponse(readyBody),
) {
  const stub = stubFetch((url, init) => (url === CHAT_PROBE_ENDPOINT ? chat(init) : health()))
  return checkServerHealth({ fetchImpl: stub.fetchImpl, ...extra }).then((result) => ({
    health: result,
    calls: stub.calls,
  }))
}

describe('checkServerHealth', () => {
  it('健康检查通过后才去测对话链路，两段都过才算就绪', async () => {
    const { health, calls } = await check()

    expect(health.kind).toBe('ready')
    expect(health.chat.kind).toBe('ok')
    expect(health.message).toContain('对话链路可用')
    expect(calls.map((call) => call.url)).toEqual([SERVER_HEALTH_ENDPOINT, CHAT_PROBE_ENDPOINT])
    expect(calls[0]?.init?.method).toBe('GET')
    expect(calls[1]?.init?.method).toBe('POST')
  })

  it('探针是零成本的：请求体只带 probe 标记，不带对话内容', async () => {
    const { calls } = await check()

    const body = JSON.parse(String(calls[1]?.init?.body))
    expect(body).toEqual({ probe: true })
    const headers = calls[1]?.init?.headers as Record<string, string>
    expect(headers.Accept).toBe('text/event-stream')
  })

  it('健康检查通过但凭据被拒（401）时，结论必须是「对话链路异常」，不能报「正常」', async () => {
    const { health } = await check(
      () =>
        jsonResponse({ error: { code: 'ai_unauthorized', message: 'AI 接口需要有效凭据。' } }, 401),
      { credential: 'pst_revoked-token' },
    )

    expect(health.kind).toBe('chat-failed')
    expect(health.chat.kind).toBe('unauthorized')
    expect(health.message).toContain('401')
    expect(health.message).toContain('静默退回')
  })

  it('本来就没带凭据（没开同步的新装环境）时说「待绑定」，不要说成故障', async () => {
    const { health } = await check(() => jsonResponse({ error: { code: 'ai_unauthorized' } }, 401))

    expect(health.kind).toBe('chat-no-credential')
    expect(health.chat.kind).toBe('no-credential')
    expect(health.message).toContain('跨设备同步')
    expect(health.message).not.toContain('静默退回')
  })

  it('浏览器读不到对话流（跨域被拦）时单独成一类：这正是 P5-9 的形态', async () => {
    const { health } = await check(() => {
      throw new TypeError('Failed to fetch')
    })

    expect(health.kind).toBe('chat-failed')
    expect(health.chat.kind).toBe('blocked')
    expect(health.message).toContain('读不到对话流')
  })

  it('对话流没有 done 帧时不算通（被反代缓冲/截断）', async () => {
    const { health } = await check(() => sseResponse(['{"type":"stage","stage":"collect"}']))

    expect(health.kind).toBe('chat-failed')
    expect(health.chat.kind).toBe('error')
    expect(health.message).toContain('done')
  })

  it('demo / guest 这类不调服务端对话的模式跳过探针，不把预期中的 401 报成故障', async () => {
    const { health, calls } = await check(undefined, { checkChat: false })

    expect(health.kind).toBe('ready')
    expect(health.chat.kind).toBe('skipped')
    expect(health.message).toContain('不调用服务端对话')
    expect(calls.map((call) => call.url)).toEqual([SERVER_HEALTH_ENDPOINT])
  })

  it('模型密钥没配时单独成一类，不要笼统说「连接失败」，也不必再测对话', async () => {
    const { health, calls } = await check(undefined, {}, () =>
      jsonResponse({ ...readyBody, ai: 'disabled' }),
    )

    expect(health.kind).toBe('ai-disabled')
    expect(health.chat.kind).toBe('skipped')
    expect(health.message).toContain('模型密钥')
    expect(calls).toHaveLength(1)
  })

  it('数据库降级优先于模型状态：库坏了说「没配密钥」会把人引偏', async () => {
    const { health } = await check(undefined, {}, () =>
      jsonResponse({ ...readyBody, status: 'degraded', db: 'error', ai: 'disabled' }),
    )

    expect(health.kind).toBe('degraded')
    expect(health.message).toContain('数据库')
  })

  it('非 200 按不可达处理，并带上状态码', async () => {
    const { health } = await check(undefined, {}, () =>
      jsonResponse({ error: { code: 'ai_unavailable' } }, 503),
    )

    expect(health.kind).toBe('unreachable')
    expect(health.message).toContain('503')
  })

  it('返回 HTML（反代错误页）时不要当成 JSON 崩掉', async () => {
    const { health } = await check(
      undefined,
      {},
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
    const { health } = await check(undefined, {}, () => jsonResponse(['ok']))

    expect(health.kind).toBe('unreachable')
    expect(health.message).toContain('结构')
  })

  it('网络直接失败时给「连不上」，不是超时', async () => {
    const { health } = await check(undefined, {}, () => {
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

describe('checkChatLink', () => {
  it('读到 done 就算通，并说明这次没花额度', async () => {
    const link = await checkChatLink({
      fetchImpl: async () => sseResponse(['{"type":"stage","stage":"collect"}', '{"type":"done"}']),
      credential: null,
    })

    expect(link.kind).toBe('ok')
    expect(link.message).toContain('未调用模型')
  })

  it('带上传入的凭据；显式给 null 时不带 authorization 头', async () => {
    const seen: Record<string, string>[] = []
    const doFetch: FetchLike = async (_input, init) => {
      seen.push(init?.headers as Record<string, string>)
      return sseResponse(['{"type":"done"}'])
    }

    await checkChatLink({ fetchImpl: doFetch, credential: 'pst_abc' })
    await checkChatLink({ fetchImpl: doFetch, credential: null })

    expect(seen[0]?.authorization).toBe('Bearer pst_abc')
    expect(seen[1]).not.toHaveProperty('authorization')
  })

  it('501 之类的未知状态码给通用文案，不假装是凭据问题', async () => {
    const link = await checkChatLink({
      fetchImpl: async () => new Response('not json', { status: 502 }),
      credential: null,
    })

    expect(link.kind).toBe('error')
    expect(link.message).toContain('502')
  })

  it('503 用服务端给的原因', async () => {
    const link = await checkChatLink({
      fetchImpl: async () =>
        jsonResponse(
          { error: { code: 'ai_not_configured', message: '服务端尚未配置模型密钥。' } },
          503,
        ),
      credential: null,
    })

    expect(link.kind).toBe('ai-disabled')
    expect(link.message).toContain('模型密钥')
  })

  it('429 与 401 分开：一个是等一会儿，一个是凭据没救；401 还分「没带」与「带了被拒」', async () => {
    const limited = await checkChatLink({
      fetchImpl: async () =>
        jsonResponse(
          { error: { code: 'rate_limited', message: '请求过于频繁，请稍后再试。' } },
          429,
        ),
      credential: null,
    })
    const missing = await checkChatLink({
      fetchImpl: async () => jsonResponse({ error: { code: 'ai_unauthorized' } }, 401),
      credential: null,
    })
    const revoked = await checkChatLink({
      fetchImpl: async () => jsonResponse({ error: { code: 'ai_unauthorized' } }, 401),
      credential: 'pst_revoked',
    })

    expect(limited.kind).toBe('rate-limited')
    expect(missing.kind).toBe('no-credential')
    expect(revoked.kind).toBe('unauthorized')
  })

  it('服务端回了 error 帧时把它的话带出来，而不是只说「失败」', async () => {
    const link = await checkChatLink({
      fetchImpl: async () =>
        sseResponse(['{"type":"error","code":"ai_failed","message":"模型服务暂时不可用。"}']),
      credential: null,
    })

    expect(link.kind).toBe('error')
    expect(link.message).toContain('模型服务暂时不可用')
  })

  it('请求挂住时自己中断，不会让按钮一直转', async () => {
    const hang: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })

    const link = await checkChatLink({ fetchImpl: hang, timeoutMs: 20, credential: null })

    expect(link.kind).toBe('error')
    expect(link.message).toContain('超时')
  })
})
