/**
 * 账号与增量同步的请求 / 响应契约（服务端与前端同源）。
 *
 * 这里是**唯一**一份定义：服务端路由用它校验入参、组装响应；前端 12d 的
 * sync-client 用同一套类型拼请求、读响应。字段名、上限、跳过原因都必须两边一致，
 * 否则 idempotency / 分页游标 / LWW 就无从谈起。
 *
 * 只放纯 TS：不碰 DOM、不碰 Node API、不碰数据库。校验函数返回 ParseResult，
 * 由调用方决定怎么转成 HTTP 状态码或 UI 提示。
 */

import { ENTITY_KINDS, isEntityKind, type EntityCandidate } from './entities.js'
import type { ParseResult } from './parse.js'

export type { EntityCandidate, EntityKind } from './entities.js'
export { ENTITY_KINDS, isEntityKind, SINGLE_ROW_KINDS } from './entities.js'
export type { ParseResult } from './parse.js'

/** 单次 push 的实体上限；够用又不会让一次请求写太久。 */
export const MAX_PUSH_ENTITIES = 500
/** 首次全量上传上限（bootstrap 请求体放宽到 8 MB）。 */
export const MAX_BOOTSTRAP_ENTITIES = 2_000
export const MAX_OP_ID_LENGTH = 128
export const MAX_ENTITY_ID_LENGTH = 64
export const DEFAULT_PULL_LIMIT = 200
export const MAX_PULL_LIMIT = 1_000

export interface PushBody {
  opId: string
  entities: EntityCandidate[]
}

export interface BootstrapBody {
  entities: EntityCandidate[]
}

export interface PullQuery {
  since: number
  limit: number
}

export type SkipReason = 'stale' | 'missing' | 'invalid'

export interface SkippedEntity {
  kind: string
  id: string | null
  reason: SkipReason
  /** 只有 invalid 带原因；stale / missing 是正常同步语义，不需要解释。 */
  message?: string
}

export interface PushResult {
  applied: number
  skipped: SkippedEntity[]
  /** 处理完这次 push 后的全局 rev；客户端可拿它与 pull 对比。 */
  serverRev: number
}

export interface PullEntity {
  kind: string
  id: string | null
  data: Record<string, unknown> | null
  updatedAt: number
  deleted: boolean
  rev: number
}

export interface PullResponseBody {
  entities: PullEntity[]
  nextSince: number
  hasMore: boolean
}

export interface DeviceRegisterBody {
  label?: string
}

export interface DeviceRestoreBody {
  recoveryCode: string
  label?: string
}

export interface DeviceRevokeBody {
  /** 省略时吊销当前令牌对应的设备。 */
  deviceId?: string
}

export interface DeviceCredentials {
  userId: string
  deviceId: string
  token: string
}

export interface DeviceRegisterResponse extends DeviceCredentials {
  /** 只在注册这一次返回；服务端只存哈希。 */
  recoveryCode: string
}

const MAX_LABEL_LENGTH = 40

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readLabel(raw: unknown): ParseResult<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, message: 'label 必须是字符串。' }
  const label = raw.replace(/\s+/g, ' ').trim()
  if (label.length > MAX_LABEL_LENGTH) {
    return { ok: false, message: `label 超长（上限 ${MAX_LABEL_LENGTH} 字符）。` }
  }
  return { ok: true, value: label.length > 0 ? label : null }
}

export function parseDeviceRegisterBody(raw: unknown): ParseResult<DeviceRegisterBody> {
  if (raw === undefined || raw === null) return { ok: true, value: {} }
  if (!isRecord(raw)) return { ok: false, message: '请求体必须是 JSON 对象。' }
  const label = readLabel(raw.label)
  if (!label.ok) return label
  return { ok: true, value: label.value ? { label: label.value } : {} }
}

export function parseDeviceRestoreBody(raw: unknown): ParseResult<DeviceRestoreBody> {
  if (!isRecord(raw)) return { ok: false, message: '请求体必须是 JSON 对象。' }
  if (typeof raw.recoveryCode !== 'string' || raw.recoveryCode.trim().length === 0) {
    return { ok: false, message: '缺少 recoveryCode。' }
  }
  if (raw.recoveryCode.length > 80) return { ok: false, message: 'recoveryCode 格式不对。' }
  const label = readLabel(raw.label)
  if (!label.ok) return label
  return {
    ok: true,
    value: {
      recoveryCode: raw.recoveryCode,
      ...(label.value ? { label: label.value } : {}),
    },
  }
}

