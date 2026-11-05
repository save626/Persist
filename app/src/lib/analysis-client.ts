import {
  ANALYSIS_CONTENT_LIMITS,
  ANALYSIS_ERROR_CODES,
  ANALYSIS_REPORT_TYPE,
  isAnalysisRangeDays,
  type AnalysisMetric,
  type AnalysisOrigin,
  type AnalysisRangeDays,
  type AnalysisReportDetail,
  type AnalysisReportListItem,
  type AnalysisReportResponse,
  type AnalysisReportsListResponse,
  type ReportContentV2,
  type ReportFactsV2,
} from './analysis-contract'

/**
 * 服务端综合分析 HTTP 客户端（设计文档 §8 / §13）。
 *
 * 与 `sync-client.ts` 同一套写法：同源请求、Bearer 令牌、超时、把失败归类成页面能辨识的
 * `AnalysisRequestError.kind`。它不负责缓存、重试与回退——页面根据 kind 决定展示哪一态。
 *
 * 诚实性约束：
 * - 只有服务端明确返回 `origin: "ai"` 才标注 DeepSeek 生成；`origin: "rules"` 如实标注规则降级；
 * - 网络 / 超时 / 服务端不可用时页面回退本地 Mock，但**不能**把本地内容标成 AI；
 * - 200 但结构不合规时抛 `invalid-response`，页面显示「已拒绝展示」，宁可不渲染也不伪造报告。
 */

export const ANALYSIS_SERVER_LABEL = '服务端分析 · DeepSeek'
export const ANALYSIS_CACHE_LABEL = '缓存结果（数据未变）'
export const ANALYSIS_RULES_LABEL = '服务端规则生成（AI 不可用）'
export const ANALYSIS_LOCAL_LABEL = '本地生成 · Mock 报告'
export const ANALYSIS_UNAVAILABLE_LABEL = '服务端分析暂不可用'
export const ANALYSIS_CONSENT_LABEL = 'AI 授权已关闭，未做服务端分析'
export const ANALYSIS_INVALID_LABEL = '服务端分析结果不合规，已拒绝展示'
export const ANALYSIS_SYNC_OFF_LABEL = '未开启数据同步，服务端分析不可用'

/** 规则降级时给用户的解释：数字仍来自真实记录，只是文字由服务端规则拼装。 */
export const ANALYSIS_RULES_NOTE =
  '服务端未配置模型或模型暂时不可用，本报告由服务端规则基于真实记录生成。'

/** 本地回退时给用户的原因。 */
export const ANALYSIS_FALLBACK_NOTE =
  '服务端暂时连不上，下面是本机生成的分析内容，不会上传到服务端。'

/**
 * 服务端要先做 SQL 聚合、再等模型生成，比同步接口慢得多：
 * 默认给 90 s（要求 ≥ 60 s），避免正常生成被前端提前掐断。
 */
export const DEFAULT_ANALYSIS_TIMEOUT_MS = 90_000

export type AnalysisErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'consent-off'
  | 'insufficient'
  | 'invalid'
  | 'rate-limited'
  | 'server'
  | 'invalid-response'

/** 页面据此决定展示哪一态；`message` 是给用户看的中文原因。 */
export class AnalysisRequestError extends Error {
  kind: AnalysisErrorKind
  status: number | null
  /** 服务端返回的错误码，例如 `insufficient_data` / `invalid_response`。 */
  code: string | null

  constructor(
    kind: AnalysisErrorKind,
    message: string,
    options: { status?: number | null; code?: string | null } = {},
  ) {
    super(message)
    this.name = 'AnalysisRequestError'
    this.kind = kind
    this.status = options.status ?? null
    this.code = options.code ?? null
  }

  /** 网络抖动、限流、5xx 可以重试；401 / 403 / 409 重试也不会变好。 */
  get retryable(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'rate-limited' ||
      this.kind === 'server'
    )
  }
}

