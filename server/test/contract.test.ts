import { describe, expect, it } from 'vitest'
import { parseChatRequest, type ChatRequest, type ProfileData } from '../src/contract.js'

const limits = { maxTurns: 20, maxTurnChars: 2_000, maxPromptChars: 12_000 }

const profile: ProfileData = {
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
  aiConsent: false,
}

const request: ChatRequest = {
  turns: [
    { role: 'assistant', content: '说说你的目标？' },
    { role: 'user', content: '我想减脂，每周练 3 次' },
  ],
  profile,
}

describe('parseChatRequest', () => {
  it('接受合法请求并规范化空白', () => {
    const result = parseChatRequest(
      { ...request, turns: [{ role: 'user', content: '  减脂  ' }] },
      limits,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.turns).toEqual([{ role: 'user', content: '减脂' }])
    expect(result.value.profile).toEqual(profile)
  })

  it('保留可选的 askedFields', () => {
    const result = parseChatRequest({ ...request, askedFields: ['goal'] }, limits)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.askedFields).toEqual(['goal'])
  })

  it('拒绝非对象请求体', () => {
    expect(parseChatRequest([], limits)).toMatchObject({ ok: false })
    expect(parseChatRequest(null, limits)).toMatchObject({ ok: false })
  })

  it('拒绝空 turns 与非法 role', () => {
    expect(parseChatRequest({ ...request, turns: [] }, limits)).toMatchObject({ ok: false })
    expect(
      parseChatRequest({ ...request, turns: [{ role: 'system', content: 'x' }] }, limits),
    ).toMatchObject({ ok: false, message: expect.stringContaining('role') })
  })

  it('拒绝最后一条不是用户发言的请求', () => {
    const result = parseChatRequest(
      {
        ...request,
        turns: [
          { role: 'user', content: '你好' },
          { role: 'assistant', content: '在的' },
        ],
      },
      limits,
    )
    expect(result.ok).toBe(false)
  })

  it('拒绝超长单条消息与超长总长度', () => {
    expect(
      parseChatRequest(
        { ...request, turns: [{ role: 'user', content: 'x'.repeat(2_001) }] },
        limits,
      ),
    ).toMatchObject({ ok: false })
    expect(
      parseChatRequest(
        {
          ...request,
          turns: Array.from({ length: 19 }, () => ({ role: 'user', content: 'x'.repeat(700) })),
        },
        limits,
      ),
    ).toMatchObject({ ok: false })
  })

  it('拒绝缺少档案或档案字段类型不对', () => {
    const { profile: _profile, ...withoutProfile } = request
    expect(parseChatRequest(withoutProfile, limits)).toMatchObject({ ok: false })
    expect(
      parseChatRequest({ ...request, profile: { ...profile, age: '30' } }, limits),
    ).toMatchObject({ ok: false, message: expect.stringContaining('age') })
    expect(
      parseChatRequest({ ...request, profile: { ...profile, goal: 123 } }, limits),
    ).toMatchObject({ ok: false, message: expect.stringContaining('goal') })
    const { aiConsent: _consent, ...withoutConsent } = profile
    expect(parseChatRequest({ ...request, profile: withoutConsent }, limits)).toMatchObject({
      ok: false,
      message: expect.stringContaining('aiConsent'),
    })
  })

  it('拒绝非数组或含非法项的 askedFields', () => {
    expect(parseChatRequest({ ...request, askedFields: 'goal' }, limits)).toMatchObject({
      ok: false,
    })
    expect(parseChatRequest({ ...request, askedFields: [1] }, limits)).toMatchObject({ ok: false })
  })

  it('忽略档案里的未知字段（向前兼容旧客户端）', () => {
    const result = parseChatRequest(
      { ...request, profile: { ...profile, legacyField: 'old' } },
      limits,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('legacyField' in result.value.profile).toBe(false)
  })
})
