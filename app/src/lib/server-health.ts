import type { FetchLike } from './ai-report-client'

/**
 * 服务端健康检查（设置页的「测试服务端连接」用）。
 *
 * 为什么另起一个函数，而不是复用 `probeAiReport` / `probeAiChat`：
 * 那两个 probe 回答的是「能不能调用真实模型，否则退回本地 Mock」，只需要一个布尔值，
 * 而且它们**故意**把所有失败折叠成 `false`——回退决策不需要知道原因。
 * 设置页的按钮回答的是另一个问题：「是哪个环节坏了」。所以这里返回分项结果，
 * 四种结局分别给不同的话术，用户才知道该去查网络、查反代，还是查服务端环境变量。
 *
 * 只读 `GET /api/health`。该接口不返回密钥、不返回业务数据，只有
 * `status / ai / model / db / version / storage` 这类部署状态。
 */

export type ServerHealthKind = 'ready' | 'ai-disabled' | 'degraded' | 'unreachable'

export interface ServerHealth {
  kind: ServerHealthKind
  /** 给用户看的一句话结论，直接渲染，不要在页面里再拼一遍。 */
  message: string
  /** 服务端 schema 版本；连不上或结构不认识时为 null。 */
  version: number | null
}

export const SERVER_HEALTH_ENDPOINT = '/api/health'

/** 8 秒：C2C 移动网络下一次往返通常 < 2 秒，超过 8 秒基本可以判定不是「慢」而是「不通」。 */
export const SERVER_HEALTH_TIMEOUT_MS = 8_000

export interface CheckServerHealthOptions {
  endpoint?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readVersion(payload: Record<string, unknown>): number | null {
  return typeof payload.version === 'number' && Number.isFinite(payload.version)
    ? payload.version
    : null
}

export async function checkServerHealth(
  options: CheckServerHealthOptions = {},
): Promise<ServerHealth> {
  const endpoint = options.endpoint ?? SERVER_HEALTH_ENDPOINT
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? SERVER_HEALTH_TIMEOUT_MS

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
      version: null,
      message: controller.signal.aborted
        ? `超时：${Math.round(timeoutMs / 1000)} 秒内没有响应，检查网络或服务是否在运行。`
        : '连不上服务端，检查网络或服务是否在运行。',
    }
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    return {
      kind: 'unreachable',
      version: null,
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
      version: null,
      message: '服务端返回的不是 JSON，可能是反代或部署问题。',
    }
  }

  if (!isRecord(payload)) {
    return { kind: 'unreachable', version: null, message: '健康检查返回的结构不认识。' }
  }

  const version = readVersion(payload)

  // 数据库优先于模型：库坏了，同步与报告都不可靠，说「模型没配」会把人引到错误方向。
  if (payload.status !== 'ok') {
    return {
      kind: 'degraded',
      version,
      message: '服务端在线，但数据库探测失败（degraded）；同步与报告都会不可靠。',
    }
  }

  if (payload.ai !== 'deepseek') {
    return {
      kind: 'ai-disabled',
      version,
      message: '服务端在线，但没有配置模型密钥，AI 请求会直接返回 503。',
    }
  }

  return {
    kind: 'ready',
    version,
    message:
      version === null
        ? '服务端在线 · DeepSeek 已配置'
        : `服务端在线 · DeepSeek 已配置 · 数据库 schema v${version}`,
  }
}
