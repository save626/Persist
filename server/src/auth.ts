import { createHash, randomBytes } from 'node:crypto'

/**
 * 设备令牌与恢复码。
 *
 * 做法与设计文档 §7.1 一致：服务端只存 sha256 哈希，明文只在注册 / 恢复的那一次响应里出现。
 * 这里不做密码学 KDF（没有用户口令，令牌本身是 32 字节随机数，sha256 足够）——
 * 用哈希只是为了让库文件泄露时拿不到可直接使用的令牌。
 */

/** 令牌前缀，方便日志里肉眼区分「这是设备令牌」而不是别的东西。 */
export const TOKEN_PREFIX = 'pst_'

/** 恢复码固定 32 位十六进制（设计文档 §7.1 定的口径）。 */
export const RECOVERY_CODE_LENGTH = 32

const RECOVERY_CODE_PATTERN = /^[0-9a-f]{32}$/

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** 43 字符 base64url（256 位随机）。 */
export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function hashToken(token: string): string {
  return sha256(token)
}

/** 32 位小写十六进制，不含容易抄错的 `o/i/l` 之外的字母（十六进制天然只有 a–f）。 */
export function generateRecoveryCode(): string {
  return randomBytes(16).toString('hex')
}

/** 用户可能按 `xxxx-xxxx-...` 抄写或带空格，先去掉分隔符再校验。 */
export function normalizeRecoveryCode(input: string): string | null {
  const compact = input.trim().toLowerCase().replace(/[\s-]/g, '')
  return compact.length === RECOVERY_CODE_LENGTH && RECOVERY_CODE_PATTERN.test(compact)
    ? compact
    : null
}

export function hashRecoveryCode(code: string): string {
  return sha256(code)
}

export function createUserId(): string {
  return `usr_${randomBytes(12).toString('base64url')}`
}

export function createDeviceId(): string {
  return `dev_${randomBytes(12).toString('base64url')}`
}

/** 只接受 `Bearer <token>`，大小写不敏感；缺 token 或格式不对都返回 null。 */
export function readBearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  const token = match?.[1]
  if (!token || token.length > 200) return null
  return token
}
