import { statfsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ServerConfig } from '../config.js'
import type { PersistDatabase } from '../db/index.js'
import type { FastifyInstance } from 'fastify'

/**
 * GET /api/health —— 部署验收用：返回 200 即代表进程与 Nginx 反代都通了。
 * 只暴露「有没有配模型」「库能不能读」这种非敏感状态，绝不回显密钥或数据内容。
 *
 * 步骤 12 起新增 `db` 与 `version`（设计文档 §10 允许的向后兼容字段）：
 * 部署脚本可以据此确认迁移是否跑到最新版本。
 *
 * 步骤 14a 起新增 `storage` / `warnings`：库所在分区使用率超过阈值时告警
 * （P4 §11.3「磁盘水位 > 85% 时 /api/health 报 warn」）。
 * 注意顶层 `status` 保持 ok/degraded 两个值不变：前端把 `status === 'ok'`
 * 当作「AI 可用」的信号，磁盘告警不应该让聊天误退回 mock，所以磁盘状态只放在
 * `storage.status` 与 `warnings` 里，告警语义交给监控脚本判断。
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
      model: options.config.deepseekModel,
      time: new Date().toISOString(),
      db,
      version: options.db.schemaVersion,
      storage,
      warnings: storage && storage.status === 'warn' ? ['disk_usage_high'] : [],
    }
  })
}
