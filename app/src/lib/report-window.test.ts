import { describe, expect, it } from 'vitest'
import type {
  DietDay,
  Exercise,
  FitnessSessionRecord,
  FitnessSessionState,
  PlanItem,
  StudyRecord,
  WaterLogEntry,
  WorkoutSet,
} from '../types'
import { createDateWindow } from './history'
import { collectReportWindowFacts } from './report-window'

const WINDOW = createDateWindow(7, '2026-11-04')

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
    date: '2026-11-03',
    completedAt: '2026-11-03T10:00:00.000Z',
    templateId: 'lower-b',
    elapsedSeconds: 2_400,
    exercises: [exercise()],
    ...overrides,
  }
}

function session(overrides: Partial<FitnessSessionState> = {}): FitnessSessionState {
  return {
    activeTemplateId: 'upper-a',
    exercises: [exercise({ id: 'bench', name: '杠铃平板卧推', sets: [set({ id: 'set-9' })] })],
    sessionStatus: 'active',
    elapsedSeconds: 600,
    ...overrides,
  }
}

function studyRecord(date: string, category: 'english' | 'math', duration: number): StudyRecord {
  return {
    id: `study-${date}-${category}`,
    category,
    source: category === 'english' ? '长难句' : '错题复盘',
    date,
    startTime: '20:00',
    duration,
    note: '',
  }
}

function dietDay(date: string, entryCounts: number[]): DietDay {
  return {
    date,
    meals: entryCounts.map((count, index) => ({
      id: (['breakfast', 'lunch', 'dinner', 'snack'] as const)[index],
      label: '餐次',
      time: '08:00',
      entries: Array.from({ length: count }, (_, entryIndex) => ({
        id: `food-${date}-${index}-${entryIndex}`,
        name: '食物',
        portion: '100 g',
        calories: 100,
        protein: 10,
        carbs: 10,
        fat: 2,
      })),
    })),
  }
}

function waterEntry(date: string, milliliters: number, index = 0): WaterLogEntry {
  return { id: `water-${date}-${index}`, time: '10:00', milliliters, date }
}

function planItem(date: string, done: boolean, index = 0): PlanItem {
  return {
    id: `plan-${date}-${index}`,
    name: '计划项',
    time: '20:00',
    detail: '',
    kind: 'default',
    done,
    date,
  }
}

const EMPTY_INPUT = {
  window: WINDOW,
  fitnessSession: null,
  fitnessHistory: [],
  studyRecords: [],
  dietDays: [],
  waterHistory: [],
  planHistory: [],
}

