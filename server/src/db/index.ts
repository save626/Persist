import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { openDatabase } from './driver.js'
import type { Db, OpenDbOptions } from './driver.js'
import { migrate } from './migrations.js'

export { openDatabase } from './driver.js'
export type { Db, DbParam, OpenDbOptions, Statement } from './driver.js'
export { MIGRATIONS, SCHEMA_VERSION, migrate } from './migrations.js'
export type { MigrateResult, Migration } from './migrations.js'
export {
  ENTITY_KINDS,
  EntityDataError,
  SINGLE_ROW_KINDS,
  deriveFitnessTotals,
  entityDefinition,
  isEntityKind,
  normalizeEntity,
} from './entities.js'
export type {
  EntityCandidate,
  EntityDefinition,
  EntityKind,
  EntityPayload,
  FitnessTotals,
  NormalizedEntity,
} from './entities.js'
export { countEntities, getEntity, pullEntities, upsertEntity } from './repositories/entities.js'
export type {
  PullResult,
  StoredEntity,
  UpsertOutcome,
  UpsertStatus,
} from './repositories/entities.js'
export { allocateRev, currentRev } from './repositories/sync-seq.js'
export { countSyncOps, findSyncOp, recordSyncOp } from './repositories/sync-ops.js'
export type { SyncOpRecord } from './repositories/sync-ops.js'

export interface PersistDatabaseOptions extends OpenDbOptions {
  /** 测试注入时钟，生产用 Date.now。 */
  now?: () => number
}

export interface PersistDatabase {
  db: Db
  schemaVersion: number
  path: string
}

/**
 * 打开（必要时创建）SQLite 文件并跑迁移，返回可用连接。
 * 服务端启动时调用一次；测试用 `:memory:`，不碰磁盘。
 */
export function openPersistDatabase(options: PersistDatabaseOptions): PersistDatabase {
  if (options.path !== ':memory:') {
    mkdirSync(dirname(options.path), { recursive: true })
  }
  const db = openDatabase(options)
  try {
    const { version } = migrate(db, { now: options.now })
    return { db, schemaVersion: version, path: options.path }
  } catch (error) {
    db.close()
    throw error
  }
}
