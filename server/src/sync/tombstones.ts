import { ENTITY_KINDS } from '@persist/shared/contract/entities'
import { entityDefinition } from '../db/entities.js'
import type { Db } from '../db/driver.js'

/**
 * 同步留痕的保留期清理（P5-1）。
 *
 * 两张只增不减的表：
 * - 墓碑：客户端删除一条记录时，服务端不真删，而是清空 `payload_json`、写 `deleted_at`
 *   并推进 `rev`。这条「墓碑」的唯一用途是被 `pull`（`rev > since`）带回其他设备，
 *   告诉它们「这条已经删了」。设备都知道了以后，它就是纯粹的行数负担。
 * - `sync_ops`：push 的幂等表，一行对应一次已应用的 op。重试去重要用的时间窗是分钟级，
 *   留 30 天已经远超实际需要。
 *
 * 为什么不能只按时间删墓碑：设备是懒的。一台 40 天没开机的设备回来时从自己的
 * `lastPulledRev` 继续拉，如果服务端已经把这段时间的墓碑删掉，它就永远学不到那几条删除，
 * 本地会留下幽灵行。所以多加一道水位：**墓碑必须比「最久未联系的活跃设备」还老才删**——
 * 那台设备至少在墓碑产生之后联系过服务端一次。`last_seen_at` 由鉴权时写（服务端时间），
 * 与 `deleted_at` 同一时基，可以直接比较；`updated_at` 是客户端时钟，不参与这个判断。
 *
 * 这道保护是「保守」而不是「保证」：设备可能在联系过后只拉了一半。真要严格，需要按设备
 * 记录已拉到的 rev（schema 改动），当前单用户部署不值得。
 */

/** 单批删除行数。和 `pruneAiCalls` 同量级：避免长事务把并发请求卡在 `SQLITE_BUSY`。 */
export const SYNC_PRUNE_BATCH = 500

/** 防御「cutoff 传错把全表扫空」：单表单次最多删 50 万行，剩下的下次继续。 */
const MAX_ROUNDS = 1_000

export interface SyncPruneOptions {
  /** 早于这个时间戳（毫秒）的数据才算过期。 */
  cutoff: number
  batchSize?: number
}

function batch(options: SyncPruneOptions): number {
  return Math.max(1, Math.trunc(options.batchSize ?? SYNC_PRUNE_BATCH))
}

/** 删墓碑。`devices` 子查询为空（该账号没有活跃设备）时退化成纯时间判断。 */
export function pruneTombstones(db: Db, options: SyncPruneOptions): number {
  const cutoff = Math.trunc(options.cutoff)
  const limit = batch(options)
  let total = 0
  for (const kind of ENTITY_KINDS) {
    const table = entityDefinition(kind).table
    // 用 rowid 子查询而不是 DELETE ... LIMIT：后者需要 SQLITE_ENABLE_UPDATE_DELETE_LIMIT
    // 编译选项，Node 自带的那份不保证开启。
    const statement = db.prepare(
      `DELETE FROM ${table}
        WHERE rowid IN (
          SELECT t.rowid FROM ${table} AS t
           WHERE t.deleted_at IS NOT NULL
             AND t.deleted_at < ?
             AND t.deleted_at < COALESCE((
                   SELECT MIN(COALESCE(d.last_seen_at, d.created_at))
                     FROM devices d
                    WHERE d.user_id = t.user_id AND d.revoked_at IS NULL
                 ), ?)
           ORDER BY t.rowid
           LIMIT ?
        )`,
    )
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const changes = Number(statement.run(cutoff, cutoff, limit).changes)
      total += changes
      if (changes < limit) break
    }
  }
  return total
}

/** 删过期的 push 幂等记录。 */
export function pruneSyncOps(db: Db, options: SyncPruneOptions): number {
  const cutoff = Math.trunc(options.cutoff)
  const limit = batch(options)
  const statement = db.prepare(
    `DELETE FROM sync_ops
      WHERE rowid IN (SELECT rowid FROM sync_ops WHERE applied_at < ? ORDER BY rowid LIMIT ?)`,
  )
  let total = 0
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const changes = Number(statement.run(cutoff, limit).changes)
    total += changes
    if (changes < limit) break
  }
  return total
}