describe('collectReportWindowFacts', () => {
  it('全部为空时给出零值事实，不抛错', () => {
    const facts = collectReportWindowFacts(EMPTY_INPUT)

    expect(facts.window).toEqual(WINDOW)
    expect(facts.fitness).toMatchObject({ hasSession: false, sessionCount: 0, summaryText: '' })
    expect(facts.study).toEqual({
      recordCount: 0,
      englishCount: 0,
      mathCount: 0,
      totalMinutes: 0,
    })
    expect(facts.diet).toEqual({ mealCount: 0, foodEntryCount: 0 })
    expect(facts.water).toEqual({ eventCount: 0, liters: 0, dailyAverage: 0 })
    expect(facts.plan).toEqual({ total: 0, done: 0 })
  })

  it('只统计窗口内的日期，窗口外的一天都不算', () => {
    const facts = collectReportWindowFacts({
      ...EMPTY_INPUT,
      fitnessHistory: [record({ date: '2026-10-29' }), record({ date: '2026-10-28', id: 'old' })],
      studyRecords: [
        studyRecord('2026-11-04', 'english', 30),
        studyRecord('2026-10-01', 'math', 60),
      ],
      waterHistory: [waterEntry('2026-11-02', 500), waterEntry('2026-10-20', 500)],
    })

    expect(facts.fitness.sessionCount).toBe(1)
    expect(facts.study.recordCount).toBe(1)
    expect(facts.study.totalMinutes).toBe(30)
    expect(facts.water.eventCount).toBe(1)
    expect(facts.water.liters).toBe(0.5)
  })

  it('进行中的会话单独补一次；已完成的会话只靠归档记录计数，不重复', () => {
    const activeFacts = collectReportWindowFacts({
      ...EMPTY_INPUT,
      fitnessSession: session({ exercises: [exercise({ sets: [set(), set({ id: 'set-2' })] })] }),
    })
    expect(activeFacts.fitness.hasSession).toBe(true)
    expect(activeFacts.fitness.sessionCount).toBe(1)
    expect(activeFacts.fitness.doneSets).toBe(2)

    const noSetsFacts = collectReportWindowFacts({
      ...EMPTY_INPUT,
      fitnessSession: session({ exercises: [exercise({ sets: [set({ done: false })] })] }),
    })
    expect(noSetsFacts.fitness.hasSession).toBe(true)
    expect(noSetsFacts.fitness.sessionCount).toBe(0)

    const completedFacts = collectReportWindowFacts({
      ...EMPTY_INPUT,
      fitnessSession: session({ sessionStatus: 'completed' }),
    })
    expect(completedFacts.fitness.hasSession).toBe(false)
    expect(completedFacts.fitness.sessionCount).toBe(0)
  })

  it('训练按归档记录累加：次数、动作数、组数、容量与时长', () => {
    const facts = collectReportWindowFacts({
      ...EMPTY_INPUT,
      fitnessHistory: [
        record({ date: '2026-11-01', exercises: [exercise()] }),
        record({
          date: '2026-11-03',
          id: 'workout-2',
          exercises: [
            exercise({
              id: 'bench',
              name: '杠铃平板卧推',
              sets: [set({ id: 'set-3', weight: 60, reps: 10 }), set({ id: 'set-4', done: false })],
            }),
          ],
        }),
      ],
    })

    expect(facts.fitness.sessionCount).toBe(2)
    expect(facts.fitness.exerciseCount).toBe(2)
    expect(facts.fitness.doneSets).toBe(2)
    expect(facts.fitness.totalSets).toBe(3)
    expect(facts.fitness.strengthVolumeKg).toBe(70 * 8 + 60 * 10)
    expect(facts.fitness.exerciseNames).toEqual(['杠铃深蹲', '杠铃平板卧推'])
    expect(facts.fitness.summaryText).toContain('2 个动作，完成 2 组')
  })

  it('饮水按窗口内真实记录累加，不叠加今日页的演示基线', () => {
    const facts = collectReportWindowFacts({
      ...EMPTY_INPUT,
      waterHistory: [
        waterEntry('2026-11-04', 250, 1),
        waterEntry('2026-11-04', 250, 2),
        waterEntry('2026-11-03', 300, 3),
      ],
    })

    expect(facts.water.eventCount).toBe(3)
    expect(facts.water.liters).toBeCloseTo(0.8, 5)
    expect(facts.water.dailyAverage).toBeCloseTo(0.8 / 7, 5)
  })

  it('饮食只数有食物的餐次；计划数窗口内已完成与总数', () => {
    const facts = collectReportWindowFacts({
      ...EMPTY_INPUT,
      dietDays: [dietDay('2026-11-04', [2, 0, 3, 0]), dietDay('2026-10-01', [1, 1, 1, 1])],
      planHistory: [
        planItem('2026-11-04', true, 1),
        planItem('2026-11-04', false, 2),
        planItem('2026-11-02', true, 3),
        planItem('2026-10-01', false, 4),
      ],
    })

    expect(facts.diet.mealCount).toBe(2)
    expect(facts.diet.foodEntryCount).toBe(5)
    expect(facts.plan.total).toBe(3)
    expect(facts.plan.done).toBe(2)
  })
})
