import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { assessStorage, readStorage } from '../src/routes/health.js'

describe('健康检查的磁盘水位：', () => {
  it('按 df 口径算使用率，到阈值报 warn：', () => {
    // used = blocks - bfree = 80，分母 = used + avail = 90 → 88.9% ≥ 85 → warn
    expect(assessStorage({ blocks: 100, bfree: 20, bavail: 10 }, 85)).toEqual({
      usedPercent: 88.9,
      status: 'warn',
    })
    // used = 60，分母 = 70 → 85.7% ≥ 85 → warn（阈值是「大于等于」）
    expect(assessStorage({ blocks: 100, bfree: 40, bavail: 10 }, 85).status).toBe('warn')
    // used = 60，分母 = 90 → 66.7% < 85 → ok
    expect(assessStorage({ blocks: 100, bfree: 40, bavail: 30 }, 85)).toEqual({
      usedPercent: 66.7,
      status: 'ok',
    })
    // 极端值不产生 NaN
    expect(assessStorage({ blocks: 0, bfree: 0, bavail: 0 }, 85)).toEqual({
      usedPercent: 0,
      status: 'ok',
    })
  })

  it('读不到分区时返回 null，不抛错：', () => {
    expect(
      readStorage(join(tmpdir(), 'persist-health-missing-dir', 'persist.sqlite'), 85),
    ).toBeNull()
    const current = readStorage(':memory:', 85)
    expect(current).not.toBeNull()
    expect(typeof current?.usedPercent).toBe('number')
  })
})

describe('GET /api/health：', () => {
  it('返回 200，并带向后兼容的 storage / warnings 字段：', async () => {
    const config = loadConfig({ DB_PATH: ':memory:' } as unknown as NodeJS.ProcessEnv)
    const app = buildApp({ config })
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' })
      expect(response.statusCode).toBe(200)
      const body = response.json() as {
        status: string
        service: string
        ai: string
        db: string
        version: number
        storage: { usedPercent: number; status: string } | null
        warnings: string[]
      }
      expect(body.status).toBe('ok')
      expect(body.service).toBe('persist-server')
      expect(body.db).toBe('ok')
      expect(typeof body.version).toBe('number')
      expect(Array.isArray(body.warnings)).toBe(true)
      // 本机磁盘远没到 85%，所以是 ok 且没有告警；字段本身必须在。
      expect(body.storage?.status).toBe('ok')
      expect(body.warnings).toEqual([])
    } finally {
      await app.close()
    }
  })
})
