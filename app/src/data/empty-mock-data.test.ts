import { describe, expect, it } from 'vitest'
import { createEmptyMockData } from './empty-mock-data'

describe('createEmptyMockData', () => {
  it('starts without sample records, goals, reports, or profile fields', () => {
    const data = createEmptyMockData()

    expect(data.goals).toEqual([])
    expect(data.planItems).toEqual([])
    expect(data.waterLog).toEqual([])
    expect(data.studyRecords).toEqual([])
    expect(data.dietDays).toEqual([])
    expect(data.fitnessSession).toBeNull()
    expect(data.fitnessHistory).toEqual([])
    expect(data.reports).toEqual([])
    expect(data.longTermPlans).toEqual([])
    expect(data.profile.goal).toBe('')
    expect(data.profile.age).toBe(0)
    expect(data.aiConsent).toBe(false)
  })

  it('keeps every reminder, source, and scheduled brief disabled', () => {
    const data = createEmptyMockData()

    expect(data.settings.reminders.every((reminder) => !reminder.enabled)).toBe(true)
    expect(Object.values(data.settings.sources).every((enabled) => !enabled)).toBe(true)
    expect(data.settings.dailyBrief).toEqual({ enabled: false, at: '21:00' })
  })
})
