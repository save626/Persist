import { describe, expect, it } from 'vitest'
import type { ChatPlanProposal } from './chat-types'
import {
  DEFAULT_MANUAL_TARGET,
  describeDroppedProfileFields,
  emptyPlanDraft,
  mergeProfilePatch,
  planToDraft,
  profilePatchEntries,
  proposalToDraft,
  resolveProposalDates,
  validateDraft,
} from './plan-draft'
import { createLongTermPlan, type LongTermPlanDraft } from './long-term-plan'
import type { ProfileData } from '../types'

const NOW = new Date('2026-11-02T09:00:00.000Z')

const PROFILE: ProfileData = {
  age: 27,
  height: 174,
  weight: 71,
  targetWeight: 68,
  experience: '系统训练 2 年',
  frequency: '每周 3 次',
  equipment: '商业健身房',
  goal: '增肌',
  dietPreference: '高蛋白',
  allergies: '没有',
  sleepHours: 7,
  bedtime: '23:30',
  stress: '',
  aiConsent: false,
}

function proposal(overrides: Partial<ChatPlanProposal> = {}): ChatPlanProposal {
  return {
    title: '增肌计划',
    goal: '增肌',
    cadence: 'cycle',
    weeklyTargets: [{ label: '力量训练', unit: '次', perWeek: 4, module: 'fitness' }],
    milestones: [
      { date: '2026-12-14', label: '第 6 周复盘' },
      { date: '2027-01-25', label: '第 12 周阶段检查' },
    ],
    profilePatch: {},
    assumptions: [],
    warnings: [],
    highlights: [],
    ...overrides,
  }
}

describe('resolveProposalDates', () => {
  it('缺省开始日期时用今天，缺省结束日期时用最后一个里程碑', () => {
    expect(resolveProposalDates(proposal(), NOW)).toEqual({
      startDate: '2026-11-02',
      endDate: '2027-01-25',
    })
  })

  it('优先使用合法建议日期', () => {
    expect(
      resolveProposalDates(proposal({ startDate: '2026-11-10', endDate: '2027-02-01' }), NOW),
    ).toEqual({ startDate: '2026-11-10', endDate: '2027-02-01' })
  })

  it('非法日期降级为默认值', () => {
    expect(resolveProposalDates(proposal({ startDate: '2026-02-31', endDate: 'x' }), NOW)).toEqual({
      startDate: '2026-11-02',
      endDate: '2027-01-25',
    })
  })

  it('结束日期早于开始日期时改用最后一个未来里程碑', () => {
    expect(resolveProposalDates(proposal({ endDate: '2026-10-01' }), NOW)).toEqual({
      startDate: '2026-11-02',
      endDate: '2027-01-25',
    })
  })

  it('建议的开始日期早于今天时回退到今天，过期里程碑不再给出结束日期', () => {
    expect(
      resolveProposalDates(
        proposal({
          startDate: '2025-01-06',
          endDate: '2025-03-02',
          milestones: [{ date: '2025-02-02', label: '第 4 周复盘' }],
        }),
        NOW,
      ),
    ).toEqual({ startDate: '2026-11-02' })
  })

  it('显式结束日期过期时用最后一个未来里程碑兜底', () => {
    expect(
      resolveProposalDates(proposal({ startDate: '2025-01-06', endDate: '2025-03-02' }), NOW),
    ).toEqual({ startDate: '2026-11-02', endDate: '2027-01-25' })
  })
})

describe('proposalToDraft', () => {
  it('把对话建议转成 AI 来源的可编辑草案', () => {
    const draft = proposalToDraft(proposal(), NOW)
    expect(draft).toMatchObject({
      title: '增肌计划',
      goal: '增肌',
      cadence: 'cycle',
      startDate: '2026-11-02',
      endDate: '2027-01-25',
      source: 'ai-chat',
    })
    expect(draft.weeklyTargets).toEqual([
      { label: '力量训练', unit: '次', perWeek: 4, module: 'fitness' },
    ])
    expect(draft.milestones).toHaveLength(2)
  })

  it('丢弃建议里已经过去的里程碑，开始日期回退到今天', () => {
    const draft = proposalToDraft(
      proposal({
        startDate: '2025-01-06',
        milestones: [
          { date: '2025-02-02', label: '旧里程碑' },
          { date: '2027-01-25', label: '第 12 周阶段检查' },
        ],
      }),
      NOW,
    )
    expect(draft.startDate).toBe('2026-11-02')
    expect(draft.milestones).toEqual([{ date: '2027-01-25', label: '第 12 周阶段检查' }])
  })

  it('生成的草案能直接创建计划', () => {
    const plan = createLongTermPlan(proposalToDraft(proposal(), NOW), NOW)
    expect(plan).not.toBeNull()
    expect(plan?.source).toBe('ai-chat')
    expect(plan?.status).toBe('draft')
    expect(plan?.startDate).toBe('2026-11-02')
  })
})

