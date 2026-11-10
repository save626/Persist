import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import {
  PERSIST_EXPORT_MODE,
  PERSIST_EXPORT_SCHEMA_VERSION,
  PERSIST_EXPORT_VERSION,
  type PersistExportEnvelope,
} from '@persist/shared/contract/export'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { openPersistDatabase, type PersistDatabase } from '../src/db/index.js'
import { upsertEntity } from '../src/db/repositories/entities.js'

/** GET /api/v1/export 的 HTTP 层测试：鉴权、账号隔离、0.3.0 形状与敏感字段排除。 */

const NOW = Date.UTC(2026, 10, 10, 1, 2, 3)
const TODAY = '2026-11-10'
const EXPORTED_AT = new Date(NOW).toISOString()

interface Env {
  app: FastifyInstance
  database: PersistDatabase
  clock: { value: number }
}

interface Account {
  userId: string
  deviceId: string
  token: string
  recoveryCode: string
}

const envs: Env[] = []

async function setup(): Promise<Env> {
  const config = loadConfig({
    DEEPSEEK_API_KEY: '',
    SYNC_RATE_LIMIT_MAX: '1000',
  } as unknown as NodeJS.ProcessEnv)
  const database = openPersistDatabase({ path: ':memory:' })
  const clock = { value: NOW }
  const app = buildApp({ config, db: database, now: () => clock.value })
  const env = { app, database, clock }
  envs.push(env)
  return env
}

afterEach(async () => {
  while (envs.length > 0) {
    const env = envs.pop()
    if (!env) continue
    await env.app.close()
    env.database.db.close()
  }
})

