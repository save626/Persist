/**
 * 服务端配置的唯一来源。
 *
 * 只从环境变量读，不读命令行参数、不读仓库里的文件：
 * 生产由 systemd 的 EnvironmentFile=/etc/persist/server.env 注入，
 * 仓库里只有 .env.example（无真实密钥）。
 */

import { dirname, join } from 'node:path'
import {
  DATA_RETENTION,
  DEFAULT_DAILY_BRIEF_AT,
  parseDailyBriefAt,
} from '@persist/shared/contract/analysis'
import { parseAiGateMode, parseAiKeys, type AiGateMode, type AiKey } from './ai/ai-guard.js'

export interface ServerConfig {
  host: string
  port: number
  /** Capacitor Android WebView 的 CORS 白名单；只接受完整 http(s) origin。 */
  allowedOrigins: string[]
  /**
   * 信任哪一级代理写入的 `X-Forwarded-For`。默认 `'loopback'`：只信本机 Nginx。
   *
   * 这不是「开不开代理支持」，而是**来源 IP 是否可信**。`true` 表示无条件相信
   * 整个 XFF 链，`request.ip` 会取到客户端自己填的第一个值——攻击者每次换一个
   * 伪造值就能重置 IP 限流桶。生产链路是 `客户端 → Nginx → 127.0.0.1:3000`，
   * 只有 Nginx 那一跳可信，所以从右往左跳过回环地址后取到的才是真实来源。
   */
  trustProxy: boolean | string
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
  /**
   * 允许存在的 active 账号总数上限（`0` = 不限制）。
   *
   * 为什么需要它：`POST /api/v1/devices` 是开放注册，原先只按 IP 限流。陌生人可以
   * 免费注册账号，把仅供本人使用的模型额度（`analysis:global` 的日上限）占满，
   * 或把库里塞满垃圾账号。生产取一个小值（3），留出「手机 + 平板 + 一次重装」的余量；
   * 满额后新注册返回 409，已有账号与恢复码换机不受影响。
   */
  registrationMaxAccounts: number
  /**
   * `ai_calls` 审计保留天数（P0-4）。`0` = 不清理（无限保留）。
   *
   * 注意这里的 `0` 与配额的两个 `0` 语义相反：配额是「0 = 关掉限制」，这里是「0 = 关掉清理」。
   * 保留期清理是删数据的动作，默认必须是「保守」——所以「关掉」= 不删，而不是「全删」。
   * 默认 30 天，与 `DATA_RETENTION.auditLogDays` 同源，隐私说明可以照这个数字写。
   */
  aiAuditKeepDays: number
  /**
   * 数据操作审计保留天数（P5-2）：`audit_log` 里「建设备 / 吊销 / 删账号 / 建快照 / 恢复 / 导出」
   * 这些行的保留期。`0` = 不清理（与 `aiAuditKeepDays` 同一套语义）。
   *
   * 与 `aiAuditKeepDays` 分开是为了能各自调：AI 调用记录和「谁动过数据」性质不同，
   * 排查数据丢失时往往需要更长的窗口。默认同为 30 天（`DATA_RETENTION.auditLogDays`）。
   */
  auditLogKeepDays: number
  /**
   * 同步留痕保留天数（P5-1）：墓碑行 + `sync_ops` 幂等记录。`0` = 不清理。
   *
   * 默认 30 天，与 `DATA_RETENTION.tombstoneDays` 同源——这个常量从 P4 就在，
   * 一直没有任务去执行它。墓碑的作用是「把删除带给其他设备」，设备都知道了以后
   * 就只是行数负担；但删早了会让长期离线的设备留下幽灵行，所以 `tombstones.ts`
   * 里还有一道「必须比最久未联系的活跃设备更老」的判断。
   */
  syncRetentionDays: number
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
/**
 * 默认模型名。DeepSeek 官方文档当前只提供 deepseek-flash 与 deepseek-v4-pro；
 * 旧名 deepseek-chat / deepseek-reasoner 已停用（2026-11-25 换 key 时实测旧名不在在售列表）。
 * 这里必须跟官方在售名保持一致，否则新部署未显式配置 DEEPSEEK_MODEL 时会直接调用失败。
 */
/**
 * 校验 AI 上游基址（2026-11-25 安全审查：防 SSRF / 密钥外带）。
 *
 * 请求会带 `Authorization: Bearer <DEEPSEEK_API_KEY>`，若基址可被配成任意地址，
 * 一次误配 / 注入就能把付费密钥发往攻击者服务器。因此只接受：
 * - https 协议（明文 http 会在网络上暴露密钥）；
 * - URL 不含 userinfo（`https://user:pass@host` 形式的凭据内嵌）；
 * - 主机名不是 localhost / 环回 / 私网 / 链路本地 / 元数据地址。
 *
 * 不合法时回落到官方默认地址，并在 loadConfig 里记一条 warn——失败方向朝向"不发密钥"。
 */
export function isValidAiBaseUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false
  // 明确拒绝本地 / 私网 / 元数据服务，阻断把密钥打进内网或云 metadata 的误配。
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^0\./.test(host) ||
    /^fc00:/i.test(host) ||
    /^fe80:/i.test(host)
  ) {
    return false
  }
  return true
}

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash'
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

