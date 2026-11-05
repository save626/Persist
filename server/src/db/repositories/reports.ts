import { randomUUID } from 'node:crypto'
import type { Db } from '../driver.js'
import type {
  AnalysisMetric,
  AnalysisOrigin,
  AnalysisReportDetail,
  AnalysisReportListItem,
  ReportContentV2,
  ReportFactsV2,
} from '@persist/shared/contract/analysis'

/**
 * 分析报告归档与每日简报任务台账的读写（步骤 13）。
 *
 * 报告整份入库：content（模型写的文字）、metrics（服务端算的指标）、facts（聚合事实包）。
 * 存 facts 的目的是可回溯——验收时能核对「报告里的数字就是当时 SQL 聚合出来的数字」。
 * 缓存键 (user_id, type, range_days, data_rev) 保证同一份数据只花一次模型额度。
 */

export interface StoredReport {
  id: string
  type: string
  rangeDays: number
  dataRev: number
  origin: AnalysisOrigin
  model: string | null
  start: string
  end: string
  title: string
  status: string
  content: ReportContentV2
  metrics: AnalysisMetric[]
  facts: ReportFactsV2
  createdAt: number
}

export interface CreateReportInput {
  userId: string
  type: string
  rangeDays: number
  dataRev: number
  origin: AnalysisOrigin
  model: string | null
  start: string
  end: string
  content: ReportContentV2
  metrics: AnalysisMetric[]
  facts: ReportFactsV2
  createdAt: number
}

interface ReportRow {
  id: string
  type: string
  range_days: number
  data_rev: number
  origin: string
  model: string | null
  start_date: string
  end_date: string
  title: string
  status: string
  content_json: string
  metrics_json: string
  facts_json: string
  created_at: number
}

const REPORT_COLUMNS = `id, type, range_days, data_rev, origin, model, start_date, end_date,
  title, status, content_json, metrics_json, facts_json, created_at`

/** 写入时带上 user_id（查询列清单里不需要，因为查询都按 user_id 过滤）。 */
const INSERT_COLUMNS = `user_id, ${REPORT_COLUMNS}`

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function toStoredReport(row: ReportRow): StoredReport | null {
  const content = parseJson<ReportContentV2>(row.content_json)
  const metrics = parseJson<AnalysisMetric[]>(row.metrics_json)
  const facts = parseJson<ReportFactsV2>(row.facts_json)
  if (!content || !metrics || !facts) return null
  return {
    id: row.id,
    type: row.type,
    rangeDays: Number(row.range_days),
    dataRev: Number(row.data_rev),
    origin: row.origin === 'ai' ? 'ai' : 'rules',
    model: row.model,
    start: row.start_date,
    end: row.end_date,
    title: row.title,
    status: row.status,
    content,
    metrics,
    facts,
    createdAt: Number(row.created_at),
  }
}

export function insertReport(db: Db, input: CreateReportInput): StoredReport {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO analysis_reports (${INSERT_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.userId,
    id,
    input.type,
    input.rangeDays,
    input.dataRev,
    input.origin,
    input.model,
    input.start,
    input.end,
    input.content.title,
    input.content.status,
    JSON.stringify(input.content),
    JSON.stringify(input.metrics),
    JSON.stringify(input.facts),
    input.createdAt,
  )
  return {
    id,
    type: input.type,
    rangeDays: input.rangeDays,
    dataRev: input.dataRev,
    origin: input.origin,
    model: input.model,
    start: input.start,
    end: input.end,
    title: input.content.title,
    status: input.content.status,
    content: input.content,
    metrics: input.metrics,
    facts: input.facts,
    createdAt: input.createdAt,
  }
}

export function findCachedReport(
  db: Db,
  options: { userId: string; type: string; rangeDays: number; dataRev: number },
): StoredReport | null {
  const row = db
    .prepare<ReportRow>(
      `SELECT ${REPORT_COLUMNS} FROM analysis_reports
       WHERE user_id = ? AND type = ? AND range_days = ? AND data_rev = ?`,
    )
    .get(options.userId, options.type, options.rangeDays, options.dataRev)
  if (!row) return null
  return toStoredReport(row)
}

/** force 重新生成时先删旧缓存行；不删的话唯一索引会把新报告挡掉。 */
export function deleteCachedReport(
  db: Db,
  options: { userId: string; type: string; rangeDays: number; dataRev: number },
): void {
  db.prepare(
    `DELETE FROM analysis_reports
     WHERE user_id = ? AND type = ? AND range_days = ? AND data_rev = ?`,
  ).run(options.userId, options.type, options.rangeDays, options.dataRev)
}

export function getReport(db: Db, userId: string, id: string): StoredReport | null {
  const row = db
    .prepare<ReportRow>(
      `SELECT ${REPORT_COLUMNS} FROM analysis_reports WHERE user_id = ? AND id = ?`,
    )
    .get(userId, id)
  if (!row) return null
  return toStoredReport(row)
}

export interface ListReportsOptions {
  limit?: number
  /** 上一页最后一条的游标（`createdAt:id`）；不传表示第一页。 */
  cursor?: string | null
}

export interface ListReportsResult {
  reports: AnalysisReportListItem[]
  nextCursor: string | null
}

const DEFAULT_LIST_LIMIT = 10
const MAX_LIST_LIMIT = 50

export function encodeReportCursor(report: { createdAt: number; id: string }): string {
  return `${report.createdAt}:${report.id}`
}

export function decodeReportCursor(
  raw: string | null | undefined,
): { createdAt: number; id: string } | null {
  if (!raw) return null
  const separator = raw.lastIndexOf(':')
  if (separator <= 0) return null
  const createdAt = Number.parseInt(raw.slice(0, separator), 10)
  const id = raw.slice(separator + 1)
  if (!Number.isFinite(createdAt) || createdAt < 0 || id.length === 0) return null
  return { createdAt, id }
}

export function listReports(
  db: Db,
  userId: string,
  options: ListReportsOptions = {},
): ListReportsResult {
  const limit = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIST_LIMIT)),
  )
  const cursor = decodeReportCursor(options.cursor)
  const rows = cursor
    ? db
        .prepare<ReportRow>(
          `SELECT ${REPORT_COLUMNS} FROM analysis_reports
           WHERE user_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(userId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
    : db
        .prepare<ReportRow>(
          `SELECT ${REPORT_COLUMNS} FROM analysis_reports
           WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .all(userId, limit + 1)

  const page = rows.slice(0, limit)
  const reports = page
    .map((row) => toStoredReport(row))
    .filter((report): report is StoredReport => report !== null)
    .map((report) => toListItem(report))
  const last = reports[reports.length - 1]
  return {
    reports,
    nextCursor: rows.length > limit && last ? encodeReportCursor(last) : null,
  }
}

