/**
 * AI 接口的调用者凭据（P0）。
 *
 * 为什么要有它：`/api/chat` 与 `/api/report` 在服务端补了凭据门，请求必须带
 * `Authorization: Bearer psa_*` 才会被受理。凭据来自构建期注入，不是运行时账号：
 *
 * - 值写在 `app/.env.mobile.local` 的 `VITE_PERSIST_AI_KEY`，由 `build:mobile`
 *   （`vite build --mode mobile`）内联进 mobile 产物。
 * - web 的 `npm run build` 走 production 模式，不加载该文件，所以公开产物里没有这个值，
 *   demo / guest 也就不可能持有有效凭据。
 *
 * 关键性质：它与「数据同步」开关完全无关。凭据来自构建产物，不是设备账号，
 * 因此同步关闭时 owner 的真实 AI 行为与改动前一致。
 *
 * 注意：这**不是**前端鉴权。它只是把服务端要求的凭据带上；真正的拒绝发生在服务端。
 * 前端任何判断都可以被绕过，所以不要在这里加「是否允许」的分支。
 */

/** 与服务端 `AI_KEY_PREFIX` 保持一致；带 `pst_` 的设备令牌不能当 AI 凭据用。 */
export const AI_CREDENTIAL_PREFIX = 'psa_'

/** 与 `server/src/auth.ts` 的 readBearerToken 上限对齐，避免发出注定被拒的请求。 */
const MAX_CREDENTIAL_LENGTH = 200

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
 * 当前构建产物的 AI 凭据；web 构建恒为 `null`。
 *
 * 不做缓存：`import.meta.env` 的值在构建时已被内联成字面量，每次读取没有成本，
 * 缓存反而会让单测之间互相污染。
 */
export function aiCredential(): string | null {
  return readAiCredential({
    mode: import.meta.env.MODE,
    key: import.meta.env.VITE_PERSIST_AI_KEY,
  })
}
