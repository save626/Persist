import { describe, expect, it } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { openPersistDatabase } from '../src/db/index.js'
import { createUser } from '../src/db/repositories/devices.js'
import { enforceAiConsent } from '../src/routes/guards.js'
import { seedProfile } from './helpers/analysis-fixtures.js'

function seedUser(db: ReturnType<typeof openPersistDatabase>, id: string): void {
  createUser(db.db, { id, recoveryHash: `hash-${id}`, now: 1_000 })
}

function harness() {
  const db = openPersistDatabase({ path: ':memory:' })
  const written: { status?: number; body?: unknown } = {}
  const reply = {
    header() {
      return this
    },
    code(status: number) {
      written.status = status
      return this
    },
    send(body: unknown) {
      written.body = body
      return this
    },
  } as unknown as FastifyReply
  const request = {
    url: '/api/chat',
    log: { warn() {} },
  } as unknown as FastifyRequest
  return { db, reply, request, written }
}

describe('enforceAiConsent（服务端强制 AI 授权）', () => {
  it('keyId 无 userId（旧 psa_ 凭据）时放行', () => {
    const { db, reply, request } = harness()
    try {
      expect(
        enforceAiConsent({ db: db.db, gate: { keyId: 'k1:hash' }, request, reply }),
      ).toBe(true)
    } finally {
      db.db.close()
    }
  })

  it('未同步 profile 时放行（数据缺失不等于用户关闭）', () => {
    const { db, reply, request } = harness()
    try {
      expect(
        enforceAiConsent({ db: db.db, gate: { keyId: 'user:usr_never_synced' }, request, reply }),
      ).toBe(true)
    } finally {
      db.db.close()
    }
  })

  it('aiConsent 明确为 false 时返回 403 ai_consent_off', () => {
    const { db, reply, request, written } = harness()
    try {
      seedUser(db, 'usr_off')
      seedProfile(db.db, 'usr_off', { aiConsent: false }, 1_000)
      expect(
        enforceAiConsent({ db: db.db, gate: { keyId: 'user:usr_off' }, request, reply }),
      ).toBe(false)
      expect(written.status).toBe(403)
      expect(JSON.stringify(written.body)).toContain('ai_consent_off')
    } finally {
      db.db.close()
    }
  })

  it('aiConsent 为 true 时放行', () => {
    const { db, reply, request } = harness()
    try {
      seedUser(db, 'usr_on')
      seedProfile(db.db, 'usr_on', { aiConsent: true }, 1_000)
      expect(
        enforceAiConsent({ db: db.db, gate: { keyId: 'user:usr_on' }, request, reply }),
      ).toBe(true)
    } finally {
      db.db.close()
    }
  })
})
