import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/db/driver.js'
import type { Db } from '../src/db/driver.js'
import { migrate } from '../src/db/migrations.js'
import {
  claimJobRun,
  decodeReportCursor,
  deleteCachedReport,
  encodeReportCursor,
  findCachedReport,
  findJobRun,
  finishJobRun,
  getReport,
  insertReport,
  listReports,
  pruneReports,
} from '../src/db/repositories/reports.js'
import type { CreateReportInput } from '../src/db/repositories/reports.js'
import type { AnalysisMetric, ReportFactsV2 } from '@persist/shared/contract/analysis'
import { NOW, USER, seedRecords, seedUser, validContent } from './helpers/analysis-fixtures.js'
import { buildAnalysisFacts } from '../src/analysis/facts.js'

/**
 * 报告归档仓库测试：缓存键、列表游标、保留期清理、每日简报任务台账。
 */

const METRICS: AnalysisMetric[] = [
  { label: '记录覆盖', value: '1/7 天', detail: '窗口内有记录的天数' },
]

function makeDb(): Db {
  const db = openDatabase({ path: ':memory:' })
  migrate(db)
  seedUser(db)
  seedRecords(db, USER)
  return db
}

function facts(db: Db, rangeDays: 7 | 30 | 90 = 7): ReportFactsV2 {
  return buildAnalysisFacts(db, USER, { rangeDays, now: NOW })
}

function reportInput(db: Db, overrides: Partial<CreateReportInput> = {}): CreateReportInput {
  const built = facts(db, 7)
  return {
    userId: USER,
    type: '综合分析',
    rangeDays: 7,
    dataRev: built.dataRev,
    origin: 'ai',
    model: 'deepseek-chat',
    start: built.range.start,
    end: built.range.end,
    content: validContent(),
    metrics: METRICS,
    facts: built,
    createdAt: NOW - 1_000,
    ...overrides,
  }
}

