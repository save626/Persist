import type { ServerConfig } from '../config.js'
import type { FastifyInstance } from 'fastify'

/**
 * GET /api/health —— 部署验收用：返回 200 即代表进程与 Nginx 反代都通了。
 * 只暴露「有没有配模型」这种非敏感状态，绝不回显密钥。
 */
export function registerHealthRoute(app: FastifyInstance, options: { config: ServerConfig }): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'persist-server',
    ai: options.config.deepseekApiKey ? 'deepseek' : 'disabled',
    model: options.config.deepseekModel,
    time: new Date().toISOString(),
  }))
}
