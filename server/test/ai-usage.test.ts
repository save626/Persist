import { describe, expect, it } from 'vitest'
import { migrate } from '../src/db/migrations.js'
import { openDatabase, type Db } from '../src/db/driver.js'
import {
  ANONYMOUS_KEY_ID,
  addAiTokens,
  isAiQuotaEnabled,
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
        const decision = reserveAiQuota(db, { keyId: 'k1', requestLimit: 3, now })
        expect(decision).toMatchObject({ allowed: true, used: i, limit: 3 })
      }
      const blocked = reserveAiQuota(db, { keyId: 'k1', requestLimit: 3, now })
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
      expect(reserveAiQuota(db, { keyId: 'k1', requestLimit: 1, now }).allowed).toBe(true)
      expect(reserveAiQuota(db, { keyId: 'k1', requestLimit: 1, now }).allowed).toBe(false)
      // k2 是另一套计数，不受 k1 用尽影响。
      expect(reserveAiQuota(db, { keyId: 'k2', requestLimit: 1, now }).allowed).toBe(true)
    } finally {
      db.close()
    }
  })

  it('跨日后额度自动恢复', () => {
    const db = fresh()
    try {
      let clock = local(2026, 11, 17, 23)
      const now = () => clock
      expect(reserveAiQuota(db, { keyId: 'k1', requestLimit: 1, now }).allowed).toBe(true)
      expect(reserveAiQuota(db, { keyId: 'k1', requestLimit: 1, now }).allowed).toBe(false)

      clock = local(2026, 11, 18, 0)
      const next = reserveAiQuota(db, { keyId: 'k1', requestLimit: 1, now })
      expect(next).toMatchObject({ allowed: true, used: 1 })
      expect(readAiUsage(db, { keyId: 'k1', now }).day).toBe('2026-11-18')
    } finally {
      db.close()
    }
  })

  it('两维都为 0 时关闭配额，且不写库', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      for (let i = 0; i < 5; i += 1) {
        expect(
          reserveAiQuota(db, { keyId: 'k1', requestLimit: 0, tokenLimit: 0, now }),
        ).toMatchObject({ allowed: true })
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
      expect(reserveAiQuota(db, { keyId: null, requestLimit: 1, now }).allowed).toBe(true)
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
      reserveAiQuota(db, { keyId: 'k1', requestLimit: 1, now })
      const denied = reserveAiQuota(db, { keyId: 'k1', requestLimit: 1, now })
      expect(denied.allowed).toBe(false)
      expect(denied.reason).toBe('requests')
      expect(denied.resetAt).toBe(nextLocalMidnight(now()))
    } finally {
      db.close()
    }
  })

  it('token 用满后按 token 理由拒绝，即使次数还富余', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      addAiTokens(db, { keyId: 'k1', promptTokens: 900, completionTokens: 120, now })
      const denied = reserveAiQuota(db, { keyId: 'k1', requestLimit: 100, tokenLimit: 1_000, now })
      expect(denied).toMatchObject({
        allowed: false,
        reason: 'tokens',
        used: 0,
        limit: 100,
        tokensUsed: 1_020,
        tokenLimit: 1_000,
      })
      // 被拒时不加次数。
      expect(readAiUsage(db, { keyId: 'k1', now }).requests).toBe(0)
    } finally {
      db.close()
    }
  })

  it('token 未到上限时放行，次数与 token 各记一套', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      addAiTokens(db, { keyId: 'k1', promptTokens: 500, completionTokens: 100, now })
      const allowed = reserveAiQuota(db, {
        keyId: 'k1',
        requestLimit: 10,
        tokenLimit: 5_000,
        now,
      })
      expect(allowed).toMatchObject({ allowed: true, used: 1, tokensUsed: 600, tokenLimit: 5_000 })
      expect(readAiUsage(db, { keyId: 'k1', now })).toMatchObject({
        requests: 1,
        promptTokens: 500,
        completionTokens: 100,
        tokens: 600,
      })
    } finally {
      db.close()
    }
  })

  it('只开 token 维度时仍然按次计数（否则看不出「今天用了几次」）', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      const first = reserveAiQuota(db, { keyId: 'k1', requestLimit: 0, tokenLimit: 1_000, now })
      expect(first).toMatchObject({ allowed: true, used: 1, limit: 0 })
      expect(
        reserveAiQuota(db, { keyId: 'k1', requestLimit: 0, tokenLimit: 1_000, now }),
      ).toMatchObject({ allowed: true, used: 2 })
    } finally {
      db.close()
    }
  })
})

