import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checksumPath,
  createBackup,
  listBackups,
  sha256File,
  writeChecksumSidecar,
} from '../src/db/backup.js'
import { openDatabase } from '../src/db/driver.js'
import { openPersistDatabase, type PersistDatabase } from '../src/db/index.js'
import { MIGRATIONS, migrate } from '../src/db/migrations.js'
import { upsertEntity } from '../src/db/repositories/entities.js'
import {
  executeRestore,
  previewRestore,
  RestoreError,
  type ExecuteRestoreOptions,
} from '../src/db/restore.js'
import { seedRecords, seedUser, TODAY } from './helpers/analysis-fixtures.js'

/**
 * 步骤 14b 恢复服务测试。
 *
 * 覆盖「校验 → 预览 → pre-restore 快照 → 替换 → 重开 → 数据回退」主路径，
 * 以及缺旁车、路径穿越、schema 过新、账号不匹配等拒绝路径。
 */

const NOW = Date.UTC(2026, 10, 7, 3, 0, 0)
const RESTORE_NOW = Date.UTC(2026, 10, 7, 9, 30, 0)
const USER = 'usr_restore'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'persist-restore-'))
  tempDirs.push(dir)
  return dir
}

interface Env {
  dir: string
  dbPath: string
  backupDir: string
  database: PersistDatabase
}

function setup(userId = USER): Env {
  const dir = tempDir()
  const dbPath = join(dir, 'persist.sqlite')
  const backupDir = join(dir, 'backups')
  const database = openPersistDatabase({ path: dbPath })
  seedUser(database.db, userId)
  seedRecords(database.db, userId)
  return { dir, dbPath, backupDir, database }
}

function options(env: Env, backupId: string, userId = USER): ExecuteRestoreOptions {
  return {
    db: env.database.db,
    dbPath: env.dbPath,
    backupDir: env.backupDir,
    userId,
    backupId,
    now: () => RESTORE_NOW,
    busyTimeoutMs: 5_000,
  }
}

function expectRestoreError(run: () => unknown, code: RestoreError['code']): void {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(RestoreError)
    expect((error as RestoreError).code).toBe(code)
    return
  }
  throw new Error(`预期抛出 ${code}`)
}

function countWater(db: PersistDatabase, userId = USER): number {
  const row = db.db
    .prepare<{ total: number }>(
      'SELECT COUNT(*) AS total FROM water_logs WHERE user_id = ? AND deleted_at IS NULL',
    )
    .get(userId)
  return row ? Number(row.total) : 0
}

