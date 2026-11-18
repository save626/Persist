import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { buildApp } from '../src/app.js'
import type { AiClient } from '../src/ai/deepseek.js'
import { loadConfig } from '../src/config.js'
import { openPersistDatabase, type PersistDatabase } from '../src/db/index.js'
import type { ChatRequest } from '../src/contract.js'

/**
 * AI 路由改用设备令牌（`pst_`）作为首选凭据。
 *
 * 背景：`psa_` 是构建期内联在安装包里的长期密钥——开源之后任何拿到 APK 的人都能提取，
 * 且轮换必须重新打包分发。设备令牌可吊销、按账号归因，也不需要客户端藏任何秘密。
 *
 * 这里覆盖三条最容易回退的语义：
 * 1. `pst_` 在 `enforce` 下可直接调用，**不依赖** `PERSIST_AI_KEYS` 里有没有 key；
 * 2. 额度与审计归到 `user:<id>`，不再全算到那把共享密钥头上；
 * 3. 吊销设备后同一令牌立刻 401——这是 `psa_` 做不到的。
 */

const profile = {
  age: 30,
  height: 175,
  weight: 72,
  targetWeight: 68,
  goal: '减脂',
  experience: '',
  frequency: '每周 3 次',
  equipment: '居家哑铃',
  dietPreference: '',
  allergies: '',
  bedtime: '',
  sleepHours: 7,
  stress: '',
  aiConsent: true,
}

const chatRequest: ChatRequest = {
  turns: [{ role: 'user', content: '我想减脂，每周练 3 次' }],
  profile,
}

function fakeAi(): AiClient {
  return {
    async *streamChat() {
      yield '记下了。'
    },
    async completeJson() {
      return {}
    },
  }
}

interface Env {
  baseUrl: string
  db: PersistDatabase
  close: () => Promise<void>
}

async function withServer(run: (env: Env) => Promise<void>): Promise<void> {
  // 刻意不配 PERSIST_AI_KEYS：能通过说明走的是设备令牌，而不是构建期内联凭据。
  const config = loadConfig({
    DEEPSEEK_API_KEY: 'sk-test',
    RATE_LIMIT_MAX: '100',
    PERSIST_AI_GATE: 'enforce',
  } as unknown as NodeJS.ProcessEnv)
  const db = openPersistDatabase({ path: ':memory:' })
  const app = buildApp({ config, db, ai: fakeAi() })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address() as AddressInfo
  try {
    await run({
      baseUrl: `http://127.0.0.1:${address.port}`,
      db,
      close: async () => {
        await app.close()
        db.db.close()
      },
    })
  } finally {
    if (app.server.listening) await app.close()
  }
}

function postChat(baseUrl: string, token: string, body: unknown = chatRequest) {
  return fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

async function register(baseUrl: string): Promise<{ userId: string; token: string; deviceId: string }> {
  const response = await fetch(`${baseUrl}/api/v1/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { userId: string; token: string; deviceId: string }
}

describe('/api/chat：设备令牌作为 AI 凭据', () => {
  it('未配置 psa_ 时，真实设备令牌仍可调用', async () => {
    await withServer(async ({ baseUrl, close }) => {
      try {
        const { token } = await register(baseUrl)
        const response = await postChat(baseUrl, token)
        expect(response.status).toBe(200)
        expect(await response.text()).toContain('记下了')
      } finally {
        await close()
      }
    })
  })

  it('额度与审计归到 user:<id>，不再共用一把 key', async () => {
    await withServer(async ({ baseUrl, db, close }) => {
      try {
        const { userId, token } = await register(baseUrl)
        await postChat(baseUrl, token)

        const usage = db.db
          .prepare<{ requests: number }>('SELECT requests FROM ai_usage WHERE key_id = ?')
          .get(`user:${userId}`)
        expect(usage?.requests).toBe(1)

        const audit = db.db
          .prepare<{ key_id: string; route: string }>('SELECT key_id, route FROM ai_calls ORDER BY id')
          .all()
        expect(audit[0]?.key_id).toBe(`user:${userId}`)
        expect(audit[0]?.route).toBe('/api/chat')
      } finally {
        await close()
      }
    })
  })

  it('吊销设备后同一令牌立即 401（psa_ 做不到这件事）', async () => {
    await withServer(async ({ baseUrl, close }) => {
      try {
        const { token } = await register(baseUrl)
        expect((await postChat(baseUrl, token)).status).toBe(200)

        const revoked = await fetch(`${baseUrl}/api/v1/devices/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        })
        expect(revoked.status).toBe(200)

        expect((await postChat(baseUrl, token)).status).toBe(401)
      } finally {
        await close()
      }
    })
  })

  it('伪造的 pst_ 与无凭据的响应完全一致', async () => {
    await withServer(async ({ baseUrl, close }) => {
      try {
        const missing = await postChat(baseUrl, '')
        const forged = await postChat(baseUrl, 'pst_not-a-real-token')
        expect(forged.status).toBe(401)
        expect(await forged.text()).toBe(await missing.text())
      } finally {
        await close()
      }
    })
  })
})
