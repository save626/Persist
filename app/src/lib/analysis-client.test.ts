import { describe, expect, it, vi } from 'vitest'
import {
  ANALYSIS_CACHE_LABEL,
  ANALYSIS_CONSENT_LABEL,
  ANALYSIS_INVALID_LABEL,
  ANALYSIS_LOCAL_LABEL,
  ANALYSIS_RULES_LABEL,
  ANALYSIS_RULES_NOTE,
  ANALYSIS_SERVER_LABEL,
  ANALYSIS_SYNC_OFF_LABEL,
  ANALYSIS_UNAVAILABLE_LABEL,
  AnalysisRequestError,
  createAnalysisClient,
} from './analysis-client'

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

/** 断言请求失败并拿到归类后的错误；成功时直接让测试失败。 */
async function expectFailure(promise: Promise<unknown>): Promise<AnalysisRequestError> {
  try {
    await promise
  } catch (error) {
    return error as AnalysisRequestError
  }
  throw new Error('预期请求失败，但请求成功了')
}

const CONTENT = {
  title: '近 7 天综合复盘：训练平稳',
  status: '节奏平稳',
  summary:
    '过去 7 天训练完成 3 次，学习记录覆盖 6 天，饮食记录在周末有两次中断。整体节奏没有明显波动，主要可以调整的是晚间学习与恢复的衔接。',
  analysis: [
    '训练方面本周完成 3 次力量训练，总容量与前三周基本持平，没有出现连续加量后的疲劳堆积。',
    '学习方面英语记录连续 6 天，高数集中在晚间；晚间学习与训练后的疲劳叠加，是接下来最值得调整的一处。',
  ],
  conclusions: ['训练节奏稳定，不需要额外增加训练日。', '晚间学习可以提前到晚饭前。'],
  actions: ['把高数主练习安排在晚饭前。', '保持每周 3 次训练不变。'],
  warnings: [],
}

/** 契约里的成功响应是平铺对象，没有 `{ report }` 包裹。 */
function reportBody(overrides: Record<string, unknown> = {}) {
  return {
    reportId: 'r-1',
    cached: false,
    origin: 'ai',
    model: 'deepseek-chat',
    range: { start: '2025-10-01', end: '2025-10-07', days: 7 },
    content: CONTENT,
    metrics: [
      { label: '训练', value: '3 次', detail: '较上周持平' },
      { label: '学习', value: '386 min', detail: '连续 6 天' },
    ],
    dataRev: 12,
    createdAt: 1_760_000_000_000,
    ...overrides,
  }
}

describe('createAnalysisClient.requestAnalysisReport', () => {
  it('POST /api/v1/analysis/reports，带 Bearer 令牌与 type/rangeDays，解析成功响应', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(reportBody())])
    const client = createAnalysisClient({ fetchImpl, baseUrl: 'http://localhost:3100/' })
    const result = await client.requestAnalysisReport('token-1', { rangeDays: 7 })

    expect(calls[0]?.url).toBe('http://localhost:3100/api/v1/analysis/reports')
    expect(calls[0]?.init.method).toBe('POST')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token-1')
    expect(headers['content-type']).toBe('application/json')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ type: '综合分析', rangeDays: 7 })

    expect(result.reportId).toBe('r-1')
    expect(result.origin).toBe('ai')
    expect(result.model).toBe('deepseek-chat')
    expect(result.cached).toBe(false)
    expect(result.range).toEqual({ start: '2025-10-01', end: '2025-10-07', days: 7 })
    expect(result.content.analysis).toHaveLength(2)
    expect(result.metrics[0]).toEqual({ label: '训练', value: '3 次', detail: '较上周持平' })
  })

  it('force: true 才带 force；缺省不带', async () => {
    const { fetchImpl, calls } = fakeFetch([jsonResponse(reportBody()), jsonResponse(reportBody())])
    const client = createAnalysisClient({ fetchImpl })
    await client.requestAnalysisReport('t', { rangeDays: 30 })
    await client.requestAnalysisReport('t', { rangeDays: 30, force: true })

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ type: '综合分析', rangeDays: 30 })
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      type: '综合分析',
      rangeDays: 30,
      force: true,
    })
  })

  it('cached 命中时保留缓存标记，origin 原样返回', async () => {
    const { fetchImpl } = fakeFetch([jsonResponse(reportBody({ cached: true }))])
    const result = await createAnalysisClient({ fetchImpl }).requestAnalysisReport('t', {
      rangeDays: 90,
    })
    expect(result.cached).toBe(true)
    expect(result.origin).toBe('ai')
  })

  it('规则降级（origin: rules, model: null）可正常解析', async () => {
    const { fetchImpl } = fakeFetch([jsonResponse(reportBody({ origin: 'rules', model: null }))])
    const result = await createAnalysisClient({ fetchImpl }).requestAnalysisReport('t', {
      rangeDays: 7,
    })
    expect(result.origin).toBe('rules')
    expect(result.model).toBeNull()
  })

  it('非法窗口不发请求', async () => {
    const { fetchImpl, calls } = fakeFetch([])
    await expect(
      createAnalysisClient({ fetchImpl }).requestAnalysisReport('t', {
        rangeDays: 14 as never,
      }),
    ).rejects.toMatchObject({ kind: 'invalid' })
    expect(calls).toHaveLength(0)
  })
})