async function register(env: Env): Promise<Account> {
  const response = await env.app.inject({ method: 'POST', url: '/api/v1/devices', payload: {} })
  expect(response.statusCode).toBe(201)
  return response.json<Account>()
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

function exportRequest(env: Env, token: string) {
  return env.app.inject({ method: 'GET', url: '/api/v1/export', headers: auth(token) })
}

function planItem(id: string, name: string) {
  return {
    id,
    name,
    time: '21:00',
    detail: '10 分钟',
    kind: 'default',
    done: true,
    date: TODAY,
  }
}

function seedRichAccount(env: Env, userId: string): void {
  const db = env.database.db
  upsertEntity(db, userId, {
    kind: 'profile',
    updatedAt: 100,
    data: {
      age: 30,
      height: 175,
      weight: 70,
      targetWeight: 68,
      goal: '保持记录',
      experience: '规律训练',
      frequency: '每周 3 次',
      equipment: '家庭',
      dietPreference: '均衡',
      allergies: '',
      bedtime: '23:00',
      sleepHours: 7,
      stress: '低',
      aiConsent: true,
    },
  })
  upsertEntity(db, userId, {
    kind: 'settings',
    updatedAt: 101,
    data: {
      reminders: [],
      summaryOnly: false,
      sources: { fitness: true, diet: true, study: true, profile: true },
      dailyBrief: { enabled: false, at: '21:00' },
    },
  })
  upsertEntity(db, userId, {
    kind: 'goal',
    id: 'goal_1',
    updatedAt: 102,
    data: {
      id: 'goal_1',
      title: '维持训练',
      date: TODAY,
      time: '21:00',
      enabled: true,
      tone: 'primary',
    },
  })
  upsertEntity(db, userId, {
    kind: 'plan_item',
    id: 'plan_1',
    updatedAt: 103,
    data: planItem('plan_1', '晚间复盘'),
  })
  upsertEntity(db, userId, {
    kind: 'study_record',
    id: 'study_1',
    updatedAt: 104,
    data: {
      id: 'study_1',
      category: 'english',
      source: '百词斩',
      date: TODAY,
      startTime: '08:00',
      duration: 45,
      note: '',
      newWords: 20,
    },
  })
  upsertEntity(db, userId, {
    kind: 'fitness_session',
    id: 'fit_1',
    updatedAt: 105,
    data: {
      id: 'fit_1',
      date: TODAY,
      completedAt: `${TODAY}T12:00:00.000Z`,
      templateId: 'strength-a',
      elapsedSeconds: 1800,
      exercises: [
        {
          id: 'ex_1',
          name: '深蹲',
          muscle: '腿',
          equipment: '杠铃',
          targetReps: '5',
          rest: '120s',
          sets: [{ id: 'set_1', weight: 60, reps: 5, done: true }],
        },
      ],
    },
  })
  upsertEntity(db, userId, {
    kind: 'diet_entry',
    id: 'diet_1',
    updatedAt: 106,
    data: {
      id: 'diet_1',
      date: TODAY,
      meal: 'lunch',
      mealLabel: '午餐',
      mealTime: '12:30',
      name: '鸡胸饭',
      portion: '1 份',
      calories: 600,
      protein: 40,
      carbs: 60,
      fat: 12,
    },
  })
  upsertEntity(db, userId, {
    kind: 'water_log',
    id: 'water_1',
    updatedAt: 107,
    data: { id: 'water_1', date: TODAY, time: '08:00', milliliters: 250 },
  })
  upsertEntity(db, userId, {
    kind: 'long_term_plan',
    id: 'ltp_1',
    updatedAt: 108,
    data: {
      id: 'ltp_1',
      title: '12 周保持',
      goal: '稳定训练',
      startDate: TODAY,
      endDate: '2027-02-01',
      cadence: 'weekly',
      weeklyTargets: [{ id: 'target_1', label: '训练', unit: '次', perWeek: 3 }],
      status: 'active',
      source: 'manual',
      createdAt: `${TODAY}T00:00:00.000Z`,
    },
  })
}

describe('GET /api/v1/export', () => {
  it('无令牌、错误令牌与已吊销令牌均返回 401', async () => {
    const env = await setup()
    const missing = await env.app.inject({ method: 'GET', url: '/api/v1/export' })
    expect(missing.statusCode).toBe(401)
    expect(missing.headers['cache-control']).toBe('no-store')

    const invalid = await exportRequest(env, 'pst_invalid')
    expect(invalid.statusCode).toBe(401)
    expect(invalid.json()).toMatchObject({ error: { code: 'unauthorized' } })

    const account = await register(env)
    const revoked = await env.app.inject({
      method: 'POST',
      url: '/api/v1/devices/revoke',
      headers: auth(account.token),
      payload: {},
    })
    expect(revoked.statusCode).toBe(200)
    const afterRevoke = await exportRequest(env, account.token)
    expect(afterRevoke.statusCode).toBe(401)
  })

  it('返回 application/json、no-store、附件名与完整 0.3.0 切片', async () => {
    const env = await setup()
    const account = await register(env)
    seedRichAccount(env, account.userId)

    const response = await exportRequest(env, account.token)
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="persist-export-20261110T010203Z.json"',
    )

    const body = response.json<PersistExportEnvelope>()
    expect(body).toMatchObject({
      app: 'Persist',
      version: PERSIST_EXPORT_VERSION,
      mode: PERSIST_EXPORT_MODE,
      schemaVersion: PERSIST_EXPORT_SCHEMA_VERSION,
      exportedAt: EXPORTED_AT,
    })
    expect(Object.keys(body.data)).toEqual([
      'goals',
      'planItems',
      'waterLog',
      'studyRecords',
      'dietDays',
      'fitnessSession',
      'fitnessHistory',
      'profile',
      'settings',
      'aiConsent',
      'eveningReview',
      'reports',
      'longTermPlans',
    ])
    expect(body.data.goals).toHaveLength(1)
    expect(body.data.planItems).toHaveLength(1)
    expect(body.data.studyRecords).toHaveLength(1)
    expect(body.data.fitnessHistory).toHaveLength(1)
    expect(body.data.waterLog).toHaveLength(1)
    expect(body.data.longTermPlans).toHaveLength(1)
    expect(body.data.fitnessSession).toBeNull()
    expect(body.data.eveningReview).toBeNull()
    expect(body.data.reports).toEqual([])
    expect(body.data.aiConsent).toBe(true)

    const day = body.data.dietDays[0] as {
      date: string
      meals: Array<{ id: string; time: string; entries: Array<Record<string, unknown>> }>
    }
    expect(day.date).toBe(TODAY)
    expect(day.meals.map((meal) => meal.id)).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
    const lunch = day.meals.find((meal) => meal.id === 'lunch')
    expect(lunch?.time).toBe('12:30')
    expect(lunch?.entries[0]).toMatchObject({
      id: 'diet_1',
      name: '鸡胸饭',
      calories: 600,
    })
    expect(lunch?.entries[0]).not.toHaveProperty('date')
    expect(lunch?.entries[0]).not.toHaveProperty('meal')

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(account.token)
    expect(serialized).not.toContain(account.recoveryCode)
    expect(serialized).not.toContain(account.deviceId)
    expect(serialized).not.toMatch(/token_hash|recovery_hash|sync_ops|deleted_at|device_id/)
  })

  it('只导出当前账号，并排除软删除墓碑', async () => {
    const env = await setup()
    const first = await register(env)
    const second = await register(env)

    upsertEntity(env.database.db, first.userId, {
      kind: 'plan_item',
      id: 'first_keep',
      updatedAt: 100,
      data: planItem('first_keep', '保留'),
    })
    upsertEntity(env.database.db, first.userId, {
      kind: 'plan_item',
      id: 'first_deleted',
      updatedAt: 101,
      data: planItem('first_deleted', '已删除'),
    })
    upsertEntity(env.database.db, first.userId, {
      kind: 'plan_item',
      id: 'first_deleted',
      updatedAt: 102,
      deleted: true,
    })
    upsertEntity(env.database.db, second.userId, {
      kind: 'plan_item',
      id: 'second_only',
      updatedAt: 200,
      data: planItem('second_only', '别的账号'),
    })

    const response = await exportRequest(env, first.token)
    expect(response.statusCode).toBe(200)
    const body = response.json<PersistExportEnvelope>()
    const ids = (body.data.planItems as Array<{ id: string }>).map((item) => item.id)
    expect(ids).toEqual(['first_keep'])
    expect(JSON.stringify(body)).not.toContain('second_only')
  })

  it('空账号返回合法空数据，不伪造个人资料或报告', async () => {
    const env = await setup()
    const account = await register(env)
    const response = await exportRequest(env, account.token)
    expect(response.statusCode).toBe(200)
    const body = response.json<PersistExportEnvelope>()

    expect(body.data.goals).toEqual([])
    expect(body.data.planItems).toEqual([])
    expect(body.data.waterLog).toEqual([])
    expect(body.data.studyRecords).toEqual([])
    expect(body.data.dietDays).toEqual([])
    expect(body.data.fitnessHistory).toEqual([])
    expect(body.data.longTermPlans).toEqual([])
    expect(body.data.reports).toEqual([])
    expect(body.data.profile).toMatchObject({ age: 0, goal: '', aiConsent: false })
    expect(body.data.settings).toMatchObject({
      reminders: [],
      summaryOnly: false,
      sources: { fitness: false, diet: false, study: false, profile: false },
    })
  })
})
