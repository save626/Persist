import type { Db } from './driver.js'

/**
 * 数据库迁移：只增不改。每条 migration 一个版本号，跑过的记在 schema_migrations 里。
 *
 * v1 只建步骤 12 用得到的表：身份（users / devices）、单行档案与设置、六类记录 + 计划、
 * 全局 rev 序列、同步幂等表。报告 / 备份 / 审计表属于步骤 13、14，各自加 v2 / v3，
 * 避免一次建一堆当前没有读写路径、也没测试覆盖的表。
 *
 * v2（步骤 13）：分析报告归档 + 每日简报任务台账。报告内容、指标、事实包都存全文，
 * 方便「报告里的每个数字都能回溯到当时的聚合结果」；缓存键是 (用户, 类型, 窗口, data_rev)。
 *
 * v3（P0 Step 2）：AI 调用配额与审计。`ai_usage` 按 (凭据, 本地日期) 累计次数，
 * `ai_calls` 记每一次调用的结果、状态码、耗时与 IP 哈希。
 * 这两张表**不参与账号删除清理**：它们是服务端运维事实（谁在花作者的钱），不属于用户
 * 业务数据；`ai_calls` 里也没有任何请求正文，删账号时留着不构成隐私残留。
 *
 * v4（P5-2）：数据操作审计。`ai_calls` 只覆盖「谁调了模型」，账号与同步侧的破坏性动作
 * （建设备、吊销设备、删账号、建快照、恢复快照、导出）此前只落在 journald 日志里，
 * 日志一滚就没了。`audit_log` 把这些事件落成可查询的行。
 * 与 `ai_calls` 的区别：这张表有 `user_id`，所以**删账号时要把该用户的 `user_id` 置空**
 * 而不是删行——事件本身（某个时间有人删了一个账号、删掉几台设备）仍是运维事实，
 * 但不再指向具体账号。它同样不记正文，`detail_json` 只放计数与文件名这类必要字段。
 *
 * v5（2026-11-18）：本机「历史报告」纳入同步。此前它被明确排除在外，代价是换机 /
 * 清空本机 / 误导入都会让这些报告永久消失，而它们既不可复算也没有别的副本。
 * 只新增 `reports` 表；`analysis_reports`（服务端综合分析归档）保持不变。
 */

export interface Migration {
  version: number
  name: string
  statements: string[]
}

/** 当前代码期望的 schema 版本；`/api/health` 会带出去，方便对比线上库。 */
export const SCHEMA_VERSION = 5

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
  id            TEXT PRIMARY KEY,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  recovery_hash TEXT UNIQUE
)`,
      `CREATE TABLE devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  token_hash    TEXT NOT NULL UNIQUE,
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
  {
    version: 2,
    name: 'analysis_reports',
    statements: [
      `CREATE TABLE analysis_reports (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL,
  range_days   INTEGER NOT NULL,
  data_rev     INTEGER NOT NULL,
  origin       TEXT NOT NULL,
  model        TEXT,
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL,
  content_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  facts_json   TEXT NOT NULL,
  created_at   INTEGER NOT NULL
)`,
      // 缓存键：同一份数据（data_rev 相同）不重复花模型额度；force 时先删后插仍落这一行。
      `CREATE UNIQUE INDEX idx_analysis_reports_cache
  ON analysis_reports (user_id, type, range_days, data_rev)`,
      'CREATE INDEX idx_analysis_reports_user_created ON analysis_reports (user_id, created_at DESC)',
      // 保留期清理：按 created_at 扫过期报告，不需要把 user_id 带上。
      'CREATE INDEX idx_analysis_reports_created ON analysis_reports (created_at)',
      `CREATE TABLE job_runs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  run_key     TEXT NOT NULL,
  status      TEXT NOT NULL,
  user_id     TEXT,
  report_id   TEXT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  error       TEXT,
  UNIQUE (name, run_key)
)`,
      'CREATE INDEX idx_job_runs_name_started ON job_runs (name, started_at)',
    ],
  },
  {
    version: 3,
    name: 'ai_quota_audit',
    statements: [
      // 按天累计：主键 (key_id, day) 让「查用量」和「加一次」落在同一行，天然原子。
      // prompt_tokens / completion_tokens 先留着（Step 3 采集 usage 时才写），避免再改表。
      `CREATE TABLE ai_usage (
  key_id            TEXT    NOT NULL,
  day               TEXT    NOT NULL,
  requests          INTEGER NOT NULL DEFAULT 0,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (key_id, day)
)`,
      // 审计：只记「谁、哪条路由、结果、状态码、耗时」，不记请求正文、不记 IP 明文。
      `CREATE TABLE ai_calls (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id            TEXT    NOT NULL,
  route             TEXT    NOT NULL,
  model             TEXT,
  result            TEXT    NOT NULL,
  http_status       INTEGER NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  latency_ms        INTEGER,
  ip_hash           TEXT,
  created_at        INTEGER NOT NULL
)`,
      // 保留期清理按 created_at 扫；按凭据查历史走 (key_id, created_at)。
      'CREATE INDEX idx_ai_calls_created_at ON ai_calls(created_at)',
      'CREATE INDEX idx_ai_calls_key_created ON ai_calls(key_id, created_at)',
    ],
  },
  {
    version: 4,
    name: 'audit_log',
    statements: [
      // 数据操作审计：一次动作一行，既不覆盖业务数据也不记录正文。
      // `user_id` 可为空——账号被删后整行保留但置空（见文件头 v4 说明）。
      // `actor` 区分「用户主动操作」与「系统定时/任务」；`result` 区分成功、被拒、出错。
      `CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT,
  actor       TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  target      TEXT,
  result      TEXT    NOT NULL,
  detail_json TEXT,
  ip_hash     TEXT,
  created_at  INTEGER NOT NULL
)`,
      // 保留期清理按 created_at 扫；「这个账号做过什么」走 (user_id, created_at)。
      'CREATE INDEX idx_audit_log_created_at ON audit_log(created_at)',
      'CREATE INDEX idx_audit_log_user_created ON audit_log(user_id, created_at)',
    ],
  },
  {
    version: 5,
    name: 'local_reports',
    statements: [
      /**
       * 本机「历史报告」（用户点「生成今日简报」留下的记录）此前**完全不上云**，
       * 换机、清空本机、误导入都会让它永久消失，且没有别的副本：
       * `analysis_reports` 存的是服务端综合分析归档，两者内容与留存策略都不同。
       *
       * 这里只补同步表，不动 `analysis_reports`；两者 id 空间不重叠（本地是
       * `report-daily-*` / `report-*`，归档是 uuid），前端也不做合并展示。
       */
      entityTable(
        'reports',
        `date         TEXT NOT NULL,
  type         TEXT,
  status       TEXT,
  origin       TEXT,`,
      ),
      pullIndex('reports'),
      // 报告按日期取：前端「历史报告」列表按 date 倒序，聚合侧也只读这一列。
      dateIndex('reports', 'date'),
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