export function toListItem(report: StoredReport): AnalysisReportListItem {
  return {
    id: report.id,
    type: report.type,
    rangeDays: report.rangeDays,
    origin: report.origin,
    model: report.model,
    start: report.start,
    end: report.end,
    dataRev: report.dataRev,
    createdAt: report.createdAt,
    title: report.title,
    status: report.status,
  }
}

export function toDetail(report: StoredReport): AnalysisReportDetail {
  return { ...toListItem(report), content: report.content, metrics: report.metrics }
}

/**
 * 保留期清理：删除 created_at 早于 cutoff 的报告。
 * 返回删除条数（调用方只记日志，不把报告内容写进日志）。
 */
export function pruneReports(db: Db, cutoff: number): number {
  const result = db.prepare('DELETE FROM analysis_reports WHERE created_at < ?').run(cutoff)
  return Number(result.changes)
}

export interface JobRunRecord {
  id: string
  name: string
  runKey: string
  status: string
  userId: string | null
  reportId: string | null
  startedAt: number
  finishedAt: number | null
  error: string | null
}

interface JobRunRow {
  id: string
  name: string
  run_key: string
  status: string
  user_id: string | null
  report_id: string | null
  started_at: number
  finished_at: number | null
  error: string | null
}

function toJobRun(row: JobRunRow): JobRunRecord {
  return {
    id: row.id,
    name: row.name,
    runKey: row.run_key,
    status: row.status,
    userId: row.user_id,
    reportId: row.report_id,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    error: row.error,
  }
}

export function findJobRun(db: Db, name: string, runKey: string): JobRunRecord | null {
  const row = db
    .prepare<JobRunRow>(
      `SELECT id, name, run_key, status, user_id, report_id, started_at, finished_at, error
       FROM job_runs WHERE name = ? AND run_key = ?`,
    )
    .get(name, runKey)
  return row ? toJobRun(row) : null
}

/**
 * 抢占式登记一次任务：`INSERT OR IGNORE` + changes 判断是否抢到。
 * 多进程/重启后重复触发时只有第一个能拿到，避免同一天重复花模型额度。
 */
export function claimJobRun(
  db: Db,
  input: { name: string; runKey: string; userId: string | null; startedAt: number },
): JobRunRecord | null {
  const id = randomUUID()
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO job_runs (id, name, run_key, status, user_id, started_at)
       VALUES (?, ?, ?, 'running', ?, ?)`,
    )
    .run(id, input.name, input.runKey, input.userId, input.startedAt)
  if (Number(result.changes) === 0) {
    // 上一次失败的任务允许当天重跑一次；已经 ok / 正在跑的都直接让出。
    const existing = findJobRun(db, input.name, input.runKey)
    if (existing?.status !== 'failed') return null
    db.prepare(
      `UPDATE job_runs SET status = 'running', started_at = ?, finished_at = NULL, error = NULL
       WHERE id = ?`,
    ).run(input.startedAt, existing.id)
    return {
      ...existing,
      status: 'running',
      startedAt: input.startedAt,
      finishedAt: null,
      error: null,
    }
  }
  return {
    id,
    name: input.name,
    runKey: input.runKey,
    status: 'running',
    userId: input.userId,
    reportId: null,
    startedAt: input.startedAt,
    finishedAt: null,
    error: null,
  }
}

export function finishJobRun(
  db: Db,
  options: {
    id: string
    status: 'ok' | 'failed'
    finishedAt: number
    reportId?: string | null
    error?: string | null
  },
): void {
  db.prepare(
    `UPDATE job_runs SET status = ?, finished_at = ?, report_id = ?, error = ? WHERE id = ?`,
  ).run(
    options.status,
    options.finishedAt,
    options.reportId ?? null,
    options.error ?? null,
    options.id,
  )
}
