import {
  DEFAULT_PULL_LIMIT,
  MAX_PULL_LIMIT,
  type BootstrapBody,
  type DeviceCredentials,
  type DeviceRegisterBody,
  type DeviceRegisterResponse,
  type DeviceRestoreBody,
  type DeviceRevokeBody,
  type PullQuery,
  type PullResponseBody,
  type PushBody,
  type PushResult,
} from './sync-contract'
import type { AccountDeleteResponse } from '@persist/shared/contract/account'

/**
 * 同步 HTTP 客户端（设计文档 §7.3 / §10）。
 *
 * 职责边界：
 * - 只负责拼请求、带令牌、解析响应、把失败归类成可重试 / 不可重试；
 * - 不管重试节奏与状态机（那是 sync-engine 的事），也不碰本地数据；
 * - 令牌只在请求头里出现，正文与日志都不打印它。
 */

export type SyncApiPath =
  | 'devices'
  | 'devices/restore'
  | 'devices/revoke'
  | 'sync/push'
  | 'sync/pull'
  | 'sync/bootstrap'
  | 'account'

/** 失败分类：引擎据此决定重试、暂停还是提示用户重新绑定。 */
export type SyncErrorKind =
  'network' | 'timeout' | 'unauthorized' | 'invalid' | 'rate-limited' | 'server'

export class SyncRequestError extends Error {
  kind: SyncErrorKind
  status: number | null
  /** 服务端返回的错误码，例如 `rate_limited` / `invalid_request`。 */
  code: string | null

  constructor(
    kind: SyncErrorKind,
    message: string,
    options: { status?: number | null; code?: string | null } = {},
  ) {
    super(message)
    this.name = 'SyncRequestError'
    this.kind = kind
    this.status = options.status ?? null
    this.code = options.code ?? null
  }

  /** 网络抖动、限流、5xx 可以退避重试；400/401 重试也不会变好。 */
  get retryable(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'rate-limited' ||
      this.kind === 'server'
    )
  }
}

/** 退避：5 s 起步，每次翻倍，封顶 5 分钟（与服务端限流窗口同一个量级）。 */
export const SYNC_RETRY_BASE_MS = 5_000
export const SYNC_RETRY_MAX_MS = 5 * 60_000

export function nextBackoffMs(attempt: number, random: () => number = Math.random): number {
  const safeAttempt = Math.max(0, Math.trunc(attempt))
  const base = Math.min(SYNC_RETRY_MAX_MS, SYNC_RETRY_BASE_MS * 2 ** safeAttempt)
  // 加一点抖动，避免多设备同时重试把窗口撞在一起。
  const jitter = Math.floor(random() * Math.min(1_000, base / 4))
  return Math.min(SYNC_RETRY_MAX_MS, base + jitter)
}

