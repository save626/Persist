import { DatabaseSync } from 'node:sqlite'

/**
 * SQLite 访问的唯一入口：仓库其他部分只允许用 exec / prepare / run / all / get / transaction。
 *
 * 为什么自己包一层：步骤 12 定的是 `node:sqlite`（Node 22 内置、零原生依赖，2C2G 小机器上
 * 不用装 gcc / make / python3）。但它在当前 Node 里仍是实验特性，换驱动（比如将来换
 * better-sqlite3）或 Node 把 sqlite 转正、改 API 时，只动这一个文件，业务代码不用碰。
 */

export type DbParam = string | number | bigint | null | Uint8Array

export interface Statement<Row = Record<string, unknown>> {
  /** 执行写语句，返回受影响行数。 */
  run(...params: DbParam[]): { changes: number }
  /** 取第一行，没有则 null。 */
  get(...params: DbParam[]): Row | null
  /** 取全部行。 */
  all(...params: DbParam[]): Row[]
}

export interface Db {
  exec(sql: string): void
  /** `prepare<Row>(sql)` 之后 get / all 直接返回 Row。 */
  prepare<Row = Record<string, unknown>>(sql: string): Statement<Row>
  /**
   * 事务：正常返回则提交，抛错则回滚。
   * 嵌套调用不报错，用 SAVEPOINT 兜住——只回滚内层，外层仍可继续。
   */
  transaction<T>(run: () => T): T
  close(): void
}

export interface OpenDbOptions {
  /** 文件路径，或测试用的 `:memory:`。 */
  path: string
  busyTimeoutMs?: number
}

const DEFAULT_BUSY_TIMEOUT_MS = 5_000

export function openDatabase(options: OpenDbOptions): Db {
  const db = new DatabaseSync(options.path)

  // 外键让 SQLite 自己校验；WAL 让读写不互相阻塞；NORMAL 在 WAL 下已足够安全且更快。
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`PRAGMA busy_timeout = ${Math.trunc(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS)}`)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')

  let depth = 0

  return {
    exec(sql) {
      db.exec(sql)
    },
    prepare<Row>(sql: string): Statement<Row> {
      const statement = db.prepare(sql)
      return {
        run(...params: DbParam[]) {
          const result = statement.run(...params)
          return { changes: Number(result.changes) }
        },
        get(...params: DbParam[]) {
          return (statement.get(...params) ?? null) as Row | null
        },
        all(...params: DbParam[]) {
          return statement.all(...params) as unknown as Row[]
        },
      }
    },
    transaction<T>(run: () => T): T {
      const savepoint = `sp_${depth}`
      db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
      depth += 1
      try {
        const result = run()
        depth -= 1
        db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
        return result
      } catch (error) {
        depth -= 1
        if (depth === 0) {
          db.exec('ROLLBACK')
        } else {
          db.exec(`ROLLBACK TO ${savepoint}`)
          db.exec(`RELEASE ${savepoint}`)
        }
        throw error
      }
    },
    close() {
      db.close()
    },
  }
}
