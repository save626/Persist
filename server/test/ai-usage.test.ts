import { describe, expect, it } from 'vitest'
import { migrate } from '../src/db/migrations.js'
import { openDatabase, type Db } from '../src/db/driver.js'
import {
  ANONYMOUS_KEY_ID,
  localDayKey,
  nextLocalMidnight,
  readAiUsage,
  reserveAiQuota,
} from '../src/ai/ai-usage.js'

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' })
  migrate(db)
  return db
}

/** 用本地时间构造时间戳：日界测试不受运行机器时区影响。 */
function local(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime()
}

describe('localDayKey', () => {
  it('按服务器本地日期出 YYYY-MM-DD', () => {
    expect(localDayKey(local(2026, 11, 17, 0))).toBe('2026-11-17')
    expect(localDayKey(local(2026, 11, 17, 23))).toBe('2026-11-17')
    // 跨过本地零点就换天，不受 UTC 影响。
    expect(localDayKey(local(2026, 11, 18, 0))).toBe('2026-11-18')
  })

  it('月份与日补零', () => {
    expect(localDayKey(local(2026, 1, 5, 9))).toBe('2026-01-05')
  })
})

describe('nextLocalMidnight', () => {
  it('返回次日零点，且与当天同一时刻的差值等于剩余时间', () => {
    const now = local(2026, 11, 17, 13)
    const midnight = nextLocalMidnight(now)
    expect(localDayKey(midnight)).toBe('2026-11-18')
    expect(new Date(midnight).getHours()).toBe(0)
    expect(new Date(midnight).getMinutes()).toBe(0)
    // 13:00 到次日 00:00 是 11 小时。
    expect(midnight - now).toBe(11 * 60 * 60 * 1000)
  })

  it('月末自动进位到下月 1 日', () => {
    const now = local(2026, 11, 30, 22)
    expect(localDayKey(nextLocalMidnight(now))).toBe('2026-12-01')
  })
})

describe('reserveAiQuota', () => {
  it('逐次累加，第 limit 次放行、第 limit+1 次拒绝', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      for (let i = 1; i <= 3; i += 1) {
        const decision = reserveAiQuota(db, { keyId: 'k1', limit: 3, now })
        expect(decision).toMatchObject({ allowed: true, used: i, limit: 3 })
      }
      const blocked = reserveAiQuota(db, { keyId: 'k1', limit: 3, now })
      expect(blocked).toMatchObject({ allowed: false, used: 3, limit: 3 })
      // 被拒时不加计数：已用仍是 3，不会把「拒绝」也算成一次调用。
      expect(readAiUsage(db, { keyId: 'k1', now }).requests).toBe(3)
    } finally {
      db.close()
    }
  })

  it('不同凭据各算各的额度', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      expect(reserveAiQuota(db, { keyId: 'k1', limit: 1, now }).allowed).toBe(true)
      expect(reserveAiQuota(db, { keyId: 'k1', limit: 1, now }).allowed).toBe(false)
      // k2 是另一套计数，不受 k1 用尽影响。
      expect(reserveAiQuota(db, { keyId: 'k2', limit: 1, now }).allowed).toBe(true)
    } finally {
      db.close()
    }
  })

  it('跨日后额度自动恢复', () => {
    const db = fresh()
    try {
      let clock = local(2026, 11, 17, 23)
      const now = () => clock
      expect(reserveAiQuota(db, { keyId: 'k1', limit: 1, now }).allowed).toBe(true)
      expect(reserveAiQuota(db, { keyId: 'k1', limit: 1, now }).allowed).toBe(false)

      clock = local(2026, 11, 18, 0)
      const next = reserveAiQuota(db, { keyId: 'k1', limit: 1, now })
      expect(next).toMatchObject({ allowed: true, used: 1 })
      expect(readAiUsage(db, { keyId: 'k1', now }).day).toBe('2026-11-18')
    } finally {
      db.close()
    }
  })

  it('limit 为 0 时关闭配额，且不写库', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      for (let i = 0; i < 5; i += 1) {
        expect(reserveAiQuota(db, { keyId: 'k1', limit: 0, now })).toMatchObject({ allowed: true })
      }
      expect(db.prepare<{ total: number }>('SELECT COUNT(*) AS total FROM ai_usage').get()).toEqual(
        { total: 0 },
      )
    } finally {
      db.close()
    }
  })

  it('keyId 为空时归到 anonymous', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      expect(reserveAiQuota(db, { keyId: null, limit: 1, now }).allowed).toBe(true)
      expect(readAiUsage(db, { keyId: ANONYMOUS_KEY_ID, now }).requests).toBe(1)
      expect(db.prepare<{ key_id: string }>('SELECT key_id FROM ai_usage').get()).toEqual({
        key_id: 'anonymous',
      })
    } finally {
      db.close()
    }
  })

  it('已用次数达到上限时不再接受，避免把上限当作软限制', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      reserveAiQuota(db, { keyId: 'k1', limit: 1, now })
      const denied = reserveAiQuota(db, { keyId: 'k1', limit: 1, now })
      expect(denied.allowed).toBe(false)
      expect(denied.resetAt).toBe(nextLocalMidnight(now()))
    } finally {
      db.close()
    }
  })
})

describe('readAiUsage', () => {
  it('没有记录时返回全 0 且不改库', () => {
    const db = fresh()
    try {
      const snapshot = readAiUsage(db, { keyId: 'k1', now: () => local(2026, 11, 17) })
      expect(snapshot).toEqual({
        day: '2026-11-17',
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        updatedAt: null,
      })
    } finally {
      db.close()
    }
  })
})