export interface SyncClientOptions {
  /** 默认同源；开发时由 vite proxy 转给 Fastify。 */
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface SyncClient {
  register(body: DeviceRegisterBody): Promise<DeviceRegisterResponse>
  restore(body: DeviceRestoreBody): Promise<DeviceCredentials>
  revoke(token: string, body: DeviceRevokeBody): Promise<{ revoked: boolean; deviceId: string }>
  push(token: string, body: PushBody): Promise<PushResult>
  pull(token: string, query: PullQuery): Promise<PullResponseBody>
  bootstrap(token: string, body: BootstrapBody): Promise<PushResult>
  deleteAccount(token: string): Promise<AccountDeleteResponse>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readErrorCode(body: unknown): string | null {
  if (!isRecord(body)) return null
  const error = body.error
  if (!isRecord(error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function readErrorMessage(body: unknown, fallback: string): string {
  if (!isRecord(body)) return fallback
  const error = body.error
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return fallback
}

function classifyStatus(status: number, body: unknown): SyncRequestError {
  const code = readErrorCode(body)
  const message = readErrorMessage(body, `同步请求失败（HTTP ${status}）。`)
  if (status === 401) return new SyncRequestError('unauthorized', message, { status, code })
  if (status === 429) return new SyncRequestError('rate-limited', message, { status, code })
  if (status >= 500) return new SyncRequestError('server', message, { status, code })
  return new SyncRequestError('invalid', message, { status, code })
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SyncRequestError('invalid', `同步接口返回的 ${field} 不合法。`, { status: 200 })
  }
  return value
}

/** 校验账号接口的响应：缺字段就当作不可用，避免半截凭据写进本地库。 */
function parseCredentials(body: unknown): DeviceCredentials {
  if (!isRecord(body)) {
    throw new SyncRequestError('invalid', '同步接口返回的内容不是对象。', { status: 200 })
  }
  return {
    userId: requireString(body.userId, 'userId'),
    deviceId: requireString(body.deviceId, 'deviceId'),
    token: requireString(body.token, 'token'),
  }
}

function parseRegisterResponse(body: unknown): DeviceRegisterResponse {
  const credentials = parseCredentials(body)
  const record = body as Record<string, unknown>
  return {
    ...credentials,
    recoveryCode: requireString(record.recoveryCode, 'recoveryCode'),
  }
}

function parsePushResult(body: unknown): PushResult {
  if (!isRecord(body)) {
    throw new SyncRequestError('invalid', '同步接口返回的内容不是对象。', { status: 200 })
  }
  const applied = typeof body.applied === 'number' ? body.applied : 0
  const serverRev = typeof body.serverRev === 'number' ? body.serverRev : 0
  const skipped = Array.isArray(body.skipped) ? body.skipped : []
  return { applied, skipped: skipped as PushResult['skipped'], serverRev }
}

function parsePullResponse(body: unknown): PullResponseBody {
  if (!isRecord(body)) {
    throw new SyncRequestError('invalid', '同步接口返回的内容不是对象。', { status: 200 })
  }
  const entities = Array.isArray(body.entities) ? body.entities : []
  const nextSince = typeof body.nextSince === 'number' ? body.nextSince : 0
  return {
    entities: entities as PullResponseBody['entities'],
    nextSince,
    hasMore: body.hasMore === true,
  }
}

function parseAccountDeleteResponse(body: unknown): AccountDeleteResponse {
  if (
    !isRecord(body) ||
    body.deleted !== true ||
    typeof body.deletedAt !== 'number' ||
    !Number.isFinite(body.deletedAt) ||
    !isRecord(body.counts)
  ) {
    throw new SyncRequestError('invalid', '删除账号接口返回的内容不完整。', { status: 200 })
  }
  return body as unknown as AccountDeleteResponse
}

export function createSyncClient(options: SyncClientOptions = {}): SyncClient {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 15_000

  if (typeof fetchImpl !== 'function') {
    throw new Error('当前环境没有 fetch，无法创建同步客户端。')
  }

  async function request(
    method: 'GET' | 'POST' | 'DELETE',
    path: SyncApiPath,
    init: { token?: string; body?: unknown; query?: Record<string, string | number> } = {},
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

    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}/api/v1/${path}${search}`, {
        method,
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        ...(controller ? { signal: controller.signal } : {}),
        cache: 'no-store',
      })
    } catch {
      const aborted = controller?.signal.aborted === true
      throw new SyncRequestError(
        aborted ? 'timeout' : 'network',
        aborted ? '同步请求超时。' : '网络不可用，暂时连不上同步服务。',
      )
    } finally {
      if (timer) clearTimeout(timer)
    }

    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }

    if (!response.ok) throw classifyStatus(response.status, body)
    return body
  }

  return {
    async register(body) {
      return parseRegisterResponse(await request('POST', 'devices', { body }))
    },
    async restore(body) {
      return parseCredentials(await request('POST', 'devices/restore', { body }))
    },
    async revoke(token, body) {
      const result = await request('POST', 'devices/revoke', { token, body })
      if (!isRecord(result)) {
        throw new SyncRequestError('invalid', '同步接口返回的内容不是对象。', { status: 200 })
      }
      return {
        revoked: result.revoked === true,
        deviceId: typeof result.deviceId === 'string' ? result.deviceId : '',
      }
    },
    async push(token, body) {
      return parsePushResult(await request('POST', 'sync/push', { token, body }))
    },
    async pull(token, query) {
      const limit = Math.min(
        MAX_PULL_LIMIT,
        Math.max(1, Math.trunc(query.limit || DEFAULT_PULL_LIMIT)),
      )
      return parsePullResponse(
        await request('GET', 'sync/pull', {
          token,
          query: { since: Math.max(0, Math.trunc(query.since)), limit },
        }),
      )
    },
    async bootstrap(token, body) {
      return parsePushResult(await request('POST', 'sync/bootstrap', { token, body }))
    },
    async deleteAccount(token) {
      return parseAccountDeleteResponse(
        await request('DELETE', 'account', { token, body: { confirm: true } }),
      )
    },
  }
}
