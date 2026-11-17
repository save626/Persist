import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { openDatabase, type Db } from '../src/db/driver.js'
import { migrate } from '../src/db/migrations.js'
import { openPersistDatabase, type PersistDatabase } from '../src/db/index.js'
import { AUDIT_LOG_PRUNE_BATCH, pruneAuditLog, recordAuditEvent } from '../src/audit/audit-log.js'
import { hashIp } from '../src/ai/ai-audit.js'
import { AI_AUDIT_PRUNE_JOB, runAiAuditPrune } from '../src/jobs/ai-audit-prune.js'

/**
 * 数据操作审计（P5-2）：`audit_log` 的写入、保留期清理，以及各破坏性接口是否真的留痕。
 * 路由部分走 `app.inject`（不起端口），库用 `:memory:`，用例之间互不影响。
 */

const NOW = Date.UTC(2026, 10, 17, 9, 0, 0)
const DAY_MS = 86_400_000

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' })
  migrate(db)
  return db
}

interface Row {
  id: number
  user_id: string | null
  actor: string
  action: string
  target: string | null
  result: string
  detail_json: string | null
  ip_hash: string | null
  created_at: number
}

function rows(db: Db): Row[] {
  return db.prepare<Row>('SELECT * FROM audit_log ORDER BY id').all()
}

describe('recordAuditEvent', () => {
  it('写入一行，默认 actor=user / result=ok，IP 只留哈希', () => {
    const db = fresh()
    recordAuditEvent(db, {
      userId: 'usr_1',
      action: 'device.create',
      target: 'dev_1',
      ip: '203.0.113.7',
      now: () => NOW,
    })

    const [row] = rows(db)
    expect(row).toMatchObject({
      user_id: 'usr_1',
      actor: 'user',
      action: 'device.create',
      target: 'dev_1',
      result: 'ok',
      created_at: NOW,
      detail_json: null,
    })
    // 明文 IP 绝不落库；哈希是 sha256 前 16 位。
    expect(row?.ip_hash).toBe(hashIp('203.0.113.7'))
    expect(row?.ip_hash).toHaveLength(16)
    expect(JSON.stringify(row)).not.toContain('203.0.113.7')
  })

  it('detail 序列化后超长就整条丢弃，不写半段 JSON', () => {
    const db = fresh()
    recordAuditEvent(db, {
      action: 'backup.create',
      detail: { blob: 'x'.repeat(5_000) },
      now: () => NOW,
    })
    expect(rows(db)[0]?.detail_json).toBeNull()
  })

  it('detail 有循环引用时不抛错，只是不写 detail', () => {
    const db = fresh()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() =>
      recordAuditEvent(db, { action: 'backup.create', detail: circular, now: () => NOW }),
    ).not.toThrow()
    expect(rows(db)).toHaveLength(1)
    expect(rows(db)[0]?.detail_json).toBeNull()
  })

  it('表不存在时也不抛错（审计是旁路，不能把正常请求变成 500）', () => {
    const bare = openDatabase({ path: ':memory:' })
    const seen: unknown[] = []
    expect(() =>
      recordAuditEvent(
        bare,
        { action: 'export.read', now: () => NOW },
        (error) => seen.push(error),
      ),
    ).not.toThrow()
    expect(seen).toHaveLength(1)
    bare.close()
  })
})

describe('pruneAuditLog', () => {
  it('只删 cutoff 之前的行，边界用严格小于', () => {
    const db = fresh()
    for (const at of [NOW - 40 * DAY_MS, NOW - 3 * DAY_MS, NOW]) {
      recordAuditEvent(db, { action: 'export.read', now: () => at })
    }
    const cutoff = NOW - 30 * DAY_MS
    expect(pruneAuditLog(db, cutoff)).toBe(1)
    expect(rows(db).map((row) => row.created_at)).toEqual([NOW - 3 * DAY_MS, NOW])

    // 恰好等于 cutoff 的那条不算过期。
    recordAuditEvent(db, { action: 'export.read', now: () => cutoff })
    expect(pruneAuditLog(db, cutoff)).toBe(0)
  })

  it('分批删也能删干净（batch 小于总行数）', () => {
    const db = fresh()
    for (let index = 0; index < 7; index += 1) {
      recordAuditEvent(db, { action: 'export.read', now: () => NOW - 40 * DAY_MS + index })
    }
    expect(AUDIT_LOG_PRUNE_BATCH).toBeGreaterThan(0)
    expect(pruneAuditLog(db, NOW - 30 * DAY_MS, 2)).toBe(7)
    expect(rows(db)).toHaveLength(0)
  })
})

interface Env {
  app: FastifyInstance
  database: PersistDatabase
}

