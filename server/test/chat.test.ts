import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { buildApp } from '../src/app.js'
import { AiError, type AiClient } from '../src/ai/deepseek.js'
import { listRecentAiCalls } from '../src/ai/ai-audit.js'
import { loadConfig } from '../src/config.js'
import { openPersistDatabase } from '../src/db/index.js'
import type { ChatRequest } from '../src/contract.js'

const profile = {
  age: 30,
  height: 175,
  weight: 72,
  targetWeight: 68,
  goal: '减脂',
  experience: '',
  frequency: '每周 3 次',
  equipment: '居家哑铃',
  dietPreference: '',
  allergies: '',
  bedtime: '',
  sleepHours: 7,
  stress: '',
  aiConsent: true,
}

const request: ChatRequest = {
  turns: [{ role: 'user', content: '我想减脂，每周练 3 次，家里有哑铃' }],
  profile,
}

function fakeAi(overrides: Partial<AiClient> = {}): AiClient {
  return {
    async *streamChat() {
      yield '我记下来了。'
      yield '先按每周 3 次安排。'
    },
    async completeJson() {
      return {}
    },
    ...overrides,
  }
}

async function withServer<T>(
  ai: AiClient,
  env: Record<string, string>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const config = loadConfig({
    DEEPSEEK_API_KEY: 'sk-test',
    RATE_LIMIT_MAX: '100',
    ...env,
  } as unknown as NodeJS.ProcessEnv)
  const app = buildApp({ config, ai })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address() as AddressInfo | null
  if (!address) throw new Error('测试服务没有监听地址')
  try {
    return await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await app.close()
  }
}

function postChat(baseUrl: string, body: unknown) {
  return fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function parseEvents(text: string): unknown[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data:'))
    .map((block) => JSON.parse(block.slice(5).trim()) as unknown)
}

describe('GET /api/health', () => {
  it('配置密钥时报告 deepseek，未配置时报告 disabled', async () => {
    await withServer(fakeAi(), {}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/health`)
      expect(response.status).toBe(200)
      const body = (await response.json()) as Record<string, unknown>
      expect(body).toMatchObject({ status: 'ok', service: 'persist-server', ai: 'deepseek' })
      expect(JSON.stringify(body)).not.toContain('sk-test')
    })
    await withServer(fakeAi(), { DEEPSEEK_API_KEY: '' }, async (baseUrl) => {
      const body = (await (await fetch(`${baseUrl}/api/health`)).json()) as Record<string, unknown>
      expect(body.ai).toBe('disabled')
    })
  })
})

describe('POST /api/chat', () => {
  it('未配置密钥返回 503 ai_not_configured', async () => {
    await withServer(fakeAi(), { DEEPSEEK_API_KEY: '' }, async (baseUrl) => {
      const response = await postChat(baseUrl, request)
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ error: { code: 'ai_not_configured' } })
    })
  })

  it('请求不合契约返回 400 invalid_request', async () => {
    await withServer(fakeAi(), {}, async (baseUrl) => {
      const response = await postChat(baseUrl, { turns: [] })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } })
    })
  })

  it('按契约顺序流式返回事件，且结构化结果已净化', async () => {
    const ai = fakeAi({
      async completeJson() {
        return {
          questions: [{ field: 'plan', prompt: '计划打算持续多久？', options: ['8 周', '12 周'] }],
          profilePatch: { goal: '改善体态', aiConsent: true },
          proposal: {
            title: '12 周减脂计划',
            goal: '减脂',
            cadence: 'cycle',
            startDate: '2026-11-10',
            endDate: '2027-02-01',
            weeklyTargets: [{ label: '力量训练', unit: '次', perWeek: 3, module: 'fitness' }],
            milestones: [{ date: '2026-12-10', label: '第 4 周复盘' }],
            assumptions: ['按每周 3 次排期'],
            warnings: ['注意恢复'],
            highlights: ['力量训练 3 次/周'],
          },
          warnings: ['目标体重与当前体重接近，建议复核。'],
        }
      },
    })

    await withServer(ai, {}, async (baseUrl) => {
      const response = await postChat(baseUrl, request)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const events = parseEvents(await response.text()) as {
        type: string
        [key: string]: unknown
      }[]

      expect(events.map((event) => event.type)).toEqual([
        'stage',
        'delta',
        'delta',
        'questions',
        'profilePatch',
        'stage',
        'proposal',
        'warnings',
        'done',
      ])
      expect(events[0]).toEqual({ type: 'stage', stage: 'collect' })
      expect(events[5]).toEqual({ type: 'stage', stage: 'propose' })
      expect(events[4]).toEqual({ type: 'profilePatch', patch: { goal: '改善体态' } })
      expect(events[8]).toEqual({ type: 'done' })
    })
  })

  it('上游失败时发 error 事件而不是 done', async () => {
    const ai = fakeAi({
      async *streamChat() {
        yield '开头'
        throw new AiError('upstream', 'boom', 500)
      },
    })
    await withServer(ai, {}, async (baseUrl) => {
      const events = parseEvents(await (await postChat(baseUrl, request)).text()) as {
        type: string
      }[]
      expect(events.map((event) => event.type)).toEqual(['stage', 'delta', 'error'])
    })
  })

  it('超限后返回 429 并带 Retry-After', async () => {
    await withServer(fakeAi(), { RATE_LIMIT_MAX: '1' }, async (baseUrl) => {
      const first = await postChat(baseUrl, request)
      await first.text()
      const second = await postChat(baseUrl, request)
      expect(second.status).toBe(429)
      expect(second.headers.get('retry-after')).toBeTruthy()
      expect(await second.json()).toMatchObject({ error: { code: 'rate_limited' } })
    })
  })

  it('未知路径返回 404 JSON', async () => {
    await withServer(fakeAi(), {}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/nope`)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ error: { code: 'not_found' } })
    })
  })
})

