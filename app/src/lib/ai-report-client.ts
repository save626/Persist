import type { ReportContent, ReportRequest } from './report-types'

/**
 * 真实 AI 报告客户端（经本站服务端代理）。
 *
 * 数据流：浏览器 → 同源 `/api/report`（Nginx 反代到 Fastify）→ DeepSeek。
 * 与对话客户端一样，前端永远不持有 API Key，也不直接访问模型厂商域名。
 *
 * 与对话的差异：报告是「一次成型」的结构化结果，因此用普通 JSON 请求而不是 SSE，
 * 失败边界清晰——要么拿到完整结论，要么明确抛错，由页面决定回退本地 Mock 还是报错。
 *
 * 诚实性约束：
 * - 只有健康检查确认服务端可调用真实模型，页面才把来源标成 DeepSeek；
 * - 未授权、服务不可用、或请求在拿到结论前失败时，页面回退到本地 Mock 并如实标注；
 * - 服务端返回的结构不符合契约时抛 `ReportContractError`，页面显示错误而不是伪造报告。
 */

export const AI_REPORT_LABEL = 'DeepSeek 生成 · 经本站服务端代理'
export const MOCK_REPORT_LABEL = '本地生成 · Mock 报告'

export const AI_REPORT_ENDPOINT = '/api/report'
export const AI_HEALTH_ENDPOINT = '/api/health'

/** 回退到本地 Mock 时展示给用户的原因。 */
export const REPORT_FALLBACK_NOTE = '真实模型暂时不可用，本次已回退到本地 Mock（规则生成）。'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** 服务端不可用 / 上游失败 / 超限时抛出；页面据此回退本地 Mock。 */
export class ReportUnavailableError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ReportUnavailableError'
    this.status = status
  }
}

/** 请求不符合契约、或响应结构不可识别时抛出；页面据此如实报错，不伪造报告。 */
export class ReportContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReportContractError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function readText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length >= min && text.length <= max ? text : null
}

function readTextList(value: unknown, min: number, max: number): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length < min || value.length > max) return null
  const items: string[] = []
  for (const item of value) {
    const text = readText(item, 1, 200)
    if (!text) return null
    items.push(text)
  }
  return items
}

/**
 * 校验服务端返回的报告结构。
 * 服务端已经净化过，这里再做一次「UI 不认识就不渲染」的兜底：
 * 宁可报错，也不把半截结构渲染成一份看起来正常的报告。
 */
export function parseReportContent(value: unknown): ReportContent | null {
  if (!isRecord(value)) return null
  const title = readText(value.title, 2, 40)
  if (!title) return null
  const status = readText(value.status, 2, 20)
  if (!status) return null
  const summary = readText(value.summary, 20, 600)
  if (!summary) return null
  const conclusions = readTextList(value.conclusions, 1, 6)
  if (!conclusions) return null
  const actions = readTextList(value.actions, 1, 6)
  if (!actions) return null
  const warnings = value.warnings === undefined ? [] : readTextList(value.warnings, 0, 6)
  if (!warnings) return null
  return { title, status, summary, conclusions, actions, warnings }
}

async function describeFailure(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    if (isRecord(data) && isRecord(data.error) && typeof data.error.message === 'string') {
      const message = data.error.message.trim()
      if (message) return message
    }
  } catch {
    // 非 JSON 响应（例如 Nginx 的 HTML 错误页），退回到通用文案。
  }
  if (response.status === 429) return '请求过于频繁，请稍后再试。'
  if (response.status === 503) return '服务端尚未配置模型密钥，或模型服务暂时不可用。'
  return `模型服务返回了 ${response.status}。`
}

export interface ProbeReportOptions {
  healthEndpoint?: string
  fetchImpl?: FetchLike
}

/** 健康检查：只有明确返回 `status: "ok"` 且 `ai: "deepseek"` 才认为可以调用真实模型。 */
export async function probeAiReport(options: ProbeReportOptions = {}): Promise<boolean> {
  const endpoint = options.healthEndpoint ?? AI_HEALTH_ENDPOINT
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))
  try {
    const response = await doFetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return false
    const data: unknown = await response.json()
    return isRecord(data) && data.status === 'ok' && data.ai === 'deepseek'
  } catch {
    return false
  }
}

export interface RequestReportOptions extends ProbeReportOptions {
  endpoint?: string
  signal?: AbortSignal
}

/**
 * 请求一次真实报告。不负责回退：调用方（页面）根据错误类型决定显示什么。
 * - `ReportUnavailableError`：服务端/上游暂时不可用，可回退本地 Mock；
 * - `ReportContractError`：请求或响应不符合契约，属于真错误，应如实提示；
 * - `AbortError`：用户已取消，直接忽略。
 */
export async function requestAiReport(
  request: ReportRequest,
  options: RequestReportOptions = {},
): Promise<ReportContent> {
  const endpoint = options.endpoint ?? AI_REPORT_ENDPOINT
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))

  let response: Response
  try {
    response = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(request),
      signal: options.signal,
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new ReportUnavailableError('无法连接模型服务。')
  }

  if (!response.ok) {
    const message = await describeFailure(response)
    if (response.status === 400 || response.status === 422) {
      throw new ReportContractError(message)
    }
    throw new ReportUnavailableError(message, response.status)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new ReportContractError('模型服务返回了无法解析的数据。')
  }
  if (!isRecord(data)) throw new ReportContractError('模型服务返回了无法识别的数据。')

  const content = parseReportContent(data.report)
  if (!content) throw new ReportContractError('模型返回的报告结构不合规。')
  return content
}
