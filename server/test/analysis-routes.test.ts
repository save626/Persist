import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { AiError } from '../src/ai/deepseek.js'
import { loadConfig } from '../src/config.js'
import type { PersistDatabase } from '../src/db/index.js'
import { openPersistDatabase } from '../src/db/index.js'
import { upsertEntity } from '../src/db/repositories/entities.js'
import type {
  AnalysisReportResponse,
  AnalysisReportsListResponse,
} from '@persist/shared/contract/analysis'
import {
  NOW,
  YESTERDAY,
  contentJson,
  fakeAi,
  seedProfile,
  seedRecords,
  validContent,
} from './helpers/analysis-fixtures.js'
import type { FakeAi } from './helpers/analysis-fixtures.js'

/**
 * 综合分析 HTTP 层测试（P4 §8.5 / §10.6）。
 *
 * 一条接口上要覆盖的语义：
 * 401 未登录、422 参数错误、403 未授权、409 零记录、200 + origin ai、
 * 200 + origin rules（无 Key / 超时）、502 契约违规、缓存命中、force 重生成、
 * 数据变化换缓存键、429 单独限流，以及归档列表/详情。
 */

interface Env {
  app: FastifyInstance
  db: PersistDatabase
  ai: FakeAi
  token: string
  userId: string
}

interface SetupOptions {
  env?: Record<string, string>
  replies?: Array<string | Error>
  /** 默认写入一套当天记录；false 表示空窗口。 */
  seed?: boolean
}

async function setup(options: SetupOptions = {}): Promise<Env> {
  const config = loadConfig({
    DEEPSEEK_API_KEY: 'test-key',
    ANALYSIS_RATE_LIMIT_MAX: '120',
    ...options.env,
  } as unknown as NodeJS.ProcessEnv)
  const db = openPersistDatabase({ path: ':memory:' })
  const ai = fakeAi(options.replies ?? [contentJson()])
  const app = buildApp({ config, db, ai, now: () => NOW })
  const registered = await app.inject({ method: 'POST', url: '/api/v1/devices', payload: {} })
  expect(registered.statusCode).toBe(201)
  const account = registered.json<{ userId: string; token: string }>()
  if (options.seed !== false) seedRecords(db.db, account.userId)
  return { app, db, ai, token: account.token, userId: account.userId }
}

async function close(env: Env): Promise<void> {
  await env.app.close()
  env.db.db.close()
}

function postAnalysis(env: Env, payload: Record<string, unknown> = { rangeDays: 7 }) {
  return env.app.inject({
    method: 'POST',
    url: '/api/v1/analysis/reports',
    headers: { authorization: `Bearer ${env.token}` },
    payload,
  })
}

function authHeader(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('POST /api/v1/analysis/reports：鉴权与参数', () => {
  it('缺少令牌返回 401，不触碰模型', async () => {
    const env = await setup()
    try {
      const response = await env.app.inject({
        method: 'POST',
        url: '/api/v1/analysis/reports',
        payload: { rangeDays: 7 },
      })
      expect(response.statusCode).toBe(401)
      expect(response.json()).toMatchObject({ error: { code: 'unauthorized' } })
      expect(env.ai.calls).toBe(0)
    } finally {
      await close(env)
    }
  })

  it('rangeDays 不是 7/30/90 返回 422', async () => {
    const env = await setup()
    try {
      const response = await postAnalysis(env, { rangeDays: 15 })
      expect(response.statusCode).toBe(422)
      expect(response.json()).toMatchObject({ error: { code: 'invalid_request' } })
      expect(response.headers['cache-control']).toBe('no-store')
      expect(env.ai.calls).toBe(0)
    } finally {
      await close(env)
    }
  })

  it('请求体不是对象返回 422', async () => {
    const env = await setup()
    try {
      const response = await env.app.inject({
        method: 'POST',
        url: '/api/v1/analysis/reports',
        headers: authHeader(env.token),
        payload: [] as unknown as Record<string, unknown>,
      })
      expect(response.statusCode).toBe(422)
      expect(env.ai.calls).toBe(0)
    } finally {
      await close(env)
    }
  })
})

describe('POST /api/v1/analysis/reports：授权与数据量', () => {
  it('零记录窗口返回 409，提示先记录而不是让模型编', async () => {
    const env = await setup({ seed: false })
    try {
      const response = await postAnalysis(env)
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: { code: 'insufficient_data' } })
      expect(env.ai.calls).toBe(0)
    } finally {
      await close(env)
    }
  })

  it('档案页 AI 总开关关闭：生成与事实包接口都返回 403', async () => {
    const env = await setup()
    try {
      seedProfile(
        env.db.db,
        env.userId,
        {
          aiConsent: false,
          age: 30,
          height: 175,
          weight: 70,
          targetWeight: 65,
          goal: '减脂',
          experience: 'beginner',
          frequency: '3 次/周',
        },
        5_000,
      )
      const generated = await postAnalysis(env)
      expect(generated.statusCode).toBe(403)
      expect(generated.json()).toMatchObject({ error: { code: 'ai_consent_off' } })

      const facts = await env.app.inject({
        method: 'GET',
        url: '/api/v1/analysis/facts',
        headers: authHeader(env.token),
      })
      expect(facts.statusCode).toBe(403)
      expect(env.ai.calls).toBe(0)
    } finally {
      await close(env)
    }
  })

  it('GET /api/v1/analysis/facts：默认 30 天，非法窗口 422，返回服务端聚合', async () => {
    const env = await setup()
    try {
      const ok = await env.app.inject({
        method: 'GET',
        url: '/api/v1/analysis/facts',
        headers: authHeader(env.token),
      })
      expect(ok.statusCode).toBe(200)
      const body = ok.json<{
        facts: { version: number; range: { days: number }; dataRev: number }
      }>()
      expect(body.facts.version).toBe(2)
      expect(body.facts.range.days).toBe(30)
      expect(body.facts.dataRev).toBeGreaterThan(0)

      const explicit = await env.app.inject({
        method: 'GET',
        url: '/api/v1/analysis/facts?rangeDays=90',
        headers: authHeader(env.token),
      })
      expect(explicit.statusCode).toBe(200)
      expect(
        explicit.json<{ facts: { granularity: string; days: unknown[] } }>().facts.granularity,
      ).toBe('week')

      const bad = await env.app.inject({
        method: 'GET',
        url: '/api/v1/analysis/facts?rangeDays=15',
        headers: authHeader(env.token),
      })
      expect(bad.statusCode).toBe(422)
    } finally {
      await close(env)
    }
  })
})

