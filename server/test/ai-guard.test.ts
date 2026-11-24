import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AI_KEY_PREFIX,
  aiUnauthorizedBody,
  evaluateAiGate,
  parseAiGateMode,
  parseAiKeys,
  verifyAiCredential,
  type AiKey,
} from '../src/ai/ai-guard.js'

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

const KEY_A = 'psa_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const KEY_B = 'psa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const keys: AiKey[] = [
  { keyId: 'k1', hash: sha256(KEY_A) },
  { keyId: 'k2', hash: sha256(KEY_B) },
]

describe('parseAiKeys', () => {
  it('解析单条与多条凭据，哈希统一转小写', () => {
    const parsed = parseAiKeys(`k1:${sha256(KEY_A).toUpperCase()},k2:${sha256(KEY_B)}`)
    expect(parsed).toEqual([
      { keyId: 'k1', hash: sha256(KEY_A) },
      { keyId: 'k2', hash: sha256(KEY_B) },
    ])
  })

  it('丢弃非法项而不是让整份配置失效', () => {
    const parsed = parseAiKeys(
      [
        'k1:' + sha256(KEY_A),
        'no-colon',
        ':' + sha256(KEY_B),
        'k3:not-a-hash',
        'bad id!:' + sha256(KEY_B),
        'k4:' + 'a'.repeat(63),
      ].join(','),
    )
    expect(parsed).toEqual([{ keyId: 'k1', hash: sha256(KEY_A) }])
  })

  it('重复 keyId 只保留第一条', () => {
    const parsed = parseAiKeys(`k1:${sha256(KEY_A)},k1:${sha256(KEY_B)}`)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.hash).toBe(sha256(KEY_A))
  })

  it('空值与 undefined 返回空数组', () => {
    expect(parseAiKeys(undefined)).toEqual([])
    expect(parseAiKeys('   ')).toEqual([])
    expect(parseAiKeys(',,')).toEqual([])
  })
})

describe('parseAiGateMode', () => {
  it('识别三种模式并做大小写归一', () => {
    expect(parseAiGateMode('off')).toBe('off')
    expect(parseAiGateMode('warn')).toBe('warn')
    expect(parseAiGateMode('ENFORCE')).toBe('enforce')
    expect(parseAiGateMode(' enforce ')).toBe('enforce')
  })

  it('未配置时沿用 off（回滚锚点，不影响本地开发与 CI）', () => {
    expect(parseAiGateMode(undefined)).toBe('off')
  })

  it('提供了但无法识别的值 fail-closed 到 enforce', () => {
    // 生产 env 明确配了 enforce；这行写错若静默退回 off 等于把接口敞开。
    // 失败方向必须朝向拒绝，让启动后立刻暴露配置错误。
    expect(parseAiGateMode('enforcee')).toBe('enforce')
    expect(parseAiGateMode('')).toBe('enforce')
    expect(parseAiGateMode('   ')).toBe('enforce')
  })
})

describe('verifyAiCredential', () => {
  it('命中第一条或第二条都返回对应 keyId', () => {
    expect(verifyAiCredential(keys, `Bearer ${KEY_A}`)).toEqual({ keyId: 'k1', result: 'ok' })
    expect(verifyAiCredential(keys, `Bearer ${KEY_B}`)).toEqual({ keyId: 'k2', result: 'ok' })
  })

  it('bearer 前缀大小写不敏感', () => {
    expect(verifyAiCredential(keys, `bearer ${KEY_A}`)).toEqual({ keyId: 'k1', result: 'ok' })
  })

  it('没带凭据归为 missing_credential', () => {
    expect(verifyAiCredential(keys, undefined)).toEqual({
      keyId: null,
      result: 'missing_credential',
    })
    expect(verifyAiCredential(keys, '')).toEqual({ keyId: null, result: 'missing_credential' })
    expect(verifyAiCredential(keys, 'Basic abc')).toEqual({
      keyId: null,
      result: 'missing_credential',
    })
  })

  it('设备令牌前缀 pst_ 不能当 AI 凭据用', () => {
    const deviceToken = 'pst_' + 'x'.repeat(43)
    expect(verifyAiCredential(keys, `Bearer ${deviceToken}`)).toEqual({
      keyId: null,
      result: 'bad_credential',
    })
  })

  it('哈希不匹配归为 bad_credential', () => {
    expect(verifyAiCredential(keys, `Bearer ${AI_KEY_PREFIX}wrong`)).toEqual({
      keyId: null,
      result: 'bad_credential',
    })
  })

  it('超长令牌由 readBearerToken 的上限先行拒绝，归为 missing_credential', () => {
    // readBearerToken 对超过 200 字符的令牌直接返回 null，因此这里走不到前缀判断。
    // 两种情况对外都是同一个 401，区别只体现在 warn 模式的日志里。
    expect(verifyAiCredential(keys, `Bearer ${AI_KEY_PREFIX}${'x'.repeat(300)}`)).toEqual({
      keyId: null,
      result: 'missing_credential',
    })
  })

  it('配了 enforce 却没有凭据时 fail-closed', () => {
    expect(verifyAiCredential([], `Bearer ${KEY_A}`)).toEqual({ keyId: null, result: 'no_keys' })
  })
})

describe('evaluateAiGate', () => {
  it('off 直接放行且不解析凭据', () => {
    expect(evaluateAiGate('off', [], undefined)).toEqual({
      allowed: true,
      keyId: null,
      result: 'gate_off',
    })
  })

  it('warn 放行但保留失败原因', () => {
    expect(evaluateAiGate('warn', keys, undefined)).toEqual({
      allowed: true,
      keyId: null,
      result: 'missing_credential',
    })
    expect(evaluateAiGate('warn', keys, `Bearer ${KEY_A}`)).toEqual({
      allowed: true,
      keyId: 'k1',
      result: 'ok',
    })
  })

  it('enforce 下三种失败形态都拒绝', () => {
    for (const header of [undefined, `Bearer ${AI_KEY_PREFIX}wrong`, 'Bearer pst_abc']) {
      const decision = evaluateAiGate('enforce', keys, header)
      expect(decision.allowed).toBe(false)
      expect(decision.keyId).toBeNull()
    }
    expect(evaluateAiGate('enforce', keys, `Bearer ${KEY_A}`).allowed).toBe(true)
  })

  it('enforce 且没有任何凭据时拒绝一切请求', () => {
    expect(evaluateAiGate('enforce', [], `Bearer ${KEY_A}`).allowed).toBe(false)
  })
})

describe('aiUnauthorizedBody', () => {
  it('固定文案与错误码，不泄露失败细节', () => {
    const body = aiUnauthorizedBody()
    expect(body.error.code).toBe('ai_unauthorized')
    expect(body.error.message).toBe('AI 接口需要有效凭据。')
    expect(JSON.stringify(body)).not.toContain(AI_KEY_PREFIX)
  })
})
