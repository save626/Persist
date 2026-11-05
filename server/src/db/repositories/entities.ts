import type { Db, DbParam } from '../driver.js'
import { ENTITY_KINDS, entityDefinition, normalizeEntity } from '../entities.js'
import type { EntityCandidate, EntityKind, NormalizedEntity } from '../entities.js'
import { allocateRev } from './sync-seq.js'

/**
 * 实体的读写：upsert（LWW）/ 单条查询 / 增量拉取。
 * 写入语义见设计文档 §7.2：`updatedAt` 大的赢，相等视为重复（stale，不再发新 rev）。
 * 删除写墓碑（deleted_at + 新 rev，payload 清空），pull 会把它带给其他设备。
 */

export interface StoredEntity {
  kind: EntityKind
  /** 单行实体为 null。 */
  id: string | null
  /** 墓碑或 payload 损坏时为 null。 */
  data: Record<string, unknown> | null
  updatedAt: number
  deleted: boolean
  rev: number
}

export type UpsertStatus = 'applied' | 'stale' | 'missing'

export interface UpsertOutcome {
  /** applied = 已写；stale = 服务端更新，拒绝覆盖；missing = 要删的记录本来就不存在。 */
  status: UpsertStatus
  /** 该实体当前的 rev；missing 时为 0。 */
  rev: number
}

interface RowShape {
  id: string | null
  payload_json: string
  updated_at: number
  deleted_at: number | null
  rev: number
}

function toStoredEntity(kind: EntityKind, row: RowShape): StoredEntity {
  const deleted = row.deleted_at !== null && row.deleted_at !== undefined
  return {
    kind,
    id: row.id ?? null,
    data: deleted ? null : parsePayload(row.payload_json),
    updatedAt: Number(row.updated_at),
    deleted,
    rev: Number(row.rev),
  }
}

