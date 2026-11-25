import { createHash, timingSafeEqual } from 'node:crypto'
import { readBearerToken } from '../auth.js'
import { AI_UNAUTHORIZED_CODE } from '../contract.js'

/**
 * AI 接口的调用者凭据校验。
 *
 * 为什么需要它：`/api/chat` 与 `/api/report` 原先只校验「请求体格式 + 服务端有没有 Key +
 * 按 IP 限流」，没有「调用者是谁」这个概念。前端运行模式（owner / demo / guest）是构建
 * 产物层的产品隔离，只在浏览器 / WebView 里生效，不构成服务端安全边界——任何拿到公网
 * IP 的客户端（curl、脚本、扫描器）都能直接调用，产生由作者付费的模型账单。
 *
 * 凭据形态（设计文档 P0 §4.1）：`Authorization: Bearer psa_<base64url>`。
 * - 复用 `authorization` 头，因为 `app.ts` 的 `access-control-allow-headers` 只允许
 *   `accept,authorization,content-type`；自定义头会触发 preflight，必须同步改 CORS 配置。
 * - `psa_` 前缀与设备令牌 `pst_` 区分，两种凭据永不混用：设备令牌只给 `/api/v1/*`。
 * - 服务端只保存 sha256 哈希，配置或库文件泄露时拿不到可直接使用的凭据。
 *
 * 三段开关（设计文档 P0 §4.4）：
 * - `enforce`：校验失败即 401。**默认值**：未配置时也必须拒绝，避免新部署/临时起服务
 *   在忘记配开关的情况下把付费 AI 接口向公网敞开（2026-11-25 安全审查结论）。
 * - `warn`：校验但不拒绝，只把结果写进日志。用于验证新 APK 是否真的带对了凭据。
 * - `off`：不校验，仅用于本地开发与回滚；必须显式配置，且不应出现在公网部署。
 *
 * `warn` 存在的唯一理由是避免上线自锁：旧 APK 不带凭据，直接 `enforce` 会让作者自己的
 * 真机立刻失去真实 AI，且没有远程补救手段，只能重新装包。这个权衡仅在显式选择时成立。
 */

/** 凭据明文前缀；与设备令牌的 `pst_` 区分。 */
export const AI_KEY_PREFIX = 'psa_'

export const AI_GATE_MODES = ['off', 'warn', 'enforce'] as const

export type AiGateMode = (typeof AI_GATE_MODES)[number]

/** 一条已配置的凭据。明文不落库、不落日志、不进 describeConfig。 */
export interface AiKey {
  keyId: string
  /** 64 位小写十六进制 sha256。 */
  hash: string
}

/** 校验结果；`warn` 模式下要靠它区分「没带」和「带错了」。 */
export type AiCredentialResult = 'ok' | 'missing_credential' | 'bad_credential' | 'no_keys'

/** 门判定结果：`gate_off` 表示根本没校验，不参与审计统计。 */
export interface AiGateDecision {
  allowed: boolean
  keyId: string | null
  result: AiCredentialResult | 'gate_off'
}

export const AI_UNAUTHORIZED_MESSAGE = 'AI 接口需要有效凭据。'

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const HASH_PATTERN = /^[0-9a-fA-F]{64}$/

/**
 * 解析 `keyId:sha256hex,keyId:sha256hex`。
 *
 * 单个非法项直接丢弃而不是让服务端起不来：与 `parseAllowedOrigins` 的容错风格一致，
 * 一个笔误不应该把整个服务拖垮。重复的 keyId 只保留第一条，避免同一 ID 指向两个哈希
 * 让审计归属变得含糊。
 */
export function parseAiKeys(raw: string | undefined): AiKey[] {
  const values =
    raw
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? []

  const keys: AiKey[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const separator = value.indexOf(':')
    if (separator <= 0) continue
    const keyId = value.slice(0, separator).trim()
    const hash = value.slice(separator + 1).trim()
    if (!KEY_ID_PATTERN.test(keyId) || !HASH_PATTERN.test(hash)) continue
    if (seen.has(keyId)) continue
    seen.add(keyId)
    keys.push({ keyId, hash: hash.toLowerCase() })
  }
  return keys
}

/**
 * 解析开关值。
 *
 * - 未配置（`undefined`）沿用 `enforce`（fail-closed）：公网部署忘记配开关时，
 *   绝不能静默变成「不校验」——那等于把由作者付费的 AI 接口向任何人敞开。
 *   本地开发 / CI 若需要旧行为，显式写 `PERSIST_AI_GATE=off`。
 * - **提供了却无法识别**（空串、`enforcee` 之类笔误）一律回落到 `enforce`（fail-closed）。
 *   生产 env 明确写了 `PERSIST_AI_GATE=enforce`，这行一旦写错就静默变成「不校验」，
 *   等于把 AI 接口向公网敞开——失败方向必须朝向拒绝，让问题在启动后立刻暴露。
 *   生效模式由 `describeConfig` 打进启动日志，便于核对。
 */
export function parseAiGateMode(raw: string | undefined): AiGateMode {
  if (raw === undefined) return 'enforce'
  const value = raw.trim().toLowerCase()
  return AI_GATE_MODES.includes(value as AiGateMode) ? (value as AiGateMode) : 'enforce'
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * 校验一次请求的凭据。
 *
 * 用 `timingSafeEqual` 逐条比较而不是按哈希查 Map：一条配置也就几项，代价可以忽略，
 * 但可以避免「按哈希命中与否」泄露时序信息。
 *
 * 所有失败都归为两种结果（`missing_credential` / `bad_credential`），调用方对外只回
 * 一个固定 401，不区分「没带 / 前缀错 / 哈希不匹配 / 已轮换」，避免被当成探测接口。
 */
export function verifyAiCredential(
  keys: AiKey[],
  header: string | undefined,
): { keyId: string | null; result: AiCredentialResult } {
  const token = readBearerToken(header)
  if (!token) return { keyId: null, result: 'missing_credential' }
  if (!token.startsWith(AI_KEY_PREFIX)) return { keyId: null, result: 'bad_credential' }
  // fail-closed：配了 enforce 却没配凭据时，不能因为「表是空的」而放行任何人。
  if (keys.length === 0) return { keyId: null, result: 'no_keys' }

  const actual = sha256(token)
  let matched: string | null = null
  for (const key of keys) {
    const expected = Buffer.from(key.hash, 'hex')
    if (expected.length !== actual.length) continue
    // 不提前 break：全部比较完再决定，进一步减少时序差异。
    if (timingSafeEqual(expected, actual) && matched === null) matched = key.keyId
  }
  return matched ? { keyId: matched, result: 'ok' } : { keyId: null, result: 'bad_credential' }
}

/** 按开关模式给出最终判定。`warn` 放行但保留失败结果供调用方记日志。 */
export function evaluateAiGate(
  mode: AiGateMode,
  keys: AiKey[],
  header: string | undefined,
): AiGateDecision {
  if (mode === 'off') return { allowed: true, keyId: null, result: 'gate_off' }

  const { keyId, result } = verifyAiCredential(keys, header)
  if (result === 'ok') return { allowed: true, keyId, result }
  return { allowed: mode === 'warn', keyId: null, result }
}

/** 对外统一的 401 响应体；三种失败形态完全一致。 */
export function aiUnauthorizedBody() {
  return { error: { code: AI_UNAUTHORIZED_CODE, message: AI_UNAUTHORIZED_MESSAGE } }
}
