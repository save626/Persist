import { EntityDataError, type EntityCandidate } from '../db/entities.js'
import type { AuthContext } from '../db/repositories/devices.js'
import { findActiveDevice, touchDevice } from '../db/repositories/devices.js'
import { pullEntities, upsertEntity } from '../db/repositories/entities.js'
import { findSyncOp, recordSyncOp } from '../db/repositories/sync-ops.js'
import { currentRev } from '../db/repositories/sync-seq.js'
import { hashToken, readBearerToken } from '../auth.js'
import type { Db } from '../db/driver.js'
import type {
  PullEntity,
  PullResponseBody,
  PushBody,
  PushResult,
  SkippedEntity,
} from '@persist/shared/contract/sync'

/**
 * 同步的业务逻辑：认证、一次 push / bootstrap 的落库、pull 的响应整形。
 * 路由层只做参数解析与状态码，这样这些逻辑能直接单测，不必经过 HTTP。
 */

/** opId 已被同一账号用过但结果损坏、或被他账号占用时抛这个；路由转 400。 */
export class SyncOpConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncOpConflictError'
  }
}

/** 从 Authorization 头解析设备身份；令牌无效 / 被吊销返回 null。 */
export function authenticateRequest(
  db: Db,
  authorization: string | undefined,
  now: () => number,
): AuthContext | null {
  const token = readBearerToken(authorization)
  if (!token) return null
  const auth = findActiveDevice(db, hashToken(token))
  if (!auth) return null
  touchDevice(db, auth.deviceId, now())
  return auth
}

function candidateId(candidate: EntityCandidate): string | null {
  if (typeof candidate.id === 'string' && candidate.id.length > 0) return candidate.id
  const data = candidate.data
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const id = (data as Record<string, unknown>).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return null
}

interface ApplySummary {
  applied: number
  skipped: SkippedEntity[]
}

/**
 * 逐条 upsert。单条业务字段不合法（EntityDataError）只跳过这一条并记 invalid，
 * 不整批回滚：客户端的其他记录没有错，没必要陪着一起失败。
 */
function applyEntities(db: Db, userId: string, entities: EntityCandidate[]): ApplySummary {
  let applied = 0
  const skipped: SkippedEntity[] = []
  for (const candidate of entities) {
    try {
      const outcome = upsertEntity(db, userId, candidate)
      if (outcome.status === 'applied') applied += 1
      else
        skipped.push({ kind: candidate.kind, id: candidateId(candidate), reason: outcome.status })
    } catch (error) {
      if (error instanceof EntityDataError) {
        skipped.push({
          kind: candidate.kind,
          id: candidateId(candidate),
          reason: 'invalid',
          message: error.message,
        })
        continue
      }
      throw error
    }
  }
  return { applied, skipped }
}

function parseStoredResult(resultJson: string): PushResult | null {
  try {
    const parsed: unknown = JSON.parse(resultJson)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.applied !== 'number' || !Array.isArray(record.skipped)) return null
    if (typeof record.serverRev !== 'number') return null
    return parsed as PushResult
  } catch {
    return null
  }
}

/**
 * 一次增量 push。
 *
 * 幂等：同一个 opId 重试直接回放上次结果，不重复写。结果损坏这种极端情况
 * 当作没记录过重新应用——LWW 下重放是安全的，最多让 stale 列表变化。
 */
export function applyPush(
  db: Db,
  auth: AuthContext,
  body: PushBody,
  now: () => number,
): PushResult {
  const existing = findSyncOp(db, body.opId)
  if (existing) {
    if (existing.userId !== auth.userId) {
      throw new SyncOpConflictError('该 opId 已被其他账号使用。')
    }
    const stored = parseStoredResult(existing.resultJson)
    if (stored) return stored
  }

  return db.transaction(() => {
    const { applied, skipped } = applyEntities(db, auth.userId, body.entities)
    const result: PushResult = { applied, skipped, serverRev: currentRev(db) }
    recordSyncOp(db, {
      opId: body.opId,
      deviceId: auth.deviceId,
      userId: auth.userId,
      appliedAt: Math.trunc(now()),
      resultJson: JSON.stringify(result),
    })
    return result
  })
}

/** 首次全量上传：一个事务写完，避免同步到一半留下半套数据。 */
export function applyBootstrap(db: Db, auth: AuthContext, entities: EntityCandidate[]): PushResult {
  return db.transaction(() => {
    const { applied, skipped } = applyEntities(db, auth.userId, entities)
    return { applied, skipped, serverRev: currentRev(db) }
  })
}

export function buildPullResponse(
  db: Db,
  auth: AuthContext,
  query: { since: number; limit: number },
): PullResponseBody {
  const result = pullEntities(db, auth.userId, query.since, query.limit)
  const entities: PullEntity[] = result.entities.map((entity) => ({
    kind: entity.kind,
    id: entity.id,
    data: entity.data,
    updatedAt: entity.updatedAt,
    deleted: entity.deleted,
    rev: entity.rev,
  }))
  return { entities, nextSince: result.nextSince, hasMore: result.hasMore }
}
