/**
 * 服务端配置的唯一来源。
 *
 * 只从环境变量读，不读命令行参数、不读仓库里的文件：
 * 生产由 systemd 的 EnvironmentFile=/etc/persist/server.env 注入，
 * 仓库里只有 .env.example（无真实密钥）。
 */

import { DEFAULT_DAILY_BRIEF_AT, parseDailyBriefAt } from '@persist/shared/contract/analysis'

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
  /** 同步 / 账号接口单独计数：客户端每 60 s 轮询一次，不能吃掉 AI 接口的额度。 */
  syncRateLimitMax: number
  /** 综合分析单独计数：一次生成可能跑 20–40 s，不能和聊天共用窗口。 */
  analysisRateLimitMax: number
  /** 综合分析单次模型调用超时；长事实包比聊天慢，允许单独放宽。 */
  analysisTimeoutMs: number
  /** 综合分析单次模型调用的 max_tokens（2–5 段正文 + 结论/建议）。 */
  analysisMaxTokens: number
  /** 每日简报的兜底开关与时间；用户设置里的 dailyBrief 优先。 */
  dailyBriefEnabled: boolean
  dailyBriefAt: string
  maxTurns: number
  maxTurnChars: number
  maxPromptChars: number
  /** SQLite 单文件库路径；生产由 server.env 指到 /var/lib/persist/persist.sqlite。 */
  dbPath: string
  dbBusyTimeoutMs: number
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
    syncRateLimitMax: readInt(env, 'SYNC_RATE_LIMIT_MAX', 240, 1, 10_000),
    analysisRateLimitMax: readInt(env, 'ANALYSIS_RATE_LIMIT_MAX', 6, 1, 120),
    analysisTimeoutMs: readInt(env, 'ANALYSIS_TIMEOUT_MS', 45_000, 1_000, 180_000),
    analysisMaxTokens: readInt(env, 'ANALYSIS_MAX_TOKENS', 2_600, 600, 8_000),
    dailyBriefEnabled: readBool(env, 'DAILY_BRIEF_ENABLED', false),
    dailyBriefAt: parseDailyBriefAt(env.DAILY_BRIEF_AT?.trim()) ?? DEFAULT_DAILY_BRIEF_AT,
    maxTurns: 20,
    maxTurnChars: 2_000,
    maxPromptChars: 12_000,
    dbPath: env.DB_PATH?.trim() || 'data/persist.sqlite',
    dbBusyTimeoutMs: readInt(env, 'DB_BUSY_TIMEOUT_MS', 5_000, 100, 60_000),
  }
}

/** 打日志用：绝不包含 API Key。库路径与 schema 版本由调用方补（要等库打开后才准）。 */
export function describeConfig(config: ServerConfig) {
  return {
    host: config.host,
    port: config.port,
    ai: config.deepseekApiKey ? 'deepseek' : 'disabled',
    model: config.deepseekModel,
    timeoutMs: config.aiTimeoutMs,
    rateLimit: `${config.rateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s`,
    syncRateLimit: `${config.syncRateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s`,
    analysisRateLimit: `${config.analysisRateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s`,
    dailyBrief: `${config.dailyBriefEnabled ? 'on' : 'off'}@${config.dailyBriefAt}`,
  }
}
