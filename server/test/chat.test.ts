import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { buildApp } from '../src/app.js'
import { AiError, type AiClient } from '../src/ai/deepseek.js'
import { loadConfig } from '../src/config.js'
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
