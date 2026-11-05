import { describe, expect, it } from 'vitest'
import type { Db } from '../src/db/driver.js'
import { openDatabase } from '../src/db/driver.js'
import { MIGRATIONS, SCHEMA_VERSION, migrate } from '../src/db/migrations.js'

function fresh(): Db {
  return openDatabase({ path: ':memory:' })
}

function tableNames(db: Db): string[] {
  return db
    .prepare<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name)
}

describe('migrate', () => {
  it('空库跑完 v1：返回版本 1，记账一行', () => {
    const db = fresh()
    try {
      const result = migrate(db, { now: () => 1_700_000_000_000 })
      expect(result.version).toBe(SCHEMA_VERSION)
      expect(result.applied).toEqual([1])
      expect(
        db
          .prepare<{ version: number; applied_at: number }>(
            'SELECT version, applied_at FROM schema_migrations',
          )
          .get(),
      ).toEqual({ version: 1, applied_at: 1_700_000_000_000 })
    } finally {
      db.close()
    }
  })

  it('重复调用幂等：第二次不应用任何版本、不重复记账', () => {
    const db = fresh()
    try {
      migrate(db)
      const second = migrate(db)
      expect(second.applied).toEqual([])
      expect(second.version).toBe(SCHEMA_VERSION)
      expect(
        db.prepare<{ total: number }>('SELECT COUNT(*) AS total FROM schema_migrations').get(),
      ).toEqual({ total: 1 })
    } finally {
      db.close()
    }
  })

  it('建出 v1 全部表：身份 / 单行 / 六类记录 + 计划 / 幂等', () => {
    const db = fresh()
    try {
      migrate(db)
      expect(tableNames(db)).toEqual([
        'devices',
        'diet_entries',
        'fitness_sessions',
        'goals',
        'long_term_plans',
        'plan_items',
        'profiles',
        'schema_migrations',
        'settings',
        'study_records',
        'sync_ops',
        'sync_seq',
        'users',
        'water_logs',
      ])
    } finally {
      db.close()
    }
  })

  it('sync_seq 是单行且从 0 开始', () => {
    const db = fresh()
    try {
      migrate(db)
      expect(
        db.prepare<{ id: number; value: number }>('SELECT id, value FROM sync_seq').all(),
      ).toEqual([{ id: 1, value: 0 }])
      expect(() => db.prepare('INSERT INTO sync_seq (id, value) VALUES (?, ?)').run(2, 0)).toThrow()
    } finally {
      db.close()
    }
  })

  it('每张同步实体表都有 (user_id, rev) 拉取索引', () => {
    const db = fresh()
    try {
      migrate(db)
      const indexes = db
        .prepare<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => row.name)
      for (const table of [
        'plan_items',
        'study_records',
        'fitness_sessions',
        'diet_entries',
        'water_logs',
        'goals',
        'long_term_plans',
      ]) {
        expect(indexes).toContain(`idx_${table}_pull`)
      }
      for (const table of [
        'plan_items',
        'study_records',
        'fitness_sessions',
        'diet_entries',
        'water_logs',
        'goals',
      ]) {
        expect(indexes).toContain(`idx_${table}_user_date`)
      }
      expect(indexes).toContain('idx_devices_user')
      expect(indexes).toContain('idx_sync_ops_applied')
    } finally {
      db.close()
    }
  })

  it('迁移定义连续递增，每次都涨版本', () => {
    const versions = MIGRATIONS.map((migration) => migration.version)
    expect(versions).toEqual([...versions].sort((a, b) => a - b))
    expect(new Set(versions).size).toBe(versions.length)
    expect(versions[versions.length - 1]).toBe(SCHEMA_VERSION)
  })

  it('migration 中途失败时整条回滚：不留半套表、不记账', () => {
    const db = fresh()
    try {
      expect(() =>
        migrate(db, {
          migrations: [
            {
              version: 1,
              name: 'broken',
              statements: ['CREATE TABLE ok (id TEXT)', 'THIS IS NOT SQL'],
            },
          ],
        }),
      ).toThrow()
      expect(tableNames(db)).not.toContain('ok')
      expect(
        db.prepare<{ total: number }>('SELECT COUNT(*) AS total FROM schema_migrations').get(),
      ).toEqual({ total: 0 })
    } finally {
      db.close()
    }
  })
})
