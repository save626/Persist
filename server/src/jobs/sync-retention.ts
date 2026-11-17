import type { ServerConfig } from '../config.js'
import type { Db } from '../db/driver.js'
import { claimJobRun, finishJobRun } from '../db/repositories/reports.js'
import { localDateKey, localTimeParts } from '../analysis/time.js'
import { pruneSyncOps, pruneTombstones } from '../sync/tombstones.js'

/**
 * 同步留痕保留期清理（P5-1）：墓碑 + `sync_ops`。
 *
 * 与 `ai_audit_prune` 同一套骨架（04:00 之后、`job_runs` 去重、分批删、失败留痕），
 * 差别在清理对象与一道额外的安全判断（见 `tombstones.ts` 里的设备水位）。
 *
 * 取舍：
 * - **和审计清理共用一个时间窗**：两者都是「跑晚了只是多留一天数据」的收敛动作，
 *   在同一个 04:00 tick 里顺序执行（Node 单线程，不会真并发抢锁）。
 * - **`keepDays = 0` 跳过且不占 `job_runs`**：这是「不清理」，不该留下「跑过了」的噪声行。
 * - 日志只记条数与保留天数，不记用户 ID、表名明细到行级。
 */

export const SYNC_RETENTION_JOB = 'sync_retention'
const SCHEDULER_INTERVAL_MS = 60_000
/** 与审计清理同一时间窗；错开 03:00 的 `VACUUM INTO` 快照。 */
export const SYNC_RETENTION_AT_HOUR = 4

export interface SyncRetentionDeps {
  db: Db
  config: Pick<ServerConfig, 'syncRetentionDays'>
  now: () => number
  logger?: {
    info(payload: Record<string, unknown>, message: string): void
    warn(payload: Record<string, unknown>, message: string): void
  }
}

export type SyncRetentionOutcome =
  | { status: 'skipped'; reason: 'disabled' | 'not-due' | 'already-ran' }
  | { status: 'pruned'; tombstones: number; syncOps: number; keepDays: number; cutoff: number }
  | { status: 'failed'; error: string }

export function runSyncRetention(deps: SyncRetentionDeps): SyncRetentionOutcome {
  const keepDays = Math.max(0, Math.trunc(deps.config.syncRetentionDays))
  if (keepDays === 0) return { status: 'skipped', reason: 'disabled' }

  const nowMs = Math.trunc(deps.now())
  if (localTimeParts(nowMs).hour < SYNC_RETENTION_AT_HOUR) {
    return { status: 'skipped', reason: 'not-due' }
  }

  const claim = claimJobRun(deps.db, {
    name: SYNC_RETENTION_JOB,
    runKey: localDateKey(nowMs),
    userId: null,
    startedAt: nowMs,
  })
  if (!claim) return { status: 'skipped', reason: 'already-ran' }

  const cutoff = nowMs - keepDays * 86_400_000
  try {
    const tombstones = pruneTombstones(deps.db, { cutoff })
    const syncOps = pruneSyncOps(deps.db, { cutoff })
    finishJobRun(deps.db, { id: claim.id, status: 'ok', finishedAt: Math.trunc(deps.now()) })
    // 删 0 行也记一条：区分「今天跑过了」与「任务没启动」。
    deps.logger?.info({ tombstones, syncOps, keepDays }, 'sync retention pruned')
    return { status: 'pruned', tombstones, syncOps, keepDays, cutoff }
  } catch (error) {
    const message = error instanceof Error ? error.name : 'unknown_error'
    finishJobRun(deps.db, {
      id: claim.id,
      status: 'failed',
      finishedAt: Math.trunc(deps.now()),
      error: message,
    })
    deps.logger?.warn({ error: message, keepDays }, 'sync retention prune failed')
    return { status: 'failed', error: message }
  }
}

export interface SyncRetentionScheduler {
  stop(): void
}

/** 进程内调度：启动即尝试一次（补跑当天已过 04:00 的情况），之后每 60 s 一次。 */
export function startSyncRetentionScheduler(
  deps: SyncRetentionDeps & { intervalMs?: number },
): SyncRetentionScheduler {
  let running = false
  const tick = () => {
    if (running) return
    running = true
    try {
      runSyncRetention(deps)
    } catch (error) {
      deps.logger?.warn({ err: error }, 'sync retention tick failed')
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
