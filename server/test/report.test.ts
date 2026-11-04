import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { AiError, type AiClient } from '../src/ai/deepseek.js'
import { sanitizeReportContent } from '../src/ai/report.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { parseReportRequest, type ReportRequest } from '../src/contract.js'

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

const digest = {
  fitness: {
    hasSession: true,
    exerciseCount: 3,
    doneSets: 6,
    totalSets: 8,
    strengthVolumeKg: 1_200,
    durationMinutes: 0,
    distanceKm: 0,
    exerciseNames: ['深蹲', '卧推'],
  },
  study: { recordCount: 4, englishCount: 3, mathCount: 1, totalMinutes: 120 },
  diet: { mealCount: 2, foodEntryCount: 5, waterLiters: 1.45, waterEvents: 2 },
  profile,
}

const request: ReportRequest = { type: '今日简报', rangeDays: 7, digest }

const goodReport = {
  title: '训练已经落地，接下来守住补水',
  status: '先补饮水',
  summary:
    '今天完成了 6 / 8 组训练，动作集中在深蹲与卧推，力量容量 1200 kg；学习记录 4 条累计 120 分钟；饮水 1.45 L，距离 2 L 目标还差约 550 ml。整体节奏是稳的，剩下的重点不是加量，而是把补水和晚间复盘收好。',
  conclusions: [
    '训练完成 6 / 8 组，强度落在计划区间内。',
    '学习投入 120 分钟，英语与高数都有覆盖。',
  ],
  actions: ['晚饭前分两次补水，每次约 275 ml。', '晚间只做一次 20 分钟复盘，不再新增任务。'],
  warnings: [],
}

function fakeAi(overrides: Partial<AiClient> = {}): AiClient {
  return {
    async *streamChat() {
      yield ''
    },
    async completeJson() {
      return goodReport
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

function postReport(baseUrl: string, body: unknown) {
  return fetch(`${baseUrl}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('parseReportRequest', () => {
  it('接受合法请求并保留来源为空的部分', () => {
    const result = parseReportRequest({
      ...request,
      digest: { fitness: digest.fitness, study: null, diet: null, profile: null },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.digest.fitness?.doneSets).toBe(6)
    expect(result.value.digest.study).toBeNull()
    expect(result.value.digest.diet).toBeNull()
  })

  it('拒绝未知报告类型与非法区间', () => {
    expect(parseReportRequest({ ...request, type: '周报' })).toMatchObject({ ok: false })
    expect(parseReportRequest({ ...request, rangeDays: 14 })).toMatchObject({ ok: false })
    expect(parseReportRequest({ ...request, rangeDays: '7' })).toMatchObject({ ok: false })
  })

  it('拒绝没有任何可引用来源的摘要', () => {
    const result = parseReportRequest({
      ...request,
      digest: { fitness: null, study: null, diet: null, profile: null },
    })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('来源') })
  })

  it('拒绝非整数计数与越界数字', () => {
    expect(
      parseReportRequest({
        ...request,
        digest: { ...digest, fitness: { ...digest.fitness, doneSets: 6.5 } },
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('doneSets') })
    expect(
      parseReportRequest({
        ...request,
        digest: { ...digest, diet: { ...digest.diet, waterLiters: 25 } },
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('waterLiters') })
  })

  it('拒绝超长动作名与不合法的档案', () => {
    expect(
      parseReportRequest({
        ...request,
        digest: { ...digest, fitness: { ...digest.fitness, exerciseNames: ['x'.repeat(21)] } },
      }),
    ).toMatchObject({ ok: false })
    const { aiConsent: _consent, ...withoutConsent } = profile
    expect(
      parseReportRequest({ ...request, digest: { ...digest, profile: withoutConsent } }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('aiConsent') })
  })

  it('只有档案来源时也允许生成', () => {
    const result = parseReportRequest({
      ...request,
      digest: { fitness: null, study: null, diet: null, profile },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.digest.profile?.goal).toBe('减脂')
  })

  it('忽略摘要里的未知字段', () => {
    const result = parseReportRequest({
      ...request,
      digest: { ...digest, mood: 'good', study: { ...digest.study, legacy: 1 } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('mood' in result.value.digest).toBe(false)
    expect(result.value.digest.study).toEqual(digest.study)
  })
})

describe('sanitizeReportContent', () => {
  it('接受合规结果并折叠多余空白', () => {
    const result = sanitizeReportContent({ ...goodReport, title: '  训练  已经落地  ' })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.value.title).toBe('训练 已经落地')
  })

  it('缺少必填字段或条数不足时整份作废', () => {
    expect(sanitizeReportContent({ ...goodReport, summary: '' })).toMatchObject({ ok: false })
    expect(sanitizeReportContent({ ...goodReport, conclusions: ['只有一条结论。'] })).toMatchObject(
      {
        ok: false,
      },
    )
    expect(sanitizeReportContent({ ...goodReport, actions: [] })).toMatchObject({ ok: false })
  })

  it('拒绝 Markdown 代码块与重复条目', () => {
    expect(
      sanitizeReportContent({ ...goodReport, summary: `\`\`\`json\n${goodReport.summary}` }),
    ).toMatchObject({ ok: false })
    expect(
      sanitizeReportContent({
        ...goodReport,
        conclusions: [goodReport.conclusions[0], goodReport.conclusions[0]],
      }),
    ).toMatchObject({ ok: false })
  })

  it('允许 warnings 缺省，未知字段被丢弃', () => {
    const result = sanitizeReportContent({ ...goodReport, warnings: undefined, metric: [] })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.value.warnings).toEqual([])
    expect('metric' in result.value).toBe(false)
  })
})

