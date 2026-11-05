import { describe, expect, it } from 'vitest'
import type { FetchLike } from './ai-report-client'
import { buildReportDigest } from './report-digest'
import type { MockSettings, ProfileData } from '../types'
import {
  MORNING_BRIEF_CACHE_PREFIX,
  MORNING_BRIEF_LOADING_NOTE,
  buildMorningBriefRequest,
  generateMorningBrief,
  morningBriefCacheKey,
  morningBriefNote,
  readCachedMorningBrief,
  safeSessionStorage,
  type MorningBriefResult,
} from './morning-brief'
import type { ReportContent, ReportRequest } from './report-types'

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

const settings: MockSettings = {
  reminders: [],
  summaryOnly: true,
  sources: { fitness: true, diet: true, study: true, profile: true },
}

const digest = buildReportDigest({
  aiConsent: true,
  settings,
  profile,
  fitnessSession: null,
  studyRecords: [],
  meals: [],
  waterLiters: 1.2,
  waterLog: [],
})

const content: ReportContent = {
  title: '先把饮水补上，再收晚间复盘',
  status: '先补饮水',
  summary:
    '今天记录不多，但饮水只有 1.2 L，距离目标还差约 800 ml。先把补水补齐，晚间再做一次简短复盘，不需要额外增加训练量。',
  conclusions: ['饮水 1.2 L，距离 2 L 目标还有距离。'],
  actions: ['下午分两次补水，每次约 400 ml。'],
  warnings: [],
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  return { calls, fetchImpl }
}

const rejectFetch: FetchLike = async () => {
  throw new TypeError('fetch failed')
}

