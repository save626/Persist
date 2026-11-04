import { describe, expect, it } from 'vitest'
import type { Exercise, FitnessSessionRecord, WorkoutSet } from '../types'
import {
  buildHistorySessions,
  formatSessionDuration,
  type HistoryTemplateRef,
} from './fitness-history'

const TEMPLATES: HistoryTemplateRef[] = [
  { id: 'lower-b', name: '下肢力量 B' },
  { id: 'upper-a', name: '上肢推 A' },
]

function set(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return { id: 'set-1', weight: 70, reps: 8, done: true, ...overrides }
}

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'squat',
    name: '杠铃深蹲',
    kind: 'strength',
    muscle: '股四头 / 臀',
    equipment: '杠铃',
    targetReps: '8 次',
    rest: '90 秒',
    sets: [set()],
    ...overrides,
  }
}

function record(overrides: Partial<FitnessSessionRecord> = {}): FitnessSessionRecord {
  return {
    id: 'workout-1',
    date: '2026-11-08',
    completedAt: '2026-11-08T10:00:00.000Z',
    templateId: 'lower-b',
    elapsedSeconds: 2_400,
    exercises: [exercise()],
    ...overrides,
  }
}

describe('formatSessionDuration', () => {
  it('不足 1 分钟按秒显示，避免完成即 0 min', () => {
    expect(formatSessionDuration(45)).toBe('45 秒')
    expect(formatSessionDuration(0)).toBe('0 秒')
  })

  it('满 1 分钟按分钟四舍五入', () => {
    expect(formatSessionDuration(60)).toBe('1 min')
    expect(formatSessionDuration(2_400)).toBe('40 min')
  })
})

describe('buildHistorySessions', () => {
  it('没有历史记录时返回空数组', () => {
    expect(buildHistorySessions([], TEMPLATES)).toEqual([])
  })

  it('用模板名做标题，日期与星期按本地日期键展示', () => {
    const [row] = buildHistorySessions([record()], TEMPLATES)

    expect(row.title).toBe('下肢力量 B')
    expect(row.date).toBe('11 月 8 日')
    expect(row.weekday).toBe('周日')
    expect(row.detail).toBe('杠铃深蹲')
    expect(row.duration).toBe('40 min')
  })

  it('容量只统计已完成的力量组，组数与文案按实际完成数', () => {
    const [row] = buildHistorySessions(
      [
        record({
          exercises: [
            exercise({
              sets: [
                set({ id: 'set-1', weight: 70, reps: 8 }),
                set({ id: 'set-2', weight: 70, reps: 8 }),
                set({ id: 'set-3', weight: 70, reps: 8 }),
              ],
            }),
          ],
        }),
      ],
      TEMPLATES,
    )

    expect(row.volume).toBe('1,680 kg')
    expect(row.sets).toBe('3 组')
  })

  it('训练中途未完成的组不算进历史，整个动作都没完成则不出现', () => {
    const [row] = buildHistorySessions(
      [
        record({
          exercises: [
            exercise({
              sets: [
                set({ id: 'set-1', weight: 70, reps: 8, done: true }),
                set({ id: 'set-2', weight: 70, reps: 8, done: false }),
              ],
            }),
            exercise({ id: 'lunge', name: '保加利亚分腿蹲', sets: [set({ done: false })] }),
          ],
        }),
      ],
      TEMPLATES,
    )

    expect(row.detail).toBe('杠铃深蹲')
    expect(row.sets).toBe('1 组')
    expect(row.volume).toBe('560 kg')
    expect(row.exercises).toHaveLength(1)
    expect(row.exercises[0].sets).toHaveLength(1)
  })

  it('有氧记录不产生 kg 容量，距离与时长按动作类型给字段', () => {
    const [row] = buildHistorySessions(
      [
        record({
          templateId: 'free',
          elapsedSeconds: 1_800,
          exercises: [
            exercise({
              id: 'run',
              name: '夜跑',
              kind: 'distance',
              muscle: '心肺',
              sets: [
                set({ weight: undefined, reps: undefined, distanceKm: 3.2, durationMinutes: 18 }),
              ],
            }),
          ],
        }),
      ],
      TEMPLATES,
    )

    expect(row.title).toBe('自由训练')
    expect(row.detail).toBe('夜跑')
    expect(row.volume).toBe('—')
    expect(row.exercises[0].sets).toEqual([
      { distanceKm: 3.2, durationMinutes: 18, rpe: undefined },
    ])
  })

  it('动作超过三个时截断摘要，避免详情行过长', () => {
    const names = ['杠铃深蹲', '保加利亚分腿蹲', '腿弯举', '坐姿提踵']
    const [row] = buildHistorySessions(
      [
        record({
          exercises: names.map((name, index) => exercise({ id: `exercise-${index}`, name })),
        }),
      ],
      TEMPLATES,
    )

    expect(row.detail).toBe('杠铃深蹲 · 保加利亚分腿蹲 · 腿弯举 等 4 个动作')
    expect(row.exercises).toHaveLength(4)
  })

  it('模板 id 对不上时标题退回自由训练，记录仍然保留', () => {
    const [row] = buildHistorySessions([record({ templateId: 'deleted-template' })], TEMPLATES)

    expect(row.title).toBe('自由训练')
    expect(row.sets).toBe('1 组')
  })

  it('多天记录最近完成的排在前面', () => {
    const rows = buildHistorySessions(
      [
        record({ id: 'workout-old', date: '2026-11-01', completedAt: '2026-11-01T10:00:00.000Z' }),
        record({ id: 'workout-new', date: '2026-11-08', completedAt: '2026-11-08T10:00:00.000Z' }),
      ],
      TEMPLATES,
    )

    expect(rows.map((row) => row.id)).toEqual(['workout-new', 'workout-old'])
  })
})