function setup(env: Record<string, string> = {}): Env {
  const config = loadConfig({ DEEPSEEK_API_KEY: '', ...env } as unknown as NodeJS.ProcessEnv)
  const database = openPersistDatabase({ path: ':memory:' })
  // 必须传 `db`：`buildApp` 不传时会自己开一个内存库，写进去的审计行读不到。
  const app = buildApp({ config, db: database })
  return { app, database }
}

interface Credentials {
  userId: string
  deviceId: string
  token: string
  recoveryCode: string
}

async function register(app: FastifyInstance): Promise<Credentials> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/devices', payload: {} })
  expect(response.statusCode).toBe(201)
  return response.json<Credentials>()
}

describe('接口留痕', () => {
  it('注册账号记 device.create，吊销设备记 device.revoke（区分吊销自己）', async () => {
    const { app, database } = setup()
    const credentials = await register(app)

    const registered = rows(database.db)
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({
      user_id: credentials.userId,
      action: 'device.create',
      target: credentials.deviceId,
      result: 'ok',
    })

    const revoke = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/revoke',
      headers: { authorization: `Bearer ${credentials.token}` },
      payload: {},
    })
    expect(revoke.statusCode).toBe(200)

    const after = rows(database.db)
    expect(after).toHaveLength(2)
    expect(after[1]).toMatchObject({ action: 'device.revoke', target: credentials.deviceId })
    expect(after[1]?.detail_json).toBe('{"self":true}')

    await app.close()
    database.db.close()
  })

  it('恢复码换设备记 device.restore', async () => {
    const { app, database } = setup()
    const credentials = await register(app)

    const restored = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/restore',
      payload: { recoveryCode: credentials.recoveryCode },
    })
    expect(restored.statusCode).toBe(200)

    const last = rows(database.db).at(-1)
    expect(last).toMatchObject({ action: 'device.restore', user_id: credentials.userId })
    expect(last?.target).not.toBe(credentials.deviceId)

    await app.close()
    database.db.close()
  })

  it('导出记 export.read', async () => {
    const { app, database } = setup()
    const credentials = await register(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/export',
      headers: { authorization: `Bearer ${credentials.token}` },
    })
    expect(response.statusCode).toBe(200)

    const last = rows(database.db).at(-1)
    expect(last).toMatchObject({ action: 'export.read', result: 'ok' })
    // detail 只放时间，不放任何业务内容。
    expect(Object.keys(JSON.parse(last?.detail_json ?? '{}'))).toEqual(['exportedAt'])

    await app.close()
    database.db.close()
  })

  it('删账号记 account.delete，并把该账号的历史行 user_id 置空（行保留）', async () => {
    const { app, database } = setup()
    const credentials = await register(app)

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/account',
      headers: { authorization: `Bearer ${credentials.token}` },
      payload: { confirm: true },
    })
    expect(response.statusCode).toBe(200)

    const all = rows(database.db)
    // device.create 那行没被删，只是不再指向已删除的账号。
    expect(all.length).toBeGreaterThanOrEqual(2)
    expect(all.some((row) => row.action === 'device.create')).toBe(true)
    expect(all.every((row) => row.user_id === null)).toBe(true)

    const deleted = all.at(-1)
    expect(deleted).toMatchObject({ action: 'account.delete', result: 'ok', user_id: null })
    expect(JSON.parse(deleted?.detail_json ?? '{}')).toMatchObject({ devices: 1 })

    await app.close()
    database.db.close()
  })
})

describe('清理任务覆盖 audit_log', () => {
  it('同一任务按各自保留期删两张表', () => {
    const db = fresh()
    recordAuditEvent(db, { action: 'export.read', now: () => NOW - 40 * DAY_MS })
    recordAuditEvent(db, { action: 'export.read', now: () => NOW - 3 * DAY_MS })

    const outcome = runAiAuditPrune({
      db,
      config: { aiAuditKeepDays: 30, auditLogKeepDays: 30 },
      now: () => NOW,
    })

    expect(outcome.status).toBe('pruned')
    expect(outcome.status === 'pruned' && outcome.deletedAudit).toBe(1)
    expect(rows(db)).toHaveLength(1)
    expect(
      db.prepare<{ name: string }>('SELECT name FROM job_runs').get()?.name,
    ).toBe(AI_AUDIT_PRUNE_JOB)
  })

  it('只关掉 audit_log 这一维时，AI 侧照旧清理', () => {
    const db = fresh()
    recordAuditEvent(db, { action: 'export.read', now: () => NOW - 40 * DAY_MS })

    const outcome = runAiAuditPrune({
      db,
      config: { aiAuditKeepDays: 30, auditLogKeepDays: 0 },
      now: () => NOW,
    })

    expect(outcome.status).toBe('pruned')
    expect(outcome.status === 'pruned' && outcome.deletedAudit).toBe(0)
    expect(rows(db)).toHaveLength(1)
  })
})
