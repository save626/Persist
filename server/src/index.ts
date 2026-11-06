import { createDeepSeekClient } from './ai/deepseek.js'
import { buildApp } from './app.js'
import { describeConfig, loadConfig } from './config.js'
import { openPersistDatabase, type PersistDatabase } from './db/index.js'
import { startDailyBriefScheduler, type DailyBriefScheduler } from './jobs/daily-brief.js'

/**
 * 生产入口：只监听回环地址（默认 127.0.0.1:3000），由 Nginx 反代 /api/*。
 * 配置全部来自环境变量（systemd EnvironmentFile），仓库里不存在任何密钥。
 *
 * 步骤 12 起多了一个本地 SQLite 文件（默认 data/persist.sqlite）：
 * 先开库跑迁移，再起 HTTP 服务；起不来就直接退出，避免带病状态对外提供 /api/health。
 *
 * 步骤 13 起多了一个进程内定时器（每日简报，默认关闭）：HTTP 起好后再启动，
 * 关闭进程时先停定时器再关连接，避免任务跑到一半把库关掉。
 */

const config = loadConfig()

let database: PersistDatabase
try {
  database = openPersistDatabase({
    path: config.dbPath,
    busyTimeoutMs: config.dbBusyTimeoutMs,
  })
} catch (error) {
  // 此时 app 还没建，没有 logger 可用；错误只落 stderr，systemd 会记进 journal。
  console.error('failed to open database', error)
  process.exit(1)
}

const ai = createDeepSeekClient(config)
const app = buildApp({ config, db: database, ai })
let scheduler: DailyBriefScheduler | null = null

try {
  await app.listen({ host: config.host, port: config.port })
  app.log.info(
    {
      ...describeConfig(config),
      dbPath: database.path,
      backupDir: config.backupDir,
      schemaVersion: database.schemaVersion,
    },
    'persist-server started',
  )
  if (!config.deepseekApiKey) {
    app.log.warn('DEEPSEEK_API_KEY 未配置：/api/chat 将返回 503，前端应回退到本地 Mock。')
  }
  scheduler = startDailyBriefScheduler({
    db: database.db,
    ai,
    config,
    now: () => Date.now(),
    logger: app.log,
  })
} catch (error) {
  app.log.error({ err: error }, 'failed to start persist-server')
  database.db.close()
  process.exit(1)
}

function shutdown(signal: string): void {
  app.log.info({ signal }, 'shutting down persist-server')
  scheduler?.stop()
  app
    .close()
    .then(() => {
      database.db.close()
      process.exit(0)
    })
    .catch(() => process.exit(1))
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => shutdown(signal))
}