describe('POST /api/v1/analysis/reports：生成、缓存与 force', () => {
  it('AI 生成成功；同 dataRev 第二次直接命中缓存，不再调模型', async () => {
    const env = await setup()
    try {
      const first = await postAnalysis(env)
      expect(first.statusCode).toBe(200)
      expect(first.headers['cache-control']).toBe('no-store')
      const created = first.json<AnalysisReportResponse>()
      expect(created).toMatchObject({
        cached: false,
        origin: 'ai',
        model: 'deepseek-chat',
        range: { start: '2026-10-30', end: '2026-11-05', days: 7 },
      })
      expect(created.content).toEqual(validContent())
      expect(created.metrics.length).toBeGreaterThan(0)
      expect(created.dataRev).toBeGreaterThan(0)
      expect(created.reportId).toBeTruthy()
      expect(env.ai.calls).toBe(1)

      const second = await postAnalysis(env)
      const cached = second.json<AnalysisReportResponse>()
      expect(second.statusCode).toBe(200)
      expect(cached.cached).toBe(true)
      expect(cached.reportId).toBe(created.reportId)
      expect(env.ai.calls).toBe(1)
    } finally {
      await close(env)
    }
  })

  it('force: true 覆盖同一缓存键，重新生成但不留重复行', async () => {
    const env = await setup()
    try {
      const first = (await postAnalysis(env)).json<AnalysisReportResponse>()
      const forced = await postAnalysis(env, { rangeDays: 7, force: true })
      expect(forced.statusCode).toBe(200)
      const regenerated = forced.json<AnalysisReportResponse>()
      expect(regenerated.cached).toBe(false)
      expect(regenerated.reportId).not.toBe(first.reportId)
      expect(env.ai.calls).toBe(2)

      const listed = await env.app.inject({
        method: 'GET',
        url: '/api/v1/reports',
        headers: authHeader(env.token),
      })
      expect(listed.json<AnalysisReportsListResponse>().reports).toHaveLength(1)
    } finally {
      await close(env)
    }
  })

  it('新增记录后 dataRev 变化：缓存未命中并生成新报告', async () => {
    const env = await setup()
    try {
      const first = (await postAnalysis(env)).json<AnalysisReportResponse>()
      upsertEntity(env.db.db, env.userId, {
        kind: 'fitness_session',
        id: 'fit_extra',
        updatedAt: 9_000,
        data: {
          id: 'fit_extra',
          date: YESTERDAY,
          status: 'completed',
          exercises: [
            { id: 'ex_1', name: '卧推', sets: [{ id: 's_1', weight: 50, reps: 8, done: true }] },
          ],
        },
      })
      const second = (await postAnalysis(env)).json<AnalysisReportResponse>()
      expect(second.cached).toBe(false)
      expect(second.dataRev).toBeGreaterThan(first.dataRev)
      expect(second.reportId).not.toBe(first.reportId)
      expect(env.ai.calls).toBe(2)
    } finally {
      await close(env)
    }
  })
})

