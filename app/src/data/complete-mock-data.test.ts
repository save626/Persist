import { describe, expect, it } from 'vitest'
import { calculateProfileCompleteness } from './profile'
import { createCompleteMockData } from './complete-mock-data'
import { formatTrainingSummary, getExerciseKind, summarizeFitness } from '../lib/fitness'
import { parseMockBackupJson } from '../lib/mock-data-transfer'
import type { FitnessSessionState, ImportableMockData, WorkoutSet } from '../types'

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function backupText(data: ImportableMockData) {
  return JSON.stringify({
    app: 'Persist',
    version: '0.1.0',
    mode: 'frontend-mock',
    exportedAt: new Date().toISOString(),
    data,
  })
}

/** 演示数据只覆盖今天一天，取当天这一份餐次快照。 */
function mealsOfToday(data: ImportableMockData) {
  return data.dietDays.find((day) => day.date === localDateKey())?.meals ?? []
}

describe('complete mock data', () => {
  it('covers every importable Mock data slice with actionable records', () => {
    const data = createCompleteMockData()
    const today = localDateKey()
    const todayStudy = data.studyRecords.filter((record) => record.date === today)
    const studyDates = new Set(data.studyRecords.map((record) => record.date))
    const sets = data.fitnessSession?.exercises.flatMap((exercise) => exercise.sets) ?? []
    const doneSets = sets.filter((set) => set.done)
    const incompleteSets = sets.filter((set) => !set.done)
    const waterMilliliters = data.waterLog.reduce((total, entry) => total + entry.milliliters, 0)

    expect(data.goals).toHaveLength(2)
    expect(data.goals.every((goal) => goal.enabled && goal.date > today)).toBe(true)
    expect(data.planItems.length).toBeGreaterThanOrEqual(7)
    expect(new Set(data.planItems.map((item) => item.kind))).toEqual(
      new Set(['default', 'food', 'water', 'study']),
    )
    expect(data.planItems.some((item) => item.actionable && !item.done)).toBe(true)
    expect(data.planItems.some((item) => item.done)).toBe(true)
    expect(data.planItems.some((item) => !item.done)).toBe(true)

    expect(data.waterLog.length).toBeGreaterThanOrEqual(3)
    expect(waterMilliliters).toBe(800)

    expect(todayStudy.length).toBeGreaterThanOrEqual(2)
    expect(studyDates.size).toBeGreaterThanOrEqual(7)
    expect(data.studyRecords.some((record) => record.category === 'english')).toBe(true)
    expect(data.studyRecords.some((record) => record.category === 'math')).toBe(true)
    expect(
      data.studyRecords.some(
        (record) =>
          record.category === 'english' &&
          record.newWords !== undefined &&
          record.reviewWords !== undefined &&
          record.accuracy !== undefined &&
          record.listening !== undefined,
      ),
    ).toBe(true)
    expect(
      data.studyRecords.some(
        (record) =>
          record.category === 'math' &&
          record.chapter &&
          record.questions !== undefined &&
          record.wrong !== undefined,
      ),
    ).toBe(true)

    const todayMeals = mealsOfToday(data)
    expect(todayMeals).toHaveLength(4)
    expect(todayMeals.every((meal) => meal.entries.length > 0)).toBe(true)
    expect(todayMeals.filter((meal) => meal.photoName).length).toBeGreaterThanOrEqual(1)
    expect(data.dietDays).toHaveLength(1)

    expect(data.fitnessSession?.sessionStatus).toBe('active')
    expect(data.fitnessSession?.exercises.length).toBeGreaterThanOrEqual(4)
    expect(doneSets.length).toBeGreaterThan(0)
    expect(incompleteSets.length).toBeGreaterThan(0)
    expect(doneSets.some((set) => set.rpe !== undefined)).toBe(true)

    expect(calculateProfileCompleteness(data.profile)).toBe(100)
    expect(data.profile.allergies).toBeTruthy()
    expect(data.profile.bedtime).toBeTruthy()
    expect(data.profile.stress).toBeTruthy()
    expect(data.aiConsent).toBe(true)

    expect(data.settings.reminders).toHaveLength(3)
    expect(data.settings.reminders.every((reminder) => reminder.enabled)).toBe(true)
    expect(Object.values(data.settings.sources).every(Boolean)).toBe(true)
    expect(data.settings.summaryOnly).toBe(true)

    expect(data.eveningReview?.energy).toBeGreaterThan(0)
    expect(data.eveningReview?.state).toBeTruthy()
    expect(data.reports.length).toBeGreaterThanOrEqual(4)
    expect(new Set(data.reports.map((report) => report.type)).size).toBeGreaterThanOrEqual(4)
    expect(data.reports.every((report) => report.actions.length > 0)).toBe(true)
  })

  it('summarizes strength, duration and distance records consistently', () => {
    const data = createCompleteMockData()
    const exercises = data.fitnessSession?.exercises ?? []
    const summary = summarizeFitness(exercises)

    expect(exercises).toHaveLength(6)
    expect(summary.doneSets).toBe(10)
    expect(summary.totalSets).toBe(16)
    expect(summary.strengthVolume).toBe(2_680)
    expect(summary.durationMinutes).toBe(37)
    expect(summary.distanceKm).toBe(8.5)
    expect(formatTrainingSummary(exercises)).toBe(
      '6 个动作，完成 10 组，力量容量 2,680 kg，累计运动 37 分钟，距离 8.5 km',
    )
  })

  it('round-trips through the JSON backup parser and preserves workout kinds', () => {
    const data = createCompleteMockData()
    const parsed = parseMockBackupJson(backupText(data))
    const exercises = parsed.fitnessSession?.exercises ?? []

    expect(parsed.goals).toHaveLength(data.goals.length)
    expect(parsed.planItems).toHaveLength(data.planItems.length)
    expect(parsed.waterLog).toHaveLength(data.waterLog.length)
    expect(parsed.studyRecords).toHaveLength(data.studyRecords.length)
    expect('meals' in parsed).toBe(false)
    expect(parsed.dietDays).toHaveLength(data.dietDays.length)
    expect(parsed.fitnessHistory).toHaveLength(0)
    expect(exercises).toHaveLength(data.fitnessSession?.exercises.length ?? 0)
    expect(parsed.reports).toHaveLength(data.reports.length)
    expect(exercises.some((exercise) => exercise.kind === 'duration')).toBe(true)
    expect(exercises.some((exercise) => exercise.kind === 'distance')).toBe(true)
    expect(summarizeFitness(exercises)).toEqual(
      summarizeFitness(data.fitnessSession?.exercises ?? []),
    )
  })

  it('accepts legacy strength records that do not contain a kind field', () => {
    const data = createCompleteMockData()
    const sourceExercise = data.fitnessSession?.exercises[0]
    expect(sourceExercise).toBeDefined()

    const legacyExercise = { ...sourceExercise! }
    delete legacyExercise.kind
    const legacySession: FitnessSessionState = {
      ...data.fitnessSession!,
      exercises: [legacyExercise],
    }
    const parsed = parseMockBackupJson(backupText({ ...data, fitnessSession: legacySession }))
    const parsedExercise = parsed.fitnessSession?.exercises[0]

    expect(parsedExercise?.kind).toBeUndefined()
    expect(parsedExercise && getExerciseKind(parsedExercise)).toBe('strength')
    expect(parsedExercise?.sets[0].reps).toBe(8)
  })

  it('rejects malformed workout sets without weakening validation', () => {
    const data = createCompleteMockData()
    const session = data.fitnessSession!
    const exercise = session.exercises[0]
    const validSet = exercise.sets[0]
    const invalidSets: Array<[string, WorkoutSet]> = [
      ['empty id', { ...validSet, id: '' }],
      ['missing metric', { id: 'missing-metric', weight: 60, done: true }],
      ['negative distance', { ...validSet, distanceKm: -1 }],
      ['rpe above ten', { ...validSet, rpe: 11 }],
    ]

    invalidSets.forEach(([label, set]) => {
      const invalidSession: FitnessSessionState = {
        ...session,
        exercises: [{ ...exercise, sets: [set] }],
      }
      expect(
        () => parseMockBackupJson(backupText({ ...data, fitnessSession: invalidSession })),
        label,
      ).toThrow('训练会话格式不正确')
    })

    const distanceExercise = session.exercises.find((item) => item.kind === 'distance')!
    const invalidDistanceSession: FitnessSessionState = {
      ...session,
      exercises: [
        {
          ...distanceExercise,
          sets: [{ id: 'duration-only', durationMinutes: 20, done: true }],
        },
      ],
    }
    expect(() =>
      parseMockBackupJson(backupText({ ...data, fitnessSession: invalidDistanceSession })),
    ).toThrow('训练会话格式不正确')
  })
})
