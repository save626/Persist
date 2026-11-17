import type { ServerConfig } from '../config.js'
import type { Db } from '../db/driver.js'
import { claimJobRun, finishJobRun } from '../db/repositories/reports.js'
import { localDateKey, localTimeParts } from '../analysis/time.js'
import { pruneAiCalls } from '../ai/ai-audit.js'

/**
 * `ai_calls` 保留期清理（P0-4）。
 *
 * 为什么需要它：`ai_calls` 是这张库里唯一「只增不减」的表——配额限的是「每天多少次」，
 * 不是「总共多少行」。不清就会一直长，而它的价值随时间衰减：30 天前的调用记录对
 * 「额度被谁吃掉」「这个 key 是不是泄露了」已经没用，只剩隐私负担（里面有 IP 哈希与调用节奏）。
 *
 * 设计取舍：
 * - **按天一次，不按小时**：清理是幂等的收敛动作，跑多了没有收益，只会白占写锁。
 * - **04:00 之后才跑**：备份定时器在 03:00 做 `VACUUM INTO`，两者错开，免得同时抢写锁。
 * - **用 `job_runs` 去重而不是内存变量**：重启后不会当天重复清理，也留下一行可查的执行记录。
 * - **删除分批**（见 `pruneAiCalls`）：避免长事务把并发 AI 请求卡在 `SQLITE_BUSY`。
 * - **`keepDays = 0` 直接跳过且不占 job_runs**：这是「不清理」的意思，不该在 job_runs 里
 *   留下「跑过了但什么都没做」的噪声行。
 * - 日志只记条数与保留天数，不记 keyId / IP / 路由明细。
 */

export const AI_AUDIT_PRUNE_JOB = 'ai_audit_prune'
const SCHEDULER_INTERVAL_MS = 60_000
/** 本地时间几点之后允许跑；错开 03:00 的库快照。 */
export const AI_AUDIT_PRUNE_AT_HOUR = 4

export interface AiAuditPruneDeps {
  db: Db
  config: Pick<ServerConfig, 'aiAuditKeepDays'>
  now: () => number
  logger?: {
    info(payload: Record<string, unknown>, message: string): void
    warn(payload: Record<string, unknown>, message: string): void
  }
}

export type AiAuditPruneOutcome =
  | { status: 'skipped'; reason: 'disabled' | 'not-due' | 'already-ran' }
  | { status: 'pruned'; deleted: number; keepDays: number; cutoff: number }
  | { status: 'failed'; error: string }

/**
 * 跑一次清理。同步执行：单次最多几千行的删除，不值得为它铺一层异步。
 */
export function runAiAuditPrune(deps: AiAuditPruneDeps): AiAuditPruneOutcome {
  const keepDays = Math.max(0, Math.trunc(deps.config.aiAuditKeepDays))
  if (keepDays === 0) return { status: 'skipped', reason: 'disabled' }

  const nowMs = Math.trunc(deps.now())
  const parts = localTimeParts(nowMs)
  if (parts.hour < AI_AUDIT_PRUNE_AT_HOUR) return { status: 'skipped', reason: 'not-due' }

  const claim = claimJobRun(deps.db, {
    name: AI_AUDIT_PRUNE_JOB,
    runKey: localDateKey(nowMs),
    userId: null,
    startedAt: nowMs,
  })
  if (!claim) return { status: 'skipped', reason: 'already-ran' }

  const cutoff = nowMs - keepDays * 86_400_000
  try {
    const deleted = pruneAiCalls(deps.db, cutoff)
    finishJobRun(deps.db, {
      id: claim.id,
      status: 'ok',
      finishedAt: Math.trunc(deps.now()),
    })
    // 即使删 0 行也记一条：这证明「今天跑过了」，与「任务没启动」是两件事。
    deps.logger?.info({ deleted, keepDays }, 'ai audit pruned')
    return { status: 'pruned', deleted, keepDays, cutoff }
  } catch (error) {
    const message = error instanceof Error ? error.name : 'unknown_error'
    finishJobRun(deps.db, {
      id: claim.id,
      status: 'failed',
      finishedAt: Math.trunc(deps.now()),
      error: message,
    })
    // 失败会让下一个 tick 重新抢锁（claimJobRun 允许 failed 当天重跑一次）。
    deps.logger?.warn({ error: message, keepDays }, 'ai audit prune failed')
    return { status: 'failed', error: message }
  }
}

export interface AiAuditPruneScheduler {
  stop(): void
}

/**
 * 进程内调度器：启动后立即尝试一次（补跑当天已过 04:00 的情况），之后每 60 s 一次。
 * 重入保护同 daily-brief：上一轮没跑完就跳过本轮。
 */
export function startAiAuditPruneScheduler(
  deps: AiAuditPruneDeps & { intervalMs?: number },
): AiAuditPruneScheduler {
  let running = false
  const tick = () => {
    if (running) return
    running = true
    try {
      runAiAuditPrune(deps)
    } catch (error) {
      // runAiAuditPrune 内部已兜住删除与 job_runs 的异常；这里只防「连日志都抛」的意外。
      deps.logger?.warn({ err: error }, 'ai audit prune tick failed')
    } finally {
      running = false
    }
  }

  tick()
  const timer = setInterval(tick, deps.intervalMs ?? SCHEDULER_INTERVAL_MS)
  timer.unref()
  return {
    stop() {
      clearInterval(timer)
    },
  }
}
