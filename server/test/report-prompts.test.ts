import { describe, expect, it } from 'vitest'
import type { ReportRequest } from '../src/contract.js'
import { buildReportMessages, REPORT_TYPE_GUIDANCE } from '../src/ai/prompts.js'

const request: ReportRequest = {
  type: '今日简报',
  rangeDays: 7,
  digest: {
    fitness: {
      hasSession: true,
      exerciseCount: 2,
      doneSets: 6,
      totalSets: 8,
      strengthVolumeKg: 1200,
      durationMinutes: 40,
      distanceKm: 0,
      exerciseNames: ['深蹲', '卧推'],
    },
    study: { recordCount: 2, englishCount: 1, mathCount: 1, totalMinutes: 55 },
    diet: { mealCount: 2, foodEntryCount: 5, waterLiters: 1.45, waterEvents: 2 },
    profile: null,
  },
}

describe('报告类型提示词', () => {
  it.each([
    ['训练建议', '只围绕本次训练'],
    ['饮食观察', '只围绕今日餐次'],
    ['学习观察', '只围绕今日英语与高数'],
  ] as const)('%s 使用专属观察边界', (type, expected) => {
    const messages = buildReportMessages({ ...request, type }, '2026-11-11')
    const system = messages[0]
    expect(system?.role).toBe('system')
    expect(system?.content).toContain(`本次报告类型为「${type}」`)
    expect(system?.content).toContain(REPORT_TYPE_GUIDANCE[type])
    expect(system?.content).toContain(expected)
    expect(system?.content).toContain('不扩展到未授权的数据来源')
  })
})
