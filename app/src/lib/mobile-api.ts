/**
 * Capacitor Android 从本地 https://localhost 加载移动端产物；同源 `/api` 不会命中服务器。
 * 该桥接只在 mobile 构建且配置了 API origin 时启用，把相对 `/api/*` 请求改写到服务器。
 *
 * Web 构建永远不会启用，因此公开 demo / guest 仍保持同源和零额外网络行为。
 */

export interface MobileApiBridgeTarget {
  fetch: typeof fetch
}

export interface InstallMobileApiBridgeOptions {
  surface: 'web' | 'mobile'
  baseUrl?: string
  target?: MobileApiBridgeTarget
}

const installedTargets = new WeakSet<object>()

/** 只接受 http(s) origin；路径、查询、片段与账号信息都拒绝。 */
export function normalizeMobileApiBaseUrl(value: string | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || url.search || url.hash) return null
    if (url.pathname !== '/' && url.pathname !== '') return null
    return url.origin
  } catch {
    return null
  }
}

/** 仅改写 `/api` 与 `/api/*`；外部 URL、资源和普通页面路由保持原样。 */
export function rewriteMobileApiUrl(raw: string, baseUrl: string): string {
  if (raw !== '/api' && !raw.startsWith('/api/')) return raw
  return new URL(raw.slice(1), `${baseUrl}/`).toString()
}

export function installMobileApiFetchBridge(options: InstallMobileApiBridgeOptions): boolean {
  if (options.surface !== 'mobile') return false
  const baseUrl = normalizeMobileApiBaseUrl(options.baseUrl)
  if (!baseUrl) return false

  const target = options.target ?? (globalThis as unknown as MobileApiBridgeTarget)
  if (installedTargets.has(target)) return true
  const originalFetch = target.fetch.bind(target)

  target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' || input instanceof URL) {
      return originalFetch(rewriteMobileApiUrl(input.toString(), baseUrl), init)
    }
    if (typeof Request !== 'undefined' && input instanceof Request) {
      const rewritten = rewriteMobileApiUrl(input.url, baseUrl)
      return originalFetch(rewritten === input.url ? input : new Request(rewritten, input), init)
    }
    return originalFetch(input, init)
  }) as typeof fetch

  installedTargets.add(target)
  return true
}