describe('generateMorningBrief', () => {
  it('未授权时不发请求，直接回退本机规则', async () => {
    const { calls, fetchImpl } = stubFetch(() => jsonResponse({}))
    const result = await generateMorningBrief({
      aiConsent: false,
      digest,
      date: '2026-11-04',
      storage: null,
      fetchImpl,
    })

    expect(result).toEqual<MorningBriefResult>({ status: 'no-consent', content: null })
    expect(calls).toHaveLength(0)
    expect(morningBriefNote('no-consent', digest)).toContain('未开启 AI 数据授权')
  })

  it('没有任何打开的数据来源时不请求模型', async () => {
    const emptyDigest = buildReportDigest({
      aiConsent: true,
      settings: {
        ...settings,
        sources: { fitness: false, diet: false, study: false, profile: false },
      },
      profile,
      fitnessSession: null,
      studyRecords: [],
      meals: [],
      waterLiters: 0,
      waterLog: [],
    })
    const { calls, fetchImpl } = stubFetch(() => jsonResponse({}))
    const result = await generateMorningBrief({
      aiConsent: true,
      digest: emptyDigest,
      date: '2026-11-04',
      storage: null,
      fetchImpl,
    })

    expect(result.status).toBe('no-data')
    expect(calls).toHaveLength(0)
  })

  it('请求成功后写缓存，同会话同摘要不再重复请求', async () => {
    const storage = createStorage()
    const { calls, fetchImpl } = stubFetch(() => jsonResponse({ report: content }))

    const first = await generateMorningBrief({
      aiConsent: true,
      digest,
      date: '2026-11-04',
      storage,
      fetchImpl,
    })
    expect(first.status).toBe('ai')
    expect(first.content).toEqual(content)
    expect(calls).toHaveLength(1)

    const sent = JSON.parse(String(calls[0]?.init?.body)) as ReportRequest
    expect(sent.type).toBe('今日简报')
    expect(sent.rangeDays).toBe(7)

    const second = await generateMorningBrief({
      aiConsent: true,
      digest,
      date: '2026-11-04',
      storage,
      fetchImpl,
    })
    expect(second.status).toBe('ai')
    expect(second.content).toEqual(content)
    expect(calls).toHaveLength(1)
  })

  it('摘要内容变化后旧缓存失效，重新请求模型', async () => {
    const storage = createStorage()
    const { calls, fetchImpl } = stubFetch(() => jsonResponse({ report: content }))

    await generateMorningBrief({ aiConsent: true, digest, date: '2026-11-04', storage, fetchImpl })

    const changedDigest = buildReportDigest({
      aiConsent: true,
      settings,
      profile,
      fitnessSession: null,
      studyRecords: [],
      meals: [],
      waterLiters: 1.6,
      waterLog: [],
    })
    const second = await generateMorningBrief({
      aiConsent: true,
      digest: changedDigest,
      date: '2026-11-04',
      storage,
      fetchImpl,
    })

    expect(second.status).toBe('ai')
    expect(calls).toHaveLength(2)
  })

  it('换一天不会复用昨天的文案', async () => {
    const storage = createStorage()
    const { calls, fetchImpl } = stubFetch(() => jsonResponse({ report: content }))

    await generateMorningBrief({ aiConsent: true, digest, date: '2026-11-04', storage, fetchImpl })
    await generateMorningBrief({ aiConsent: true, digest, date: '2026-11-05', storage, fetchImpl })

    expect(calls).toHaveLength(2)
    expect(storage.getItem(morningBriefCacheKey('2026-11-04'))).not.toBeNull()
    expect(storage.getItem(morningBriefCacheKey('2026-11-05'))).not.toBeNull()
  })

  it('服务端不可用时回退，且不写入缓存', async () => {
    const storage = createStorage()
    const result = await generateMorningBrief({
      aiConsent: true,
      digest,
      date: '2026-11-04',
      storage,
      fetchImpl: rejectFetch,
    })

    expect(result).toEqual<MorningBriefResult>({ status: 'unavailable', content: null })
    expect(storage.length).toBe(0)
    expect(morningBriefNote('unavailable', digest)).toContain('已回退到本机规则')
  })

  it('结构不合契约时如实回退，不用半截输出冒充模型结论', async () => {
    const storage = createStorage()
    const { fetchImpl } = stubFetch(() => jsonResponse({ report: { title: '太短' } }))
    const result = await generateMorningBrief({
      aiConsent: true,
      digest,
      date: '2026-11-04',
      storage,
      fetchImpl,
    })

    expect(result.status).toBe('contract')
    expect(result.content).toBeNull()
    expect(morningBriefNote('contract', digest)).toContain('不符合契约')
  })

  it('尊重取消信号', async () => {
    const controller = new AbortController()
    const aborting: FetchLike = async () => {
      controller.abort()
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }

    await expect(
      generateMorningBrief({
        aiConsent: true,
        digest,
        date: '2026-11-04',
        storage: null,
        fetchImpl: aborting,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('缓存与文案', () => {
  it('缓存只认识通过形状校验的内容', () => {
    const storage = createStorage()
    const key = morningBriefCacheKey('2026-11-04')
    storage.setItem(
      key,
      JSON.stringify({ digestKey: JSON.stringify(digest), content: { title: 'ok' } }),
    )
    expect(readCachedMorningBrief(storage, '2026-11-04', digest)).toBeNull()

    storage.removeItem(key)
    expect(readCachedMorningBrief(storage, '2026-11-04', digest)).toBeNull()
  })

  it('缓存键按天隔离，且带固定前缀', () => {
    expect(morningBriefCacheKey('2026-11-04')).toBe(`${MORNING_BRIEF_CACHE_PREFIX}2026-11-04`)
  })

  it('只有 ai 状态才把来源标成 DeepSeek', () => {
    expect(morningBriefNote('ai', digest)).toContain('DeepSeek')
    expect(morningBriefNote('ai', digest)).toContain('服务端代理')
    for (const status of ['no-consent', 'no-data', 'unavailable', 'contract'] as const) {
      expect(morningBriefNote(status, digest)).not.toContain('DeepSeek')
    }
    expect(MORNING_BRIEF_LOADING_NOTE).toContain('DeepSeek')
  })

  it('请求体固定使用服务端支持的「今日简报」类型', () => {
    expect(buildMorningBriefRequest(digest)).toEqual({
      type: '今日简报',
      rangeDays: 7,
      digest,
    })
  })

  it('拿不到 sessionStorage 时安全降级为不缓存', () => {
    const original = globalThis.window
    // 模拟隐私模式：访问 sessionStorage 直接抛错。
    const throwing = Object.create(original) as Window & typeof globalThis
    Object.defineProperty(throwing, 'sessionStorage', {
      get() {
        throw new Error('security error')
      },
    })
    Object.defineProperty(globalThis, 'window', { value: throwing, configurable: true })
    try {
      expect(safeSessionStorage()).toBeNull()
    } finally {
      Object.defineProperty(globalThis, 'window', { value: original, configurable: true })
    }
  })
})
