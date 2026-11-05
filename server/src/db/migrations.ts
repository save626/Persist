import type { Db } from './driver.js'

/**
 * 数据库迁移：只增不改。每条 migration 一个版本号，跑过的记在 schema_migrations 里。
 *
 * v1 只建步骤 12 用得到的表：身份（users / devices）、单行档案与设置、六类记录 + 计划、
 * 全局 rev 序列、同步幂等表。报告 / 备份 / 审计表属于步骤 13、14，各自加 v2 / v3，
 * 避免一次建一堆当前没有读写路径、也没测试覆盖的表。
 */

export interface Migration {
  version: number
  name: string
  statements: string[]
}

/** 当前代码期望的 schema 版本；`/api/health` 会带出去，方便对比线上库。 */
export const SCHEMA_VERSION = 1

const PULL_COLUMNS = `
  payload_json TEXT NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  rev          INTEGER NOT NULL`

/** 除单行表（profiles / settings）外，所有同步实体都有 id + user_id + rev。 */
function entityTable(name: string, columns: string): string {
  // 调用处的列清单允许带结尾逗号（方便增删列），拼之前去掉，避免出现双逗号。
  const body = columns.trim().replace(/,\s*$/, '')
  return `CREATE TABLE ${name} (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  ${body},
  ${PULL_COLUMNS}
)`
}

/** 每张实体表的拉取索引：pull 按 (user_id, rev) 扫，跨设备增量只读这一条索引。 */
function pullIndex(table: string): string {
  return `CREATE INDEX idx_${table}_pull ON ${table} (user_id, rev)`
}

/** 按日查询索引：步骤 13 的服务端聚合要按日期范围取事实。 */
function dateIndex(table: string, column: string): string {
  return `CREATE INDEX idx_${table}_user_date ON ${table} (user_id, ${column}) WHERE deleted_at IS NULL`
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'sync_core',
    statements: [
      `CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
)`,
      `CREATE TABLE devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  token_hash    TEXT NOT NULL UNIQUE,
  recovery_hash TEXT UNIQUE,
  label         TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER,
  revoked_at    INTEGER
)`,
      'CREATE INDEX idx_devices_user ON devices (user_id)',
      `CREATE TABLE sync_seq (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL
)`,
      'INSERT INTO sync_seq (id, value) VALUES (1, 0)',
      `CREATE TABLE profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  ${PULL_COLUMNS}
)`,
      `CREATE TABLE settings (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  summary_only INTEGER NOT NULL DEFAULT 0,
  ${PULL_COLUMNS}
)`,
      entityTable(
        'plan_items',
        `date         TEXT NOT NULL,
  kind         TEXT,
  done         INTEGER NOT NULL DEFAULT 0,`,
      ),
      entityTable(
        'study_records',
        `date         TEXT NOT NULL,
  category     TEXT NOT NULL,
  duration_min REAL NOT NULL DEFAULT 0,`,
      ),
      entityTable(
        'fitness_sessions',
        `date          TEXT NOT NULL,
  status        TEXT NOT NULL,
  completed_at  TEXT,
  total_sets    INTEGER,
  done_sets     INTEGER,
  volume_kg     REAL,
  duration_min  REAL,
  distance_km   REAL,`,
      ),
      entityTable(
        'diet_entries',
        `date         TEXT NOT NULL,
  meal         TEXT NOT NULL,
  name         TEXT,
  calories     REAL,
  protein      REAL,
  carbs        REAL,
  fat          REAL,`,
      ),
      entityTable(
        'water_logs',
        `date         TEXT NOT NULL,
  time         TEXT NOT NULL,
  milliliters  INTEGER NOT NULL,`,
      ),
      entityTable(
        'goals',
        `date         TEXT NOT NULL,
  title        TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,`,
      ),
      entityTable('long_term_plans', `status       TEXT NOT NULL,`),
      `CREATE TABLE sync_ops (
  op_id       TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  applied_at  INTEGER NOT NULL,
  result_json TEXT NOT NULL
)`,
      'CREATE INDEX idx_sync_ops_applied ON sync_ops (applied_at)',
      pullIndex('plan_items'),
      pullIndex('study_records'),
      pullIndex('fitness_sessions'),
      pullIndex('diet_entries'),
      pullIndex('water_logs'),
      pullIndex('goals'),
      pullIndex('long_term_plans'),
      dateIndex('plan_items', 'date'),
      dateIndex('study_records', 'date'),
      dateIndex('fitness_sessions', 'date'),
      dateIndex('diet_entries', 'date'),
      dateIndex('water_logs', 'date'),
      dateIndex('goals', 'date'),
    ],
  },
]

export interface MigrateResult {
  /** 迁移后的 schema 版本（没有表时是 0）。 */
  version: number
  /** 本次真正执行了的版本号。 */
  applied: number[]
}

/**
 * 跑迁移。可重复调用：已应用的版本直接跳过。
 * 每条 migration 的建表 + 记账在同一个事务里，失败不会留下半套表。
 * `migrations` 参数只给测试注入坏迁移用，生产走模块内的 MIGRATIONS。
 */
export function migrate(
  db: Db,
  options: { now?: () => number; migrations?: Migration[] } = {},
): MigrateResult {
  const now = options.now ?? Date.now
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
)`)

  const rows = db.prepare<{ version: number }>('SELECT version FROM schema_migrations').all()
  const applied = new Set(rows.map((row) => Number(row.version)))
  const pending = (options.migrations ?? MIGRATIONS)
    .filter((migration) => !applied.has(migration.version))
    .sort((a, b) => a.version - b.version)

  const appliedNow: number[] = []
  for (const migration of pending) {
    db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        Math.trunc(now()),
      )
    })
    appliedNow.push(migration.version)
  }

  const version =
    pending.length > 0 ? (pending[pending.length - 1]?.version ?? 0) : currentVersion(db)
  return { version, applied: appliedNow }
}

function currentVersion(db: Db): number {
  const row = db
    .prepare<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_migrations')
    .get()
  return row?.version ? Number(row.version) : 0
}
