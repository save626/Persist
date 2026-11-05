import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../src/db/driver.js'

const opened: Db[] = []

function memory(): Db {
  const db = openDatabase({ path: ':memory:' })
  opened.push(db)
  return db
}

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close()
})

describe('openDatabase', () => {
  it('建表、写入、读回：run 返回受影响行数，get 缺行返回 null', () => {
    const db = memory()
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, value INTEGER NOT NULL)')
    expect(db.prepare('INSERT INTO t (id, value) VALUES (?, ?)').run('a', 1)).toEqual({
      changes: 1,
    })
    expect(db.prepare<{ value: number }>('SELECT value FROM t WHERE id = ?').get('a')).toEqual({
      value: 1,
    })
    expect(db.prepare('SELECT value FROM t WHERE id = ?').get('missing')).toBe(null)
    expect(db.prepare<{ value: number }>('SELECT value FROM t ORDER BY id').all()).toEqual([
      { value: 1 },
    ])
  })

  it('事务：正常返回提交，抛错回滚', () => {
    const db = memory()
    db.exec('CREATE TABLE t (value INTEGER NOT NULL)')
    db.transaction(() => {
      db.prepare('INSERT INTO t (value) VALUES (?)').run(1)
    })
    expect(db.prepare<{ total: number }>('SELECT COUNT(*) AS total FROM t').get()).toEqual({
      total: 1,
    })

    expect(() =>
      db.transaction(() => {
        db.prepare('INSERT INTO t (value) VALUES (?)').run(2)
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(db.prepare<{ total: number }>('SELECT COUNT(*) AS total FROM t').get()).toEqual({
      total: 1,
    })
  })

  it('嵌套事务用 savepoint：只回滚内层，外层照常提交', () => {
    const db = memory()
    db.exec('CREATE TABLE t (value INTEGER NOT NULL)')
    db.transaction(() => {
      db.prepare('INSERT INTO t (value) VALUES (?)').run(1)
      expect(() =>
        db.transaction(() => {
          db.prepare('INSERT INTO t (value) VALUES (?)').run(2)
          throw new Error('inner')
        }),
      ).toThrow('inner')
      db.prepare('INSERT INTO t (value) VALUES (?)').run(3)
    })
    expect(
      db
        .prepare<{ value: number }>('SELECT value FROM t ORDER BY value')
        .all()
        .map((row) => row.value),
    ).toEqual([1, 3])
  })

  it('开启外键：引用不存在的 user 会被拒绝', () => {
    const db = memory()
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)')
    db.exec(
      'CREATE TABLE devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id))',
    )
    expect(() =>
      db.prepare('INSERT INTO devices (id, user_id) VALUES (?, ?)').run('d1', 'u1'),
    ).toThrow()
  })

  it('文件库：数据落盘，关掉重开仍在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'persist-db-'))
    const file = join(dir, 'persist.sqlite')
    try {
      const first = openDatabase({ path: file })
      first.exec('CREATE TABLE t (value INTEGER NOT NULL)')
      first.prepare('INSERT INTO t (value) VALUES (?)').run(7)
      first.close()

      const second = openDatabase({ path: file })
      try {
        expect(second.prepare<{ value: number }>('SELECT value FROM t').get()).toEqual({ value: 7 })
      } finally {
        second.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
