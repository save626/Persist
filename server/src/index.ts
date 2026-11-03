import { buildApp } from './app.js'
import { describeConfig, loadConfig } from './config.js'

/**
 * 生产入口：只监听回环地址（默认 127.0.0.1:3000），由 Nginx 反代 /api/*。
 * 配置全部来自环境变量（systemd EnvironmentFile），仓库里不存在任何密钥。
 */

const config = loadConfig()
const app = buildApp({ config })

try {
  await app.listen({ host: config.host, port: config.port })
  app.log.info(describeConfig(config), 'persist-server started')
  if (!config.deepseekApiKey) {
    app.log.warn('DEEPSEEK_API_KEY 未配置：/api/chat 将返回 503，前端应回退到本地 Mock。')
  }
} catch (error) {
  app.log.error({ err: error }, 'failed to start persist-server')
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down persist-server')
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
}
