import { describe, expect, it } from 'vitest'
import { createCompleteMockData } from '../data/complete-mock-data'
import type { ImportableMockData } from '../types'
import type { PullEntity } from './sync-contract'
import {
  applyPulledEntities,
  collectLocalEntities,
  diffLocalEntities,
  entityKey,
  hashEntities,
  hashText,
  removedCandidates,
  stableStringify,
  SYNC_SINGLE_ROW_ID,
  toCandidates,
} from './sync-entities'

const NOW = new Date(2026, 10, 5, 9, 0, 0)
const NOW_MS = NOW.getTime()

function sampleData(): ImportableMockData {
  return createCompleteMockData(NOW)
}

function pulled(overrides: Partial<PullEntity> & Pick<PullEntity, 'kind' | 'data'>): PullEntity {
  return {
    id: null,
    updatedAt: NOW_MS + 1_000,
    deleted: false,
    rev: 1,
    ...overrides,
  } as PullEntity
}

describe('collectLocalEntities', () => {
  it('把 8 个可同步切片摊平成实体，并跳过报告/进行中会话', () => {
    const data = sampleData()
    const entities = collectLocalEntities(data)
    const kinds = entities.map((entity) => entity.kind)

    expect(kinds.filter((kind) => kind === 'profile')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'settings')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'goal')).toHaveLength(data.goals.length)
    expect(kinds.filter((kind) => kind === 'plan_item')).toHaveLength(data.planItems.length)
    expect(kinds.filter((kind) => kind === 'water_log')).toHaveLength(data.waterLog.length)
    expect(kinds.filter((kind) => kind === 'study_record')).toHaveLength(data.studyRecords.length)
    // 每个食物条目一条实体；报告、进行中训练不参与同步。
    expect(kinds.filter((kind) => kind === 'diet_entry')).toHaveLength(8)
    expect(kinds).not.toContain('report')
    expect(entities.every((entity) => entity.id.length > 0)).toBe(true)
    const keys = new Set(entities.map((entity) => entityKey(entity.kind, entity.id)))
    expect(keys.size).toBe(entities.length)
  })

  it('单行实体用占位 id，且档案带回顶层的 aiConsent', () => {
    const data = { ...sampleData(), aiConsent: false }
    const entities = collectLocalEntities(data)
    const profile = entities.find((entity) => entity.kind === 'profile')
    const settings = entities.find((entity) => entity.kind === 'settings')

    expect(profile?.id).toBe(SYNC_SINGLE_ROW_ID)
    expect(settings?.id).toBe(SYNC_SINGLE_ROW_ID)
    expect(profile?.data.aiConsent).toBe(false)
  })

  it('饮食实体带上日期与餐次，不再带照片字段', () => {
    const data = sampleData()
    const entries = collectLocalEntities(data).filter((entity) => entity.kind === 'diet_entry')
    const breakfast = entries.filter((entity) => entity.data.meal === 'breakfast')

    expect(breakfast).toHaveLength(2)
    expect(breakfast[0]?.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(breakfast[0]?.data.mealLabel).toBe('早餐')
    expect(entries.every((entity) => entity.data.photoName === undefined)).toBe(true)
  })
})

describe('stableStringify / hashText', () => {
  it('对象键顺序不影响序列化与哈希', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    )
    expect(hashText('abc')).toBe(hashText('abc'))
    expect(hashText('abc')).not.toBe(hashText('abd'))
  })
})

describe('diffLocalEntities', () => {
  it('没有基线时全部算新增；基线一致时无变化', () => {
    const entities = collectLocalEntities(sampleData())
    const first = diffLocalEntities(entities, {})
    expect(first.changed).toHaveLength(entities.length)
    expect(first.removed).toHaveLength(0)

    const second = diffLocalEntities(entities, first.hashes)
    expect(second.changed).toHaveLength(0)
    expect(second.removed).toHaveLength(0)
  })

  it('只报内容变化的实体，以及消失实体对应的键', () => {
    const data = sampleData()
    const baseline = hashEntities(collectLocalEntities(data))

    const changedData: ImportableMockData = {
      ...data,
      goals: data.goals.map((goal) =>
        goal.id === 'goal-1' ? { ...goal, title: '高数阶段测验（改）' } : goal,
      ),
      waterLog: data.waterLog.filter((entry) => entry.id !== 'water-demo-2'),
    }
    const diff = diffLocalEntities(collectLocalEntities(changedData), baseline)

    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0]?.id).toBe('goal-1')
    expect(diff.removed).toEqual(['water_log:water-demo-2'])
  })
})

