import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig, parseTrustProxy } from '../src/config.js'

/**
 * 来源 IP 的可信度是 IP 限流的地基：`enforceRateLimit` 的桶键就是 `request.ip`。
 *
 * 生产链路是 `客户端 → Nginx → 127.0.0.1:3000`，Nginx 用
 * `$proxy_add_x_forwarded_for` **追加**真实来源，所以上游收到的 XFF 形如
 * `<客户端自己填的>, <真实 IP>`。只要信任链配得对，伪造的前缀会被丢弃；
 * 一旦 `trustProxy: true`，Fastify 会取列表最左边那个值 —— 也就是攻击者
 * 随手填的值，等于把限流桶的钥匙交给对方。
 *
 * 这里用「不同伪造前缀是否落入同一个桶」来间接观察 `request.ip`，
 * 因为它正是业务代码真正消费的那个值。
 */

type ParseArgs = Parameters<typeof loadConfig>[0]

async function withApp(
  run: (app: ReturnType<typeof buildApp>) => Promise<void>,
  env: Record<string, string> = {},
): Promise<void> {
  const config = loadConfig({ DB_PATH: ':memory:', ...env } as unknown as ParseArgs)
  const app = buildApp({ config })
  try {
    await run(app)
  } finally {
    await app.close()
  }
}

/** 打一个「先限流、后鉴权」的接口：无令牌返回 401，被限流返回 429。 */
async function hitSync(
  app: ReturnType<typeof buildApp>,
  forwardedFor: string,
): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/bootstrap',
    headers: { 'x-forwarded-for': forwardedFor },
    payload: {},
  })
  return response.statusCode
}

describe('X-Forwarded-For 信任链', () => {
  it('默认只信任回环代理：换一个伪造前缀仍然落在同一个限流桶', async () => {
    await withApp(
      async (app) => {
        expect(await hitSync(app, '9.9.9.9, 203.0.113.7')).toBe(401)
        // 伪造值换成 8.8.8.8，真实来源仍是 203.0.113.7 → 同一个桶 → 被限流
        expect(await hitSync(app, '8.8.8.8, 203.0.113.7')).toBe(429)
      },
      { SYNC_RATE_LIMIT_MAX: '1' },
    )
  })

  it('真实来源不同则各占一个桶，不会被误伤', async () => {
    await withApp(
      async (app) => {
        expect(await hitSync(app, '203.0.113.7')).toBe(401)
        expect(await hitSync(app, '198.51.100.9')).toBe(401)
      },
      { SYNC_RATE_LIMIT_MAX: '1' },
    )
  })

  it('TRUST_PROXY=true 会采信伪造前缀（修复前的漏洞形态，仅作回归对照）', async () => {
    await withApp(
      async (app) => {
        expect(await hitSync(app, '9.9.9.9, 203.0.113.7')).toBe(401)
        // 同一个真实来源，仅靠伪造前缀就换到了新桶 → 限流被绕过
        expect(await hitSync(app, '8.8.8.8, 203.0.113.7')).toBe(401)
      },
      { SYNC_RATE_LIMIT_MAX: '1', TRUST_PROXY: 'true' },
    )
  })

  it('TRUST_PROXY=false 时完全忽略 XFF，退回 socket 对端地址', async () => {
    await withApp(
      async (app) => {
        expect(await hitSync(app, '203.0.113.7')).toBe(401)
        // inject 的对端固定是 127.0.0.1，伪造 XFF 不再有任何作用
        expect(await hitSync(app, '198.51.100.9')).toBe(429)
      },
      { SYNC_RATE_LIMIT_MAX: '1', TRUST_PROXY: '0' },
    )
  })
})

describe('parseTrustProxy', () => {
  it('留空回到只信任回环代理的安全默认值', () => {
    expect(parseTrustProxy(undefined)).toBe('loopback')
    expect(parseTrustProxy('   ')).toBe('loopback')
  })

  it('关闭与全信的多种写法', () => {
    for (const value of ['0', 'false', 'OFF', 'no', 'none']) {
      expect(parseTrustProxy(value)).toBe(false)
    }
    for (const value of ['1', 'true', 'ALL', 'yes', 'on']) {
      expect(parseTrustProxy(value)).toBe(true)
    }
  })

  it('网段与单 IP 原样透传，供代理不在本机的部署使用', () => {
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8')
    expect(parseTrustProxy(' 192.0.2.1 ')).toBe('192.0.2.1')
  })
})
