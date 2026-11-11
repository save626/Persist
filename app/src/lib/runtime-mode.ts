/**
 * 运行界面与 AI 能力门禁。
 *
 * 隔离规则：
 * - web：域名 / IP 网页构建，只允许 demo / guest；无参数或非法参数一律回落 guest。
 * - mobile：`vite --mode mobile` 构建，默认 owner，保留完整真实 AI 与同步。
 *
 * `?mode=demo` / `?mode=guest` 会写入 sessionStorage，保证产品内跳转和刷新不丢失。
 * web 模式永远不能解析出 owner；这是构建产物层的产品隔离，不替代服务端鉴权。
 */
export type RuntimeMode = 'owner' | 'demo' | 'guest'
export type RuntimeSurface = 'web' | 'mobile'

export interface RuntimeAiCapabilities {
  report: boolean
  chat: boolean
  morningBrief: boolean
  serverAnalysis: boolean
}

export interface RuntimeModeConfig {
  mode: RuntimeMode
  label: string
  /** 业务数据 IndexedDB 名；三种模式必须隔离，避免公开体验覆盖作者本机数据。 */
  storageDbName: string
  /** 今日页饮水进度基线；guest 从 0 开始，不凭空展示预置饮水。 */
  waterBaselineMilliliters: number
  ai: RuntimeAiCapabilities
  sync: boolean
  /** demo 的所有业务数据只读；写入在数据层统一拦截，不产生持久化。 */
  readOnly: boolean
  /** demo 不读写 IndexedDB，确保每次打开都来自构建时的静态基线。 */
  persist: boolean
}

export const RUNTIME_MODE_QUERY_KEY = 'mode'
export const RUNTIME_MODE_STORAGE_KEY = 'persist.runtime-mode'
export const RUNTIME_MOBILE_VITE_MODE = 'mobile'

const CONFIGS: Record<RuntimeMode, RuntimeModeConfig> = {
  owner: {
    mode: 'owner',
    label: '完整模式',
    storageDbName: 'persist-app',
    waterBaselineMilliliters: 1_200,
    ai: { report: true, chat: true, morningBrief: true, serverAnalysis: true },
    sync: true,
    readOnly: false,
    persist: true,
  },
  demo: {
    mode: 'demo',
    label: '演示模式',
    storageDbName: 'persist-app-demo',
    waterBaselineMilliliters: 1_200,
    // 部署后不再调用任何 AI 接口；报告、简报与建档都读取 prebuilt-demo-ai.ts。
    ai: { report: false, chat: false, morningBrief: false, serverAnalysis: false },
    sync: false,
    readOnly: true,
    persist: false,
  },
  guest: {
    mode: 'guest',
    label: '体验模式',
    storageDbName: 'persist-app-guest',
    waterBaselineMilliliters: 0,
    ai: { report: false, chat: false, morningBrief: false, serverAnalysis: false },
    sync: false,
    readOnly: false,
    persist: true,
  },
}

export function getRuntimeModeConfig(mode: RuntimeMode): RuntimeModeConfig {
  return CONFIGS[mode]
}

export function isRuntimeMode(value: unknown): value is RuntimeMode {
  return value === 'owner' || value === 'demo' || value === 'guest'
}

/** Vite mode 只认精确的 `mobile`；任何未知值都按公开 web 构建处理。 */
export function resolveRuntimeSurface(viteMode: string | undefined): RuntimeSurface {
  return viteMode === RUNTIME_MOBILE_VITE_MODE ? 'mobile' : 'web'
}

type ModeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function safeSessionStorage(): ModeStorage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

export interface ResolveRuntimeModeOptions {
  surface?: RuntimeSurface
  storage?: ModeStorage | null
}

/**
 * 解析入口模式。
 *
 * web 构建只接受 demo / guest；显式 owner、非法值以及无参数默认都回落 guest。
 * mobile 构建默认 owner，同时保留 demo / guest 查询参数，供真机预览与自动化测试使用。
 */
export function resolveRuntimeMode(
  search: string,
  options: ResolveRuntimeModeOptions = {},
): RuntimeMode {
  const surface = options.surface ?? 'web'
  const storage = options.storage === undefined ? safeSessionStorage() : options.storage
  const fallbackMode: RuntimeMode = surface === 'mobile' ? 'owner' : 'guest'

  let queryMode: string | null = null
  try {
    queryMode = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get(
      RUNTIME_MODE_QUERY_KEY,
    )
  } catch {
    queryMode = null
  }

  const clearStoredMode = () => {
    try {
      storage?.removeItem(RUNTIME_MODE_STORAGE_KEY)
    } catch {
      // 存储不可用时，本次仍按 surface 的默认模式返回。
    }
  }

  if (queryMode !== null) {
    if (queryMode === 'demo' || queryMode === 'guest') {
      try {
        storage?.setItem(RUNTIME_MODE_STORAGE_KEY, queryMode)
      } catch {
        // 本次加载仍按显式参数生效。
      }
      return queryMode
    }
    if (queryMode === 'owner') {
      clearStoredMode()
      return fallbackMode
    }
    clearStoredMode()
    return fallbackMode
  }

  try {
    const stored = storage?.getItem(RUNTIME_MODE_STORAGE_KEY)
    if (stored === 'demo' || stored === 'guest') return stored
    if (surface === 'mobile' && stored === 'owner') return 'owner'
    if (stored !== null && stored !== undefined) clearStoredMode()
  } catch {
    // 隐私模式禁用 sessionStorage 时，仍返回 surface 的安全默认值。
  }
  return fallbackMode
}
