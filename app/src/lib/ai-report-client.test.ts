import { describe, expect, it } from 'vitest'
import {
  AI_REPORT_ENDPOINT,
  AI_REPORT_LABEL,
  MOCK_REPORT_LABEL,
  REPORT_FALLBACK_NOTE,
  ReportContractError,
  ReportUnavailableError,
  parseReportContent,
  probeAiReport,
  requestAiReport,
  type FetchLike,
} from './ai-report-client'
import type { ReportContent, ReportRequest } from './report-types'

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

const request: ReportRequest = {
  type: '今日简报',
  rangeDays: 7,
  digest: {
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
  },
}

const content: ReportContent = {
  title: '训练已经落地，接下来守住补水',
  status: '先补饮水',
  summary:
    '今天完成了 6 / 8 组训练，动作集中在深蹲与卧推，力量容量 1200 kg；学习记录 4 条累计 120 分钟；饮水 1.45 L。整体节奏是稳的，剩下的重点不是加量，而是把补水和晚间复盘收好。',
  conclusions: [
    '训练完成 6 / 8 组，强度落在计划区间内。',
    '学习投入 120 分钟，英语与高数都有覆盖。',
  ],
  actions: ['晚饭前分两次补水，每次约 275 ml。', '晚间只做一次 20 分钟复盘，不再新增任务。'],
  warnings: [],
}

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

describe('probeAiReport', () => {
  it('只有明确返回 ok + deepseek 才认为可用', async () => {
    const ai = stubFetch(() => jsonResponse({ status: 'ok', ai: 'deepseek' }))
    await expect(probeAiReport({ fetchImpl: ai.fetchImpl })).resolves.toBe(true)
    expect(ai.calls[0]?.url).toBe('/api/health')

    const disabled = stubFetch(() => jsonResponse({ status: 'ok', ai: 'disabled' }))
    await expect(probeAiReport({ fetchImpl: disabled.fetchImpl })).resolves.toBe(false)
  })

  it('请求失败或健康检查失败时按不可用处理', async () => {
    const notFound = stubFetch(() => jsonResponse({ error: { code: 'not_found' } }, 404))
    await expect(probeAiReport({ fetchImpl: notFound.fetchImpl })).resolves.toBe(false)

    const offline: FetchLike = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(probeAiReport({ fetchImpl: offline })).resolves.toBe(false)
  })
})

describe('requestAiReport', () => {
  it('按契约 POST 摘要并返回净化后的内容', async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      jsonResponse({ report: content, model: 'deepseek-chat' }),
    )
    const result = await requestAiReport(request, { fetchImpl })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(AI_REPORT_ENDPOINT)
    expect(calls[0]?.init?.method).toBe('POST')
    const sent = JSON.parse(String(calls[0]?.init?.body)) as ReportRequest
    expect(sent).toEqual(request)
    expect(result.title).toBe(content.title)
    expect(result.warnings).toEqual([])
  })

  it('服务端不可用时抛可回退错误', async () => {
    const unavailable = stubFetch(() =>
      jsonResponse({ error: { code: 'ai_not_configured', message: '服务端没有配置密钥。' } }, 503),
    )
    await expect(
      requestAiReport(request, { fetchImpl: unavailable.fetchImpl }),
    ).rejects.toMatchObject({
      name: 'ReportUnavailableError',
      message: '服务端没有配置密钥。',
      status: 503,
    })

    const limited = stubFetch(() => jsonResponse({ error: { code: 'rate_limited' } }, 429))
    const error = await requestAiReport(request, { fetchImpl: limited.fetchImpl }).catch((e) => e)
    expect(error).toBeInstanceOf(ReportUnavailableError)
    expect(error.message).toBe('请求过于频繁，请稍后再试。')
  })

  it('连不上服务端时抛可回退错误', async () => {
    const offline: FetchLike = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(requestAiReport(request, { fetchImpl: offline })).rejects.toBeInstanceOf(
      ReportUnavailableError,
    )
  })

  it('请求或响应结构不合契约时抛真错误，不静默降级', async () => {
    const badRequest = stubFetch(() =>
      jsonResponse({ error: { message: 'type 只能是今日简报。' } }, 400),
    )
    await expect(
      requestAiReport(request, { fetchImpl: badRequest.fetchImpl }),
    ).rejects.toBeInstanceOf(ReportContractError)

    const brokenJson = stubFetch(() => new Response('<html>502</html>', { status: 200 }))
    await expect(
      requestAiReport(request, { fetchImpl: brokenJson.fetchImpl }),
    ).rejects.toBeInstanceOf(ReportContractError)

    const brokenShape = stubFetch(() => jsonResponse({ report: { title: '太短' } }))
    await expect(
      requestAiReport(request, { fetchImpl: brokenShape.fetchImpl }),
    ).rejects.toBeInstanceOf(ReportContractError)
  })

  it('尊重取消信号', async () => {
    const controller = new AbortController()
    const aborting: FetchLike = async (_url, init) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort()
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
    await expect(
      requestAiReport(request, { fetchImpl: aborting, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('parseReportContent', () => {
  it('忽略未知字段并补全 warnings', () => {
    expect(parseReportContent({ ...content, warnings: undefined, metric: [] })).toMatchObject({
      title: content.title,
      warnings: [],
    })
  })

  it('拒绝缺字段或空数组', () => {
    expect(parseReportContent(null)).toBeNull()
    expect(parseReportContent({ ...content, actions: [] })).toBeNull()
    expect(parseReportContent({ ...content, summary: '太短' })).toBeNull()
  })
})

describe('文案常量', () => {
  it('AI 与 Mock 标签、回退说明都明确写出来源', () => {
    expect(AI_REPORT_LABEL).toContain('DeepSeek')
    expect(AI_REPORT_LABEL).toContain('服务端')
    expect(MOCK_REPORT_LABEL).toContain('Mock')
    expect(REPORT_FALLBACK_NOTE).toContain('Mock')
  })
})
