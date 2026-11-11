import { describe, expect, it } from 'vitest'
import {
  PREBUILT_AI_LABEL,
  PREBUILT_DEMO_AI_METADATA,
  PREBUILT_DEMO_PLAN_CHAT,
  PREBUILT_DEMO_REPORT_CONTENT,
} from './prebuilt-demo-ai'

describe('prebuilt demo AI', () => {
  it('ships all demo AI content as a fixed DeepSeek snapshot', () => {
    expect(PREBUILT_DEMO_AI_METADATA).toMatchObject({
      model: 'deepseek-chat',
      generatedAt: '2026-11-10T12:32:59.000Z',
    })
    expect(PREBUILT_AI_LABEL).toBe('部署前预生成 · 只读')

    for (const content of Object.values(PREBUILT_DEMO_REPORT_CONTENT)) {
      expect(content.title.length).toBeGreaterThan(0)
      expect(content.summary.length).toBeGreaterThan(80)
      expect(content.conclusions.length).toBeGreaterThan(0)
      expect(content.actions.length).toBeGreaterThan(0)
    }
  })

  it('keeps the AI onboarding conversation and plan static', () => {
    expect(PREBUILT_DEMO_PLAN_CHAT.userText).toContain('12 周')
    expect(PREBUILT_DEMO_PLAN_CHAT.assistantText).toContain('第 1–4 周')
    expect(PREBUILT_DEMO_PLAN_CHAT.proposal.title).toBe('12 周增肌与体态改善计划')
    expect(PREBUILT_DEMO_PLAN_CHAT.proposal.weeklyTargets).toHaveLength(3)
    expect(PREBUILT_DEMO_PLAN_CHAT.proposal.milestones).toHaveLength(3)
  })
})
