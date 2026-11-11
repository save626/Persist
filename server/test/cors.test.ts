import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

async function withApp(
  run: (app: ReturnType<typeof buildApp>) => Promise<void>,
  env: Record<string, string> = {},
): Promise<void> {
  const config = loadConfig({ DB_PATH: ':memory:', ...env } as unknown as NodeJS.ProcessEnv)
  const app = buildApp({ config })
  try {
    await run(app)
  } finally {
    await app.close()
  }
}

describe('Capacitor CORS', () => {
  it('允许默认的 https://localhost 并回写精确 origin', async () => {
    await withApp(async (app) => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://localhost' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['access-control-allow-origin']).toBe('https://localhost')
      expect(response.headers.vary).toContain('Origin')
    })
  })

  it('允许预检并声明 Authorization / Content-Type', async () => {
    await withApp(async (app) => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/sync/push',
        headers: {
          origin: 'https://localhost',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      })
      expect(response.statusCode).toBe(204)
      expect(response.headers['access-control-allow-origin']).toBe('https://localhost')
      expect(response.headers['access-control-allow-methods']).toContain('POST')
      expect(response.headers['access-control-allow-headers']).toContain('authorization')
      expect(response.headers['access-control-allow-headers']).toContain('content-type')
    })
  })

  it('拒绝未授权来源的预检，普通请求不回写 CORS 头', async () => {
    await withApp(async (app) => {
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/health',
        headers: { origin: 'https://evil.example' },
      })
      expect(preflight.statusCode).toBe(403)
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined()

      const request = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://evil.example' },
      })
      expect(request.statusCode).toBe(200)
      expect(request.headers['access-control-allow-origin']).toBeUndefined()
    })
  })

  it('白名单可通过环境变量覆盖', async () => {
    await withApp(
      async (app) => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/health',
          headers: { origin: 'https://owner.example' },
        })
        expect(response.headers['access-control-allow-origin']).toBe('https://owner.example')
      },
      { PERSIST_ALLOWED_ORIGINS: 'https://owner.example' },
    )
  })
})
