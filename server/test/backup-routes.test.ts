import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { BackupRestoreResponse } from '@persist/shared/contract/backup'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createBackup } from '../src/db/backup.js'
import { openPersistDatabase, type PersistDatabase } from '../src/db/index.js'
import { upsertEntity } from '../src/db/repositories/entities.js'
import { NOW, TODAY, seedRecords } from './helpers/analysis-fixtures.js'

/** POST /api/v1/backups/:id/restore 的 HTTP 层测试（真实文件库 + app.inject）。 */

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

interface Env {
  app: FastifyInstance
  database: PersistDatabase
  backupDir: string
  dbPath: string
  token: string
  userId: string
  clock: { value: number }
}

async function setup(): Promise<Env> {
  const dir = mkdtempSync(join(tmpdir(), 'persist-backup-route-'))
  tempDirs.push(dir)
  const dbPath = join(dir, 'persist.sqlite')
  const backupDir = join(dir, 'backups')
  const clock = { value: NOW }
  const config = loadConfig({
    DB_PATH: dbPath,
    DB_BACKUP_DIR: backupDir,
    DEEPSEEK_API_KEY: '',
    SYNC_RATE_LIMIT_MAX: '1000',
  } as unknown as NodeJS.ProcessEnv)
  const database = openPersistDatabase({ path: dbPath })
  const app = buildApp({ config, db: database, now: () => clock.value })
  const registered = await app.inject({ method: 'POST', url: '/api/v1/devices', payload: {} })
  expect(registered.statusCode).toBe(201)
  const account = registered.json<{ token: string; userId: string }>()
  seedRecords(database.db, account.userId)
  return { app, database, backupDir, dbPath, token: account.token, userId: account.userId, clock }
}

async function close(env: Env): Promise<void> {
  await env.app.close()
  env.database.db.close()
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

function waterCount(env: Env): number {
  const row = env.database.db
    .prepare<{ total: number }>(
      'SELECT COUNT(*) AS total FROM water_logs WHERE user_id = ? AND deleted_at IS NULL',
    )
    .get(env.userId)
  return row ? Number(row.total) : 0
}

describe('POST /api/v1/backups/:id/restore：', () => {
  it('未带令牌返回 401，不生成任何快照：', async () => {
    const env = await setup()
    try {
      env.clock.value = NOW + 1_000
      const created = createBackup({
        dbPath: env.dbPath,
        backupDir: env.backupDir,
        now: NOW,
        reason: 'manual',
        retain: false,
      })
      const response = await env.app.inject({
        method: 'POST',
        url: `/api/v1/backups/${created.file}/restore`,
        payload: { confirm: true },
      })
      expect(response.statusCode).toBe(401)
      expect(response.json()).toMatchObject({ error: { code: 'unauthorized' } })
    } finally {
      await close(env)
    }
  })

  it('confirm 不是布尔值返回 422：', async () => {
    const env = await setup()
    try {
      const created = createBackup({
        dbPath: env.dbPath,
        backupDir: env.backupDir,
        now: NOW,
        reason: 'manual',
        retain: false,
      })
      const response = await env.app.inject({
        method: 'POST',
        url: `/api/v1/backups/${created.file}/restore`,
        headers: auth(env.token),
        payload: { confirm: 'yes' },
      })
      expect(response.statusCode).toBe(422)
      expect(response.json()).toMatchObject({ error: { code: 'invalid_request' } })
    } finally {
      await close(env)
    }
  })

  it('先返回预览，confirm:true 后才恢复并保留 pre-restore 快照：', async () => {
    const env = await setup()
    try {
      const created = createBackup({
        dbPath: env.dbPath,
        backupDir: env.backupDir,
        now: NOW,
        reason: 'manual',
        retain: false,
      })
      upsertEntity(env.database.db, env.userId, {
        kind: 'water_log',
        id: 'water_after_snapshot',
        updatedAt: 2_000,
        data: { id: 'water_after_snapshot', date: TODAY, time: '10:00', milliliters: 500 },
      })
      expect(waterCount(env)).toBe(2)

      const previewResponse = await env.app.inject({
        method: 'POST',
        url: `/api/v1/backups/${created.file}/restore`,
        headers: auth(env.token),
        payload: {},
      })
      expect(previewResponse.statusCode).toBe(200)
      expect(previewResponse.headers['cache-control']).toBe('no-store')
      const preview = previewResponse.json<BackupRestoreResponse>()
      expect(preview.restored).toBe(false)
      expect(preview.preview.current.counts.waterLogs).toBe(2)
      expect(preview.preview.restored.counts.waterLogs).toBe(1)
      expect(waterCount(env)).toBe(2)

      env.clock.value = NOW + 1_000
      const restoredResponse = await env.app.inject({
        method: 'POST',
        url: `/api/v1/backups/${created.file}/restore`,
        headers: auth(env.token),
        payload: { confirm: true },
      })
      expect(restoredResponse.statusCode).toBe(200)
      const body = restoredResponse.json<BackupRestoreResponse>()
      expect(body.restored).toBe(true)
      expect(body.preRestoreBackup?.file).toMatch(/pre-restore\.sqlite$/)
      expect(existsSync(join(env.backupDir, body.preRestoreBackup?.file ?? ''))).toBe(true)
      expect(waterCount(env)).toBe(1)
      expect(env.database.schemaVersion).toBe(2)

      // 快照里包含当前设备令牌，恢复后同一 token 仍可继续使用。
      const reports = await env.app.inject({
        method: 'GET',
        url: '/api/v1/reports',
        headers: auth(env.token),
      })
      expect(reports.statusCode).toBe(200)
    } finally {
      await close(env)
    }
  })

  it('不存在的快照返回 404：', async () => {
    const env = await setup()
    try {
      const response = await env.app.inject({
        method: 'POST',
        url: '/api/v1/backups/persist-20261107-030000-manual.sqlite/restore',
        headers: auth(env.token),
        payload: {},
      })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: 'backup_not_found' } })
    } finally {
      await close(env)
    }
  })
})
