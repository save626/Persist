import { describe, expect, it } from 'vitest'
import {
  AI_CREDENTIAL_PREFIX,
  aiCredential,
  readAiCredential,
  resetAiRuntimeCredential,
  setAiRuntimeCredential,
} from './ai-credential'

describe('readAiCredential', () => {
  const key = `${AI_CREDENTIAL_PREFIX}${'a'.repeat(43)}`

  it('mobile 构建 + 合法值才返回凭据', () => {
    expect(readAiCredential({ mode: 'mobile', key })).toBe(key)
  })

  it('web / production 构建永远返回 null', () => {
    // 这是「公开产物里没有凭据」的第一道保证：不依赖 .env 是否写错。
    expect(readAiCredential({ mode: 'production', key })).toBeNull()
    expect(readAiCredential({ mode: 'development', key })).toBeNull()
    expect(readAiCredential({ mode: 'test', key })).toBeNull()
    expect(readAiCredential({ key })).toBeNull()
  })

  it('去掉首尾空白', () => {
    expect(readAiCredential({ mode: 'mobile', key: `  ${key}  ` })).toBe(key)
  })

  it('缺失或空值返回 null', () => {
    expect(readAiCredential({ mode: 'mobile' })).toBeNull()
    expect(readAiCredential({ mode: 'mobile', key: '' })).toBeNull()
    expect(readAiCredential({ mode: 'mobile', key: '   ' })).toBeNull()
  })

  it('前缀不对返回 null：设备令牌 pst_ 不能被当成 AI 凭据', () => {
    expect(readAiCredential({ mode: 'mobile', key: 'pst_something' })).toBeNull()
    expect(readAiCredential({ mode: 'mobile', key: key.replace(AI_CREDENTIAL_PREFIX, '') })).toBeNull()
  })

  it('超长值返回 null，不发注定被服务端拒绝的请求', () => {
    expect(readAiCredential({ mode: 'mobile', key: `${AI_CREDENTIAL_PREFIX}${'x'.repeat(300)}` })).toBeNull()
  })
})

/**
 * 设备令牌优先：开源后安装包里不再有 `psa_`，AI 凭据就是账号令牌。
 * 这是「吊销即失效」的唯一来源，所以要单独锁住优先级与清洗规则。
 */
describe('setAiRuntimeCredential', () => {
  it('pst_ 令牌会被采用，且优先于构建期内联值', () => {
    setAiRuntimeCredential(`pst_${'a'.repeat(43)}`)
    expect(aiCredential()).toBe(`pst_${'a'.repeat(43)}`)
    resetAiRuntimeCredential()
  })

  it('非 pst_ 前缀（含 psa_）一律忽略', () => {
    setAiRuntimeCredential('psa_should-not-be-used')
    expect(aiCredential()).toBeNull()
    setAiRuntimeCredential('garbage')
    expect(aiCredential()).toBeNull()
    resetAiRuntimeCredential()
  })

  it('null / 空白视为未绑定，回到构建期内联值（本环境为 null）', () => {
    setAiRuntimeCredential(null)
    expect(aiCredential()).toBeNull()
    setAiRuntimeCredential('   ')
    expect(aiCredential()).toBeNull()
  })
})
