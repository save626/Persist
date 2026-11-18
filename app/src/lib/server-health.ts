import type { FetchLike } from './ai-report-client'
import { aiCredential } from './ai-credential'

/**
 * 服务端连通性检查（设置页的「测试服务端连接」用）。
 *
 * 为什么另起一个函数，而不是复用 `probeAiReport` / `probeAiChat`：
 * 那两个 probe 回答的是「能不能调用真实模型，否则退回本地 Mock」，只需要一个布尔值，
 * 而且它们**故意**把所有失败折叠成 `false`——回退决策不需要知道原因。
 * 设置页的按钮回答的是另一个问题：「是哪个环节坏了」。所以这里返回分项结果，
 * 每种结局给不同的话术，用户才知道该去查网络、查反代，还是查服务端环境变量。
 *
 * 两个阶段（P5-9 之后）：
 * 1. `GET /api/health`——部署是否在线、库是否可用、模型是否配置；
 * 2. `POST /api/chat` 探针——**只走鉴权 + 跨域 + 裸 SSE 流**，不打模型、不占配额。
 *
 * 第二阶段不是锦上添花：健康检查在某些故障面前会一路 200，而真实对话一个字节都读不到。
 * 典型例子就是 P5-9——`/api/chat` 的 SSE 走 `hijack` + 裸 `writeHead`，CORS 头没跟过去，
 * WebView 里直接 `TypeError: Failed to fetch`，健康检查却完全正常。只测第一阶段，
 * 等于把「已经排除过了」这件事说成了真的。
 */

export type ServerHealthKind =
  | 'ready'
  | 'ai-disabled'
  | 'degraded'
  | 'unreachable'
  /** 服务端本身没问题，但对话这条链路不通（凭据被拒 / 跨域被拦 / 限流 / 非 200）。 */
  | 'chat-failed'
  /** 链路没坏，只是这台设备还没有凭据（没开同步 / 没注册过账号）——不是故障，是待办。 */
  | 'chat-no-credential'

export type ChatLinkKind =
  | 'ok'
  | 'skipped'
  /** 服务端 401，而且这次请求本来就没带凭据：先绑账号，别去查网络。 */
  | 'no-credential'
  /** 服务端 401，但凭据是带了的：被吊销或过期，需要重新绑定。 */
  | 'unauthorized'
  | 'ai-disabled'
  | 'rate-limited'
  /** 浏览器层面就读不到：CORS 被拦、DNS 失败、反代不通。P5-9 就长这样。 */
  | 'blocked'
  | 'error'

export interface ChatLink {
  kind: ChatLinkKind
  /** 给用户看的一句话结论，直接渲染，不要在页面里再拼一遍。 */
  message: string
}

export interface ServerHealth {
  kind: ServerHealthKind
  /** 给用户看的一句话结论，直接渲染，不要在页面里再拼一遍。 */
  message: string
  /** 对话链路的结果；健康检查没通过时是 `skipped`（没有意义再往下测）。 */
  chat: ChatLink
}

export const SERVER_HEALTH_ENDPOINT = '/api/health'
export const CHAT_PROBE_ENDPOINT = '/api/chat'

/** 8 秒：C2C 移动网络下一次往返通常 < 2 秒，超过 8 秒基本可以判定不是「慢」而是「不通」。 */
export const SERVER_HEALTH_TIMEOUT_MS = 8_000
/** 探针不打模型，正常应该几十毫秒内结束；超过 8 秒同样是「不通」。 */
export const CHAT_PROBE_TIMEOUT_MS = 8_000

export interface CheckServerHealthOptions {
  endpoint?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
  /**
   * 是否连同对话链路一起测。默认测；`false` 用于 demo / guest 这类
   * 客户端根本不调用服务端 AI 的模式——那种情况下 401 是预期行为，
   * 报「凭据无效」只会误导。
   */
  checkChat?: boolean
  /** 透传给探针；不传则用真实对话会用的那一个（`aiCredential()`）。 */
  credential?: string | null
}

export interface CheckChatLinkOptions {
  endpoint?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
  credential?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function timeoutSeconds(timeoutMs: number): number {
  return Math.max(1, Math.round(timeoutMs / 1_000))
}

/** 服务端回的是错误响应体（`{ error: { message } }`），能读出人话就读，读不出退回通用文案。 */
function errorMessageOfText(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text)
    if (isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string') {
      const message = value.error.message.trim()
      if (message) return message
    }
  } catch {
    // 非 JSON（Nginx 的 HTML 错误页等）走通用文案。
  }
  return null
}

/** 从探针的 SSE 文本里找出 `done` / `error` 两类帧，其余（`stage`、`: ping` 注释）忽略。 */
function readProbeFrames(text: string): { done: boolean; error: string | null } {
  let done = false
  let error: string | null = null
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((item) => item.startsWith('data:'))
    if (!line) continue
    try {
      const value: unknown = JSON.parse(line.slice('data:'.length).trim())
      if (!isRecord(value)) continue
      if (value.type === 'done') done = true
      if (value.type === 'error' && typeof value.message === 'string') error = value.message
    } catch {
      // 单个坏帧不影响结论：真正要看的是最后有没有 done。
    }
  }
  return { done, error }
}

/**
 * 对话链路探针：带真实对话会带的那份凭据，发一次 `{ probe: true }`，
 * 然后检查能不能从流里读到 `done`。
 *
 * 它证明的是「此刻这个浏览器 + 这台设备 + 这条反代」能把 `/api/chat` 的 SSE 帧读下来，
 * 也就是 P5-9 那类问题一定会被它抓到的原因；它**不**证明模型可用——那由健康检查的
 * `ai` 字段和真实对话的账本回答。
 */