describe('POST /api/v1/analysis/reports：降级与契约违规', () => {
  it('未配置 API Key：200 + origin rules，带未配置提示，不调模型', async () => {
    const env = await setup({ env: { DEEPSEEK_API_KEY: '' } })
    try {
      const response = await postAnalysis(env)
      expect(response.statusCode).toBe(200)
      const report = response.json<AnalysisReportResponse>()
      expect(report.origin).toBe('rules')
      expect(report.model).toBeNull()
      expect(report.content.warnings.join('')).toContain('未配置 AI')
      expect(report.content.analysis.length).toBeGreaterThanOrEqual(2)
      expect(env.ai.calls).toBe(0)
    } finally {
      await close(env)
    }
  })

  it('模型超时：200 + origin rules 降级，不是 502', async () => {
    const env = await setup({ replies: [new AiError('timeout', '模型超时了')] })
    try {
      const response = await postAnalysis(env)
      expect(response.statusCode).toBe(200)
      const report = response.json<AnalysisReportResponse>()
      expect(report.origin).toBe('rules')
      expect(report.content.warnings.join('')).toContain('规则模板')
      expect(env.ai.calls).toBe(1)
    } finally {
      await close(env)
    }
  })

  it('模型首次写了事实包以外的数字、重试后合规：200 + origin ai，不落半份报告', async () => {
    const env = await setup({
      replies: [
        contentJson({ ...validContent(), summary: `${validContent().summary} 折合 1234 千卡。` }),
        contentJson(),
      ],
    })
    try {
      const response = await postAnalysis(env)
      expect(response.statusCode).toBe(200)
      const report = response.json<AnalysisReportResponse>()
      expect(report.origin).toBe('ai')
      expect(report.model).toBe('deepseek-chat')
      expect(report.cached).toBe(false)
      // 第一次被判不合规，第二次带纠正说明重试成功。
      expect(env.ai.calls).toBe(2)

      const listed = await env.app.inject({
        method: 'GET',
        url: '/api/v1/reports',
        headers: authHeader(env.token),
      })
      expect(listed.json<AnalysisReportsListResponse>().reports).toHaveLength(1)
    } finally {
      await close(env)
    }
  })

  it('两次都不合规：502 invalid_response，且不落库', async () => {
    const env = await setup({
      replies: [
        contentJson({ ...validContent(), summary: `${validContent().summary} 折合 1234 千卡。` }),
        contentJson({ ...validContent(), summary: `${validContent().summary} 折合 5678 千卡。` }),
      ],
    })
    try {
      const rejected = await postAnalysis(env)
      expect(rejected.statusCode).toBe(502)
      expect(rejected.json()).toMatchObject({ error: { code: 'invalid_response' } })
      expect(rejected.headers['cache-control']).toBe('no-store')
      expect(env.ai.calls).toBe(2)

      const listed = await env.app.inject({
        method: 'GET',
        url: '/api/v1/reports',
        headers: authHeader(env.token),
      })
      expect(listed.json<AnalysisReportsListResponse>().reports).toEqual([])
    } finally {
      await close(env)
    }
  })
})

describe('GET /api/v1/reports：归档列表与详情', () => {
  it('列表分页、limit/cursor 校验、详情与 404', async () => {
    const env = await setup()
    try {
      const report = (await postAnalysis(env)).json<AnalysisReportResponse>()

      const first = await env.app.inject({
        method: 'GET',
        url: '/api/v1/reports?limit=1',
        headers: authHeader(env.token),
      })
      expect(first.statusCode).toBe(200)
      const page = first.json<AnalysisReportsListResponse>()
      expect(page.reports).toHaveLength(1)
      expect(page.reports[0]).toMatchObject({
        id: report.reportId,
        type: '综合分析',
        rangeDays: 7,
        origin: 'ai',
      })
      expect(page.nextCursor).toBeNull()

      const badLimit = await env.app.inject({
        method: 'GET',
        url: '/api/v1/reports?limit=0',
        headers: authHeader(env.token),
      })
      expect(badLimit.statusCode).toBe(422)

      const badCursor = await env.app.inject({
        method: 'GET',
        url: '/api/v1/reports?cursor=nope',
        headers: authHeader(env.token),
      })
      expect(badCursor.statusCode).toBe(422)

      const detail = await env.app.inject({
        method: 'GET',
        url: `/api/v1/reports/${report.reportId}`,
        headers: authHeader(env.token),
      })
      expect(detail.statusCode).toBe(200)
      const body = detail.json<{ content: unknown; metrics: unknown[] }>()
      expect(body.content).toEqual(validContent())
      expect(body.metrics.length).toBeGreaterThan(0)

      const missing = await env.app.inject({
        method: 'GET',
        url: '/api/v1/reports/rpt_missing',
        headers: authHeader(env.token),
      })
      expect(missing.statusCode).toBe(404)
      expect(missing.json()).toMatchObject({ error: { code: 'not_found' } })
    } finally {
      await close(env)
    }
  })
})

describe('分析接口限流', () => {
  it('超出 ANALYSIS_RATE_LIMIT_MAX 后返回 429，且不影响归档查询', async () => {
    const env = await setup({ env: { ANALYSIS_RATE_LIMIT_MAX: '2' } })
    try {
      expect((await postAnalysis(env)).statusCode).toBe(200)
      expect((await postAnalysis(env)).statusCode).toBe(200)
      const limited = await postAnalysis(env)
      expect(limited.statusCode).toBe(429)

      const listed = await env.app.inject({
        method: 'GET',
        url: '/api/v1/reports',
        headers: authHeader(env.token),
      })
      expect(listed.statusCode).toBe(200)
    } finally {
      await close(env)
    }
  })
})
