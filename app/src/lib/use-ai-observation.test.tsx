import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportContent, ReportRequest } from './report-types'

const mocks = vi.hoisted(() => ({
  requestAiReport: vi.fn(),
}))

vi.mock('./ai-report-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ai-report-client')>()
  return { ...actual, requestAiReport: mocks.requestAiReport }
})

import { observationCacheKey, readObservationCache, useAiObservation } from './use-ai-observation'

const CONTENT: ReportContent = {
  title: '训练节奏保持稳定',
  status: '稳步推进',
  summary: '今天完成了六组训练，动作集中在胸推与深蹲，整体节奏稳定，可以按计划结束本次训练。',
  conclusions: ['已完成六组训练'],
  actions: ['按原计划结束训练'],
  warnings: [],
}

const REQUEST: ReportRequest = {
  type: '训练建议',
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
    study: null,
    diet: null,
    profile: null,
  },
}

const DATE_KEY = '2026-11-11'

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

afterEach(cleanup)

describe('useAiObservation', () => {
  it('未启用时不发起请求并保持 disabled', () => {
    const { result } = renderHook(() =>
      useAiObservation({ enabled: false, request: REQUEST, dateKey: DATE_KEY }),
    )
    expect(result.current.mode).toBe('disabled')
    expect(mocks.requestAiReport).not.toHaveBeenCalled()
  })

  it('启用后请求一次 AI，并把当天结果写入缓存', async () => {
    mocks.requestAiReport.mockResolvedValueOnce(CONTENT)
    const { result } = renderHook(() =>
      useAiObservation({ enabled: true, request: REQUEST, dateKey: DATE_KEY }),
    )

    await waitFor(() => expect(result.current.mode).toBe('ai'))
    expect(result.current.content).toEqual(CONTENT)
    expect(result.current.fromCache).toBe(false)
    expect(mocks.requestAiReport).toHaveBeenCalledTimes(1)
    expect(readObservationCache('训练建议', DATE_KEY)?.content).toEqual(CONTENT)
  })

  it('当天缓存可直接使用，数据变化只标记过期，手动重新生成才再次请求', async () => {
    window.localStorage.setItem(
      observationCacheKey('训练建议', DATE_KEY),
      JSON.stringify({
        fingerprint: '旧摘要',
        content: CONTENT,
        generatedAt: '2026-11-11T01:00:00.000Z',
      }),
    )
    const { result } = renderHook(() =>
      useAiObservation({ enabled: true, request: REQUEST, dateKey: DATE_KEY }),
    )

    await waitFor(() => expect(result.current.mode).toBe('ai'))
    expect(result.current.fromCache).toBe(true)
    expect(result.current.stale).toBe(true)
    expect(mocks.requestAiReport).not.toHaveBeenCalled()

    mocks.requestAiReport.mockResolvedValueOnce(CONTENT)
    act(() => result.current.regenerate())
    await waitFor(() => expect(result.current.fromCache).toBe(false))
    expect(mocks.requestAiReport).toHaveBeenCalledTimes(1)
  })

  it('请求失败时回退状态可被页面识别', async () => {
    mocks.requestAiReport.mockRejectedValueOnce(new Error('模型服务不可用'))
    const { result } = renderHook(() =>
      useAiObservation({ enabled: true, request: REQUEST, dateKey: DATE_KEY }),
    )

    await waitFor(() => expect(result.current.mode).toBe('fallback'))
    expect(result.current.error).toBe('模型服务不可用')
    expect(result.current.content).toBeNull()
  })
})
