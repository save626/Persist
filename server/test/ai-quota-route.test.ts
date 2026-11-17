import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { buildApp } from '../src/app.js'
import { AiError, type AiClient } from '../src/ai/deepseek.js'
import { listRecentAiCalls, type AiCallRow } from '../src/ai/ai-audit.js'
import { loadConfig } from '../src/config.js'
import { openPersistDatabase, type Db } from '../src/db/index.js'
import type { ChatRequest } from '../src/contract.js'
import { parseReportRequest } from '../src/contract.js'

/**
 * 路由级配额与审计用例：验证「第 100 次放行、第 101 次 429」「跨日恢复」
 * 「超限不影响其它接口」「审计能区分 ok 与 client_closed」这几条设计验收项。
 *
 * 时钟通过 `clock.value` 注入：跨日测试不需要真的等到零点。
 */

const key = 'psa_test_quota_key'
const keysEnv = `k1:${createHash('sha256').update(key, 'utf8').digest('hex')}`

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

const chatRequest: ChatRequest = {
  turns: [{ role: 'user', content: '我想减脂，每周练 3 次' }],
  profile,
}

const reportRequest = {
  type: '今日简报',
  rangeDays: 7,
  digest: {
    fitness: {
      hasSession: true,
      exerciseCount: 2,
      doneSets: 6,
      totalSets: 8,
      strengthVolumeKg: 1_200,
      durationMinutes: 0,
      distanceKm: 0,
      exerciseNames: ['深蹲'],
    },
    study: { recordCount: 2, englishCount: 1, mathCount: 1, totalMinutes: 60 },
    diet: { mealCount: 2, foodEntryCount: 4, waterLiters: 1.5, waterEvents: 2 },
    profile,
  },
} as const

const goodReport = {
  title: '训练已经落地，接下来守住补水',
  status: '先补饮水',
  summary:
    '今天完成了 6 / 8 组训练，动作集中在深蹲与卧推，力量容量 1200 kg；学习记录 2 条累计 60 分钟；饮水 1.5 L，距离 2 L 目标还差约 500 ml。整体节奏是稳的，剩下的重点不是加量，而是把补水和晚间复盘收好。',
  conclusions: [
    '训练完成 6 / 8 组，强度落在计划区间内。',
    '学习投入 60 分钟，英语与高数都有覆盖。',
  ],
  actions: ['晚饭前分两次补水，每次约 250 ml。', '晚间只做一次 20 分钟复盘，不再新增任务。'],
  warnings: [],
}

function fakeAi(overrides: Partial<AiClient> = {}): AiClient {
  return {
    async *streamChat() {
      yield '记下来了。'
    },
    async completeJson() {
      return goodReport
    },
    ...overrides,
  }
}

interface Harness {
  baseUrl: string
  db: Db
  clock: { value: number }
}

async function withServer<T>(
  options: { ai?: AiClient; env?: Record<string, string> },
  run: (ctx: Harness) => Promise<T>,
): Promise<T> {
  const config = loadConfig({
    DEEPSEEK_API_KEY: 'sk-test',
    // 限流放到很高，避免它先于配额触发 429，让本用例只测配额。
    RATE_LIMIT_MAX: '500',
    PERSIST_AI_GATE: 'enforce',
    PERSIST_AI_KEYS: keysEnv,
    ...options.env,
  } as unknown as NodeJS.ProcessEnv)

  // 本地时间 2026-11-17 13:00，跨日测试再改 clock.value。
  const clock = { value: new Date(2026, 10, 17, 13, 0, 0, 0).getTime() }
  const database = openPersistDatabase({ path: ':memory:' })
  const app = buildApp({
    config,
    ai: options.ai ?? fakeAi(),
    db: database,
    now: () => clock.value,
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address() as AddressInfo | null
  if (!address) throw new Error('测试服务没有监听地址')
  try {
    return await run({ baseUrl: `http://127.0.0.1:${address.port}`, db: database.db, clock })
  } finally {
    await app.close()
  }
}

function postReport(baseUrl: string, credential: string | null = key) {
  return fetch(`${baseUrl}/api/report`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(credential ? { authorization: `Bearer ${credential}` } : {}),
    },
    body: JSON.stringify(reportRequest),
  })
}

