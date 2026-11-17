/**
 * DeepSeek 客户端。
 *
 * 三个必须可测的点：
 * - 超时：每次尝试 25s（可配），超时抛 AiError('timeout')；
 * - 取消：调用方 abort 时立刻中止上游请求，不再多花额度；
 * - 重试：只对 429/5xx/网络错误重试，且流式一旦已经吐出内容就不再重试（否则会重复文本）。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type AiErrorCode = 'upstream' | 'timeout' | 'invalid_response'

export class AiError extends Error {
  readonly code: AiErrorCode
  readonly status?: number

  constructor(code: AiErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'AiError'
    this.code = code
    if (status !== undefined) this.status = status
  }
}

/**
 * 上游报告的 token 用量（P0 Step 3）。
 *
 * 只取两个数：输入与输出。不取 `total_tokens`——它是两者之和，存三份会有一份永远
 * 可能和另两份对不上；配额判定要的是「花掉多少」，加出来即可。
 */
export interface AiTokenUsage {
  promptTokens: number
  completionTokens: number
}

export interface AiStreamOptions {
  signal?: AbortSignal
  /**
   * 上游返回 usage 时回调一次。
   *
   * 流式下 DeepSeek 只在**最后一个 chunk**（`choices` 为空、带 `usage`）给出用量，
   * 所以拿到它意味着这条流正常跑到了结尾；中途 abort / 断流时不会回调，
   * 这次调用在账上就记 0 token（少算，不会多算）。
   */
  onUsage?: (usage: AiTokenUsage) => void
}

export interface AiJsonOptions {
  signal?: AbortSignal
  /** 本次调用覆盖默认 max_tokens（综合分析正文比简报长，需要更大额度）。 */
  maxTokens?: number
  /** 本次调用覆盖默认超时（长事实包生成更慢）。 */
  timeoutMs?: number
  /** 同 `AiStreamOptions.onUsage`；非流式响应体里直接带 `usage`。 */
  onUsage?: (usage: AiTokenUsage) => void
}

export interface AiClient {
  /** 逐块产出模型可见回复文本。 */
  streamChat(messages: ChatMessage[], options?: AiStreamOptions): AsyncGenerator<string>
  /** 非流式 JSON 调用，返回已解析的对象（未校验结构）。 */
  completeJson(messages: ChatMessage[], options?: AiJsonOptions): Promise<unknown>
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface AiClientConfig {
  deepseekApiKey: string | null
  deepseekBaseUrl: string
  deepseekModel: string
  aiTimeoutMs: number
  aiMaxRetries: number
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

interface AiSession {
  signal: AbortSignal
  timedOut: () => boolean
  dispose: () => void
}

function openSession(outerSignal: AbortSignal | undefined, timeoutMs: number): AiSession {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  timer.unref()
  const onAbort = () => controller.abort()
  outerSignal?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      outerSignal?.removeEventListener('abort', onAbort)
    },
  }
}

function normalizeError(error: unknown, timedOut: boolean): Error {
  if (timedOut) return new AiError('timeout', '模型服务响应超时。')
  if (error instanceof AiError) return error
  if (error instanceof Error && error.name === 'AbortError') return error
  return new AiError('upstream', '模型服务连接失败。')
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof AiError)) return false
  if (error.status !== undefined) return RETRYABLE_STATUS.has(error.status)
  return error.code === 'upstream'
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const body = fenced?.[1] ?? trimmed
  try {
    return JSON.parse(body)
  } catch {
    throw new AiError('invalid_response', '模型返回的结构化结果不是合法 JSON。')
  }
}

/**
 * 从上游响应里抠出 token 用量。取不到就返回 `null`（记 0），**绝不猜**：
 * 编一个数字会让日配额看起来更紧，排查时却查不出缘由。
 */
export function readTokenUsage(value: unknown): AiTokenUsage | null {
  if (typeof value !== 'object' || value === null) return null
  const usage = value as { prompt_tokens?: unknown; completion_tokens?: unknown }
  const prompt = toTokenCount(usage.prompt_tokens)
  const completion = toTokenCount(usage.completion_tokens)
  // 两项都缺或都为 0 视为没有用量（上游可能没返回 usage 字段）。
  if (prompt === 0 && completion === 0) return null
  return { promptTokens: prompt, completionTokens: completion }
}

function toTokenCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.trunc(value)
}

type SseEvent = { content: string } | { usage: AiTokenUsage } | 'done'

