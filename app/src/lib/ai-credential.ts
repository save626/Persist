/**
 * AI 接口的调用者凭据。
 *
 * 两种来源，优先用第一种：
 *
 * 1. **设备令牌（`pst_`）**——运行时从同步状态里拿，绑定账号、可吊销、按账号归因。
 *    开源项目里这是唯一安全的形态：安装包里不需要藏任何长期密钥，别人拿到 APK
 *    也提不出可用的凭据；你不想要某台设备用 AI 时，吊销它即可，不必重新打包分发。
 * 2. **构建期内联凭据（`psa_`）**——P0 时期的方案，从 `VITE_PERSIST_AI_KEY` 内联。
 *    保留它只为回滚与旧包兼容：新包不再配置这个环境变量，产物里就不会有值。
 *
 * 关键性质：`pst_` 与「同步开关」不是同一件事。关闭同步只是不上传数据，令牌仍在；
 * 只有「从未注册过账号」的新装环境才没有令牌，此时 AI 不可用（费用由服务端承担，
 * 没有账号就没有额度归属）。
 *
 * 注意：这**不是**前端鉴权。它只是把服务端要求的凭据带上；真正的拒绝发生在服务端。
 * 前端任何判断都可以被绕过，所以不要在这里加「是否允许」的分支。
 */

/** 与服务端 `AI_KEY_PREFIX` 保持一致。 */
export const AI_CREDENTIAL_PREFIX = 'psa_'

/** 与服务端 `TOKEN_PREFIX` 保持一致。 */
export const DEVICE_TOKEN_PREFIX = 'pst_'

/** 与 `server/src/auth.ts` 的 readBearerToken 上限对齐，避免发出注定被拒的请求。 */
const MAX_CREDENTIAL_LENGTH = 200

/**
 * 当前登录设备的令牌，由同步状态在变化时写进来。
 *
 * 为什么用模块级变量而不是逐层传参：`aiCredential()` 被四个互不相干的地方调用
 * （计划对话、晨间简报、AI 观察、报告页），逐层加参数会把令牌穿过与本功能无关的
 * 组件；而这里只关心「此刻请求该带什么」，没有渲染语义。
 * 写入点只有一处（`MockDataProvider` 的同步状态 effect），读点是一次取值。
 */
let runtimeDeviceToken: string | null = null

/** 由同步状态调用；传 null / 非 `pst_` 值都视为「没有设备令牌」。 */
export function setAiRuntimeCredential(token: string | null | undefined): void {
  const value = token?.trim() ?? ''
  runtimeDeviceToken =
    value.startsWith(DEVICE_TOKEN_PREFIX) && value.length <= MAX_CREDENTIAL_LENGTH ? value : null
}

/** 仅供测试复位。 */
export function resetAiRuntimeCredential(): void {
  runtimeDeviceToken = null
}

export interface AiCredentialSource {
  /** Vite 的 `import.meta.env.MODE`。 */
  mode?: string
  /** `import.meta.env.VITE_PERSIST_AI_KEY`。 */
  key?: string
}

/**
 * 纯函数形式的读取逻辑，便于单测直接覆盖，不依赖 `import.meta.env`。
 * 任何不合规的值都返回 `null`（宁可不带，也不带一个错的）。
 */
export function readAiCredential(source: AiCredentialSource): string | null {
  if (source.mode !== 'mobile') return null
  const raw = source.key?.trim()
  if (!raw || raw.length > MAX_CREDENTIAL_LENGTH) return null
  return raw.startsWith(AI_CREDENTIAL_PREFIX) ? raw : null
}

/**
 * 当前请求应带的 AI 凭据：设备令牌优先，其次才是构建期内联凭据（旧包回滚用）。
 *
 * 不做缓存：`import.meta.env` 的值在构建时已被内联成字面量，每次读取没有成本，
 * 缓存反而会让单测之间互相污染。
 */
export function aiCredential(): string | null {
  if (runtimeDeviceToken) return runtimeDeviceToken
  return readAiCredential({
    mode: import.meta.env.MODE,
    key: import.meta.env.VITE_PERSIST_AI_KEY,
  })
}
