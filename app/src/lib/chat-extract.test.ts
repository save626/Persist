import { describe, expect, it } from 'vitest'
import {
  analyzeChat,
  buildProposal,
  findConflicts,
  mergeProfile,
  parseProfileFromText,
} from './chat-extract'
import { createMockChatClient, MOCK_CHAT_LABEL } from './mock-chat-client'
import { INITIAL_PROFILE } from '../data/profile'
import type { ChatEvent, ChatTurn } from './chat-types'
import type { ProfileData } from '../types'

const RICH_TEXT =
  '我今年 26 岁，身高 175cm，现在体重 80kg，想减到 70kg。平时在健身房练，每周能去 4 次，练了 2 年了。晚上 23:30 睡，大概睡 6 个小时，最近加班压力大。不吃辣，对虾过敏。'

function turn(content: string): ChatTurn {
  return { role: 'user', content }
}

describe('parseProfileFromText', () => {
  it('从一段完整描述里抽出档案字段', () => {
    const patch = parseProfileFromText(RICH_TEXT)
    expect(patch.age).toBe(26)
    expect(patch.height).toBe(175)
    expect(patch.weight).toBe(80)
    expect(patch.targetWeight).toBe(70)
    expect(patch.goal).toBe('减脂')
    expect(patch.experience).toBe('系统训练 2 年')
    expect(patch.frequency).toBe('每周 4 次')
    expect(patch.equipment).toBe('商业健身房')
    expect(patch.sleepHours).toBe(6)
    expect(patch.bedtime).toBe('23:30')
    expect(patch.allergies).toBe('虾')
    expect(patch.dietPreference).toBe('清淡不吃辣')
    expect(patch.stress).toContain('加班')
  })

  it('不会凭空编造没提到的字段', () => {
    expect(parseProfileFromText('')).toEqual({})
    expect(parseProfileFromText('随便聊聊')).toEqual({})
  })

  it('越界数值不会写进档案', () => {
    const patch = parseProfileFromText('身高 300cm，体重 900kg，每周 9 次')
    expect(patch.height).toBeUndefined()
    expect(patch.weight).toBeUndefined()
    expect(patch.frequency).toBeUndefined()
  })

  it('识别中文数字的次数', () => {
    expect(parseProfileFromText('一周三次').frequency).toBe('每周 3 次')
    expect(parseProfileFromText('每周两次').frequency).toBe('每周 2 次')
  })
})

describe('mergeProfile', () => {
  it('只覆盖有新值且合法的字段', () => {
    const merged = mergeProfile(INITIAL_PROFILE, {
      weight: 0,
      goal: '   ',
      allergies: '虾',
      sleepHours: Number.NaN,
    })
    expect(merged.weight).toBe(INITIAL_PROFILE.weight)
    expect(merged.goal).toBe(INITIAL_PROFILE.goal)
    expect(merged.allergies).toBe('虾')
    expect(merged.sleepHours).toBe(INITIAL_PROFILE.sleepHours)
  })
})

describe('findConflicts', () => {
  it('减脂目标体重不低于当前体重时提示', () => {
    const profile: ProfileData = {
      ...INITIAL_PROFILE,
      goal: '减脂',
      weight: 72.5,
      targetWeight: 75,
    }
    expect(findConflicts(profile).join(' ')).toContain('目标体重')
  })

  it('高频训练叠加睡眠不足时提示恢复风险', () => {
    const profile: ProfileData = {
      ...INITIAL_PROFILE,
      frequency: '每周 5 次',
      sleepHours: 5.5,
    }
    expect(findConflicts(profile).join(' ')).toContain('恢复')
  })
})

