import type { ParseResult } from './parse.js'

/**
 * 14d 账号删除契约。
 *
 * 删除是不可撤销的破坏性操作，因此请求必须显式带上 `confirm: true`；
 * 缺失、false 或非布尔值都不会触发任何数据库 / 文件删除。
 */
export interface AccountDeleteBody {
  confirm: true
}

export interface AccountDeletionCounts {
  profile: number
  settings: number
  planItems: number
  studyRecords: number
  fitnessSessions: number
  dietEntries: number
  waterLogs: number
  goals: number
  longTermPlans: number
  analysisReports: number
  jobRuns: number
  syncOps: number
  devices: number
  /** 实际删除的规范快照 `.sqlite` 与 `.sha256` 文件总数。 */
  backupFiles: number
}

export interface AccountDeleteResponse {
  deleted: true
  deletedAt: number
  counts: AccountDeletionCounts
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseAccountDeleteBody(raw: unknown): ParseResult<AccountDeleteBody> {
  if (!isRecord(raw)) return { ok: false, message: '请求体必须是 JSON 对象。' }
  if (raw.confirm !== true) {
    return { ok: false, message: '必须显式传入 confirm: true 才能删除账号。' }
  }
  return { ok: true, value: { confirm: true } }
}
