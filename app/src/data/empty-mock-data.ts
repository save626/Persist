import type { ImportableMockData, ProfileData } from '../types'
import { INITIAL_SETTINGS } from './settings'

const EMPTY_PROFILE: ProfileData = {
  age: 0,
  height: 0,
  weight: 0,
  targetWeight: 0,
  goal: '',
  experience: '',
  frequency: '',
  equipment: '',
  dietPreference: '',
  allergies: '',
  bedtime: '',
  sleepHours: 0,
  stress: '',
  aiConsent: false,
}

/**
 * guest 的空白起点：不预置目标、计划、记录、报告或档案。
 * 设置只保留可编辑框架，提醒、数据来源与每日简报均关闭。
 */
export function createEmptyMockData(): ImportableMockData {
  return {
    goals: [],
    planItems: [],
    waterLog: [],
    studyRecords: [],
    dietDays: [],
    fitnessSession: null,
    fitnessHistory: [],
    profile: { ...EMPTY_PROFILE },
    settings: {
      ...INITIAL_SETTINGS,
      reminders: INITIAL_SETTINGS.reminders.map((reminder) => ({
        ...reminder,
        time: '',
        enabled: false,
      })),
      sources: { fitness: false, diet: false, study: false, profile: false },
      dailyBrief: { enabled: false, at: '' },
    },
    aiConsent: false,
    eveningReview: null,
    reports: [],
    longTermPlans: [],
  }
}
