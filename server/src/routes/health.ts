import type { ServerConfig } from '../config.js'
import type { PersistDatabase } from '../db/index.js'
import type { FastifyInstance } from 'fastify'

/**
 * GET /api/health —— 部署验收用：返回 200 即代表进程与 Nginx 反代都通了。
 * 只暴露「有没有配模型」「库能不能读」这种非敏感状态，绝不回显密钥或数据内容。
 *
 * 步骤 12 起新增 `db` 与 `version`（设计文档 §10 允许的向后兼容字段）：
 * 部署脚本可以据此确认迁移是否跑到最新版本。
 */
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
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      service: 'persist-server',
      ai: options.config.deepseekApiKey ? 'deepseek' : 'disabled',
      model: options.config.deepseekModel,
      time: new Date().toISOString(),
      db,
      version: options.db.schemaVersion,
    }
  })
}