function parsePayload(payloadJson: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function keyWhere(entity: NormalizedEntity): {
  sql: string
  params: (userId: string) => DbParam[]
} {
  if (entity.singleRow) return { sql: 'user_id = ?', params: (userId) => [userId] }
  return { sql: 'id = ? AND user_id = ?', params: (userId) => [entity.entityId, userId] }
}

function findRow(
  db: Db,
  userId: string,
  entity: NormalizedEntity,
): { updatedAt: number; rev: number } | null {
  const { sql, params } = keyWhere(entity)
  const row = db
    .prepare<{ updated_at: number; rev: number }>(
      `SELECT updated_at, rev FROM ${entity.table} WHERE ${sql}`,
    )
    .get(...params(userId))
  return row ? { updatedAt: Number(row.updated_at), rev: Number(row.rev) } : null
}

function insertRow(db: Db, userId: string, entity: NormalizedEntity, rev: number): void {
  const columnNames = Object.keys(entity.columns)
  const columnValues = columnNames.map((name) => entity.columns[name])
  const names = ['user_id', ...columnNames, 'payload_json', 'updated_at', 'deleted_at', 'rev']
  const values = [userId, ...columnValues, entity.payloadJson, entity.updatedAt, null, rev]
  if (!entity.singleRow) {
    names.unshift('id')
    values.unshift(entity.entityId)
  }
  const placeholders = names.map(() => '?').join(', ')
  db.prepare(`INSERT INTO ${entity.table} (${names.join(', ')}) VALUES (${placeholders})`).run(
    ...(values as (string | number | null)[]),
  )
}

function updateRow(db: Db, userId: string, entity: NormalizedEntity, rev: number): void {
  const columnNames = Object.keys(entity.columns)
  const assignments = columnNames.map((name) => `${name} = ?`)
  const { sql, params } = keyWhere(entity)
  db.prepare(
    `UPDATE ${entity.table} SET ${assignments.join(', ')}${
      assignments.length > 0 ? ', ' : ''
    }payload_json = ?, updated_at = ?, deleted_at = NULL, rev = ? WHERE ${sql}`,
  ).run(
    ...(columnNames.map((name) => entity.columns[name]) as (string | number | null)[]),
    entity.payloadJson,
    entity.updatedAt,
    rev,
    ...(params(userId) as (string | null)[]),
  )
}

export function upsertEntity(db: Db, userId: string, candidate: EntityCandidate): UpsertOutcome {
  const entity = normalizeEntity(candidate)
  return db.transaction(() => {
    const existing = findRow(db, userId, entity)
    if (!existing) {
      // 删除一块服务端从没收到过的数据：没有可写墓碑的行，直接告诉客户端「本来就没有」。
      if (entity.deleted) return { status: 'missing', rev: 0 }
      const rev = allocateRev(db)
      insertRow(db, userId, entity, rev)
      return { status: 'applied', rev }
    }
    if (entity.updatedAt <= existing.updatedAt) {
      return { status: 'stale', rev: existing.rev }
    }
    const rev = allocateRev(db)
    if (entity.deleted) {
      const { sql, params } = keyWhere(entity)
      db.prepare(
        `UPDATE ${entity.table} SET payload_json = '{}', updated_at = ?, deleted_at = ?, rev = ? WHERE ${sql}`,
      ).run(entity.updatedAt, entity.updatedAt, rev, ...(params(userId) as (string | null)[]))
    } else {
      updateRow(db, userId, entity, rev)
    }
    return { status: 'applied', rev }
  })
}

export function getEntity(
  db: Db,
  userId: string,
  kind: EntityKind,
  id?: string,
): StoredEntity | null {
  const definition = entityDefinition(kind)
  if (!definition.singleRow && (typeof id !== 'string' || id.length === 0)) return null
  const where = definition.singleRow ? 'user_id = ?' : 'user_id = ? AND id = ?'
  const params = definition.singleRow ? [userId] : [userId, id as string]
  const idColumn = definition.singleRow ? 'NULL' : 'id'
  const row = db
    .prepare<RowShape>(
      `SELECT ${idColumn} AS id, payload_json, updated_at, deleted_at, rev
       FROM ${definition.table} WHERE ${where}`,
    )
    .get(...params)
  return row ? toStoredEntity(kind, row) : null
}

export interface PullResult {
  entities: StoredEntity[]
  /** 下一次 pull 的 `since`；没有变化时原样返回入参。 */
  nextSince: number
  hasMore: boolean
}

const DEFAULT_PULL_LIMIT = 200
const MAX_PULL_LIMIT = 1_000

/**
 * 增量拉取：按 rev 升序跨全部实体表合并。
 *
 * 没有单独的全局 changes 表，所以每张表各取 `limit + 1` 行再做 k 路归并——
 * 单用户数据量下 9 次索引查询远比维护一张变更日志表简单，也不会出现日志与实体不一致。
 */
export function pullEntities(
  db: Db,
  userId: string,
  since: number,
  limit = DEFAULT_PULL_LIMIT,
): PullResult {
  const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_PULL_LIMIT)
  const collected: StoredEntity[] = []

  for (const kind of ENTITY_KINDS) {
    const definition = entityDefinition(kind)
    const idColumn = definition.singleRow ? 'NULL' : 'id'
    const rows = db
      .prepare<RowShape>(
        `SELECT ${idColumn} AS id, payload_json, updated_at, deleted_at, rev
         FROM ${definition.table}
         WHERE user_id = ? AND rev > ?
         ORDER BY rev ASC
         LIMIT ?`,
      )
      .all(userId, Math.trunc(since), cappedLimit + 1)
    for (const row of rows) collected.push(toStoredEntity(kind, row))
  }

  collected.sort((a, b) => a.rev - b.rev)
  const page = collected.slice(0, cappedLimit)
  const last = page[page.length - 1]
  return {
    entities: page,
    nextSince: last ? last.rev : Math.trunc(since),
    hasMore: collected.length > cappedLimit,
  }
}

export function countEntities(db: Db, userId: string, kind?: EntityKind): number {
  const kinds = kind ? [kind] : ENTITY_KINDS
  let total = 0
  for (const current of kinds) {
    const definition = entityDefinition(current)
    const row = db
      .prepare<{ total: number }>(
        `SELECT COUNT(*) AS total FROM ${definition.table} WHERE user_id = ?`,
      )
      .get(userId)
    total += row ? Number(row.total) : 0
  }
  return total
}
