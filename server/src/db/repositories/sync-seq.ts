import type { Db } from '../driver.js'

/**
 * 全局单调 rev：所有实体表共用同一个序列，客户端 pull 只带一个 `since`。
 * 每次写入在一个事务里取号，保证「同一 rev 不会分给两条记录」。
 */

export function allocateRev(db: Db): number {
  const result = db.prepare('UPDATE sync_seq SET value = value + 1 WHERE id = 1').run()
  if (result.changes !== 1) {
    throw new Error('sync_seq 未初始化：migrate() 是否跑过？')
  }
  const row = db.prepare<{ value: number }>('SELECT value FROM sync_seq WHERE id = 1').get()
  if (!row) throw new Error('sync_seq 读不到当前值。')
  return Number(row.value)
}

export function currentRev(db: Db): number {
  const row = db.prepare<{ value: number }>('SELECT value FROM sync_seq WHERE id = 1').get()
  return row ? Number(row.value) : 0
}
