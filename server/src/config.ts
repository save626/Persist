/**
 * 服务端配置的唯一来源。
 *
 * 只从环境变量读，不读命令行参数、不读仓库里的文件：
 * 生产由 systemd 的 EnvironmentFile=/etc/persist/server.env 注入，
 * 仓库里只有 .env.example（无真实密钥）。
 */

export interface ServerConfig {
  host: string
  port: number
  trustProxy: boolean
  logLevel: string
  deepseekApiKey: string | null
  deepseekBaseUrl: string
  deepseekModel: string
  aiTimeoutMs: number
  aiMaxRetries: number
  rateLimitMax: number
  rateLimitWindowMs: number
  maxTurns: number
  maxTurnChars: number
  maxPromptChars: number
}

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat'

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const raw = env[key]?.trim()
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function readBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean) {
  const raw = env[key]?.trim().toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'off'].includes(raw)) return false
  return fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const apiKey = env.DEEPSEEK_API_KEY?.trim() ?? ''
  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: readInt(env, 'PORT', 3000, 1, 65_535),
    trustProxy: readBool(env, 'TRUST_PROXY', true),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    deepseekApiKey: apiKey.length > 0 ? apiKey : null,
    deepseekBaseUrl: (env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL).replace(
      /\/+$/,
      '',
    ),
    deepseekModel: env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
    aiTimeoutMs: readInt(env, 'AI_TIMEOUT_MS', 25_000, 1_000, 120_000),
    aiMaxRetries: readInt(env, 'AI_MAX_RETRIES', 1, 0, 3),
    rateLimitMax: readInt(env, 'RATE_LIMIT_MAX', 20, 1, 1_000),
    rateLimitWindowMs: readInt(env, 'RATE_LIMIT_WINDOW_MS', 5 * 60_000, 1_000, 3_600_000),
    maxTurns: 20,
    maxTurnChars: 2_000,
    maxPromptChars: 12_000,
  }
}

/** 打日志用：绝不包含 API Key。 */
export function describeConfig(config: ServerConfig) {
  return {
    host: config.host,
    port: config.port,
    ai: config.deepseekApiKey ? 'deepseek' : 'disabled',
    model: config.deepseekModel,
    timeoutMs: config.aiTimeoutMs,
    rateLimit: `${config.rateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s`,
  }
}