describe('buildProposal', () => {
  it('按目标与频率生成周目标与里程碑', () => {
    const profile: ProfileData = { ...INITIAL_PROFILE, goal: '减脂', frequency: '每周 4 次' }
    const proposal = buildProposal(profile, '')
    expect(proposal.cadence).toBe('cycle')
    expect(proposal.title).toBe('减脂计划')
    expect(
      proposal.weeklyTargets.map((target) => [target.label, target.perWeek, target.unit]),
    ).toEqual([
      ['力量训练', 4, '次'],
      ['有氧', 140, '分钟'],
    ])
    expect(proposal.milestones).toHaveLength(2)
    expect(proposal.milestones[1].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(proposal.assumptions).toHaveLength(3)
  })

  it('用户提到周期时按提到的周期排期', () => {
    const profile: ProfileData = { ...INITIAL_PROFILE, goal: '备考提分' }
    const proposal = buildProposal(profile, '按 8 周来')
    expect(proposal.assumptions.join(' ')).toContain('8 周')
    expect(proposal.weeklyTargets.some((target) => target.module === 'study')).toBe(true)
  })
})

describe('analyzeChat', () => {
  it('描述足够一段话时直接产出草案，但仍标注需要确认', () => {
    const analysis = analyzeChat({ turns: [turn(RICH_TEXT)], profile: INITIAL_PROFILE })
    expect(analysis.proposal).not.toBeNull()
    expect(analysis.questions).toHaveLength(0)
    expect(analysis.mergedProfile.goal).toBe('减脂')
    expect(analysis.reply).toContain('我记下来了')
    expect(analysis.reply).toContain('确认')
  })

  it('信息不足时追问最关键的缺口，且不产出草案', () => {
    const analysis = analyzeChat({
      turns: [turn('我想开始健身，但一直坚持不下来')],
      profile: INITIAL_PROFILE,
    })
    expect(analysis.proposal).toBeNull()
    expect(analysis.questions.map((question) => question.field)).toEqual(['frequency', 'equipment'])
    expect(analysis.questions[0].options?.length).toBeGreaterThan(0)
  })

  it('已经问过的字段不会重复追问', () => {
    const analysis = analyzeChat({
      turns: [turn('我想开始健身，但一直坚持不下来')],
      profile: INITIAL_PROFILE,
      askedFields: ['frequency'],
    })
    expect(analysis.questions[0].field).toBe('equipment')
    expect(analysis.questions.map((question) => question.field)).not.toContain('frequency')
  })

  it('用户明确说生成计划时一定给出草案', () => {
    const analysis = analyzeChat({ turns: [turn('帮我生成计划')], profile: INITIAL_PROFILE })
    expect(analysis.proposal).not.toBeNull()
    expect(analysis.questions).toHaveLength(0)
  })
})

describe('buildProposal 的档案补丁与周期', () => {
  it('把净化后的档案补丁写进草案', () => {
    const profile: ProfileData = { ...INITIAL_PROFILE, goal: '增肌' }
    const proposal = buildProposal(profile, '按 8 周来', {
      weight: 80,
      age: 12,
      nickname: '不该出现',
    } as Partial<ProfileData>)
    expect(proposal.profilePatch).toEqual({ weight: 80 })
  })

  it('默认给出起止日期，且结束日期不早于开始日期', () => {
    const proposal = buildProposal({ ...INITIAL_PROFILE, goal: '减脂' }, '帮我出个计划')
    expect(proposal.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(proposal.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(proposal.startDate && proposal.endDate && proposal.endDate >= proposal.startDate).toBe(
      true,
    )
  })

  it('不传补丁时 profilePatch 为空对象，兼容只读调用方', () => {
    expect(
      buildProposal({ ...INITIAL_PROFILE, goal: '减脂' }, '帮我出个计划').profilePatch,
    ).toEqual({})
  })
})

describe('analyzeChat 的档案规则', () => {
  it('年龄低于 14 岁不会进入补丁', () => {
    const analysis = analyzeChat({
      turns: [turn('我 12 岁，身高 170cm，体重 60kg，想增肌')],
      profile: INITIAL_PROFILE,
    })
    expect(analysis.patch.age).toBeUndefined()
    expect(analysis.mergedProfile.age).toBe(INITIAL_PROFILE.age)
  })

  it('年龄在 14–100 之间时正常写进补丁', () => {
    const analysis = analyzeChat({
      turns: [turn('我 20 岁，身高 170cm，体重 60kg，想增肌')],
      profile: INITIAL_PROFILE,
    })
    expect(analysis.patch.age).toBe(20)
    expect(analysis.mergedProfile.age).toBe(20)
  })
})

async function collect(events: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const list: ChatEvent[] = []
  for await (const event of events) list.push(event)
  return list
}

describe('createMockChatClient', () => {
  it('如实标注为本地 Mock', () => {
    const client = createMockChatClient({ chunkDelayMs: 0 })
    expect(client.label).toBe(MOCK_CHAT_LABEL)
    expect(client.label).toContain('Mock')
    expect(client.label).toContain('未接入真实模型')
  })

  it('按契约顺序吐出阶段、文本增量、问题、补丁、草案与结束标记', async () => {
    const client = createMockChatClient({ chunkDelayMs: 0 })
    const events = await collect(
      client.send({
        turns: [turn(RICH_TEXT)],
        profile: INITIAL_PROFILE,
      }),
    )
    const shape = events.map((event) =>
      event.type === 'stage' ? `stage:${event.stage}` : event.type,
    )
    expect(shape[0]).toBe('stage:collect')

    const patchIndex = shape.indexOf('profilePatch')
    const proposeIndex = shape.indexOf('stage:propose')
    const doneIndex = shape.indexOf('done')
    expect(patchIndex).toBeGreaterThan(0)
    expect(shape.slice(1, patchIndex).every((item) => item === 'delta')).toBe(true)
    expect(shape.filter((item) => item === 'profilePatch')).toHaveLength(1)
    expect(proposeIndex).toBe(patchIndex + 1)
    expect(shape[proposeIndex + 1]).toBe('proposal')
    expect(doneIndex).toBe(shape.length - 1)

    const text = events
      .filter((event): event is Extract<ChatEvent, { type: 'delta' }> => event.type === 'delta')
      .map((event) => event.text)
      .join('')
    expect(text).toContain('我记下来了')
  })

  it('profilePatch 事件携带本轮补丁，且永远不含 aiConsent', async () => {
    const client = createMockChatClient({ chunkDelayMs: 0 })
    const events = await collect(
      client.send({ turns: [turn(RICH_TEXT)], profile: INITIAL_PROFILE }),
    )
    const patchEvent = events.find(
      (event): event is Extract<ChatEvent, { type: 'profilePatch' }> =>
        event.type === 'profilePatch',
    )
    expect(patchEvent).toBeDefined()
    expect(patchEvent?.patch.weight).toBe(80)
    expect(patchEvent?.patch).not.toHaveProperty('aiConsent')
  })

  it('没识别到档案信息时不发 profilePatch', async () => {
    const client = createMockChatClient({ chunkDelayMs: 0 })
    const events = await collect(
      client.send({ turns: [turn('帮我生成计划')], profile: INITIAL_PROFILE }),
    )
    expect(events.map((event) => event.type)).not.toContain('profilePatch')
  })

  it('只追问信息时不发草案', async () => {
    const client = createMockChatClient({ chunkDelayMs: 0 })
    const events = await collect(
      client.send({ turns: [turn('我想开始健身，但一直坚持不下来')], profile: INITIAL_PROFILE }),
    )
    const types = events.map((event) => event.type)
    expect(types).toContain('questions')
    expect(types).not.toContain('proposal')
    expect(types[types.length - 1]).toBe('done')
  })

  it('中断后不再继续输出', async () => {
    const client = createMockChatClient({ chunkDelayMs: 0 })
    const controller = new AbortController()
    controller.abort()
    const events = await collect(
      client.send({ turns: [turn(RICH_TEXT)], profile: INITIAL_PROFILE }, controller.signal),
    )
    expect(events).toHaveLength(0)
  })
})
