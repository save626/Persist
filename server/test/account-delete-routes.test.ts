import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AccountDeleteResponse } from '@persist/shared/contract/account'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createBackup, checksumPath } from '../src/db/backup.js'
import { openPersistDatabase, type PersistDatabase } from '../src/db/index.js'
import { recordSyncOp } from '../src/db/repositories/sync-ops.js'
import { upsertEntity } from '../src/db/repositories/entities.js'

/** DELETE /api/v1/account（14d）：确认门禁、事务删除、账号隔离、备份清理与回滚。 */

const NOW = Date.UTC(2026, 10, 10, 3, 4, 5)
const TODAY = '2026-11-10'

interface Env {
  app: FastifyInstance
  database: PersistDatabase
  clock: { value: number }
  root: string
  dbPath: string
  backupDir: string
}

interface Account {
  userId: string
  deviceId: string
  token: string
  recoveryCode: string
}

const envs: Env[] = []

async function setup(fileDatabase = false): Promise<Env> {
  const root = mkdtempSync(join(tmpdir(), 'persist-account-delete-'))
  const dbPath = fileDatabase ? join(root, 'persist.sqlite') : ':memory:'
  const backupDir = join(root, 'backups')
  const config = loadConfig({
    DEEPSEEK_API_KEY: '',
    SYNC_RATE_LIMIT_MAX: '1000',
    DB_BACKUP_DIR: backupDir,
  } as unknown as NodeJS.ProcessEnv)
  const database = openPersistDatabase({ path: dbPath })
  const clock = { value: NOW }
  const app = buildApp({ config, db: database, now: () => clock.value })
  const env = { app, database, clock, root, dbPath, backupDir }
  envs.push(env)
  return env
}