function postChat(baseUrl: string, credential: string | null = key) {
  return fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(credential ? { authorization: `Bearer ${credential}` } : {}),
    },
    body: JSON.stringify(chatRequest),
  })
}

async function waitForAudit(
  db: Db,
  predicate: (rows: AiCallRow[]) => boolean,
): Promise<AiCallRow[]> {
  for (let i = 0; i < 60; i += 1) {
    const rows = listRecentAiCalls(db, 50)
    if (predicate(rows)) return rows
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`审计没有在预期时间内出现：${JSON.stringify(listRecentAiCalls(db, 50))}`)
}

describe('日配额：/api/report', () => {
  it('默认上限 100：第 100 次放行，第 101 次 429 并带次日零点的 retry-after', async () => {
    await withServer({ env: { PERSIST_AI_DAILY_LIMIT: '100' } }, async ({ baseUrl, db, clock }) => {
      for (let i = 1; i <= 100; i += 1) {
        const response = await postReport(baseUrl)
        if (response.status !== 200) throw new Error(`第 ${i} 次请求返回 ${response.status}`)
        await response.arrayBuffer()
      }

      const blocked = await postReport(baseUrl)
      expect(blocked.status).toBe(429)
      expect(blocked.headers.get('cache-control')).toBe('no-store')
      const body = (await blocked.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('ai_quota_exceeded')
      // 文案要说清「上限」与「明天恢复」，不能只说「稍后再试」。
      expect(body.error.message).toContain('100')
      expect(body.error.message).toContain('明天')

      // 13:00 到次日 00:00 是 11 小时。
      expect(Number(blocked.headers.get('retry-after'))).toBe(11 * 60 * 60)

      // 超限不影响其它接口。
      const health = await fetch(`${baseUrl}/api/health`)
      expect(health.status).toBe(200)
      await health.arrayBuffer()

      // 也不会多记：计数停在 100。
      const usage = db
        .prepare<{ requests: number }>('SELECT requests FROM ai_usage WHERE key_id = ?')
        .get('k1')
      expect(usage).toEqual({ requests: 100 })

      clock.value = new Date(2026, 10, 18, 0, 1, 0, 0).getTime()
      const nextDay = await postReport(baseUrl)
      expect(nextDay.status).toBe(200)
      await nextDay.arrayBuffer()
    })
  }, 60_000)

  it('两条路由共用同一份额度：报告用完后聊天同样被拒', async () => {
    await withServer({ env: { PERSIST_AI_DAILY_LIMIT: '1' } }, async ({ baseUrl }) => {
      const first = await postReport(baseUrl)
      expect(first.status).toBe(200)
      await first.arrayBuffer()

      const chat = await postChat(baseUrl)
      expect(chat.status).toBe(429)
      const body = (await chat.json()) as { error: { code: string } }
      expect(body.error.code).toBe('ai_quota_exceeded')
    })
  })

  it('凭据不合法的请求不消耗额度', async () => {
    await withServer({ env: { PERSIST_AI_DAILY_LIMIT: '1' } }, async ({ baseUrl, db }) => {
      for (let i = 0; i < 3; i += 1) {
        const denied = await postReport(baseUrl, null)
        expect(denied.status).toBe(401)
        await denied.arrayBuffer()
      }
      expect(db.prepare<{ total: number }>('SELECT COUNT(*) AS total FROM ai_usage').get()).toEqual(
        { total: 0 },
      )

      // 额度没有被匿名请求吃掉，合法请求仍然可用。
      const ok = await postReport(baseUrl)
      expect(ok.status).toBe(200)
      await ok.arrayBuffer()
    })
  })

  it('PERSIST_AI_DAILY_LIMIT=0 时关闭配额', async () => {
    await withServer({ env: { PERSIST_AI_DAILY_LIMIT: '0' } }, async ({ baseUrl }) => {
      for (let i = 0; i < 5; i += 1) {
        const response = await postReport(baseUrl)
        expect(response.status).toBe(200)
        await response.arrayBuffer()
      }
    })
  })
})

describe('审计', () => {
  it('成功与超限都留下记录，且不含请求正文', async () => {
    await withServer({ env: { PERSIST_AI_DAILY_LIMIT: '1' } }, async ({ baseUrl, db }) => {
      const ok = await postReport(baseUrl)
      await ok.arrayBuffer()
      const blocked = await postReport(baseUrl)
      expect(blocked.status).toBe(429)
      await blocked.arrayBuffer()

      const rows = listRecentAiCalls(db, 10)
      expect(rows.map((row) => [row.route, row.result, row.http_status])).toEqual([
        ['/api/report', 'quota_exceeded', 429],
        ['/api/report', 'ok', 200],
      ])
      // 正文里的档案与摘要不得出现在审计表任何字段里。
      const dump = JSON.stringify(rows)
      expect(dump).not.toContain('减脂')
      expect(dump).not.toContain('深蹲')
    })
  })

  it('聊天成功记为 ok，并带耗时与 IP 哈希', async () => {
    await withServer({}, async ({ baseUrl, db }) => {
      const response = await postChat(baseUrl)
      expect(response.status).toBe(200)
      await response.text()

      const rows = await waitForAudit(db, (list) => list.some((row) => row.route === '/api/chat'))
      const row = rows.find((item) => item.route === '/api/chat')
      expect(row).toMatchObject({ result: 'ok', http_status: 200, key_id: 'k1' })
      expect(row?.latency_ms).not.toBeNull()
      expect(row?.ip_hash).toMatch(/^[0-9a-f]{16}$/)
    })
  })

  it('客户端提前断开记为 client_closed，而不是 ok', async () => {
    const hangingAi = fakeAi({
      completeJson: (_messages, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        }),
    })
    await withServer({ ai: hangingAi }, async ({ baseUrl, db }) => {
      const controller = new AbortController()
      const pending = fetch(`${baseUrl}/api/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(reportRequest),
        signal: controller.signal,
      }).catch(() => null)
      setTimeout(() => controller.abort(), 100)
      await pending

      const rows = await waitForAudit(db, (list) =>
        list.some((row) => row.result === 'client_closed'),
      )
      expect(rows[0]).toMatchObject({ result: 'client_closed', http_status: 499 })
    })
  })

  it('上游失败记为 ai_failed，不算成功', async () => {
    const failingAi = fakeAi({
      completeJson: async () => {
        throw new AiError('upstream', 'boom')
      },
    })
    await withServer({ ai: failingAi }, async ({ baseUrl, db }) => {
      const response = await postReport(baseUrl)
      expect(response.status).toBe(502)
      await response.arrayBuffer()

      const rows = await waitForAudit(db, (list) => list.some((row) => row.route === '/api/report'))
      expect(rows[0]).toMatchObject({ result: 'ai_failed', http_status: 502 })
    })
  })
})

describe('配置默认值', () => {
  it('不设 PERSIST_AI_DAILY_LIMIT 时默认 100', () => {
    const config = loadConfig({ DEEPSEEK_API_KEY: 'sk-test' } as unknown as NodeJS.ProcessEnv)
    expect(config.aiDailyLimit).toBe(100)
  })

  it('非法或越界值收敛到合法区间', () => {
    const view = (raw: string) =>
      loadConfig({
        DEEPSEEK_API_KEY: 'sk-test',
        PERSIST_AI_DAILY_LIMIT: raw,
      } as unknown as NodeJS.ProcessEnv).aiDailyLimit
    expect(view('abc')).toBe(100)
    expect(view('-5')).toBe(0)
    expect(view('999999')).toBe(100_000)
  })
})

describe('请求样例自检', () => {
  it('报告请求体能通过契约解析', () => {
    expect(parseReportRequest(reportRequest).ok).toBe(true)
  })
})
