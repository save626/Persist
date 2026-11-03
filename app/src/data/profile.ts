import type { ProfileData } from '../types'

export const INITIAL_PROFILE: ProfileData = {
  age: 24,
  height: 178,
  weight: 72.5,
  targetWeight: 70,
  goal: '增肌同时改善体态',
  experience: '系统训练 2 年',
  frequency: '每周 4 次',
  equipment: '商业健身房',
  dietPreference: '高蛋白、正常碳水',
  allergies: '',
  bedtime: '',
  sleepHours: 7.2,
  stress: '',
  aiConsent: true,
}

export function countProfileFields(profile: ProfileData) {
  const values = [
    profile.age,
    profile.height,
    profile.weight,
    profile.targetWeight,
    profile.goal,
    profile.experience,
    profile.frequency,
    profile.equipment,
    profile.dietPreference,
    profile.allergies,
    profile.bedtime,
    profile.sleepHours,
    profile.stress,
    profile.aiConsent,
  ]
  return values.filter((value) => {
    if (typeof value === 'boolean') return true
    return String(value ?? '').trim() !== '' && Number(value) !== 0
  }).length
}

export function calculateProfileCompleteness(profile: ProfileData) {
  return Math.floor((countProfileFields(profile) / 14) * 100)
}
