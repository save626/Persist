import { describe, expect, it, vi } from 'vitest'
import {
  installMobileApiFetchBridge,
  normalizeMobileApiBaseUrl,
  rewriteMobileApiUrl,
  type MobileApiBridgeTarget,
} from './mobile-api'

describe('mobile API bridge', () => {
  it('只接受无路径的 http(s) origin', () => {
    expect(normalizeMobileApiBaseUrl(' http://192.0.2.10:8080/ ')).toBe('http://192.0.2.10:8080')
    expect(normalizeMobileApiBaseUrl('https://persist.example.com')).toBe(
      'https://persist.example.com',
    )
    expect(normalizeMobileApiBaseUrl('https://persist.example.com/api')).toBeNull()
    expect(normalizeMobileApiBaseUrl('ftp://persist.example.com')).toBeNull()
    expect(normalizeMobileApiBaseUrl('')).toBeNull()
  })

  it('只改写 API 路径', () => {
    expect(rewriteMobileApiUrl('/api/health', 'http://192.0.2.10:8080')).toBe(
      'http://192.0.2.10:8080/api/health',
    )
    expect(rewriteMobileApiUrl('/api/v1/sync/pull?since=1', 'https://persist.example.com')).toBe(
      'https://persist.example.com/api/v1/sync/pull?since=1',
    )
    expect(rewriteMobileApiUrl('/assets/app.js', 'https://persist.example.com')).toBe(
      '/assets/app.js',
    )
    expect(
      rewriteMobileApiUrl('https://other.example/api/health', 'https://persist.example.com'),
    ).toBe('https://other.example/api/health')
  })

  it('仅在 mobile surface 安装一次', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    const target = { fetch: fetchMock } as unknown as MobileApiBridgeTarget

    expect(
      installMobileApiFetchBridge({
        surface: 'web',
        baseUrl: 'https://persist.example.com',
        target,
      }),
    ).toBe(false)
    expect(target.fetch).toBe(fetchMock)

    expect(
      installMobileApiFetchBridge({
        surface: 'mobile',
        baseUrl: 'https://persist.example.com/',
        target,
      }),
    ).toBe(true)
    expect(
      installMobileApiFetchBridge({
        surface: 'mobile',
        baseUrl: 'https://persist.example.com',
        target,
      }),
    ).toBe(true)

    await target.fetch('/api/health')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://persist.example.com/api/health', undefined)
  })
})