/**
 * 解析 `TRUST_PROXY`。
 *
 * - 留空 → `'loopback'`（只信任本机反向代理，安全默认值）
 * - `0/false/off/no/none` → `false`（完全不信任，直接取 socket 对端地址）
 * - `1/true/all/yes/on` → `true`（整条链都信；只在没有反向代理时才是正确的）
 * - 其余原样透传给 Fastify，例如 `10.0.0.0/8`、单个 IP，用于代理不在本机的部署
 *
 * 之所以不用 `readBool`：布尔值只有两档，而「信一跳」和「信全部」是完全不同的
 * 安全语义，混成一个开关后默认值一旦取 `true` 就等于关掉 IP 限流。
 */
export function parseTrustProxy(raw: string | undefined): boolean | string {
  const value = raw?.trim()
  if (!value) return 'loopback'
  const lowered = value.toLowerCase()
  if (['0', 'false', 'off', 'no', 'none'].includes(lowered)) return false
  if (['1', 'true', 'all', 'yes', 'on'].includes(lowered)) return true
  return value
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
  const rawBaseUrl = (env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL).replace(
    /\/+$/,
    '',
  )
  // 非法基址一律回落到官方地址：宁可打错目标让运维看到告警，也不把密钥发往未知主机。
  const deepseekBaseUrl = isValidAiBaseUrl(rawBaseUrl) ? rawBaseUrl : DEFAULT_DEEPSEEK_BASE_URL
  if (deepseekBaseUrl !== rawBaseUrl) {
    process.emitWarning(
      `DEEPSEEK_BASE_URL 不安全（仅允许 https、无内嵌凭据、非本地/私网主机），已回落到 ${DEFAULT_DEEPSEEK_BASE_URL}`,
      { code: 'PERSIST_UNSAFE_AI_BASE_URL' },
    )
  }
  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: readInt(env, 'PORT', 3000, 1, 65_535),
    allowedOrigins: parseAllowedOrigins(env.PERSIST_ALLOWED_ORIGINS),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    deepseekApiKey: apiKey.length > 0 ? apiKey : null,
    deepseekBaseUrl,
    deepseekModel: env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
    aiTimeoutMs: readInt(env, 'AI_TIMEOUT_MS', 25_000, 1_000, 120_000),
    aiMaxRetries: readInt(env, 'AI_MAX_RETRIES', 1, 0, 3),
    aiGate: parseAiGateMode(env.PERSIST_AI_GATE),
    aiKeys: parseAiKeys(env.PERSIST_AI_KEYS),
    aiDailyLimit: readInt(env, 'PERSIST_AI_DAILY_LIMIT', 100, 0, 100_000),
    aiDailyTokens: readInt(env, 'PERSIST_AI_DAILY_TOKENS', 200_000, 0, 100_000_000),
    // 默认只允许 1 个账号：个人自用工具，且设备令牌可凭恢复码换机（不占新名额）。
    // 开放注册 + 设备令牌直连 AI 时，每多一个账号就多一份独立日配额，等于把作者
    // 付费的账单按账号数倍增（2026-11-25 安全审查）。需要多账号部署时显式调大。
    registrationMaxAccounts: readInt(env, 'PERSIST_REGISTRATION_MAX_ACCOUNTS', 1, 0, 1_000),
    aiAuditKeepDays: readInt(
      env,
      'PERSIST_AI_AUDIT_KEEP_DAYS',
      DATA_RETENTION.auditLogDays,
      0,
      3_650,
    ),
    auditLogKeepDays: readInt(env, 'PERSIST_AUDIT_KEEP_DAYS', DATA_RETENTION.auditLogDays, 0, 3_650),
    syncRetentionDays: readInt(
      env,
      'PERSIST_SYNC_RETENTION_DAYS',
      DATA_RETENTION.tombstoneDays,
      0,
      3_650,
    ),
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
    // 审计保留期：`off` 表示不清理（不是「不记录」），避免看日志的人误解。
    aiAudit: config.aiAuditKeepDays > 0 ? `${config.aiAuditKeepDays}d` : 'off',
    auditLog: config.auditLogKeepDays > 0 ? `${config.auditLogKeepDays}d` : 'off',
    // 同步留痕保留期：同样 `off` = 不清理。
    syncRetention: config.syncRetentionDays > 0 ? `${config.syncRetentionDays}d` : 'off',
    timeoutMs: config.aiTimeoutMs,
    rateLimit: `${config.rateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s`,
    syncRateLimit: `${config.syncRateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s`,
    analysisRateLimit: `${config.analysisRateLimitMax}/${Math.round(config.rateLimitWindowMs / 1000)}s`,
    corsOrigins: config.allowedOrigins,
    // 注册上限：`off` 表示开放注册（任何人都能建账号），不是「没人能注册」。
    registration:
      config.registrationMaxAccounts > 0 ? `max:${config.registrationMaxAccounts}` : 'off',
    dailyBrief: `${config.dailyBriefEnabled ? 'on' : 'off'}@${config.dailyBriefAt}`,
  }
}
