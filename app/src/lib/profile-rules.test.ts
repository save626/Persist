import { describe, expect, it } from 'vitest'
import {
  isProfileNumberInRange,
  MAX_PROFILE_TEXT_LENGTH,
  PROFILE_NUMBER_RULES,
  sanitizeProfilePatch,
} from './profile-rules'
import type { ProfileData } from '../types'

describe('PROFILE_NUMBER_RULES', () => {
  it('年龄范围与档案页一致：14–100 才合法', () => {
    expect(isProfileNumberInRange('age', 14)).toBe(true)
    expect(isProfileNumberInRange('age', 100)).toBe(true)
    expect(isProfileNumberInRange('age', 13)).toBe(false)
    expect(isProfileNumberInRange('age', 101)).toBe(false)
  })

  it('拒绝 NaN、Infinity 这类非有限数', () => {
    expect(isProfileNumberInRange('weight', Number.NaN)).toBe(false)
    expect(isProfileNumberInRange('weight', Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('每条数值规则都给出可读的中文提示', () => {
    for (const rule of Object.values(PROFILE_NUMBER_RULES)) {
      expect(rule.min).toBeLessThan(rule.max)
      expect(rule.message.length).toBeGreaterThan(0)
    }
  })
})

describe('sanitizeProfilePatch', () => {
  it('合法字段原样保留', () => {
    const result = sanitizeProfilePatch({
      weight: 72.5,
      targetWeight: 68,
      sleepHours: 7,
      goal: '减脂',
    })
    expect(result.patch).toEqual({ weight: 72.5, targetWeight: 68, sleepHours: 7, goal: '减脂' })
    expect(result.dropped).toEqual([])
  })

  it('越界数字被丢弃并列入 dropped，不会改成边界值', () => {
    const result = sanitizeProfilePatch({ age: 12, height: 175, weight: 900, sleepHours: 6 })
    expect(result.patch).toEqual({ height: 175, sleepHours: 6 })
    expect(result.dropped.sort()).toEqual(['age', 'weight'])
  })

  it('数字字段传字符串视为非法', () => {
    const result = sanitizeProfilePatch({ age: '26' as never })
    expect(result.patch).toEqual({})
    expect(result.dropped).toEqual(['age'])
  })

  it('文本去首尾空格，空串视为没提供（不计入 dropped）', () => {
    const result = sanitizeProfilePatch({ goal: '  减脂  ', allergies: '   ' })
    expect(result.patch).toEqual({ goal: '减脂' })
    expect(result.dropped).toEqual([])
  })

  it('超长文本被丢弃', () => {
    const result = sanitizeProfilePatch({
      goal: 'a'.repeat(MAX_PROFILE_TEXT_LENGTH + 1),
      dietPreference: '清淡',
    })
    expect(result.patch).toEqual({ dietPreference: '清淡' })
    expect(result.dropped).toEqual(['goal'])
  })

  it('永远不写入 aiConsent，也忽略未知字段', () => {
    const input = { aiConsent: true, nickname: '不该出现', weight: 70 } as Partial<ProfileData>
    const result = sanitizeProfilePatch(input)
    expect(result.patch).toEqual({ weight: 70 })
    expect('aiConsent' in result.patch).toBe(false)
  })

  it('空补丁返回空对象', () => {
    expect(sanitizeProfilePatch({})).toEqual({ patch: {}, dropped: [] })
  })

  it('不修改传入对象', () => {
    const input: Partial<ProfileData> = { age: 12, goal: ' 减脂 ' }
    sanitizeProfilePatch(input)
    expect(input).toEqual({ age: 12, goal: ' 减脂 ' })
  })
})