describe('planToDraft', () => {
  it('已保存的计划能往返成草案', () => {
    const plan = createLongTermPlan(proposalToDraft(proposal(), NOW), NOW)
    expect(plan).not.toBeNull()
    if (!plan) return
    const draft = planToDraft(plan)
    expect(draft.title).toBe(plan.title)
    expect(draft.startDate).toBe(plan.startDate)
    expect(draft.endDate).toBe(plan.endDate)
    expect(draft.source).toBe('ai-chat')
    expect(draft.weeklyTargets).toEqual([
      { label: '力量训练', unit: '次', perWeek: 4, module: 'fitness' },
    ])
  })

  it('没有结束日期的计划往返后仍然没有结束日期', () => {
    const plan = createLongTermPlan(
      {
        title: '每周习惯',
        goal: '养成习惯',
        cadence: 'weekly',
        weeklyTargets: [{ label: '力量训练', unit: '次', perWeek: 2 }],
      },
      NOW,
    )
    expect(plan).not.toBeNull()
    if (!plan) return
    expect(planToDraft(plan).endDate).toBeUndefined()
  })
})

describe('validateDraft', () => {
  it('清洗空白、取整次数并回退默认开始日期', () => {
    const result = validateDraft(
      {
        title: '  减脂计划  ',
        goal: '  ',
        cadence: 'cycle',
        startDate: '',
        weeklyTargets: [{ label: ' 有氧 ', unit: '分钟', perWeek: 150.4, module: 'fitness' }],
      },
      NOW,
    )
    expect(result.ok).toBe(true)
    expect(result.draft).toMatchObject({
      title: '减脂计划',
      goal: '减脂计划',
      startDate: '2026-11-02',
      source: 'manual',
    })
    expect(result.draft?.weeklyTargets).toEqual([
      { label: '有氧', unit: '分钟', perWeek: 150, module: 'fitness' },
    ])
  })

  it('缺少标题时报错', () => {
    expect(validateDraft({ ...emptyPlanDraft(NOW), title: '   ' }, NOW)).toMatchObject({
      ok: false,
      message: '给计划起个标题再保存。',
    })
  })

  it('没有有效目标时报错', () => {
    expect(
      validateDraft(
        {
          ...emptyPlanDraft(NOW),
          title: '空计划',
          weeklyTargets: [{ label: '', unit: '次', perWeek: 3 }],
        },
        NOW,
      ),
    ).toMatchObject({ ok: false, message: '至少保留一条有效的每周目标（名称 + 次数）。' })
  })

  it('结束日期早于开始日期时报错', () => {
    const result = validateDraft(
      { ...emptyPlanDraft(NOW), title: '计划', startDate: '2026-11-10', endDate: '2026-11-01' },
      NOW,
    )
    expect(result.ok).toBe(false)
    expect(result.message).toContain('结束日期')
  })

  it('次数上限被夹到 999', () => {
    const result = validateDraft(
      {
        ...emptyPlanDraft(NOW),
        title: '计划',
        weeklyTargets: [{ ...DEFAULT_MANUAL_TARGET, perWeek: 5000 }],
      },
      NOW,
    )
    expect(result.draft?.weeklyTargets[0].perWeek).toBe(999)
  })
})

describe('档案补丁展示', () => {
  it('只列出真正发生变化的字段', () => {
    const entries = profilePatchEntries({ age: 28, weight: 71, goal: '减脂' }, PROFILE)
    expect(entries.map((entry) => entry.field)).toEqual(['age', 'goal'])
    expect(entries[0]).toMatchObject({ label: '年龄', previous: '27', next: '28' })
    expect(entries[1]).toMatchObject({ label: '当前目标', previous: '增肌', next: '减脂' })
  })

  it('忽略 aiConsent 与空值', () => {
    expect(profilePatchEntries({ aiConsent: true, stress: '' }, PROFILE)).toEqual([])
  })

  it('空档案的旧值显示为未填写', () => {
    const entries = profilePatchEntries({ allergies: '花生' }, { ...PROFILE, allergies: '' })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ previous: '未填写', next: '花生' })
  })

  it('被忽略字段拼成中文提示', () => {
    expect(describeDroppedProfileFields(['age', 'weight'])).toBe(
      '已忽略 2 项不符合档案规则的输入：年龄、体重',
    )
    expect(describeDroppedProfileFields([])).toBe('')
  })

  it('档案补丁按轮次合并，后者覆盖前者', () => {
    expect(mergeProfilePatch({ age: 27, goal: '增肌' }, { goal: '减脂' })).toEqual({
      age: 27,
      goal: '减脂',
    })
  })
})

describe('emptyPlanDraft', () => {
  it('给出手工新建的最小可用草案', () => {
    const draft: LongTermPlanDraft = emptyPlanDraft(NOW)
    expect(draft).toMatchObject({
      title: '',
      cadence: 'weekly',
      startDate: '2026-11-02',
      source: 'manual',
    })
    expect(draft.weeklyTargets).toEqual([{ ...DEFAULT_MANUAL_TARGET }])
    expect(draft.milestones).toEqual([])
  })
})
