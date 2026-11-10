import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type {
  BackupCreateResponse,
  BackupListItem,
  BackupListResponse,
  BackupRestoreResponse,
} from '@persist/shared/contract/backup'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createBackup, listBackups } from '../src/db/backup.js'
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
  config: ReturnType<typeof loadConfig>
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
  return {
    app,
    database,
    backupDir,
    dbPath,
    token: account.token,
    userId: account.userId,
    clock,
    config,
  }
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

describe('GET /api/v1/backups：', () => {
  it('未带令牌返回 401：', async () => {
    const env = await setup()
    try {
      const response = await env.app.inject({ method: 'GET', url: '/api/v1/backups' })
      expect(response.statusCode).toBe(401)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toMatchObject({ error: { code: 'unauthorized' } })
    } finally {
      await close(env)
    }
  })

  it('空目录返回平铺空列表且 no-store：', async () => {
    const env = await setup()
    try {
      const response = await env.app.inject({
        method: 'GET',
        url: '/api/v1/backups',
        headers: auth(env.token),
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toEqual({ backups: [] })
    } finally {
      await close(env)
    }
  })

  it('只列规范快照、按新到旧排序，且不暴露绝对路径：', async () => {
    const env = await setup()
    try {
      const older = createBackup({
        dbPath: env.dbPath,
        backupDir: env.backupDir,
        now: NOW - 60_000,
        reason: 'scheduled',
        retain: false,
      })
      const newer = createBackup({
        dbPath: env.dbPath,
        backupDir: env.backupDir,
        now: NOW,
        reason: 'manual',
        retain: false,
      })
      const noChecksumId = 'persist-20200101-030000-pre-restore.sqlite'
      writeFileSync(join(env.backupDir, noChecksumId), 'snapshot-without-checksum')
      writeFileSync(join(env.backupDir, 'persist-20261106-030000-unknown.sqlite'), 'ignored')
      writeFileSync(join(env.backupDir, 'note.sqlite'), 'ignored')

      const response = await env.app.inject({
        method: 'GET',
        url: '/api/v1/backups',
        headers: auth(env.token),
      })
      expect(response.statusCode).toBe(200)
      const body = response.json<BackupListResponse>()
      expect(body.backups.map((item) => item.id)).toEqual([newer.file, older.file, noChecksumId])
      expect(body.backups[0]).toMatchObject({
        reason: 'manual',
        sha256: newer.sha256,
      })
      expect(body.backups.find((item) => item.id === noChecksumId)?.sha256).toBeNull()
      expect(response.body).not.toContain(env.backupDir)
      expect(body.backups.every((item: BackupListItem) => !('path' in item))).toBe(true)
    } finally {
      await close(env)
    }
  })
})

describe('POST /api/v1/backups：', () => {
  it('未带令牌返回 401，不生成快照：', async () => {
    const env = await setup()
    try {
      const response = await env.app.inject({
        method: 'POST',
        url: '/api/v1/backups',
        payload: { reason: 'scheduled' },
      })
      expect(response.statusCode).toBe(401)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.json()).toMatchObject({ error: { code: 'unauthorized' } })
      expect(listBackups(env.backupDir)).toEqual([])
    } finally {
      await close(env)
    }
  })

  it('固定生成 manual 快照、写 sha256 旁车并返回 201：', async () => {
    const env = await setup()
    try {
      const response = await env.app.inject({
        method: 'POST',
        url: '/api/v1/backups',
        headers: auth(env.token),
        payload: { reason: 'scheduled' },
      })
      expect(response.statusCode).toBe(201)
      expect(response.headers['cache-control']).toBe('no-store')
      const body = response.json<BackupCreateResponse>()
      expect(body.backup.id).toMatch(/^persist-\d{8}-\d{6}-manual\.sqlite$/)
      expect(body.backup.reason).toBe('manual')
      expect(body.backup.bytes).toBeGreaterThan(0)
      expect(body.backup.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(existsSync(join(env.backupDir, body.backup.id))).toBe(true)
      expect(existsSync(join(env.backupDir, `${body.backup.id}.sha256`))).toBe(true)
      expect(response.body).not.toContain(env.backupDir)
      expect(listBackups(env.backupDir).map((item) => item.reason)).toContain('manual')
    } finally {
      await close(env)
    }
  })

  it('同一秒重复创建返回 409，不覆盖已有快照：', async () => {
    const env = await setup()
    try {
      const first = await env.app.inject({
        method: 'POST',
        url: '/api/v1/backups',
        headers: auth(env.token),
      })
      const second = await env.app.inject({
        method: 'POST',
        url: '/api/v1/backups',
        headers: auth(env.token),
      })
      expect(first.statusCode).toBe(201)
      expect(second.statusCode).toBe(409)
      expect(second.json()).toMatchObject({ error: { code: 'backup_already_exists' } })
      expect(listBackups(env.backupDir)).toHaveLength(1)
    } finally {
      await close(env)
    }
  })

  it('内存库返回明确的 409，而不是笼统 500：', async () => {
    const env = await setup()
    const memoryApp = buildApp({
      config: env.config,
      db: { ...env.database, path: ':memory:' },
      now: () => env.clock.value,
    })
    try {
      const response = await memoryApp.inject({
        method: 'POST',
        url: '/api/v1/backups',
        headers: auth(env.token),
      })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: { code: 'backup_unavailable' } })
    } finally {
      await memoryApp.close()
      await close(env)
    }
  })
})

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
