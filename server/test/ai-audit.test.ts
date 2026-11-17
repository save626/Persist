import { describe, expect, it } from 'vitest'
import { migrate } from '../src/db/migrations.js'
import { openDatabase, type Db } from '../src/db/driver.js'
import { hashIp, listRecentAiCalls, recordAiCall } from '../src/ai/ai-audit.js'

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' })
  migrate(db)
  return db
}

describe('hashIp', () => {
  it('空值返回 null，正常值返回 16 位十六进制', () => {
    expect(hashIp(null)).toBeNull()
    expect(hashIp('')).toBeNull()
    expect(hashIp(undefined)).toBeNull()
    const hashed = hashIp('39.149.83.157')
    expect(hashed).toMatch(/^[0-9a-f]{16}$/)
  })

  it('同一 IP 稳定、不同 IP 不同', () => {
    expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'))
    expect(hashIp('1.2.3.4')).not.toBe(hashIp('1.2.3.5'))
  })

  it('不包含 IP 明文', () => {
    const hashed = hashIp('39.149.83.157')
    expect(hashed).not.toContain('39.149')
  })
})

describe('recordAiCall', () => {
  it('写入一条完整审计', () => {
    const db = fresh()
    try {
      recordAiCall(db, {
        keyId: 'k1',
        route: '/api/report',
        result: 'ok',
        httpStatus: 200,
        model: 'deepseek-chat',
        latencyMs: 2380.7,
        ip: '39.149.83.157',
        now: () => 1_790_000_000_000,
      })
      const rows = listRecentAiCalls(db)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        key_id: 'k1',
        route: '/api/report',
        model: 'deepseek-chat',
        result: 'ok',
        http_status: 200,
        latency_ms: 2380,
        created_at: 1_790_000_000_000,
      })
      // 落库的是哈希，不是 IP 明文。
      expect(rows[0]?.ip_hash).toBe(hashIp('39.149.83.157'))
      expect(JSON.stringify(rows[0])).not.toContain('39.149.83.157')
    } finally {
      db.close()
    }
  })

  it('keyId 为空时落 anonymous，可选字段为空时落 null', () => {
    const db = fresh()
    try {
      recordAiCall(db, {
        keyId: null,
        route: '/api/chat',
        result: 'client_closed',
        httpStatus: 200,
        now: () => 1,
      })
      expect(listRecentAiCalls(db)[0]).toMatchObject({
        key_id: 'anonymous',
        model: null,
        latency_ms: null,
        ip_hash: null,
      })
    } finally {
      db.close()
    }
  })

  it('写失败不抛错：审计是旁路，不能把正常请求变成 500', () => {
    const db = fresh()
    db.close()
    const errors: unknown[] = []
    expect(() =>
      recordAiCall(
        db,
        { keyId: 'k1', route: '/api/chat', result: 'ok', httpStatus: 200, now: () => 1 },
        (error) => errors.push(error),
      ),
    ).not.toThrow()
    expect(errors).toHaveLength(1)
  })

  it('表里没有任何存放请求正文的列', () => {
    const db = fresh()
    try {
      const columns = db
        .prepare<{ name: string }>("SELECT name FROM pragma_table_info('ai_calls') ORDER BY cid")
        .all()
        .map((row) => row.name)
      expect(columns).toEqual([
        'id',
        'key_id',
        'route',
        'model',
        'result',
        'http_status',
        'prompt_tokens',
        'completion_tokens',
        'latency_ms',
        'ip_hash',
        'created_at',
      ])
    } finally {
      db.close()
    }
  })
})

describe('listRecentAiCalls', () => {
  it('按倒序返回，数量受 limit 约束', () => {
    const db = fresh()
    try {
      for (let i = 0; i < 3; i += 1) {
        recordAiCall(db, {
          keyId: 'k1',
          route: `/api/r${i}`,
          result: 'ok',
          httpStatus: 200,
          now: () => i,
        })
      }
      const rows = listRecentAiCalls(db, 2)
      expect(rows).toHaveLength(2)
      expect(rows.map((row) => row.route)).toEqual(['/api/r2', '/api/r1'])
    } finally {
      db.close()
    }
  })
})