describe('POST /api/report', () => {
  it('未配置密钥返回 503 ai_not_configured', async () => {
    await withServer(fakeAi(), { DEEPSEEK_API_KEY: '' }, async (baseUrl) => {
      const response = await postReport(baseUrl, request)
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ error: { code: 'ai_not_configured' } })
    })
  })

  it('请求不合契约返回 400 invalid_request', async () => {
    await withServer(fakeAi(), {}, async (baseUrl) => {
      const response = await postReport(baseUrl, { ...request, type: '周报' })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } })
    })
  })

  it('成功时返回净化后的报告与模型名，并禁止缓存', async () => {
    await withServer(fakeAi(), {}, async (baseUrl) => {
      const response = await postReport(baseUrl, request)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const body = (await response.json()) as Record<string, unknown>
      expect(body.model).toBe('deepseek-chat')
      expect(body.report).toMatchObject({ title: goodReport.title, status: '先补饮水' })
      expect(JSON.stringify(body)).not.toContain('sk-test')
    })
  })

  it('模型返回不合规结构时返回 502 invalid_response', async () => {
    const ai = fakeAi({
      async completeJson() {
        return { title: '太短' }
      },
    })
    await withServer(ai, {}, async (baseUrl) => {
      const response = await postReport(baseUrl, request)
      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_response' } })
    })
  })

  it('上游失败返回 502 ai_failed，超时返回 504 timeout', async () => {
    const failing = fakeAi({
      async completeJson() {
        throw new AiError('upstream', 'boom', 500)
      },
    })
    await withServer(failing, {}, async (baseUrl) => {
      const response = await postReport(baseUrl, request)
      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({ error: { code: 'ai_failed' } })
    })

    const timingOut = fakeAi({
      async completeJson() {
        throw new AiError('timeout', '模型服务响应超时。')
      },
    })
    await withServer(timingOut, {}, async (baseUrl) => {
      const response = await postReport(baseUrl, request)
      expect(response.status).toBe(504)
      expect(await response.json()).toMatchObject({ error: { code: 'timeout' } })
    })
  })

  it('超限后返回 429 并带 Retry-After', async () => {
    await withServer(fakeAi(), { RATE_LIMIT_MAX: '1' }, async (baseUrl) => {
      await (await postReport(baseUrl, request)).json()
      const second = await postReport(baseUrl, request)
      expect(second.status).toBe(429)
      expect(second.headers.get('retry-after')).toBeTruthy()
      expect(await second.json()).toMatchObject({ error: { code: 'rate_limited' } })
    })
  })
})