describe('AI 凭据门（/api/chat）', () => {
  const key = 'psa_chat-route-test-0000000000000000000000'
  const keysEnv = `k1:${createHash('sha256').update(key, 'utf8').digest('hex')}`

  function postWithKey(baseUrl: string, body: unknown, value?: string) {
    return fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(value === undefined ? {} : { authorization: `Bearer ${value}` }),
      },
      body: JSON.stringify(body),
    })
  }

  it('enforce 下无凭据返回 401，且不调用上游', async () => {
    let called = 0
    const ai = fakeAi({
      async *streamChat() {
        called += 1
        yield '不该出现'
      },
    })
    await withServer(
      ai,
      { PERSIST_AI_GATE: 'enforce', PERSIST_AI_KEYS: keysEnv },
      async (baseUrl) => {
        const response = await postWithKey(baseUrl, request)
        expect(response.status).toBe(401)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.json()).toEqual({
          error: { code: 'ai_unauthorized', message: 'AI 接口需要有效凭据。' },
        })
        expect(called).toBe(0)
      },
    )
  })

  it('enforce 下有效凭据正常返回事件流', async () => {
    await withServer(
      fakeAi(),
      { PERSIST_AI_GATE: 'enforce', PERSIST_AI_KEYS: keysEnv },
      async (baseUrl) => {
        const response = await postWithKey(baseUrl, request, key)
        expect(response.status).toBe(200)
        const events = parseEvents(await response.text()) as { type: string; text?: string }[]
        expect(events.some((event) => event.type === 'delta')).toBe(true)
        expect(events.at(-1)?.type).toBe('done')
      },
    )
  })

  it('错误凭据与无凭据的响应完全一致，不泄露失败细节', async () => {
    await withServer(
      fakeAi(),
      { PERSIST_AI_GATE: 'enforce', PERSIST_AI_KEYS: keysEnv },
      async (baseUrl) => {
        const missing = await postWithKey(baseUrl, request)
        const missingBody = await missing.text()
        const wrong = await postWithKey(baseUrl, request, 'psa_wrong-key')
        const wrongBody = await wrong.text()
        // 设备令牌前缀也不被接受
        const deviceLike = await postWithKey(baseUrl, request, 'pst_something')
        const deviceBody = await deviceLike.text()

        expect(wrong.status).toBe(401)
        expect(deviceLike.status).toBe(401)
        expect(wrongBody).toBe(missingBody)
        expect(deviceBody).toBe(missingBody)
      },
    )
  })

  it('warn 放行错误凭据，但请求照常完成', async () => {
    await withServer(
      fakeAi(),
      { PERSIST_AI_GATE: 'warn', PERSIST_AI_KEYS: keysEnv },
      async (baseUrl) => {
        const response = await postWithKey(baseUrl, request, 'psa_wrong-key')
        expect(response.status).toBe(200)
        const events = parseEvents(await response.text()) as { type: string }[]
        expect(events.at(-1)?.type).toBe('done')
      },
    )
  })

  it('off 是默认值，行为与改动前一致', async () => {
    await withServer(fakeAi(), {}, async (baseUrl) => {
      const response = await postWithKey(baseUrl, request)
      expect(response.status).toBe(200)
    })
  })

  it('凭据门在限流之前：无凭据的请求不消耗 IP 额度', async () => {
    await withServer(
      fakeAi(),
      { PERSIST_AI_GATE: 'enforce', PERSIST_AI_KEYS: keysEnv, RATE_LIMIT_MAX: '1' },
      async (baseUrl) => {
        const first = await postWithKey(baseUrl, request)
        const second = await postWithKey(baseUrl, request)
        // 若限流在前，第二次会是 429。
        expect(first.status).toBe(401)
        expect(second.status).toBe(401)
      },
    )
  })
})