describe('addAiTokens', () => {
  it('同一请求的两次模型调用累加到同一行', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      addAiTokens(db, { keyId: 'k1', promptTokens: 300, completionTokens: 120, now })
      addAiTokens(db, { keyId: 'k1', promptTokens: 200, completionTokens: 30, now })
      expect(readAiUsage(db, { keyId: 'k1', now })).toMatchObject({
        promptTokens: 500,
        completionTokens: 150,
        tokens: 650,
      })
    } finally {
      db.close()
    }
  })

  it('不覆盖当日已有计数：只加 token，次数不动', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      reserveAiQuota(db, { keyId: 'k1', requestLimit: 10, now })
      addAiTokens(db, { keyId: 'k1', promptTokens: 100, completionTokens: 50, now })
      expect(readAiUsage(db, { keyId: 'k1', now })).toMatchObject({ requests: 1, tokens: 150 })
    } finally {
      db.close()
    }
  })

  it('两项都为 0 时不写库（上游没给 usage）', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      addAiTokens(db, { keyId: 'k1', promptTokens: 0, completionTokens: 0, now })
      expect(db.prepare<{ total: number }>('SELECT COUNT(*) AS total FROM ai_usage').get()).toEqual(
        { total: 0 },
      )
    } finally {
      db.close()
    }
  })

  it('负数与小数被收敛，不会把账记成负的', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      addAiTokens(db, { keyId: 'k1', promptTokens: -50, completionTokens: 99.9, now })
      expect(readAiUsage(db, { keyId: 'k1', now })).toMatchObject({
        promptTokens: 0,
        completionTokens: 99,
        tokens: 99,
      })
    } finally {
      db.close()
    }
  })

  it('跨日各记一行', () => {
    const db = fresh()
    try {
      let clock = local(2026, 11, 17, 23)
      addAiTokens(db, { keyId: 'k1', promptTokens: 10, completionTokens: 10, now: () => clock })
      clock = local(2026, 11, 18, 1)
      addAiTokens(db, { keyId: 'k1', promptTokens: 20, completionTokens: 20, now: () => clock })
      expect(readAiUsage(db, { keyId: 'k1', now: () => clock }).tokens).toBe(40)
      expect(db.prepare<{ total: number }>('SELECT COUNT(*) AS total FROM ai_usage').get()).toEqual(
        { total: 2 },
      )
    } finally {
      db.close()
    }
  })

  it('keyId 为空时归到 anonymous', () => {
    const db = fresh()
    try {
      const now = () => local(2026, 11, 17)
      addAiTokens(db, { keyId: null, promptTokens: 7, completionTokens: 3, now })
      expect(readAiUsage(db, { keyId: ANONYMOUS_KEY_ID, now }).tokens).toBe(10)
    } finally {
      db.close()
    }
  })
})

describe('isAiQuotaEnabled', () => {
  it('任一维度为正即启用', () => {
    expect(isAiQuotaEnabled({ requestLimit: 100, tokenLimit: 0 })).toBe(true)
    expect(isAiQuotaEnabled({ requestLimit: 0, tokenLimit: 200_000 })).toBe(true)
    expect(isAiQuotaEnabled({ requestLimit: 0, tokenLimit: 0 })).toBe(false)
    expect(isAiQuotaEnabled({ requestLimit: -1, tokenLimit: Number.NaN })).toBe(false)
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
        tokens: 0,
        updatedAt: null,
      })
    } finally {
      db.close()
    }
  })
})