function parseSseLine(line: string): SseEvent | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const data = trimmed.slice(5).trim()
  if (!data) return null
  if (data === '[DONE]') return 'done'
  try {
    const parsed = JSON.parse(data) as {
      choices?: { delta?: { content?: unknown } }[]
      usage?: unknown
    }
    const content = parsed.choices?.[0]?.delta?.content
    if (typeof content === 'string' && content.length > 0) return { content }
    // usage 只出现在最后一个 chunk 上，且那一帧的 choices 是空数组，
    // 所以必须先判文本、再判 usage，否则会把纯 usage 帧误当成「空内容」丢掉。
    const usage = readTokenUsage(parsed.usage)
    return usage ? { usage } : null
  } catch {
    // 单行解析失败不中断整条流：跳过坏行，继续等后面的数据。
    return null
  }
}

async function* readSseContent(
  response: Response,
  onUsage?: (usage: AiTokenUsage) => void,
): AsyncGenerator<string> {
  if (!response.body) throw new AiError('invalid_response', '模型服务没有返回响应体。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        const payload = parseSseLine(line)
        if (payload === 'done') return
        if (payload && 'content' in payload) yield payload.content
        else if (payload && 'usage' in payload) onUsage?.(payload.usage)
        newline = buffer.indexOf('\n')
      }
    }
    const tail = parseSseLine(buffer)
    if (tail && tail !== 'done') {
      if ('content' in tail) yield tail.content
      else onUsage?.(tail.usage)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export function createDeepSeekClient(
  config: AiClientConfig,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): AiClient {
  const baseUrl = config.deepseekBaseUrl.replace(/\/+$/, '')
  const attempts = Math.max(0, config.aiMaxRetries) + 1

  async function postChat(session: AiSession, body: Record<string, unknown>): Promise<Response> {
    if (!config.deepseekApiKey) {
      throw new AiError('upstream', '服务端未配置 DEEPSEEK_API_KEY。', 503)
    }
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.deepseekApiKey}`,
      },
      body: JSON.stringify({ model: config.deepseekModel, ...body }),
      signal: session.signal,
    })
    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 300).trim()
      } catch {
        // 读不到错误体不影响状态码判断
      }
      const message = detail
        ? `模型服务返回 ${response.status}：${detail}`
        : `模型服务返回 ${response.status}。`
      throw new AiError('upstream', message, response.status)
    }
    return response
  }

  return {
    async *streamChat(messages, options) {
      const outer = options?.signal
      let lastError: unknown = new AiError('upstream', '模型服务不可用。')
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const session = openSession(outer, config.aiTimeoutMs)
        let yielded = 0
        try {
          const response = await postChat(session, {
            messages,
            stream: true,
            temperature: 0.6,
            max_tokens: 900,
            // 要求上游在流末尾附带 usage，否则配额拿不到 token 数（P0 Step 3）。
            stream_options: { include_usage: true },
          })
          for await (const text of readSseContent(response, options?.onUsage)) {
            yielded += 1
            yield text
          }
          return
        } catch (error) {
          lastError = normalizeError(error, session.timedOut())
          if (outer?.aborted) throw lastError
          // 已经吐出内容就绝不重试：重试会让同一段话出现两次。
          if (yielded > 0 || !isRetryable(lastError) || attempt === attempts - 1) {
            throw lastError
          }
        } finally {
          session.dispose()
        }
        await delay(300 * (attempt + 1), outer)
      }
      throw lastError
    },

    async completeJson(messages, options) {
      const outer = options?.signal
      let lastError: unknown = new AiError('upstream', '模型服务不可用。')
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const session = openSession(outer, options?.timeoutMs ?? config.aiTimeoutMs)
        try {
          const response = await postChat(session, {
            messages,
            stream: false,
            temperature: 0,
            max_tokens: options?.maxTokens ?? 1_600,
            response_format: { type: 'json_object' },
          })
          const payload = (await response.json()) as {
            choices?: { message?: { content?: unknown } }[]
            usage?: unknown
          }
          const content = payload.choices?.[0]?.message?.content
          if (typeof content !== 'string' || !content.trim()) {
            throw new AiError('invalid_response', '模型服务返回了空内容。')
          }
          // 先回调再解析 JSON：即使正文结构不合规，这次调用的 token 也已经花掉了。
          const usage = readTokenUsage(payload.usage)
          if (usage) options?.onUsage?.(usage)
          return parseJsonContent(content)
        } catch (error) {
          lastError = normalizeError(error, session.timedOut())
          if (outer?.aborted) throw lastError
          if (!isRetryable(lastError) || attempt === attempts - 1) throw lastError
        } finally {
          session.dispose()
        }
        await delay(300 * (attempt + 1), outer)
      }
      throw lastError
    },
  }
}
