import { describe, expect, it } from 'vitest'
import { sanitizeExtraction, sanitizeProfilePatch } from '../src/ai/extract.js'
import type { ProfileData } from '../src/contract.js'

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

describe('sanitizeProfilePatch', () => {
  it('只保留合法且确实变化的字段', () => {
    const patch = sanitizeProfilePatch(
      {
        age: 31,
        height: '175',
        weight: 72,
        targetWeight: 300,
        goal: ' 改善体态 ',
        experience: '',
        aiConsent: true,
        unknown: 'x',
      },
      profile,
    )
    expect(patch).toEqual({ age: 31, goal: '改善体态' })
  })

  it('数字亲和转换，非数字与越界丢弃', () => {
    expect(sanitizeProfilePatch({ sleepHours: '8' }, profile)).toEqual({ sleepHours: 8 })
    expect(sanitizeProfilePatch({ sleepHours: '八' }, profile)).toEqual({})
    expect(sanitizeProfilePatch({ height: 10 }, profile)).toEqual({})
  })

  it('超长文本与空文本丢弃', () => {
    expect(sanitizeProfilePatch({ allergies: '坚'.repeat(121) }, profile)).toEqual({})
    expect(sanitizeProfilePatch({ allergies: '   ' }, profile)).toEqual({})
  })
})

describe('sanitizeExtraction', () => {
  it('非法问题被丢弃，字段去重且最多 4 个', () => {
    const extraction = sanitizeExtraction(
      {
        questions: [
          { field: 'goal', prompt: '目标是什么？', options: ['减脂', '增肌'] },
          { field: 'goal', prompt: '重复字段' },
          { field: 'notAField', prompt: '非法字段' },
          { field: 'frequency', prompt: '一周几次？' },
          { field: 'equipment', prompt: '器械？' },
          { field: 'sleepHours', prompt: '睡多久？' },
          { field: 'stress', prompt: '压力？' },
        ],
      },
      profile,
    )
    expect(extraction.questions.map((question) => question.field)).toEqual([
      'goal',
      'frequency',
      'equipment',
      'sleepHours',
    ])
    expect(extraction.questions[0]).toMatchObject({ id: 'q-goal', options: ['减脂', '增肌'] })
  })

  it('合法提案可通过，日期倒挂时丢弃结束日期', () => {
    const extraction = sanitizeExtraction(
      {
        proposal: {
          title: '12 周减脂计划',
          goal: '减脂',
          cadence: 'cycle',
          startDate: '2026-11-10',
          endDate: '2026-01-01',
          weeklyTargets: [
            { label: '力量训练', unit: '次', perWeek: '3', module: 'fitness' },
            { label: '有氧', unit: '光年', perWeek: 2 },
          ],
          milestones: [
            { date: '2026-12-10', label: '第 4 周复盘', metric: '完成率 ≥ 80%' },
            { date: '2026-02-30', label: '不存在的日期' },
          ],
          assumptions: ['按每周 3 次排期'],
          warnings: ['注意恢复'],
          highlights: ['力量训练 3 次/周'],
          profilePatch: { goal: '改善体态' },
        },
      },
      profile,
    )
    const proposal = extraction.proposal
    expect(proposal).not.toBeNull()
    expect(proposal?.weeklyTargets).toEqual([
      { label: '力量训练', unit: '次', perWeek: 3, module: 'fitness' },
    ])
    expect(proposal?.milestones).toEqual([
      { date: '2026-12-10', label: '第 4 周复盘', metric: '完成率 ≥ 80%' },
    ])
    expect(proposal?.startDate).toBe('2026-11-10')
    expect(proposal?.endDate).toBeUndefined()
    expect(proposal?.profilePatch).toEqual({ goal: '改善体态' })
  })

  it('没有合法周目标的提案整份作废', () => {
    const extraction = sanitizeExtraction(
      {
        proposal: {
          title: '减脂计划',
          weeklyTargets: [{ label: '', unit: '次', perWeek: 3 }],
        },
      },
      profile,
    )
    expect(extraction.proposal).toBe(null)
  })

  it('warnings 去重并截断数量', () => {
    const extraction = sanitizeExtraction(
      { warnings: ['注意恢复', '注意恢复', '就医', 'x1', 'x2', 'x3', 'x4', 'x5'] },
      profile,
    )
    expect(extraction.warnings).toHaveLength(6)
    expect(extraction.warnings[0]).toBe('注意恢复')
  })

  it('完全非法的输入返回空结果而不是抛错', () => {
    expect(sanitizeExtraction(null, profile)).toEqual({
      questions: [],
      patch: {},
      proposal: null,
      warnings: [],
    })
    expect(sanitizeExtraction('oops', profile)).toMatchObject({ proposal: null })
  })
})