export async function checkChatLink(options: CheckChatLinkOptions = {}): Promise<ChatLink> {
  const endpoint = options.endpoint ?? CHAT_PROBE_ENDPOINT
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? CHAT_PROBE_TIMEOUT_MS
  const credential = 'credential' in options ? options.credential : aiCredential()

  // 超时覆盖「连接 + 读流」全程：探针正常几十毫秒结束，挂住就是有问题。
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let response: Response
    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify({ probe: true }),
        signal: controller.signal,
      })
    } catch {
      // 浏览器把「CORS 未通过」和「网络不通」都报成同一个 TypeError，
      // 所以话术必须同时覆盖两种可能，不能替用户下结论。
      return controller.signal.aborted
        ? {
            kind: 'error',
            message: `对话请求超时：${timeoutSeconds(timeoutMs)} 秒内没有响应，检查网络或反代。`,
          }
        : {
            kind: 'blocked',
            message: '浏览器读不到对话流（请求被跨域拦下或网络不通），真实 AI 会静默退回本地规则。',
          }
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const detail = errorMessageOfText(text)
      if (response.status === 401) {
        // 「没带凭据」和「凭据被拒」是两件事：前者去开同步，后者要去查设备是否被吊销。
        // 合成一句 401 会把「还没注册」说成「出故障了」。
        return credential === null
          ? {
              kind: 'no-credential',
              message:
                '这台设备还没有可用的 AI 凭据（没开跨设备同步或还没注册账号），真实 AI 会继续用本地规则。',
            }
          : {
              kind: 'unauthorized',
              message:
                '对话请求被拒（401）：这次带的凭据服务端不认（可能已被吊销），真实 AI 会静默退回本地规则。',
            }
      }
      if (response.status === 503) {
        return {
          kind: 'ai-disabled',
          message: detail ?? '服务端还没有配置模型密钥，对话只能走本地规则。',
        }
      }
      if (response.status === 429) {
        return {
          kind: 'rate-limited',
          message: detail ?? '请求过于频繁，稍后再试；真实 AI 暂时会退回本地规则。',
        }
      }
      return {
        kind: 'error',
        message: detail ?? `对话接口返回 ${response.status}，先查反代与部署。`,
      }
    }

    let text: string
    try {
      text = await response.text()
    } catch {
      return controller.signal.aborted
        ? {
            kind: 'error',
            message: `对话流超时：${timeoutSeconds(timeoutMs)} 秒内没有结束，可能被反代缓冲。`,
          }
        : { kind: 'error', message: '对话流读到一半中断了。' }
    }

    const frames = readProbeFrames(text)
    if (frames.done) {
      return { kind: 'ok', message: '对话链路可用（本次未调用模型，不消耗额度）' }
    }
    if (frames.error) {
      return { kind: 'error', message: `服务端回了错误帧：${frames.error}` }
    }
    return {
      kind: 'error',
      message: '对话流没有以 done 结束，可能被反代缓冲或截断了。',
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function checkServerHealth(
  options: CheckServerHealthOptions = {},
): Promise<ServerHealth> {
  const endpoint = options.endpoint ?? SERVER_HEALTH_ENDPOINT
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? SERVER_HEALTH_TIMEOUT_MS
  const skipped: ChatLink = { kind: 'skipped', message: '未检查对话链路。' }

  // 没有超时的话，一个挂住的连接会让按钮永远停在「测试中…」——比测不出来更糟。
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await doFetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch {
    // 两种情况必须分开说：超时是「对面没回」，其余是「根本没连上」（DNS / 拒绝连接 / 离线）。
    return {
      kind: 'unreachable',
      chat: skipped,
      message: controller.signal.aborted
        ? `超时：${timeoutSeconds(timeoutMs)} 秒内没有响应，检查网络或服务是否在运行。`
        : '连不上服务端，检查网络或服务是否在运行。',
    }
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    return {
      kind: 'unreachable',
      chat: skipped,
      message: `服务端返回 ${response.status}。这个地址应该有 200 + JSON，先查反代和部署。`,
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    // Nginx 的 HTML 错误页、被运营商劫持的落地页都会走到这里。
    return {
      kind: 'unreachable',
      chat: skipped,
      message: '服务端返回的不是 JSON，可能是反代或部署问题。',
    }
  }

  if (!isRecord(payload)) {
    return { kind: 'unreachable', chat: skipped, message: '健康检查返回的结构不认识。' }
  }

  // 数据库优先于模型：库坏了，同步与报告都不可靠，说「模型没配」会把人引到错误方向。
  if (payload.status !== 'ok') {
    return {
      kind: 'degraded',
      chat: skipped,
      message: '服务端在线，但数据库探测失败（degraded）；同步与报告都会不可靠。',
    }
  }

  if (payload.ai !== 'deepseek') {
    return {
      kind: 'ai-disabled',
      chat: skipped,
      message: '服务端在线，但没有配置模型密钥，AI 请求会直接返回 503。',
    }
  }

  // 部署这一层过关了，接着测真正会坏的那一段。
  if (options.checkChat === false) {
    return {
      kind: 'ready',
      chat: { kind: 'skipped', message: '当前模式不调用服务端对话，未检查。' },
      message: '服务端在线 · DeepSeek 已配置（当前模式不调用服务端对话）',
    }
  }

  const chat = await checkChatLink({
    fetchImpl: doFetch,
    ...('credential' in options ? { credential: options.credential } : {}),
  })
  if (chat.kind === 'no-credential') {
    return { kind: 'chat-no-credential', chat, message: `服务端在线，但${chat.message}` }
  }
  if (chat.kind !== 'ok') {
    return { kind: 'chat-failed', chat, message: `服务端在线，但${chat.message}` }
  }
  return { kind: 'ready', chat, message: `服务端在线 · ${chat.message}` }
}