describe('恢复预览与执行：', () => {
  it('预览显示当前/快照行数，执行后数据回退且 pre-restore 快照可读：', () => {
    const env = setup()
    try {
      const created = createBackup({
        dbPath: env.dbPath,
        backupDir: env.backupDir,
        now: NOW,
        reason: 'manual',
        retain: false,
      })

      upsertEntity(env.database.db, USER, {
        kind: 'water_log',
        id: 'water_after_snapshot',
        updatedAt: 2_000,
        data: { id: 'water_after_snapshot', date: TODAY, time: '10:00', milliliters: 500 },
      })
      expect(countWater(env.database)).toBe(2)

      const preview = previewRestore(options(env, created.file))
      expect(preview.current.counts.waterLogs).toBe(2)
      expect(preview.restored.counts.waterLogs).toBe(1)
      expect(preview.backup.id).toBe(created.file)
      expect(preview.backup.sha256).toBe(created.sha256)
      // 只读预览不能改动快照本身，否则旁车 sha256 会失效。
      expect(sha256File(created.path)).toBe(created.sha256)

      const result = executeRestore(options(env, created.file))
      expect(result.preview.restored.counts.waterLogs).toBe(1)
      expect(result.preRestoreBackup.file).toMatch(/pre-restore\.sqlite$/)
      expect(existsSync(join(env.backupDir, result.preRestoreBackup.file))).toBe(true)
      expect(countWater(env.database)).toBe(1)

      const preRestore = openDatabase({
        path: join(env.backupDir, result.preRestoreBackup.file),
        readOnly: true,
      })
      try {
        const row = preRestore
          .prepare<{ total: number }>(
            'SELECT COUNT(*) AS total FROM water_logs WHERE user_id = ? AND deleted_at IS NULL',
          )
          .get(USER)
        expect(Number(row?.total)).toBe(2)
      } finally {
        preRestore.close()
      }
      expect(listBackups(env.backupDir).map((entry) => entry.name)).toContain(created.file)
      expect(listBackups(env.backupDir).map((entry) => entry.name)).toContain(
        result.preRestoreBackup.file,
      )
    } finally {
      env.database.db.close()
    }
  })

  it('快照缺 sha256 旁车时拒绝恢复：', () => {
    const env = setup()
    try {
      const created = createBackup({
        dbPath: env.dbPath,
        backupDir: env.backupDir,
        now: NOW,
        reason: 'manual',
        retain: false,
      })
      rmSync(checksumPath(created.path), { force: true })
      expectRestoreError(() => previewRestore(options(env, created.file)), 'backup_checksum_failed')
    } finally {
      env.database.db.close()
    }
  })

  it('路径穿越 / 非规范文件名按不存在处理：', () => {
    const env = setup()
    try {
      expectRestoreError(
        () => previewRestore(options(env, '../persist.sqlite')),
        'backup_not_found',
      )
      expectRestoreError(() => previewRestore(options(env, 'persist.sqlite')), 'backup_not_found')
    } finally {
      env.database.db.close()
    }
  })

  it('schema 版本高于当前服务端时拒绝恢复：', () => {
    const env = setup()
    try {
      const created = createBackup({
        dbPath: env.dbPath,
        backupDir: env.backupDir,
        now: NOW,
        reason: 'manual',
        retain: false,
      })
      const snapshot = openDatabase({ path: created.path })
      try {
        snapshot
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(99, NOW)
      } finally {
        snapshot.close()
      }
      writeChecksumSidecar(created.path, created.file, sha256File(created.path))
      expectRestoreError(
        () => previewRestore(options(env, created.file)),
        'backup_schema_unsupported',
      )
    } finally {
      env.database.db.close()
    }
  })

  it('快照不含当前账号时拒绝恢复：', () => {
    const env = setup()
    try {
      const created = createBackup({
        dbPath: env.dbPath,
        backupDir: env.backupDir,
        now: NOW,
        reason: 'manual',
        retain: false,
      })
      expectRestoreError(
        () => previewRestore(options(env, created.file, 'usr_not_in_snapshot')),
        'backup_user_mismatch',
      )
    } finally {
      env.database.db.close()
    }
  })

  it('替换后迁移失败时自动回滚并保留当前库：', () => {
    const env = setup()
    try {
      // 造一个合法的 schema v1 快照，再塞一张与 v2 迁移冲突的表；
      // 预览会通过，但恢复后的 v2 迁移必定失败，用来验证自动回滚。
      const v1Path = join(env.dir, 'v1.sqlite')
      const v1 = openDatabase({ path: v1Path })
      try {
        migrate(v1, { now: () => NOW, migrations: [MIGRATIONS[0]!] })
        v1.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run('usr_v1', NOW)
      } finally {
        v1.close()
      }
      const created = createBackup({
        dbPath: v1Path,
        backupDir: env.backupDir,
        now: NOW,
        reason: 'manual',
        retain: false,
      })
      const snapshot = openDatabase({ path: created.path })
      try {
        snapshot.exec('CREATE TABLE analysis_reports (user_id TEXT)')
      } finally {
        snapshot.close()
      }
      writeChecksumSidecar(created.path, created.file, sha256File(created.path))

      upsertEntity(env.database.db, USER, {
        kind: 'water_log',
        id: 'water_before_failed_restore',
        updatedAt: 3_000,
        data: { id: 'water_before_failed_restore', date: TODAY, time: '11:00', milliliters: 300 },
      })
      expect(countWater(env.database)).toBe(2)

      expectRestoreError(
        () => executeRestore(options(env, created.file, 'usr_v1')),
        'restore_failed',
      )
      expect(countWater(env.database)).toBe(2)
      expect(listBackups(env.backupDir).some((entry) => entry.name.includes('pre-restore'))).toBe(
        true,
      )
    } finally {
      env.database.db.close()
    }
  })
  it('内存库明确拒绝恢复：', () => {
    const db = openPersistDatabase({ path: ':memory:' })
    try {
      expectRestoreError(
        () =>
          previewRestore({
            db: db.db,
            dbPath: ':memory:',
            backupDir: 'unused',
            userId: USER,
            backupId: 'persist-20261107-030000-manual.sqlite',
          }),
        'restore_in_memory_unsupported',
      )
    } finally {
      db.db.close()
    }
  })
})