describe('applyPulledEntities', () => {
  it('较新的服务端实体覆盖本地，较旧的被跳过（LWW）', () => {
    const data = sampleData()
    const times = {
      [entityKey('goal', 'goal-1')]: NOW_MS,
      [entityKey('goal', 'goal-2')]: NOW_MS,
    }

    const newer = pulled({
      kind: 'goal',
      id: 'goal-1',
      data: { ...data.goals[0], title: '服务端新标题' },
      updatedAt: NOW_MS + 1,
    })
    const older = pulled({
      kind: 'goal',
      id: 'goal-2',
      data: { ...data.goals[1], title: '旧标题' },
      updatedAt: NOW_MS - 1,
    })
    const merged = applyPulledEntities(data, [newer, older], times, NOW_MS)

    expect(merged.applied).toBe(1)
    expect(merged.skipped).toBe(1)
    expect(merged.data.goals.find((goal) => goal.id === 'goal-1')?.title).toBe('服务端新标题')
    expect(merged.data.goals.find((goal) => goal.id === 'goal-2')?.title).toBe('英语六级考试')
    expect(merged.hashes[entityKey('goal', 'goal-1')]).toBe(
      hashEntities(collectLocalEntities(merged.data))[entityKey('goal', 'goal-1')],
    )
  })

  it('单行实体 id 为 null 时落到占位 id，并同步顶层 aiConsent', () => {
    const data = { ...sampleData(), aiConsent: true }
    const merged = applyPulledEntities(
      data,
      [
        pulled({
          kind: 'profile',
          id: null,
          data: { ...data.profile, aiConsent: false },
        }),
      ],
      {},
      NOW_MS,
    )

    expect(merged.applied).toBe(1)
    expect(merged.data.aiConsent).toBe(false)
    expect(merged.times[entityKey('profile', SYNC_SINGLE_ROW_ID)]).toBeGreaterThan(0)
  })

  it('墓碑删除本地条目，不存在的实体跳过', () => {
    const data = sampleData()
    const merged = applyPulledEntities(
      data,
      [
        pulled({ kind: 'water_log', id: 'water-demo-1', data: null, deleted: true }),
        pulled({ kind: 'goal', id: 'not-exist', data: null, deleted: true }),
      ],
      {},
      NOW_MS,
    )

    expect(merged.data.waterLog.map((entry) => entry.id)).not.toContain('water-demo-1')
    expect(merged.applied).toBe(2)
  })

  it('未知 kind / 缺字段的 payload 计入 skipped，而不是把脏数据写进本地', () => {
    const data = sampleData()
    const merged = applyPulledEntities(
      data,
      [
        { kind: 'unknown' as never, id: 'x', data: {}, updatedAt: NOW_MS, deleted: false, rev: 1 },
        pulled({ kind: 'plan_item', id: 'bad', data: { id: 'bad' } as never }),
      ],
      {},
      NOW_MS,
    )

    expect(merged.applied).toBe(0)
    expect(merged.skipped).toBe(2)
    expect(merged.data.planItems).toHaveLength(data.planItems.length)
  })

  it('远端记录形状不完整时跳过，不把坏记录写进本地（否则下次启动整份存档会被判损坏）', () => {
    const data = sampleData()
    const merged = applyPulledEntities(
      data,
      [
        // 服务端只校验索引列，这里模拟不规范客户端推上来的残缺学习记录。
        pulled({
          kind: 'study_record',
          id: 'accept-conflict-1',
          data: { date: '2026-11-05', category: 'english', duration: 30, title: '残缺' } as never,
        }),
        pulled({
          kind: 'water_log',
          id: 'water-broken-1',
          data: { id: 'water-broken-1', time: '12:00', date: '2026-11-05' } as never,
        }),
      ],
      {},
      NOW_MS,
    )

    expect(merged.applied).toBe(0)
    expect(merged.skipped).toBe(2)
    expect(merged.data.studyRecords.map((record) => record.id)).not.toContain('accept-conflict-1')
    expect(merged.data.waterLog.map((entry) => entry.id)).not.toContain('water-broken-1')
  })

  it('正文 id 与信封 id 不一致时跳过', () => {
    const data = sampleData()
    const goal = data.goals[0]!
    const merged = applyPulledEntities(
      data,
      [pulled({ kind: 'goal', id: 'goal-1', data: { ...goal, id: 'goal-9' } })],
      {},
      NOW_MS,
    )

    expect(merged.applied).toBe(0)
    expect(merged.skipped).toBe(1)
    expect(merged.data.goals.map((item) => item.id)).not.toContain('goal-9')
  })

  it('饮食条目合并进已有日期，未知餐次追加且四餐顺序不变', () => {
    const data = sampleData()
    const merged = applyPulledEntities(
      data,
      [
        pulled({
          kind: 'diet_entry',
          id: 'remote-snack-1',
          data: {
            id: 'remote-snack-1',
            name: '远端加餐',
            portion: '1 份',
            calories: 100,
            protein: 5,
            carbs: 10,
            fat: 2,
            date: data.dietDays[0]!.date,
            meal: 'snack',
            mealLabel: '加餐',
            mealTime: '16:10',
          },
        }),
        pulled({
          kind: 'diet_entry',
          id: 'remote-late-1',
          data: {
            id: 'remote-late-1',
            name: '夜宵',
            portion: '1 份',
            calories: 50,
            protein: 1,
            carbs: 2,
            fat: 1,
            date: data.dietDays[0]!.date,
            meal: 'late',
            mealLabel: '夜宵',
            mealTime: '22:00',
          },
        }),
      ],
      {},
      NOW_MS,
    )

    const day = merged.data.dietDays.find((item) => item.date === data.dietDays[0]!.date)
    expect(day?.meals.map((meal) => meal.id as string)).toEqual([
      'breakfast',
      'lunch',
      'dinner',
      'snack',
      'late',
    ])
    expect(day?.meals.find((meal) => meal.id === 'snack')?.entries).toHaveLength(3)
    expect(day?.meals.find((meal) => (meal.id as string) === 'late')?.entries).toHaveLength(1)
  })

  it('删除最后一条食物后，该日从台账里移除', () => {
    const data = sampleData()
    const date = data.dietDays[0]!.date
    const entries = collectLocalEntities(data).filter((entity) => entity.kind === 'diet_entry')
    const tombstones = entries.map((entity) =>
      pulled({ kind: 'diet_entry', id: entity.id, data: null, deleted: true }),
    )
    const merged = applyPulledEntities(data, tombstones, {}, NOW_MS)

    expect(merged.data.dietDays.find((day) => day.date === date)).toBeUndefined()
  })
})

describe('candidates', () => {
  it('toCandidates 带上当前时间且不丢 data', () => {
    const entities = collectLocalEntities(sampleData()).slice(0, 2)
    const candidates = toCandidates(entities, NOW_MS)
    expect(candidates.every((candidate) => candidate.updatedAt === NOW_MS)).toBe(true)
    expect(candidates[0]?.data).toEqual(entities[0]?.data)
  })

  it('removedCandidates 解析 kind/id 键，忽略非法键', () => {
    const candidates = removedCandidates(['goal:goal-1', 'bad-key'], NOW_MS)
    expect(candidates).toEqual([{ kind: 'goal', id: 'goal-1', updatedAt: NOW_MS, deleted: true }])
  })
})