export function parseDeviceRevokeBody(raw: unknown): ParseResult<DeviceRevokeBody> {
  if (raw === undefined || raw === null) return { ok: true, value: {} }
  if (!isRecord(raw)) return { ok: false, message: '请求体必须是 JSON 对象。' }
  if (raw.deviceId === undefined) return { ok: true, value: {} }
  if (typeof raw.deviceId !== 'string' || raw.deviceId.length === 0 || raw.deviceId.length > 64) {
    return { ok: false, message: 'deviceId 格式不对。' }
  }
  return { ok: true, value: { deviceId: raw.deviceId } }
}

/**
 * 单个实体候选值只做「形状」校验：kind 合法、updatedAt 是正数、data 是对象。
 * 业务字段（日期、枚举、数值范围）在服务端 `normalizeEntity` 里校验，失败记为 invalid
 * 并跳过，不影响同一批里其他合法实体。
 */
export function parseEntityCandidate(raw: unknown): ParseResult<EntityCandidate> {
  if (!isRecord(raw)) return { ok: false, message: 'entities 的每一项必须是对象。' }
  if (!isEntityKind(raw.kind)) {
    return { ok: false, message: `kind 只能是 ${ENTITY_KINDS.join('、')}。` }
  }
  if (raw.updatedAt === undefined || raw.updatedAt === null) {
    return { ok: false, message: '缺少 updatedAt。' }
  }
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt) || raw.updatedAt <= 0) {
    return { ok: false, message: 'updatedAt 必须是正的毫秒时间戳。' }
  }
  if (raw.deleted !== undefined && typeof raw.deleted !== 'boolean') {
    return { ok: false, message: 'deleted 必须是布尔值。' }
  }
  if (raw.id !== undefined && raw.id !== null) {
    if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > MAX_ENTITY_ID_LENGTH) {
      return { ok: false, message: 'id 必须是 1–64 字符的字符串。' }
    }
  }
  if (raw.data !== undefined && raw.data !== null && !isRecord(raw.data)) {
    return { ok: false, message: 'data 必须是对象。' }
  }
  const candidate: EntityCandidate = {
    kind: raw.kind,
    updatedAt: raw.updatedAt,
    ...(raw.id !== undefined ? { id: raw.id as string | null } : {}),
    ...(raw.deleted !== undefined ? { deleted: raw.deleted } : {}),
    ...(raw.data !== undefined ? { data: raw.data } : {}),
  }
  return { ok: true, value: candidate }
}

function parseEntities(raw: unknown, max: number): ParseResult<EntityCandidate[]> {
  if (!Array.isArray(raw)) return { ok: false, message: 'entities 必须是数组。' }
  if (raw.length === 0) return { ok: false, message: 'entities 不能为空。' }
  if (raw.length > max) {
    return { ok: false, message: `单次同步实体过多（上限 ${max} 条）。` }
  }
  const entities: EntityCandidate[] = []
  for (const item of raw) {
    const parsed = parseEntityCandidate(item)
    if (!parsed.ok) {
      // 形状都不对的条目没法重试，直接整批拒绝：说明客户端有 bug，不该带病写入。
      return { ok: false, message: parsed.message }
    }
    entities.push(parsed.value)
  }
  return { ok: true, value: entities }
}

export function parsePushBody(raw: unknown): ParseResult<PushBody> {
  if (!isRecord(raw)) return { ok: false, message: '请求体必须是 JSON 对象。' }
  if (typeof raw.opId !== 'string' || raw.opId.length === 0 || raw.opId.length > MAX_OP_ID_LENGTH) {
    return { ok: false, message: `opId 必须是 1–${MAX_OP_ID_LENGTH} 字符的字符串。` }
  }
  const entities = parseEntities(raw.entities, MAX_PUSH_ENTITIES)
  if (!entities.ok) return entities
  return { ok: true, value: { opId: raw.opId, entities: entities.value } }
}

export function parseBootstrapBody(raw: unknown): ParseResult<BootstrapBody> {
  if (!isRecord(raw)) return { ok: false, message: '请求体必须是 JSON 对象。' }
  const entities = parseEntities(raw.entities, MAX_BOOTSTRAP_ENTITIES)
  if (!entities.ok) return entities
  return { ok: true, value: { entities: entities.value } }
}

/** query 里的数字可能是字符串，统一在这里转；越界就夹到合法范围而不是报错。 */
export function parsePullQuery(raw: unknown): ParseResult<PullQuery> {
  const query = isRecord(raw) ? raw : {}
  const readInt = (value: unknown, fallback: number): number => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text.length === 0) return fallback
    const parsed = Number.parseInt(text, 10)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const since = Math.max(0, readInt(query.since, 0))
  const limit = Math.min(Math.max(readInt(query.limit, DEFAULT_PULL_LIMIT), 1), MAX_PULL_LIMIT)
  return { ok: true, value: { since, limit } }
}