describe('analysis_reports：缓存键与读写', () => {
  it('同一 dataRev 命中缓存，换了数据版本就未命中', () => {
    const db = makeDb()
    try {
      const input = reportInput(db)
      const inserted = insertReport(db, input)
      expect(inserted.id).toBeTruthy()
      expect(inserted.title).toBe(validContent().title)
      expect(inserted.status).toBe(validContent().status)

      const hit = findCachedReport(db, {
        userId: USER,
        type: '综合分析',
        rangeDays: 7,
        dataRev: input.dataRev,
      })
      expect(hit).toMatchObject({
        id: inserted.id,
        origin: 'ai',
        model: 'deepseek-chat',
        title: validContent().title,
      })
      expect(hit?.content).toEqual(validContent())
      expect(hit?.facts.version).toBe(2)

      expect(
        findCachedReport(db, {
          userId: USER,
          type: '综合分析',
          rangeDays: 7,
          dataRev: input.dataRev + 1,
        }),
      ).toBeNull()
      // 窗口长度不同不能共用缓存。
      expect(
        findCachedReport(db, {
          userId: USER,
          type: '综合分析',
          rangeDays: 30,
          dataRev: input.dataRev,
        }),
      ).toBeNull()
    } finally {
      db.close()
    }
  })

  it('唯一索引挡住同键重复写入；force 先删旧行才允许覆盖', () => {
    const db = makeDb()
    try {
      const input = reportInput(db)
      insertReport(db, input)
      expect(() => insertReport(db, input)).toThrow(/UNIQUE|constraint/i)

      deleteCachedReport(db, {
        userId: USER,
        type: '综合分析',
        rangeDays: 7,
        dataRev: input.dataRev,
      })
      expect(
        findCachedReport(db, {
          userId: USER,
          type: '综合分析',
          rangeDays: 7,
          dataRev: input.dataRev,
        }),
      ).toBeNull()
      expect(() => insertReport(db, input)).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('getReport 按用户隔离：别人的报告拿不到', () => {
    const db = makeDb()
    try {
      db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('usr_other', 1)
      const inserted = insertReport(db, reportInput(db))
      expect(getReport(db, USER, inserted.id)?.id).toBe(inserted.id)
      expect(getReport(db, 'usr_other', inserted.id)).toBeNull()
      expect(getReport(db, USER, 'missing')).toBeNull()
    } finally {
      db.close()
    }
  })
})

describe('analysis_reports：列表与游标', () => {
  function seedThree(db: Db): string[] {
    const ids: string[] = []
    const base = reportInput(db)
    for (const [index, createdAt] of [NOW - 3_000, NOW - 2_000, NOW - 1_000].entries()) {
      ids.push(insertReport(db, { ...base, createdAt, dataRev: base.dataRev + index }).id)
    }
    return ids
  }

  it('默认按创建时间倒序，游标翻页不重不漏', () => {
    const db = makeDb()
    try {
      const ids = seedThree(db)
      const first = listReports(db, USER, { limit: 2 })
      expect(first.reports.map((report) => report.id)).toEqual([ids[2], ids[1]])
      expect(first.nextCursor).toBe(encodeReportCursor({ createdAt: NOW - 2_000, id: ids[1]! }))

      const second = listReports(db, USER, { limit: 2, cursor: first.nextCursor })
      expect(second.reports.map((report) => report.id)).toEqual([ids[0]])
      expect(second.nextCursor).toBeNull()

      const listed = first.reports[0]!
      expect(listed.type).toBe('综合分析')
      expect(listed.rangeDays).toBe(7)
      expect(listed.start).toBe('2026-10-30')
      expect(listed.end).toBe('2026-11-05')
      // 列表项不带正文与事实包，只有详情接口才返回。
      expect(listed).not.toHaveProperty('content')
    } finally {
      db.close()
    }
  })

  it('列表只返回当前用户的报告，limit 被夹到 1–50', () => {
    const db = makeDb()
    try {
      db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('usr_other', 1)
      seedThree(db)
      insertReport(db, { ...reportInput(db), userId: 'usr_other', dataRev: 999 })
      expect(listReports(db, USER, { limit: 50 }).reports).toHaveLength(3)
      expect(listReports(db, USER, { limit: 0 }).reports).toHaveLength(1)
      expect(listReports(db, USER, { limit: 999 }).reports).toHaveLength(3)
    } finally {
      db.close()
    }
  })

  it('游标解析：非法值返回 null，不抛错', () => {
    expect(decodeReportCursor(null)).toBeNull()
    expect(decodeReportCursor('')).toBeNull()
    expect(decodeReportCursor('abc')).toBeNull()
    expect(decodeReportCursor(':id')).toBeNull()
    expect(decodeReportCursor('-1:id')).toBeNull()
    expect(decodeReportCursor('1700000000000:')).toBeNull()
    expect(decodeReportCursor('1700000000000:id_1')).toEqual({
      createdAt: 1_700_000_000_000,
      id: 'id_1',
    })
  })
})

describe('analysis_reports：保留期清理', () => {
  it('只删掉早于 cutoff 的报告，返回删除条数', () => {
    const db = makeDb()
    try {
      const input = reportInput(db)
      insertReport(db, { ...input, createdAt: NOW - 400 * 24 * 3600_000, dataRev: 1 })
      insertReport(db, { ...input, createdAt: NOW - 10 * 24 * 3600_000, dataRev: 2 })
      const cutoff = NOW - 365 * 24 * 3600_000
      expect(pruneReports(db, cutoff)).toBe(1)
      expect(listReports(db, USER).reports).toHaveLength(1)
      expect(pruneReports(db, cutoff)).toBe(0)
    } finally {
      db.close()
    }
  })
})

describe('job_runs：每日简报任务台账', () => {
  it('claim 抢占：第一次成功，running/ok 时让出，failed 允许当天重跑', () => {
    const db = makeDb()
    try {
      const first = claimJobRun(db, {
        name: 'daily_brief',
        runKey: '2026-11-05',
        userId: USER,
        startedAt: NOW,
      })
      expect(first).toMatchObject({ status: 'running', runKey: '2026-11-05' })
      expect(
        claimJobRun(db, {
          name: 'daily_brief',
          runKey: '2026-11-05',
          userId: USER,
          startedAt: NOW + 1,
        }),
      ).toBeNull()

      finishJobRun(db, {
        id: first!.id,
        status: 'ok',
        finishedAt: NOW + 2_000,
        reportId: 'rpt_1',
      })
      const done = findJobRun(db, 'daily_brief', '2026-11-05')
      expect(done).toMatchObject({ status: 'ok', reportId: 'rpt_1', finishedAt: NOW + 2_000 })
      expect(
        claimJobRun(db, {
          name: 'daily_brief',
          runKey: '2026-11-05',
          userId: USER,
          startedAt: NOW + 3,
        }),
      ).toBeNull()

      // 换一个日期则互不影响。
      expect(
        claimJobRun(db, {
          name: 'daily_brief',
          runKey: '2026-11-06',
          userId: USER,
          startedAt: NOW,
        }),
      ).toMatchObject({ status: 'running' })
    } finally {
      db.close()
    }
  })

  it('failed 的行可以被同一 runKey 重新抢占，并清空失败信息', () => {
    const db = makeDb()
    try {
      const claimed = claimJobRun(db, {
        name: 'daily_brief',
        runKey: '2026-11-05',
        userId: USER,
        startedAt: NOW,
      })!
      finishJobRun(db, { id: claimed.id, status: 'failed', finishedAt: NOW + 1, error: 'upstream' })
      const retry = claimJobRun(db, {
        name: 'daily_brief',
        runKey: '2026-11-05',
        userId: USER,
        startedAt: NOW + 2,
      })
      expect(retry).toMatchObject({
        id: claimed.id,
        status: 'running',
        finishedAt: null,
        error: null,
      })
      expect(findJobRun(db, 'daily_brief', '2026-11-05')?.status).toBe('running')
      expect(
        claimJobRun(db, {
          name: 'daily_brief',
          runKey: '2026-11-05',
          userId: USER,
          startedAt: NOW + 3,
        }),
      ).toBeNull()
    } finally {
      db.close()
    }
  })

  it('findJobRun 未登记时返回 null', () => {
    const db = makeDb()
    try {
      expect(findJobRun(db, 'daily_brief', '2026-01-01')).toBeNull()
    } finally {
      db.close()
    }
  })
})