describe('失败分类', () => {
  async function classify(status: number, body: unknown): Promise<AnalysisRequestError> {
    const { fetchImpl } = fakeFetch([jsonResponse(body, status)])
    return expectFailure(
      createAnalysisClient({ fetchImpl }).requestAnalysisReport('t', { rangeDays: 7 }),
    )
  }

  it('401 → unauthorized，不可重试', async () => {
    const error = await classify(401, {
      error: { code: 'unauthorized', message: '缺少或无效的设备令牌。' },
    })
    expect(error).toBeInstanceOf(AnalysisRequestError)
    expect(error.kind).toBe('unauthorized')
    expect(error.status).toBe(401)
    expect(error.code).toBe('unauthorized')
    expect(error.retryable).toBe(false)
    expect(error.message).toBe('缺少或无效的设备令牌。')
  })

  it('403 ai_consent_off → consent-off，并给出授权未开启文案', async () => {
    const error = await classify(403, { error: { code: 'ai_consent_off', message: '' } })
    expect(error.kind).toBe('consent-off')
    expect(error.code).toBe('ai_consent_off')
    expect(error.message).toBe(ANALYSIS_CONSENT_LABEL)
    expect(error.retryable).toBe(false)
  })

  it('409 insufficient_data → insufficient，保留服务端说明', async () => {
    const error = await classify(409, {
      error: { code: 'insufficient_data', message: '窗口内只有 1 天有记录。' },
    })
    expect(error.kind).toBe('insufficient')
    expect(error.status).toBe(409)
    expect(error.message).toBe('窗口内只有 1 天有记录。')
  })

  it('422 invalid_request → invalid，不可重试', async () => {
    const error = await classify(422, {
      error: { code: 'invalid_request', message: '分析窗口只支持 7 / 30 / 90 天。' },
    })
    expect(error.kind).toBe('invalid')
    expect(error.retryable).toBe(false)
  })

  it('429 rate_limited → rate-limited，可重试', async () => {
    const error = await classify(429, { error: { code: 'rate_limited', message: '慢一点' } })
    expect(error.kind).toBe('rate-limited')
    expect(error.retryable).toBe(true)
  })

  it('502 invalid_response → invalid-response，不可自动重试，文案为「已拒绝展示」', async () => {
    const error = await classify(502, {
      error: { code: 'invalid_response', message: '' },
    })
    expect(error.kind).toBe('invalid-response')
    expect(error.status).toBe(502)
    expect(error.message).toBe(ANALYSIS_INVALID_LABEL)
    expect(error.retryable).toBe(false)
  })

  it('503 → server，可重试（页面据此回退本地）', async () => {
    const error = await classify(503, {
      error: { code: 'ai_unavailable', message: '模型暂不可用' },
    })
    expect(error.kind).toBe('server')
    expect(error.status).toBe(503)
    expect(error.retryable).toBe(true)
  })

  it('网络异常 → network，可重试', async () => {
    const { fetchImpl } = fakeFetch([new TypeError('Failed to fetch')])
    const error = await expectFailure(
      createAnalysisClient({ fetchImpl }).requestAnalysisReport('t', { rangeDays: 7 }),
    )
    expect(error.kind).toBe('network')
    expect(error.retryable).toBe(true)
  })

  it('超时 → timeout，可重试', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    ) as unknown as typeof fetch
    const error = await expectFailure(
      createAnalysisClient({ fetchImpl, timeoutMs: 5 }).requestAnalysisReport('t', {
        rangeDays: 7,
      }),
    )
    expect(error.kind).toBe('timeout')
    expect(error.retryable).toBe(true)
  })

  it('外部取消保留 AbortError，页面据此静默忽略', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const fail = () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          }
          if (init.signal?.aborted) fail()
          else init.signal?.addEventListener('abort', fail)
        }),
    ) as unknown as typeof fetch
    const error = (await createAnalysisClient({ fetchImpl })
      .requestAnalysisReport('t', { rangeDays: 7, signal: controller.signal })
      .catch((caught) => caught)) as Error
    expect(error.name).toBe('AbortError')
  })
})