export interface AnalysisClientOptions {
  /** 默认同源；开发时由 vite proxy 转给 Fastify。 */
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface RequestAnalysisOptions {
  rangeDays: AnalysisRangeDays
  /** true 表示跳过缓存、按当前 dataRev 重新生成。 */
  force?: boolean
  signal?: AbortSignal
}

export interface ArchiveOptions {
  limit?: number
  cursor?: string | null
}

export interface AnalysisClient {
  requestAnalysisReport(
    token: string,
    options: RequestAnalysisOptions,
  ): Promise<AnalysisReportResponse>
  fetchAnalysisFacts(token: string, rangeDays: AnalysisRangeDays): Promise<ReportFactsV2>
  fetchReportArchive(token: string, options?: ArchiveOptions): Promise<AnalysisReportsListResponse>
  fetchReportDetail(token: string, id: string): Promise<AnalysisReportDetail>
}

const ANALYSIS_PATH = 'analysis/reports'
const FACTS_PATH = 'analysis/facts'
const REPORTS_PATH = 'reports'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function readErrorCode(body: unknown): string | null {
  if (!isRecord(body)) return null
  const error = body.error
  if (!isRecord(error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function readErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null
  const error = body.error
  if (isRecord(error) && typeof error.message === 'string') {
    const message = error.message.trim()
    if (message) return message
  }
  return null
}

function classifyStatus(status: number, body: unknown): AnalysisRequestError {
  const code = readErrorCode(body)
  const serverMessage = readErrorMessage(body)
  if (status === 401) {
    return new AnalysisRequestError(
      'unauthorized',
      serverMessage ?? '设备令牌已失效，请用恢复码重新绑定本机。',
      { status, code },
    )
  }
  if (status === 403) {
    return new AnalysisRequestError('consent-off', serverMessage ?? ANALYSIS_CONSENT_LABEL, {
      status,
      code,
    })
  }
  if (status === 409) {
    return new AnalysisRequestError(
      'insufficient',
      serverMessage ?? '窗口内记录不足，先记录几天再看。',
      { status, code },
    )
  }
  if (status === 429) {
    return new AnalysisRequestError('rate-limited', serverMessage ?? '请求过于频繁，请稍后再试。', {
      status,
      code,
    })
  }
  // 502 表示上游模型输出没通过服务端净化器：属于「结果不合规」，不是网络抖动。
  if (status === 502 || code === ANALYSIS_ERROR_CODES.invalidResponse) {
    return new AnalysisRequestError('invalid-response', serverMessage ?? ANALYSIS_INVALID_LABEL, {
      status,
      code,
    })
  }
  if (status >= 500) {
    return new AnalysisRequestError(
      'server',
      serverMessage ?? `服务端分析暂不可用（HTTP ${status}）。`,
      { status, code },
    )
  }
  if (status === 422 || status === 400) {
    return new AnalysisRequestError(
      'invalid',
      serverMessage ?? `分析请求不合法（HTTP ${status}）。`,
      { status, code },
    )
  }
  return new AnalysisRequestError('invalid', serverMessage ?? `分析请求失败（HTTP ${status}）。`, {
    status,
    code,
  })
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > 0 ? text : null
}

function readText(value: unknown, min: number, max: number): string | null {
  const text = normalizeText(value)
  if (!text) return null
  return text.length >= min && text.length <= max ? text : null
}

function readTextList(
  value: unknown,
  count: { min: number; max: number },
  item: { min: number; max: number },
): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length < count.min || value.length > count.max) return null
  const items: string[] = []
  for (const entry of value) {
    const text = readText(entry, item.min, item.max)
    if (!text) return null
    items.push(text)
  }
  return items
}

/** 校验报告正文；服务端已净化过，这里再做一次「UI 不认识就不渲染」的兜底。 */
export function parseAnalysisContent(value: unknown): ReportContentV2 | null {
  if (!isRecord(value)) return null
  const limits = ANALYSIS_CONTENT_LIMITS
  const title = readText(value.title, limits.title.min, limits.title.max)
  if (!title) return null
  const status = readText(value.status, limits.status.min, limits.status.max)
  if (!status) return null
  const summary = readText(value.summary, limits.summary.min, limits.summary.max)
  if (!summary) return null
  const analysis = readTextList(
    value.analysis,
    { min: limits.analysis.min, max: limits.analysis.max },
    { min: limits.analysis.minLength, max: limits.analysis.maxLength },
  )
  if (!analysis) return null
  const conclusions = readTextList(
    value.conclusions,
    { min: limits.conclusions.min, max: limits.conclusions.max },
    { min: limits.conclusions.itemMin, max: limits.conclusions.itemMax },
  )
  if (!conclusions) return null
  const actions = readTextList(
    value.actions,
    { min: limits.actions.min, max: limits.actions.max },
    { min: limits.actions.itemMin, max: limits.actions.itemMax },
  )
  if (!actions) return null
  const warnings = readTextList(
    value.warnings ?? [],
    { min: 0, max: limits.warnings.max },
    { min: limits.warnings.itemMin, max: limits.warnings.itemMax },
  )
  if (!warnings) return null
  return { title, status, summary, analysis, conclusions, actions, warnings }
}

function parseMetric(value: unknown): AnalysisMetric | null {
  if (!isRecord(value)) return null
  const label = readText(value.label, 1, 24)
  if (!label) return null
  const metricValue = readText(value.value, 1, 40)
  if (!metricValue) return null
  const detail = normalizeText(value.detail) ?? ''
  if (detail.length > 80) return null
  return { label, value: metricValue, detail }
}

/** 数字类标量：缺字段就是结构不合规，绝不补 0。 */
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function parseOrigin(value: unknown): AnalysisOrigin | null {
  return value === 'ai' || value === 'rules' ? value : null
}

function parseRange(value: unknown): { start: string; end: string; days: number } | null {
  if (!isRecord(value)) return null
  const start = normalizeText(value.start)
  const end = normalizeText(value.end)
  const days = readNumber(value.days)
  if (!start || !end || days === null || !isAnalysisRangeDays(days)) return null
  return { start, end, days }
}

function parseReportContent(value: unknown): {
  content: ReportContentV2
  metrics: AnalysisMetric[]
} | null {
  if (!isRecord(value)) return null
  const content = parseAnalysisContent(value.content)
  if (!content) return null
  if (!Array.isArray(value.metrics) || value.metrics.length === 0) return null
  const metrics: AnalysisMetric[] = []
  for (const entry of value.metrics) {
    const metric = parseMetric(entry)
    if (!metric) return null
    metrics.push(metric)
  }
  return { content, metrics }
}

function invalidResponse(message: string): AnalysisRequestError {
  return new AnalysisRequestError('invalid-response', message, { status: 200 })
}

/** 校验平铺的 200 报告响应（契约里 `AnalysisReportResponse` 没有 `{ report }` 包裹）；任何字段缺失都按「结果不合规」处理。 */
export function parseAnalysisReportResponse(body: unknown): AnalysisReportResponse {
  if (!isRecord(body)) throw invalidResponse('服务端返回的内容不是对象。')
  const report = body
  if (!isRecord(report)) throw invalidResponse('服务端没有返回报告内容。')
  const reportId = normalizeText(report.reportId)
  if (!reportId) throw invalidResponse('服务端返回的报告缺少 id。')
  const cached = readBoolean(report.cached)
  if (cached === null) throw invalidResponse('服务端返回的缓存标记不合法。')
  const origin = parseOrigin(report.origin)
  if (!origin) throw invalidResponse('服务端返回的报告来源不合法。')
  const range = parseRange(report.range)
  if (!range) throw invalidResponse('服务端返回的报告窗口不合法。')
  const parsed = parseReportContent(report)
  if (!parsed) throw invalidResponse(ANALYSIS_INVALID_LABEL)
  const model = report.model === null ? null : normalizeText(report.model)
  if (report.model !== null && report.model !== undefined && model === null) {
    throw invalidResponse('服务端返回的模型名不合法。')
  }
  const dataRev = readNumber(report.dataRev)
  const createdAt = readNumber(report.createdAt)
  if (dataRev === null || createdAt === null) {
    throw invalidResponse('服务端返回的报告缺少版本或生成时间。')
  }
  return {
    reportId,
    cached,
    origin,
    model,
    range,
    content: parsed.content,
    metrics: parsed.metrics,
    dataRev,
    createdAt,
  }
}

function parseListItem(value: unknown): AnalysisReportListItem | null {
  if (!isRecord(value)) return null
  const id = normalizeText(value.id)
  const type = normalizeText(value.type)
  const origin = parseOrigin(value.origin)
  const rangeDays = readNumber(value.rangeDays)
  const start = normalizeText(value.start)
  const end = normalizeText(value.end)
  const dataRev = readNumber(value.dataRev)
  const createdAt = readNumber(value.createdAt)
  const title = readText(
    value.title,
    ANALYSIS_CONTENT_LIMITS.title.min,
    ANALYSIS_CONTENT_LIMITS.title.max,
  )
  const status = readText(
    value.status,
    ANALYSIS_CONTENT_LIMITS.status.min,
    ANALYSIS_CONTENT_LIMITS.status.max,
  )
  if (
    !id ||
    !type ||
    !origin ||
    rangeDays === null ||
    !isAnalysisRangeDays(rangeDays) ||
    !start ||
    !end ||
    dataRev === null ||
    createdAt === null ||
    !title ||
    !status
  ) {
    return null
  }
  const model =
    value.model === null || value.model === undefined ? null : normalizeText(value.model)
  if (value.model !== null && value.model !== undefined && model === null) return null
  return { id, type, rangeDays, origin, model, start, end, dataRev, createdAt, title, status }
}

export function parseAnalysisReportListResponse(body: unknown): AnalysisReportsListResponse {
  if (!isRecord(body)) throw invalidResponse('服务端返回的归档列表不是对象。')
  if (!Array.isArray(body.reports)) throw invalidResponse('服务端返回的归档列表格式不正确。')
  const reports: AnalysisReportListItem[] = []
  for (const entry of body.reports) {
    const item = parseListItem(entry)
    if (!item) throw invalidResponse('服务端返回的归档条目不合规。')
    reports.push(item)
  }
  const nextCursor = typeof body.nextCursor === 'string' ? body.nextCursor : null
  return { reports, nextCursor }
}

export function parseAnalysisReportDetail(body: unknown): AnalysisReportDetail {
  if (!isRecord(body)) throw invalidResponse('服务端返回的归档详情不是对象。')
  const item = parseListItem(body)
  if (!item) throw invalidResponse('服务端返回的归档详情不合规。')
  const parsed = parseReportContent(body)
  if (!parsed) throw invalidResponse(ANALYSIS_INVALID_LABEL)
  return { ...item, content: parsed.content, metrics: parsed.metrics }
}

export function parseAnalysisFactsResponse(body: unknown): ReportFactsV2 {
  if (!isRecord(body) || !isRecord(body.facts)) {
    throw invalidResponse('服务端返回的事实包不是对象。')
  }
  const facts = body.facts
  if (facts.version !== 2) throw invalidResponse('服务端返回的事实包版本不受支持。')
  const range = parseRange(facts.range)
  if (!range) throw invalidResponse('服务端返回的事实包窗口不合法。')
  if (!Array.isArray(facts.days)) throw invalidResponse('服务端返回的事实包缺少按日明细。')
  if (!isRecord(facts.totals)) throw invalidResponse('服务端返回的事实包缺少汇总。')
  return body.facts as unknown as ReportFactsV2
}

/** 只接受契约里的窗口；页面传错时直接拒绝，不发请求。 */
function requireRangeDays(value: unknown): AnalysisRangeDays {
  if (!isAnalysisRangeDays(value)) {
    throw new AnalysisRequestError('invalid', '分析窗口只支持 7 / 30 / 90 天。', { status: null })
  }
  return value
}

export function createAnalysisClient(options: AnalysisClientOptions = {}): AnalysisClient {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS

  if (typeof fetchImpl !== 'function') {
    throw new Error('当前环境没有 fetch，无法创建分析客户端。')
  }

  async function request(
    method: 'GET' | 'POST',
    path: string,
    init: {
      token: string
      body?: unknown
      query?: Record<string, string | number>
      signal?: AbortSignal
    },
  ): Promise<unknown> {
    const search = init.query
      ? `?${new URLSearchParams(
          Object.entries(init.query).map(([key, value]) => [key, String(value)]),
        ).toString()}`
      : ''
    const headers: Record<string, string> = { accept: 'application/json' }
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.token) headers.authorization = `Bearer ${init.token}`

    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    const onExternalAbort = () => controller?.abort()
    if (controller && init.signal) {
      if (init.signal.aborted) controller.abort()
      else init.signal.addEventListener('abort', onExternalAbort, { once: true })
    }

    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}/api/v1/${path}${search}`, {
        method,
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        ...(controller ? { signal: controller.signal } : {}),
        cache: 'no-store',
      })
    } catch (error) {
      if (init.signal?.aborted && isAbortError(error)) throw error
      const aborted = controller?.signal.aborted === true
      throw new AnalysisRequestError(
        aborted ? 'timeout' : 'network',
        aborted
          ? '分析请求超时，服务端可能仍在生成，请稍后重试。'
          : '网络不可用，暂时连不上分析服务。',
      )
    } finally {
      if (timer) clearTimeout(timer)
      if (init.signal) init.signal.removeEventListener('abort', onExternalAbort)
    }

    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }

    if (!response.ok) throw classifyStatus(response.status, body)
    if (body === null) throw invalidResponse('服务端返回了无法解析的数据。')
    return body
  }

  return {
    async requestAnalysisReport(token, requestOptions) {
      const rangeDays = requireRangeDays(requestOptions.rangeDays)
      const payload: { type: string; rangeDays: AnalysisRangeDays; force?: boolean } = {
        type: ANALYSIS_REPORT_TYPE,
        rangeDays,
      }
      if (requestOptions.force) payload.force = true
      const body = await request('POST', ANALYSIS_PATH, {
        token,
        body: payload,
        signal: requestOptions.signal,
      })
      return parseAnalysisReportResponse(body)
    },
    async fetchAnalysisFacts(token, rangeDays) {
      const days = requireRangeDays(rangeDays)
      return parseAnalysisFactsResponse(
        await request('GET', FACTS_PATH, { token, query: { rangeDays: days } }),
      )
    },
    async fetchReportArchive(token, archiveOptions = {}) {
      const limit = Math.min(50, Math.max(1, Math.trunc(archiveOptions.limit ?? 10)))
      const query: Record<string, string | number> = { limit }
      if (archiveOptions.cursor) query.cursor = archiveOptions.cursor
      return parseAnalysisReportListResponse(await request('GET', REPORTS_PATH, { token, query }))
    },
    async fetchReportDetail(token, id) {
      const reportId = id.trim()
      if (!reportId) {
        throw new AnalysisRequestError('invalid', '报告 id 不能为空。', { status: null })
      }
      return parseAnalysisReportDetail(
        await request('GET', `${REPORTS_PATH}/${encodeURIComponent(reportId)}`, { token }),
      )
    },
  }
}
