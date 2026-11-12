import { describe, expect, it } from 'vitest'
import { calculateProfileCompleteness } from './profile'
import { createInitialDataForRuntimeMode } from './runtime-initial-data'

describe('createInitialDataForRuntimeMode', () => {
  it('starts owner without business records while keeping full-mode AI preferences', () => {
    const data = createInitialDataForRuntimeMode('owner', new Date('2026-11-11T12:00:00+08:00'))

    expect(data.goals).toEqual([])
    expect(data.planItems).toEqual([])
    expect(data.waterLog).toEqual([])
    expect(data.studyRecords).toEqual([])
    expect(data.dietDays).toEqual([])
    expect(data.fitnessSession).toBeNull()
    expect(data.fitnessHistory).toEqual([])
    expect(data.reports).toEqual([])
    expect(data.longTermPlans).toEqual([])
    expect(data.eveningReview).toBeNull()
    expect(data.profile.goal).toBe('')
    expect(data.profile.age).toBe(0)
    expect(data.profile.sleepHours).toBe(0)
    expect(calculateProfileCompleteness(data.profile)).toBe(0)
    expect(data.aiConsent).toBe(true)
    expect(Object.values(data.settings.sources).every((enabled) => !enabled)).toBe(true)
    expect(data.settings.reminders.every((reminder) => !reminder.enabled && !reminder.time)).toBe(
      true,
    )
  })

  it('keeps guest empty and demo complete with prebuilt data', () => {
    const guest = createInitialDataForRuntimeMode('guest')
    const demo = createInitialDataForRuntimeMode('demo')

    expect(guest.planItems).toEqual([])
    expect(guest.reports).toEqual([])
    expect(guest.aiConsent).toBe(false)
    expect(demo.planItems.length).toBeGreaterThan(0)
    expect(demo.studyRecords.length).toBeGreaterThan(0)
    expect(demo.reports.length).toBeGreaterThan(0)
    expect(demo.longTermPlans?.length).toBeGreaterThan(0)
  })
})