describe('响应结构校验', () => {
  async function parse(report: unknown): Promise<AnalysisRequestError> {
    const { fetchImpl } = fakeFetch([jsonResponse(report)])
    return expectFailure(
      createAnalysisClient({ fetchImpl }).requestAnalysisReport('t', { rangeDays: 7 }),
    )
  }

  it('不接受 `{ report }` 包裹：契约里的成功响应是平铺对象', async () => {
    const wrapped = await parse({ report: reportBody() })
    expect(wrapped.kind).toBe('invalid-response')
  })

  it('缺少 analysis 段落时按 invalid-response 拒绝，不伪造报告', async () => {
    const error = await parse({
      ...reportBody(),
      content: { ...CONTENT, analysis: undefined },
    })
    expect(error.kind).toBe('invalid-response')
    expect(error.message).toBe(ANALYSIS_INVALID_LABEL)
  })

  it('analysis 少于 2 段、结论为空、id 缺失都判为 invalid-response', async () => {
    const shortAnalysis = await parse({
      ...reportBody(),
      content: { ...CONTENT, analysis: ['只有一段分析内容，长度也不够。'] },
    })
    expect(shortAnalysis.kind).toBe('invalid-response')

    const noConclusions = await parse({
      ...reportBody(),
      content: { ...CONTENT, conclusions: [] },
    })
    expect(noConclusions.kind).toBe('invalid-response')

    const noId = await parse({ ...reportBody(), reportId: '' })
    expect(noId.kind).toBe('invalid-response')
  })

  it('metrics 缺失或条目字段不全时判为 invalid-response', async () => {
    const noMetrics = await parse({ ...reportBody(), metrics: undefined })
    expect(noMetrics.kind).toBe('invalid-response')

    const badMetric = await parse({
      ...reportBody(),
      metrics: [{ label: '训练', value: '', detail: '' }],
    })
    expect(badMetric.kind).toBe('invalid-response')
  })

  it('origin 非法、cached 非布尔、range.days 不在 7/30/90 都拒绝', async () => {
    expect((await parse({ ...reportBody(), origin: 'mock' })).kind).toBe('invalid-response')
    expect((await parse({ ...reportBody(), cached: 'yes' })).kind).toBe('invalid-response')
    expect(
      (
        await parse({
          ...reportBody(),
          range: { start: '2025-10-01', end: '2025-10-14', days: 14 },
        })
      ).kind,
    ).toBe('invalid-response')
  })

  it('非 JSON / 空响应按 invalid-response 处理', async () => {
    const empty = { ok: true, status: 200, json: async () => null } as unknown as Response
    const { fetchImpl } = fakeFetch([empty])
    const error = await expectFailure(
      createAnalysisClient({ fetchImpl }).requestAnalysisReport('t', { rangeDays: 7 }),
    )
    expect(error.kind).toBe('invalid-response')
  })
})

