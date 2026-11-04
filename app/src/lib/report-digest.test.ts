import { describe, expect, it } from 'vitest'
import type { FitnessSessionState, Meal, MockSettings, ProfileData, StudyRecord } from '../types'
import {
  buildReportDigest,
  digestFingerprint,
  digestSourceLabels,
  hasDigestSources,
} from './report-digest'

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
  aiConsent: true,
}

const allOn: MockSettings = {
  reminders: [],
  summaryOnly: true,
  sources: { fitness: true, diet: true, study: true, profile: true },
}

function settingsWith(patch: Partial<MockSettings['sources']>): MockSettings {
  return { ...allOn, sources: { ...allOn.sources, ...patch } }
}

const fitnessSession: FitnessSessionState = {
  activeTemplateId: 'tpl',
  sessionStatus: 'active',
  elapsedSeconds: 600,
  exercises: [
    {
      id: 'e1',
      name: '卧推',
      kind: 'strength',
      muscle: '胸',
      equipment: '杠铃',
      targetReps: '8',
      rest: '90s',
      sets: [
        { id: 's1', weight: 60, reps: 8, done: true, rpe: 7 },
        { id: 's2', weight: 60, reps: 8, done: false },
      ],
    },
  ],
}

const studyRecords: StudyRecord[] = [
  {
    id: 'st1',
    category: 'english',
    source: '墨墨',
    date: '2026-11-04',
    startTime: '10:00',
    duration: 30,
    note: '',
  },
  {
    id: 'st2',
    category: 'math',
    source: '高数',
    date: '2026-11-04',
    startTime: '20:00',
    duration: 45,
    note: '',
  },
]

const meals: Meal[] = [
  {
    id: 'breakfast',
    label: '早餐',
    time: '08:00',
    entries: [
      { id: 'f1', name: '鸡蛋', portion: '2 个', calories: 140, protein: 12, carbs: 1, fat: 10 },
      { id: 'f2', name: '牛奶', portion: '250 ml', calories: 120, protein: 8, carbs: 12, fat: 4 },
    ],
  },
  { id: 'lunch', label: '午餐', time: '12:30', entries: [] },
]

const baseInput = {
  aiConsent: true,
  settings: allOn,
  profile,
  fitnessSession,
  studyRecords,
  meals,
  waterLiters: 1.2,
  waterLog: [
    { id: 'w1', milliliters: 300, time: '09:10', date: '2026-11-04' },
    { id: 'w2', milliliters: 400, time: '14:20', date: '2026-11-04' },
  ],
}

describe('buildReportDigest', () => {
  it('全体来源打开时按本地记录生成完整摘要', () => {
    const digest = buildReportDigest(baseInput)

    expect(digest.fitness).toMatchObject({
      hasSession: true,
      exerciseCount: 1,
      doneSets: 1,
      totalSets: 2,
      strengthVolumeKg: 480,
      exerciseNames: ['卧推'],
    })
    expect(digest.study).toEqual({
      recordCount: 2,
      englishCount: 1,
      mathCount: 1,
      totalMinutes: 75,
    })
    expect(digest.diet).toEqual({
      mealCount: 1,
      foodEntryCount: 2,
      waterLiters: 1.2,
      waterEvents: 3,
    })
    expect(digest.profile).toMatchObject({ ...profile, aiConsent: true })
    expect(hasDigestSources(digest)).toBe(true)
    expect(digestSourceLabels(digest)).toEqual(['训练', '学习', '饮食', '档案'])
  })

  it('未授权时所有模块都是 null，绝不用 0 或空数组顶替', () => {
    const digest = buildReportDigest({ ...baseInput, aiConsent: false })

    expect(digest).toEqual({ fitness: null, study: null, diet: null, profile: null })
    expect(hasDigestSources(digest)).toBe(false)
  })

  it('单个来源开关关闭时，该模块保持 null，其他模块不受影响', () => {
    const digest = buildReportDigest({
      ...baseInput,
      settings: settingsWith({ fitness: false, diet: false }),
    })

    expect(digest.fitness).toBeNull()
    expect(digest.diet).toBeNull()
    expect(digest.study).not.toBeNull()
    expect(digest.profile).not.toBeNull()
    expect(digestSourceLabels(digest)).toEqual(['学习', '档案'])
  })

  it('未授权时即使来源开关打开也不会带出数据', () => {
    const digest = buildReportDigest({
      ...baseInput,
      aiConsent: false,
      settings: settingsWith({ profile: true }),
    })

    expect(digest.profile).toBeNull()
    expect(hasDigestSources(digest)).toBe(false)
  })

  it('没有训练会话时不编造训练摘要', () => {
    const digest = buildReportDigest({ ...baseInput, fitnessSession: null })

    expect(digest.fitness).toMatchObject({
      hasSession: false,
      exerciseCount: 0,
      doneSets: 0,
      strengthVolumeKg: 0,
      exerciseNames: [],
    })
  })
})

describe('digestFingerprint', () => {
  it('摘要内容变化后指纹随之变化，用于让晨间简报缓存失效', () => {
    const before = digestFingerprint(buildReportDigest(baseInput))
    const after = digestFingerprint(
      buildReportDigest({ ...baseInput, waterLiters: 1.5 }),
    )

    expect(before).not.toBe(after)
    expect(digestFingerprint(buildReportDigest(baseInput))).toBe(before)
  })
})