/**
 * SSE 走的是 `reply.hijack()` + 裸 `writeHead`，Fastify 的 onSend 钩子不再执行，
 * 所以 onRequest 里用 `reply.header()` 设的 CORS 头压根发不出去。移动端 WebView 的
 * origin 是 `https://localhost`、接口在另一个源上，缺这个头浏览器就直接
 * `TypeError: Failed to fetch`——同源的 web 前端看不出来，只有 APK 里是死的。
 */
describe('POST /api/chat 的跨源响应头', () => {
  it('hijack 之后仍回写 allow-origin，且流保持完整', async () => {
    await withServer(fakeAi(), {}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://localhost' },
        body: JSON.stringify(request),
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe('https://localhost')
      expect(response.headers.get('vary')).toContain('Origin')
      const text = await response.text()
      expect(text).toContain('"type":"done"')
      expect(text).toContain('先按每周 3 次安排。')
    })
  })

  it('来源不在白名单时不回写 allow-origin', async () => {
    await withServer(fakeAi(), {}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify(request),
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      await response.text()
    })
  })
})

/**
 * 连通性探针（`{ probe: true }`）：给设置页的「测试服务端连接」用。
 *
 * 它存在的理由只有一个——健康检查测不到 SSE 这条路上的坑（P5-9 就是 CORS 头在
 * hijack 之后丢失）。所以下面这几条断言的重点是：探针必须与真实对话同走
 * 「凭据门 + 跨域 + 裸流」，又不能产生任何真实成本（模型、配额、审计）。
 */
describe('POST /api/chat 的连通性探针', () => {
  const key = 'psa_chat_probe-test-000000000000000000'
  const keysEnv = `k1:${createHash('sha256').update(key, 'utf8').digest('hex')}`

  function postProbe(baseUrl: string, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ probe: true }),
    })
  }

  it('返回 stage + done，且不打模型、不占配额、不写审计', async () => {
    let calls = 0
    const ai = fakeAi({
      async *streamChat() {
        calls += 1
        yield '不该出现'
      },
      async completeJson() {
        calls += 1
        return {}
      },
    })
    const db = openPersistDatabase({ path: ':memory:' })
    const config = loadConfig({
      DEEPSEEK_API_KEY: 'sk-test',
      RATE_LIMIT_MAX: '100',
      // 配额只给 1 次：探针若偷偷预占，紧跟着的真实对话就会 429。
      PERSIST_AI_DAILY_LIMIT: '1',
      PERSIST_AI_GATE: 'enforce',
      PERSIST_AI_KEYS: keysEnv,
    } as unknown as NodeJS.ProcessEnv)
    const app = buildApp({ config, ai, db })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address() as AddressInfo | null
    if (!address) throw new Error('测试服务没有监听地址')
    const baseUrl = `http://127.0.0.1:${address.port}`

    try {
      const response = await postProbe(baseUrl, { authorization: `Bearer ${key}` })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const events = parseEvents(await response.text()) as { type: string }[]
      expect(events.map((event) => event.type)).toEqual(['stage', 'done'])
      expect(calls).toBe(0)
      expect(listRecentAiCalls(db.db)).toHaveLength(0)

      // 探针之后真实对话仍然有额度：证明探针没有预占日配额。
      const chat = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(request),
      })
      expect(chat.status).toBe(200)
      await chat.text()
    } finally {
      await app.close()
      db.db.close()
    }
  })

  it('跨源时同样回写 allow-origin：它测的就是这条路上的头', async () => {
    await withServer(fakeAi(), {}, async (baseUrl) => {
      const response = await postProbe(baseUrl, { origin: 'https://localhost' })
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe('https://localhost')
      await response.text()
    })
  })

  it('凭据不通过时仍是 401，与真实对话同一个响应体', async () => {
    await withServer(
      fakeAi(),
      { PERSIST_AI_GATE: 'enforce', PERSIST_AI_KEYS: keysEnv },
      async (baseUrl) => {
        const probe = await postProbe(baseUrl)
        const real = await postChat(baseUrl, request)
        expect(probe.status).toBe(401)
        expect(await probe.text()).toBe(await real.text())
      },
    )
  })

  it('没配模型密钥时给 503：探针不谎报「一切正常」', async () => {
    await withServer(fakeAi(), { DEEPSEEK_API_KEY: '' }, async (baseUrl) => {
      const response = await postProbe(baseUrl)
      expect(response.status).toBe(503)
      expect(await response.text()).toContain('ai_not_configured')
    })
  })
})