afterEach(async () => {
  while (envs.length > 0) {
    const env = envs.pop()
    if (!env) continue
    await env.app.close()
    env.database.db.close()
    rmSync(env.root, { recursive: true, force: true })
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

function deleteRequest(env: Env, token: string, payload?: unknown) {
  return env.app.inject({
    method: 'DELETE',
    url: '/api/v1/account',
    headers: auth(token),
    ...(payload === undefined ? {} : { payload: payload as never }),
  })
}

function countForUser(env: Env, table: string, userId: string): number {
  const row = env.database.db
    .prepare<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table} WHERE user_id = ?`)
    .get(userId)
  return row ? Number(row.total) : 0
}

function userExists(env: Env, userId: string): boolean {
  return Boolean(
    env.database.db
      .prepare<{ id: string }>('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL')
      .get(userId),
  )
}

function insertExtraDevice(env: Env, account: Account): void {
  env.database.db
    .prepare(
      `INSERT INTO devices (id, user_id, token_hash, label, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      `dev_extra_${account.userId}`,
      account.userId,
      `hash_extra_${account.userId}`,
      '备用机',
      NOW,
    )
}

function seedAccount(env: Env, account: Account): void {
  const db = env.database.db
  insertExtraDevice(env, account)
  upsertEntity(db, account.userId, {
    kind: 'profile',
    updatedAt: 100,
    data: { age: 30, height: 175, weight: 70, aiConsent: false },
  })
  upsertEntity(db, account.userId, {
    kind: 'settings',
    updatedAt: 101,
    data: {
      reminders: [],
      summaryOnly: false,
      sources: { fitness: false, diet: false, study: false, profile: false },
      dailyBrief: { enabled: false, at: '21:00' },
    },
  })
  upsertEntity(db, account.userId, {
    kind: 'goal',
    id: `goal_${account.userId}`,
    updatedAt: 102,
    data: { id: `goal_${account.userId}`, title: '保持记录', date: TODAY, enabled: true },
  })
  upsertEntity(db, account.userId, {
    kind: 'plan_item',
    id: `plan_${account.userId}`,
    updatedAt: 103,
    data: {
      id: `plan_${account.userId}`,
      name: '晚间复盘',
      time: '21:00',
      detail: '10 分钟',
      kind: 'default',
      done: false,
      date: TODAY,
    },
  })
  upsertEntity(db, account.userId, {
    kind: 'study_record',
    id: `study_${account.userId}`,
    updatedAt: 104,
    data: {
      id: `study_${account.userId}`,
      category: 'english',
      source: '百词斩',
      date: TODAY,
      startTime: '08:00',
      duration: 45,
      note: '',
      newWords: 20,
    },
  })
  upsertEntity(db, account.userId, {
    kind: 'fitness_session',
    id: `fit_${account.userId}`,
    updatedAt: 105,
    data: {
      id: `fit_${account.userId}`,
      date: TODAY,
      status: 'completed',
      completedAt: `${TODAY}T12:00:00.000Z`,
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
  upsertEntity(db, account.userId, {
    kind: 'diet_entry',
    id: `diet_${account.userId}`,
    updatedAt: 106,
    data: {
      id: `diet_${account.userId}`,
      date: TODAY,
      meal: 'lunch',
      name: '鸡胸饭',
      calories: 600,
      protein: 40,
      carbs: 60,
      fat: 12,
    },
  })
  upsertEntity(db, account.userId, {
    kind: 'water_log',
    id: `water_${account.userId}`,
    updatedAt: 107,
    data: { id: `water_${account.userId}`, date: TODAY, time: '08:00', milliliters: 250 },
  })
  upsertEntity(db, account.userId, {
    kind: 'long_term_plan',
    id: `ltp_${account.userId}`,
    updatedAt: 108,
    data: { id: `ltp_${account.userId}`, title: '长期计划', status: 'active' },
  })
  db.prepare(
    `INSERT INTO analysis_reports
      (id, user_id, type, range_days, data_rev, origin, model, start_date, end_date,
       title, status, content_json, metrics_json, facts_json, created_at)
     VALUES (?, ?, '综合分析', 30, 1, 'rules', NULL, ?, ?, '标题', '状态', '{}', '[]', '{}', ?)`,
  ).run(`rpt_${account.userId}`, account.userId, TODAY, TODAY, NOW)
  db.prepare(
    `INSERT INTO job_runs (id, name, run_key, status, user_id, started_at)
     VALUES (?, 'daily_brief', ?, 'success', ?, ?)`,
  ).run(`job_${account.userId}`, `run_${account.userId}`, account.userId, NOW)
  recordSyncOp(db, {
    opId: `op_${account.userId}_1`,
    deviceId: account.deviceId,
    userId: account.userId,
    appliedAt: NOW,
    resultJson: '{}',
  })
  recordSyncOp(db, {
    opId: `op_${account.userId}_2`,
    deviceId: account.deviceId,
    userId: account.userId,
    appliedAt: NOW,
    resultJson: '{}',
  })
}

describe('DELETE /api/v1/account', () => {
  it('未带令牌返回 401，账号不受影响', async () => {
    const env = await setup()
    const account = await register(env)
    const response = await env.app.inject({
      method: 'DELETE',
      url: '/api/v1/account',
      payload: { confirm: true },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: { code: 'unauthorized' } })
    expect(userExists(env, account.userId)).toBe(true)
  })

  it('缺失、false 与非布尔 confirm 均拒绝且不删除数据', async () => {
    const env = await setup()
    const account = await register(env)
    seedAccount(env, account)

    const missing = await env.app.inject({
      method: 'DELETE',
      url: '/api/v1/account',
      headers: auth(account.token),
    })
    expect(missing.statusCode).toBe(422)
    expect(missing.headers['cache-control']).toBe('no-store')
    expect(missing.json()).toMatchObject({ error: { code: 'confirmation_required' } })

    const denied = await deleteRequest(env, account.token, { confirm: false })
    expect(denied.statusCode).toBe(422)
    expect(denied.json()).toMatchObject({ error: { code: 'confirmation_required' } })

    const invalid = await deleteRequest(env, account.token, { confirm: 'true' })
    expect(invalid.statusCode).toBe(422)
    expect(invalid.json()).toMatchObject({ error: { code: 'invalid_request' } })

    expect(userExists(env, account.userId)).toBe(true)
    expect(countForUser(env, 'profiles', account.userId)).toBe(1)
  })

  it('confirm:true 删除所有账号行、设备、报告、任务与同步台账，并让旧凭据失效', async () => {
    const env = await setup()
    const account = await register(env)
    const restored = await env.app.inject({
      method: 'POST',
      url: '/api/v1/devices/restore',
      payload: { recoveryCode: account.recoveryCode },
    })
    expect(restored.statusCode).toBe(200)
    seedAccount(env, account)

    env.clock.value = NOW + 1_000
    const response = await deleteRequest(env, account.token, { confirm: true })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const body = response.json<AccountDeleteResponse>()
    expect(body).toEqual({
      deleted: true,
      deletedAt: NOW + 1_000,
      counts: {
        profile: 1,
        settings: 1,
        planItems: 1,
        studyRecords: 1,
        fitnessSessions: 1,
        dietEntries: 1,
        waterLogs: 1,
        goals: 1,
        longTermPlans: 1,
        analysisReports: 1,
        jobRuns: 1,
        syncOps: 2,
        devices: 3,
        backupFiles: 0,
      },
    })

    for (const table of [
      'profiles',
      'settings',
      'plan_items',
      'study_records',
      'fitness_sessions',
      'diet_entries',
      'water_logs',
      'goals',
      'long_term_plans',
      'analysis_reports',
      'job_runs',
      'sync_ops',
      'devices',
    ]) {
      expect(countForUser(env, table, account.userId)).toBe(0)
    }
    expect(userExists(env, account.userId)).toBe(false)

    const exported = await env.app.inject({
      method: 'GET',
      url: '/api/v1/export',
      headers: auth(account.token),
    })
    expect(exported.statusCode).toBe(401)

    const restoreAgain = await env.app.inject({
      method: 'POST',
      url: '/api/v1/devices/restore',
      payload: { recoveryCode: account.recoveryCode },
    })
    expect(restoreAgain.statusCode).toBe(400)
    expect(restoreAgain.json()).toMatchObject({ error: { code: 'invalid_recovery_code' } })
  })

  it('多账号但无快照时只删除当前账号，另一账号仍可访问', async () => {
    const env = await setup()
    const first = await register(env)
    const second = await register(env)
    seedAccount(env, first)
    seedAccount(env, second)

    const response = await deleteRequest(env, first.token, { confirm: true })
    expect(response.statusCode).toBe(200)
    expect(userExists(env, first.userId)).toBe(false)
    expect(userExists(env, second.userId)).toBe(true)
    expect(countForUser(env, 'profiles', second.userId)).toBe(1)

    const secondExport = await env.app.inject({
      method: 'GET',
      url: '/api/v1/export',
      headers: auth(second.token),
    })
    expect(secondExport.statusCode).toBe(200)
  })

  it('多账号且存在整库快照时返回 409，数据库与文件均不变', async () => {
    const env = await setup(true)
    const first = await register(env)
    const second = await register(env)
    seedAccount(env, first)
    seedAccount(env, second)
    const backup = createBackup({
      dbPath: env.dbPath,
      backupDir: env.backupDir,
      now: NOW,
      reason: 'manual',
      retain: false,
    })

    const response = await deleteRequest(env, first.token, { confirm: true })
    expect(response.statusCode).toBe(409)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({ error: { code: 'account_delete_blocked' } })
    expect(userExists(env, first.userId)).toBe(true)
    expect(countForUser(env, 'profiles', first.userId)).toBe(1)
    expect(existsSync(backup.path)).toBe(true)
    expect(existsSync(checksumPath(backup.path))).toBe(true)

    const firstExport = await env.app.inject({
      method: 'GET',
      url: '/api/v1/export',
      headers: auth(first.token),
    })
    expect(firstExport.statusCode).toBe(200)
  })

  it('单账号删除时清理规范快照与旁车，不碰无关文件或非规范 sqlite', async () => {
    const env = await setup(true)
    const account = await register(env)
    seedAccount(env, account)
    const backup = createBackup({
      dbPath: env.dbPath,
      backupDir: env.backupDir,
      now: NOW,
      reason: 'manual',
      retain: false,
    })
    const unrelated = join(env.backupDir, 'README.txt')
    const nonCanonical = join(env.backupDir, 'manual-copy.sqlite')
    writeFileSync(unrelated, 'keep', 'utf8')
    writeFileSync(nonCanonical, 'not a real database', 'utf8')

    const response = await deleteRequest(env, account.token, { confirm: true })
    expect(response.statusCode).toBe(200)
    expect(response.json<AccountDeleteResponse>().counts.backupFiles).toBe(2)
    expect(existsSync(backup.path)).toBe(false)
    expect(existsSync(checksumPath(backup.path))).toBe(false)
    expect(existsSync(unrelated)).toBe(true)
    expect(existsSync(nonCanonical)).toBe(true)
  })

  it('数据库删除中途失败时整体回滚，旧令牌仍可用', async () => {
    const env = await setup()
    const account = await register(env)
    seedAccount(env, account)
    env.database.db.exec(`
      CREATE TRIGGER fail_account_delete
      BEFORE DELETE ON users
      BEGIN
        SELECT RAISE(ABORT, 'forced delete failure');
      END
    `)

    const response = await deleteRequest(env, account.token, { confirm: true })
    expect(response.statusCode).toBe(500)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({ error: { code: 'account_delete_failed' } })
    expect(userExists(env, account.userId)).toBe(true)
    expect(countForUser(env, 'profiles', account.userId)).toBe(1)
    expect(countForUser(env, 'devices', account.userId)).toBe(2)

    const exported = await env.app.inject({
      method: 'GET',
      url: '/api/v1/export',
      headers: auth(account.token),
    })
    expect(exported.statusCode).toBe(200)
  })
})
