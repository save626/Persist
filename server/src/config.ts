/**
 * 服务端配置的唯一来源。
 *
 * 只从环境变量读，不读命令行参数、不读仓库里的文件：
 * 生产由 systemd 的 EnvironmentFile=/etc/persist/server.env 注入，
 * 仓库里只有 .env.example（无真实密钥）。
 */

import { dirname, join } from 'node:path'
import { DEFAULT_DAILY_BRIEF_AT, parseDailyBriefAt } from '@persist/shared/contract/analysis'
import { parseAiGateMode, parseAiKeys, type AiGateMode, type AiKey } from './ai/ai-guard.js'

export interface ServerConfig {
  host: string
  port: number
  /** Capacitor Android WebView 的 CORS 白名单；只接受完整 http(s) origin。 */
  allowedOrigins: string[]
  trustProxy: boolean
  logLevel: string
  deepseekApiKey: string | null
  deepseekBaseUrl: string
  deepseekModel: string
  aiTimeoutMs: number
  aiMaxRetries: number
  /**
   * AI 接口的服务端凭据门（P0）。
   * `off` = 不校验（默认，等同改动前行为）；`warn` = 只记日志不拒绝；`enforce` = 401。
   */
  aiGate: AiGateMode
  /**
   * 允许调用 `/api/chat` 与 `/api/report` 的凭据哈希。
   * 空数组配合 `enforce` 会拒绝一切请求（fail-closed），这是刻意选择：
   * 宁可自己用不了，也不放行匿名调用。
   */
  aiKeys: AiKey[]
  /**
   * 每个凭据的每日调用上限（P0 Step 2）。`0` 关闭这一维。
   * 默认 100：凭据被提取后，这是唯一能把「无限盗刷」变成「每天有限」的止损手段。
   */
  aiDailyLimit: number
  /**
   * 每个凭据的每日 token 上限（P0 Step 3，输入 + 输出）。`0` 关闭这一维。
   * 默认 200000：正常一天（十几次对话 + 两三份报告）大约 2–5 万 token，
   * 留约 4–10 倍余量；按 deepseek-chat 的价格，跑满一天也只是几毛到一两块钱。
   */
  aiDailyTokens: number
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
  /** 每日快照目录；默认与库同级的 backups/（生产即 /var/lib/persist/backups）。 */
  backupDir: string
  /** 保留策略：近 N 天全留 + 近 N 周每周一份 + 近 N 月每月一份。 */
  backupKeepDays: number
  backupKeepWeeks: number
  backupKeepMonths: number
  /** 库所在分区使用率到达该百分比时，/api/health 报 storage.warn（P4 §11.3：85）。 */
  diskWarnPercent: number
}

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat'
export const DEFAULT_ALLOWED_ORIGINS = ['https://localhost'] as const

/** 解析逗号分隔的 origin；非法项丢弃，留空时回到 Capacitor 安全的默认值。 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  const values =
    raw
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? []
  const origins = new Set<string>()
  for (const value of values) {
    try {
      const url = new URL(value)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      if (url.username || url.password || url.search || url.hash) continue
      if (url.pathname !== '/' && url.pathname !== '') continue
      origins.add(url.origin)
    } catch {
      // 忽略无法解析的项，避免一个坏配置让服务端无法启动。
    }
  }
  return origins.size > 0 ? [...origins] : [...DEFAULT_ALLOWED_ORIGINS]
}

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
  const dbPath = env.DB_PATH?.trim() || 'data/persist.sqlite'
  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: readInt(env, 'PORT', 3000, 1, 65_535),
    allowedOrigins: parseAllowedOrigins(env.PERSIST_ALLOWED_ORIGINS),
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
    aiGate: parseAiGateMode(env.PERSIST_AI_GATE),
    aiKeys: parseAiKeys(env.PERSIST_AI_KEYS),
    aiDailyLimit: readInt(env, 'PERSIST_AI_DAILY_LIMIT', 100, 0, 100_000),
    aiDailyTokens: readInt(env, 'PERSIST_AI_DAILY_TOKENS', 200_000, 0, 100_000_000),
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
    dbPath,
    dbBusyTimeoutMs: readInt(env, 'DB_BUSY_TIMEOUT_MS', 5_000, 100, 60_000),
    // 备份目录默认跟着库走：DB_PATH=/var/lib/persist/persist.sqlite 时
    // 默认就是 /var/lib/persist/backups，不需要在 server.env 里重复写一遍。
    backupDir: env.DB_BACKUP_DIR?.trim() || join(dirname(dbPath), 'backups'),
    backupKeepDays: readInt(env, 'BACKUP_KEEP_DAYS', 7, 1, 365),
    // 周/月可以配 0：等于只保留日备份。
    backupKeepWeeks: readInt(env, 'BACKUP_KEEP_WEEKS', 4, 0, 52),
    backupKeepMonths: readInt(env, 'BACKUP_KEEP_MONTHS', 3, 0, 120),
    diskWarnPercent: readInt(env, 'DISK_WARN_PERCENT', 85, 50, 100),
  }
}

/**
 * 启动日志里的配额摘要。两维分别可关，用同一条 `aiQuota` 字段表达，
 * 例如 `enforce/1` + `100/day, 200k tokens/day`；全关时是 `off`。
 */
function describeAiQuota(config: ServerConfig): string {
  const parts: string[] = []
  if (config.aiDailyLimit > 0) parts.push(`${config.aiDailyLimit}/day`)
  if (config.aiDailyTokens > 0) {
    const tokens =
      config.aiDailyTokens >= 1_000
        ? `${Math.round(config.aiDailyTokens / 1_000)}k`
        : String(config.aiDailyTokens)
    parts.push(`${tokens} tokens/day`)
  }
  return parts.length > 0 ? parts.join(', ') : 'off'
}

/** 打日志用：绝不包含 API Key。库路径与 schema 版本由调用方补（要等库打开后才准）。 */
export function describeConfig(config: ServerConfig) {
  return {
    host: config.host,
    port: config.port,
    ai: config.deepseekApiKey ? 'deepseek' : 'disabled',
    model: config.deepseekModel,
    // 只报「模式/凭据条数」，不报 keyId，更不报哈希：启动日志会被到处贴。
    aiGate: `${config.aiGate}/${config.aiKeys.length}`,
    aiQuota: describeAiQuota(config),
    timeoutMs: config.aiTimeoutMs,
    rateLimit: `${config.rateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s`,
    syncRateLimit: `${config.syncRateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s`,
    analysisRateLimit: `${config.analysisRateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s`,
    corsOrigins: config.allowedOrigins,
    dailyBrief: `${config.dailyBriefEnabled ? 'on' : 'off'}@${config.dailyBriefAt}`,
  }
}
