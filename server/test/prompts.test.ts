import { describe, expect, it } from 'vitest'
import type { ChatRequest, ProfileData } from '../src/contract.js'
import {
  buildChatMessages,
  buildExtractionMessages,
  buildExtractionSystemPrompt,
  todayInShanghai,
} from '../src/ai/prompts.js'

const profile: ProfileData = {
  age: 30,
  height: 175,
  weight: 80,
  targetWeight: 72,
  goal: '减脂',
  experience: '新手',
  frequency: '每周 3 次',
  equipment: '哑铃',
  dietPreference: '',
  allergies: '',
  bedtime: '23:30',
  sleepHours: 7,
  stress: '',
  aiConsent: true,
}

const request: ChatRequest = { turns: [{ role: 'user', content: '我想减脂' }], profile }

describe('提示词日期上下文', () => {
  it('按北京时间输出 YYYY-MM-DD 的今天', () => {
    expect(todayInShanghai(new Date('2026-11-03T16:30:00.000Z'))).toBe('2026-11-04')
    expect(todayInShanghai(new Date('2026-11-03T15:59:00.000Z'))).toBe('2026-11-03')
  })

  it('对话提示词带今天日期，避免按训练语料给出过去的年份', () => {
    const system = buildChatMessages(request)[0]
    expect(system?.role).toBe('system')
    expect(system?.content).toContain('今天是 ')
    expect(system?.content).toContain('（Asia/Shanghai）')
  })

  it('抽取提示词要求开始日期不早于今天', () => {
    const prompt = buildExtractionSystemPrompt('2026-11-03')
    expect(prompt).toContain('startDate 不得早于今天')
    expect(prompt).toContain('2026-11-03')
    const system = buildExtractionMessages(request)[0]
    expect(system?.content).toContain('不得早于今天')
  })
})
