import { MOCK_CHAT_LABEL, createMockChatClient, type MockChatOptions } from './mock-chat-client'
import type {
  ChatClient,
  ChatEvent,
  ChatPlanProposal,
  ChatQuestion,
  ChatRequest,
} from './chat-types'
import type { ProfileData } from '../types'

/**
 * 真实 AI 对话客户端（经本站服务端代理）+ 本地 Mock 回退。
 *
 * 数据流：浏览器 → 同源 `/api/chat`（Nginx 反代到 Fastify）→ DeepSeek。
 * 前端永远不持有 API Key，也不直接访问模型厂商域名。
 *
 * 诚实性约束（与 Mock 标注规则同一优先级）：
 * - 只有服务端健康检查确认可用、且本次请求成功走完，来源才标成 DeepSeek；
 * - 未开启 AI 数据处理授权、服务不可用、或失败发生在首块内容之前时，
 *   必须回退到本地 Mock，并在界面同时显示 Mock 标签与回退原因；
 * - 已经输出过内容后再失败不自动回退（否则会出现两段矛盾的答案），
 *   而是如实报错让用户自己决定是否重试。
 */

export const AI_CHAT_LABEL = 'DeepSeek 生成 · 经本站服务端代理'

export const AI_CHAT_ENDPOINT = '/api/chat'
export const AI_HEALTH_ENDPOINT = '/api/health'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** 服务端不可用 / 拒绝请求 / 流到一半报错时抛出，调用方据此决定是否回退。 */
export class ChatUnavailableError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ChatUnavailableError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

const STAGES = new Set(['collect', 'propose', 'applied'])
const PROFILE_FIELDS = new Set([
  'age',
  'height',
  'weight',
  'targetWeight',
  'goal',
  'experience',
  'frequency',
  'equipment',
  'dietPreference',
  'allergies',
  'bedtime',
  'sleepHours',
  'stress',
])

/**
 * 校验服务端下发的事件形状。
 * 服务端已经做过白名单净化，这里只做「UI 不认识就拒绝」的最后一道检查：
 * 宁可报错回退 Mock，也不把未知结构塞进渲染层。
 */
function parseChatEvent(value: Record<string, unknown>): ChatEvent | null {
  if (typeof value.type !== 'string') return null

  switch (value.type) {
    case 'stage': {
      if (typeof value.stage !== 'string' || !STAGES.has(value.stage)) return null
      return { type: 'stage', stage: value.stage as 'collect' | 'propose' | 'applied' }
    }
    case 'delta': {
      if (typeof value.text !== 'string') return null
      if (value.text.length === 0) return null
      return { type: 'delta', text: value.text }
    }
    case 'questions': {
      if (!Array.isArray(value.questions)) return null
      const questions: ChatQuestion[] = []
      for (const item of value.questions) {
        if (!isRecord(item)) return null
        if (typeof item.id !== 'string' || typeof item.prompt !== 'string') return null
        if (typeof item.field !== 'string') return null
        const question: ChatQuestion = {
          id: item.id,
          field: item.field as ChatQuestion['field'],
          prompt: item.prompt,
        }
        if (typeof item.hint === 'string') question.hint = item.hint
        if (isStringArray(item.options)) question.options = item.options
        questions.push(question)
      }
      return { type: 'questions', questions }
    }
    case 'profilePatch': {
      if (!isRecord(value.patch)) return null
      const patch: Record<string, unknown> = {}
      for (const [key, field] of Object.entries(value.patch)) {
        if (!PROFILE_FIELDS.has(key)) continue
        if (typeof field === 'number' && Number.isFinite(field)) patch[key] = field
        else if (typeof field === 'string') patch[key] = field
      }
      return { type: 'profilePatch', patch: patch as Partial<ProfileData> }
    }
    case 'proposal': {
      if (!isRecord(value.proposal)) return null
      const proposal = value.proposal
      if (typeof proposal.title !== 'string' || typeof proposal.goal !== 'string') return null
      if (proposal.cadence !== 'weekly' && proposal.cadence !== 'cycle') return null
      if (!Array.isArray(proposal.weeklyTargets) || !Array.isArray(proposal.milestones)) {
        return null
      }
      if (
        !isStringArray(proposal.assumptions) ||
        !isStringArray(proposal.warnings) ||
        !isStringArray(proposal.highlights)
      ) {
        return null
      }
      return { type: 'proposal', proposal: proposal as unknown as ChatPlanProposal }
    }
    case 'warnings': {
      if (!isStringArray(value.warnings)) return null
      return { type: 'warnings', warnings: value.warnings }
    }
    case 'done':
      return { type: 'done' }
    default:
      return null
  }
}

