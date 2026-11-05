import type { AiClient } from '../ai/deepseek.js'
import type { ServerConfig } from '../config.js'
import type { Db } from '../db/driver.js'
import { claimJobRun, finishJobRun, pruneReports } from '../db/repositories/reports.js'
import { AnalysisFailure, generateAnalysisReport } from '../analysis/service.js'
import { localDateKey, localTimeParts, minutesOfDay } from '../analysis/time.js'
import {
  DATA_RETENTION,
  normalizeDailyBriefSettings,
  type DailyBriefSettings,
} from '@persist/shared/contract/analysis'

/**
 * 每日简报任务（步骤 13 / P4 §8.6）。
 *
 * 设计取舍：
 * - 进程内 60 s 定时器（`unref`），不引入队列/依赖；单用户自建场景够用；
 * - 到点（默认 21:00 Asia/Shanghai）才跑，重启后当天到点仍会补跑一次；
 * - 用 job_runs 的 `(name, run_key)` 唯一约束去重，run_key 是本地日期，同一天只生成一次；
 * - 失败的任务允许当天再试：失败的任务由下一个 tick 重新抢锁（见 claimJobRun）。
 * - 模型输出不合规已在 generateAnalysisReport 内部重试一次，这里不再叠一层，
 *   避免同一次简报最多打 4 次模型；两次都不合规才记 failed，等下一个 tick 再试。
 * - 「零记录」不算失败重试风暴——它会记为 failed，但因为没有模型调用，代价可忽略，
 *   等用户当天补了记录，下一个 tick 就能成功生成。
 * - 日志只记范围、报告 id、来源，绝不写报告正文（用户数据不落 journal）。
 */

export const DAILY_BRIEF_JOB = 'daily_brief'
const SCHEDULER_INTERVAL_MS = 60_000

export interface DailyBriefDeps {
  db: Db
  ai: AiClient
  config: Pick<
    ServerConfig,
    | 'deepseekApiKey'
    | 'deepseekModel'
    | 'analysisTimeoutMs'
    | 'analysisMaxTokens'
    | 'dailyBriefEnabled'
    | 'dailyBriefAt'
  >
  now: () => number
  logger?: {
    info(payload: Record<string, unknown>, message: string): void
    warn(payload: Record<string, unknown>, message: string): void
  }
}

export type DailyBriefOutcome =
  | { status: 'skipped'; reason: 'disabled' | 'not-due' | 'no-user' | 'already-ran' }
  | { status: 'generated'; reportId: string; origin: string; cached: boolean }
  | { status: 'failed'; error: string }

function firstUser(db: Db): string | null {
  const row = db
    .prepare<{ id: string }>(
      'SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1',
    )
    .get()
  return row?.id ?? null
}

/**
 * 生效设置 = 同步上来的设置页开关（优先）+ 服务端环境变量兜底。
 * 用户没同步过设置（payload 为空）时按环境变量处理，方便自建部署先跑起来。
 */
export function resolveDailyBriefSettings(
  db: Db,
  userId: string,
  config: Pick<ServerConfig, 'dailyBriefEnabled' | 'dailyBriefAt'>,
): DailyBriefSettings {
  const row = db
    .prepare<{ payload_json: string }>(
      'SELECT payload_json FROM settings WHERE user_id = ? AND deleted_at IS NULL',
    )
    .get(userId)
  let payload: Record<string, unknown> | null = null
  if (row) {
    try {
      const parsed: unknown = JSON.parse(row.payload_json)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>
      }
    } catch {
      payload = null
    }
  }
  if (!payload || payload.dailyBrief === undefined) {
    const env = normalizeDailyBriefSettings({
      enabled: config.dailyBriefEnabled,
      at: config.dailyBriefAt,
    })
    return env
  }
  return normalizeDailyBriefSettings(payload.dailyBrief)
}

export async function runDailyBrief(deps: DailyBriefDeps): Promise<DailyBriefOutcome> {
  const userId = firstUser(deps.db)
  if (!userId) return { status: 'skipped', reason: 'no-user' }

  const settings = resolveDailyBriefSettings(deps.db, userId, deps.config)
  if (!settings.enabled) return { status: 'skipped', reason: 'disabled' }

  const nowMs = deps.now()
  const parts = localTimeParts(nowMs)
  const dueAt = minutesOfDay(settings.at)
  if (dueAt === null || parts.hour * 60 + parts.minute < dueAt) {
    return { status: 'skipped', reason: 'not-due' }
  }

  const runKey = localDateKey(nowMs)
  const claim = claimJobRun(deps.db, {
    name: DAILY_BRIEF_JOB,
    runKey,
    userId,
    startedAt: Math.trunc(nowMs),
  })
  if (!claim) return { status: 'skipped', reason: 'already-ran' }

  let lastError: unknown = null
  try {
    const report = await generateAnalysisReport(
      {
        db: deps.db,
        ai: deps.ai,
        config: deps.config,
        ...(deps.logger ? { logger: deps.logger } : {}),
      },
      { userId, rangeDays: 7, now: nowMs },
    )
    finishJobRun(deps.db, {
      id: claim.id,
      status: 'ok',
      finishedAt: Math.trunc(deps.now()),
      reportId: report.reportId,
    })
    deps.logger?.info(
      {
        reportId: report.reportId,
        origin: report.origin,
        cached: report.cached,
        rangeDays: report.range.days,
        runKey,
      },
      'daily brief generated',
    )
    pruneReports(deps.db, Math.trunc(nowMs) - DATA_RETENTION.reportDays * 86_400_000)
    return {
      status: 'generated',
      reportId: report.reportId,
      origin: report.origin,
      cached: report.cached,
    }
  } catch (error) {
    // 失败原因（含「窗口内零记录」）落 failed 即可；下一次 tick 会重新抢锁。
    lastError = error
  }

  const message =
    lastError instanceof AnalysisFailure
      ? lastError.code
      : lastError instanceof Error
        ? lastError.name
        : 'unknown_error'
  finishJobRun(deps.db, {
    id: claim.id,
    status: 'failed',
    finishedAt: Math.trunc(deps.now()),
    error: message,
  })
  deps.logger?.warn({ error: message, runKey }, 'daily brief failed')
  return { status: 'failed', error: message }
}

export interface DailyBriefScheduler {
  stop(): void
}

/**
 * 启动进程内调度器：立即尝试一次（补跑当天已到点的情况），之后每 60 s 一次。
 * 重入保护：上一次还没跑完时跳过本轮，避免同一用户并发生成。
 */
export function startDailyBriefScheduler(
  deps: DailyBriefDeps & { intervalMs?: number },
): DailyBriefScheduler {
  let running = false
  const tick = () => {
    if (running) return
    running = true
    void runDailyBrief(deps)
      .catch((error: unknown) => {
        deps.logger?.warn({ err: error }, 'daily brief tick failed')
      })
      .finally(() => {
        running = false
      })
  }

  tick()
  const timer = setInterval(tick, deps.intervalMs ?? SCHEDULER_INTERVAL_MS)
  timer.unref()
  // 启动时顺手清一次过期报告：进程长期不生成报告时也能按保留期收敛。
  pruneReports(deps.db, Math.trunc(deps.now()) - DATA_RETENTION.reportDays * 86_400_000)
  return {
    stop() {
      clearInterval(timer)
    },
  }
}