describe('归档与事实包', () => {
  const listItem = {
    id: 'r-1',
    type: '综合分析',
    rangeDays: 7,
    origin: 'rules',
    model: null,
    start: '2025-10-01',
    end: '2025-10-07',
    dataRev: 12,
    createdAt: 1_760_000_000_000,
    title: '近 7 天综合复盘',
    status: '缓存结果',
  }

  it('fetchReportArchive：GET /api/v1/reports，limit 夹到 1–50，解析 nextCursor', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse({ reports: [listItem], nextCursor: 'cursor-1' }),
    ])
    const result = await createAnalysisClient({ fetchImpl }).fetchReportArchive('t', { limit: 999 })

    const url = new URL(calls[0]?.url ?? '', 'http://localhost')
    expect(url.pathname).toBe('/api/v1/reports')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(result.reports[0]).toMatchObject({ id: 'r-1', origin: 'rules' })
    expect(result.nextCursor).toBe('cursor-1')
  })

  it('fetchReportDetail：GET /api/v1/reports/:id，解析正文与指标', async () => {
    const { fetchImpl, calls } = fakeFetch([
      jsonResponse({ ...listItem, content: CONTENT, metrics: reportBody().metrics }),
    ])
    const detail = await createAnalysisClient({ fetchImpl }).fetchReportDetail('t', 'r-1')

    expect(new URL(calls[0]?.url ?? '', 'http://localhost').pathname).toBe('/api/v1/reports/r-1')
    expect(detail.id).toBe('r-1')
    expect(detail.content.analysis).toHaveLength(2)
    expect(detail.metrics).toHaveLength(2)
  })

  it('fetchReportDetail 404 → invalid，并带上服务端错误码', async () => {
    const { fetchImpl } = fakeFetch([
      jsonResponse({ error: { code: 'not_found', message: '报告不存在。' } }, 404),
    ])
    const error = await expectFailure(
      createAnalysisClient({ fetchImpl }).fetchReportDetail('t', 'missing'),
    )
    expect(error.kind).toBe('invalid')
    expect(error.code).toBe('not_found')
    expect(error.message).toBe('报告不存在。')
  })

  it('fetchAnalysisFacts：GET /api/v1/analysis/facts?rangeDays=30，校验 version', async () => {
    const facts = {
      version: 2,
      generatedAt: 1_760_000_000_000,
      type: '综合分析',
      range: { days: 30, start: '2025-09-08', end: '2025-10-07' },
      granularity: 'day',
      dataRev: 12,
      profile: null,
      plan: null,
      days: [],
      weekly: [],
      totals: { fitnessSessions: 3 },
      trend: {},
      coverage: {},
      consent: { profile: true, fitness: true, diet: false, study: true },
    }
    const { fetchImpl, calls } = fakeFetch([jsonResponse({ facts })])
    const result = await createAnalysisClient({ fetchImpl }).fetchAnalysisFacts('t', 30)

    expect(new URL(calls[0]?.url ?? '', 'http://localhost').searchParams.get('rangeDays')).toBe(
      '30',
    )
    expect(result.version).toBe(2)

    const bad = await expectFailure(
      createAnalysisClient({
        fetchImpl: fakeFetch([jsonResponse({ facts: { ...facts, version: 1 } })]).fetchImpl,
      }).fetchAnalysisFacts('t', 30),
    )
    expect(bad.kind).toBe('invalid-response')
  })
})

describe('展示文案常量', () => {
  it('六种来源/状态文案与设计文档一致', () => {
    expect(ANALYSIS_SERVER_LABEL).toBe('服务端分析 · DeepSeek')
    expect(ANALYSIS_CACHE_LABEL).toBe('缓存结果（数据未变）')
    expect(ANALYSIS_RULES_LABEL).toBe('服务端规则生成（AI 不可用）')
    expect(ANALYSIS_LOCAL_LABEL).toBe('本地生成 · Mock 报告')
    expect(ANALYSIS_UNAVAILABLE_LABEL).toBe('服务端分析暂不可用')
    expect(ANALYSIS_CONSENT_LABEL).toBe('AI 授权已关闭，未做服务端分析')
    expect(ANALYSIS_SYNC_OFF_LABEL).toBe('未开启数据同步，服务端分析不可用')
    expect(ANALYSIS_RULES_NOTE).toBe(
      '服务端未配置模型或模型暂时不可用，本报告由服务端规则基于真实记录生成。',
    )
  })
})