function parseSseLine(line: string): ChatEvent | null {
  if (!line.startsWith('data:')) return null
  const payload = line.slice('data:'.length).trim()
  if (!payload) return null

  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    throw new ChatUnavailableError('模型服务返回了无法解析的数据。')
  }
  if (!isRecord(value)) throw new ChatUnavailableError('模型服务返回了无法识别的事件。')

  if (value.type === 'error') {
    const message =
      typeof value.message === 'string' && value.message.trim().length > 0
        ? value.message.trim()
        : '模型服务暂时不可用。'
    throw new ChatUnavailableError(message)
  }

  const event = parseChatEvent(value)
  if (!event) throw new ChatUnavailableError('模型服务返回了无法识别的事件。')
  return event
}

async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        const event = parseSseLine(line)
        if (!event) continue
        yield event
        // 服务端发完 done 就会断开；提前返回可以避免等一个必然的 EOF。
        if (event.type === 'done') return
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
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

export interface HttpChatOptions {
  endpoint?: string
  fetchImpl?: FetchLike
}

/** 直连 `/api/chat` 的 ChatClient 实现；不负责回退，失败一律抛出。 */
export function createHttpChatClient(options: HttpChatOptions = {}): ChatClient {
  const endpoint = options.endpoint ?? AI_CHAT_ENDPOINT
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))

  return {
    label: AI_CHAT_LABEL,
    async *send(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
      let response: Response
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            turns: request.turns,
            profile: request.profile,
            ...(request.askedFields && request.askedFields.length > 0
              ? { askedFields: request.askedFields }
              : {}),
          }),
          signal,
        })
      } catch (error) {
        if (isAbortError(error)) throw error
        throw new ChatUnavailableError('无法连接模型服务。')
      }

      if (!response.ok) {
        throw new ChatUnavailableError(await describeFailure(response), response.status)
      }
      if (!response.body) {
        throw new ChatUnavailableError('模型服务没有返回数据流。')
      }

      yield* readSseEvents(response.body)
    },
  }
}

export interface ProbeOptions {
  healthEndpoint?: string
  fetchImpl?: FetchLike
}

/** 健康检查：只有明确返回 `ai: "deepseek"` 才认为服务端可以调用真实模型。 */
export async function probeAiChat(options: ProbeOptions = {}): Promise<boolean> {
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

export type ChatSource = 'ai' | 'mock' | 'unknown'

export interface ChatStatus {
  source: ChatSource
  /** 本次是否因为真实模型不可用而回退到 Mock */
  fallback: boolean
  reason?: string
}

export interface AppChatClient extends ChatClient {
  /** 检测服务端是否可用；结果会缓存，直到页面重新打开。 */
  probe(): Promise<'ai' | 'mock'>
  status(): ChatStatus
}

export interface AppChatOptions {
  /** 用户是否已开启 AI 数据处理授权；关闭时永远走本地 Mock，不发任何请求。 */
  consent: boolean
  endpoint?: string
  healthEndpoint?: string
  fetchImpl?: FetchLike
  mockOptions?: MockChatOptions
}

/**
 * 组装「真实优先、Mock 兜底」的客户端。
 *
 * 回退规则：只有「还没输出任何内容」时失败才回退，避免同一轮出现两套答案；
 * 已输出内容后的失败原样抛出，由页面显示错误让用户重试。
 */
export function createAppChatClient(options: AppChatOptions): AppChatClient {
  const mock = createMockChatClient(options.mockOptions)
  const http = createHttpChatClient({
    endpoint: options.endpoint,
    fetchImpl: options.fetchImpl,
  })
  let status: ChatStatus = options.consent
    ? { source: 'unknown', fallback: false }
    : { source: 'mock', fallback: false }
  let probed: boolean | null = options.consent ? null : false

  const client: AppChatClient = {
    get label() {
      return status.source === 'ai' ? AI_CHAT_LABEL : MOCK_CHAT_LABEL
    },
    async probe() {
      if (!options.consent) {
        status = { source: 'mock', fallback: false }
        probed = false
        return 'mock'
      }
      const available = await probeAiChat({
        healthEndpoint: options.healthEndpoint,
        fetchImpl: options.fetchImpl,
      })
      probed = available
      status = { source: available ? 'ai' : 'mock', fallback: false }
      return available ? 'ai' : 'mock'
    },
    status() {
      return { ...status }
    },
    async *send(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
      if (!options.consent) {
        status = { source: 'mock', fallback: false }
        yield* mock.send(request, signal)
        return
      }

      if (probed === null) await client.probe()
      if (!probed) {
        status = { source: 'mock', fallback: false }
        yield* mock.send(request, signal)
        return
      }

      let emitted = false
      try {
        for await (const event of http.send(request, signal)) {
          if (event.type !== 'stage' && event.type !== 'done') emitted = true
          yield event
        }
        status = { source: 'ai', fallback: false }
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) throw error
        if (emitted) {
          status = {
            source: 'unknown',
            fallback: false,
            reason: errorMessageOf(error, '对话中断了。'),
          }
          throw error
        }
        status = {
          source: 'mock',
          fallback: true,
          reason: errorMessageOf(error, '模型服务暂时不可用。'),
        }
        yield* mock.send(request, signal)
      }
    },
  }

  return client
}
