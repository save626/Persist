import { describe, expect, it } from 'vitest'
import { DEFAULT_DEEPSEEK_BASE_URL, loadConfig } from '../src/config.js'

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv
}

describe('loadConfig', () => {
  it('空环境使用安全默认值：只监听回环、无密钥', () => {
    const config = loadConfig(env({}))
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(3000)
    expect(config.deepseekApiKey).toBe(null)
    expect(config.deepseekBaseUrl).toBe(DEFAULT_DEEPSEEK_BASE_URL)
    expect(config.aiTimeoutMs).toBe(25_000)
    expect(config.aiMaxRetries).toBe(1)
    expect(config.rateLimitMax).toBe(20)
  })

  it('解析环境变量并去掉密钥首尾空白', () => {
    const config = loadConfig(
      env({
        HOST: '0.0.0.0',
        PORT: '3100',
        DEEPSEEK_API_KEY: '  sk-test  ',
        DEEPSEEK_BASE_URL: 'https://proxy.example.com/',
        DEEPSEEK_MODEL: 'deepseek-reasoner',
        AI_TIMEOUT_MS: '8000',
        AI_MAX_RETRIES: '0',
        RATE_LIMIT_MAX: '5',
        RATE_LIMIT_WINDOW_MS: '60000',
        TRUST_PROXY: '0',
      }),
    )
    expect(config.host).toBe('0.0.0.0')
    expect(config.port).toBe(3100)
    expect(config.deepseekApiKey).toBe('sk-test')
    expect(config.deepseekBaseUrl).toBe('https://proxy.example.com')
    expect(config.deepseekModel).toBe('deepseek-reasoner')
    expect(config.aiTimeoutMs).toBe(8000)
    expect(config.aiMaxRetries).toBe(0)
    expect(config.rateLimitMax).toBe(5)
    expect(config.rateLimitWindowMs).toBe(60_000)
    expect(config.trustProxy).toBe(false)
  })

  it('非法数字回落默认值，端口被限制在合法范围', () => {
    const config = loadConfig(
      env({ PORT: 'not-a-number', AI_TIMEOUT_MS: '-5', RATE_LIMIT_MAX: '999999' }),
    )
    expect(config.port).toBe(3000)
    expect(config.aiTimeoutMs).toBe(1_000)
    expect(config.rateLimitMax).toBe(1_000)
  })

  it('空密钥视为未配置', () => {
    expect(loadConfig(env({ DEEPSEEK_API_KEY: '   ' })).deepseekApiKey).toBe(null)
  })
})
