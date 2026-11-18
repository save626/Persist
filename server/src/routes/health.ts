import { statfsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ServerConfig } from '../config.js'
import type { PersistDatabase } from '../db/index.js'
import type { FastifyInstance } from 'fastify'

/**
 * GET /api/health —— 部署验收用：返回 200 即代表进程与 Nginx 反代都通了。
 * 只暴露「有没有配模型」「库能不能读」这种非敏感状态，绝不回显密钥或数据内容。
 *
 * 2026-11-18 起不再返回 `version`（schema 版本）与 `model`：这两个字段对运维
 * 有用，但 `/api/health` 是公网可达的，等于白送「迁移到第几版、用的哪个模型」
 * 这类指纹。需要确认迁移版本时在本机执行 `sqlite3 <db> 'PRAGMA user_version'`，
 * 启动日志的 `describeConfig` 也会打印同一信息。
 *
 * 步骤 14a 起新增 `storage` / `warnings`：库所在分区使用率超过阈值时告警
 * （P4 §11.3「磁盘水位 > 85% 时 /api/health 报 warn」）。
 * 注意顶层 `status` 保持 ok/degraded 两个值不变：前端把 `status === 'ok'`
 * 当作「AI 可用」的信号，磁盘告警不应该让聊天误退回 mock，所以磁盘状态只放在
 * `storage.status` 与 `warnings` 里，告警语义交给监控脚本判断。
 *
 * 前端只读取 `status` 与 `ai` 两个字段（见 `ai-chat-client.ts`），
 * 增删其余字段不影响客户端。
 */

export interface StorageStatus {
  /** 与 df 一致的口径：used / (used + avail)，保留一位小数。 */
  usedPercent: number
  status: 'ok' | 'warn'
}

export function assessStorage(
  stats: { blocks: number; bfree: number; bavail: number },
  warnPercent: number,
): StorageStatus {
  const used = stats.blocks - stats.bfree
  const denominator = used + stats.bavail
  const usedPercent = denominator > 0 ? Math.round((used / denominator) * 1_000) / 10 : 0
  return { usedPercent, status: usedPercent >= warnPercent ? 'warn' : 'ok' }
}

/** 读库所在分区；读不到（相对路径还没建、容器里没有 statfs）就返回 null，不影响健康判定。 */
export function readStorage(dbPath: string, warnPercent: number): StorageStatus | null {
  try {
    const stats = statfsSync(dbPath === ':memory:' ? '.' : dirname(dbPath), { bigint: true })
    return assessStorage(
      { blocks: Number(stats.blocks), bfree: Number(stats.bfree), bavail: Number(stats.bavail) },
      warnPercent,
    )
  } catch {
    return null
  }
}

export function registerHealthRoute(
  app: FastifyInstance,
  options: { config: ServerConfig; db: PersistDatabase },
): void {
  app.get('/api/health', async () => {
    let db: 'ok' | 'error' = 'ok'
    try {
      options.db.db.prepare('SELECT 1 AS probe').get()
    } catch {
      db = 'error'
    }
    const storage = readStorage(options.config.dbPath, options.config.diskWarnPercent)
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      service: 'persist-server',
      ai: options.config.deepseekApiKey ? 'deepseek' : 'disabled',
      time: new Date().toISOString(),
      db,
      storage,
      warnings: storage && storage.status === 'warn' ? ['disk_usage_high'] : [],
    }
  })
}
