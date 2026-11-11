import { describe, expect, it } from 'vitest'
import type { ProfileData } from '../types'
import type { ChatEvent, ChatRequest } from './chat-types'
import {
  AI_CHAT_LABEL,
  ChatUnavailableError,
  createAppChatClient,
  createHttpChatClient,
  probeAiChat,
  type FetchLike,
} from './ai-chat-client'
import { MOCK_CHAT_LABEL } from './mock-chat-client'

const profile: ProfileData = {
  age: 28,
  height: 175,
  weight: 80,
  targetWeight: 72,
  goal: '减脂',
  experience: '初级',
  frequency: '每周 4 次',
  equipment: '哑铃',
  dietPreference: '正常饮食',
  allergies: '无',
  bedtime: '23:30',
  sleepHours: 7.5,
  stress: '中等',
  aiConsent: true,
}

const request: ChatRequest = {
  turns: [{ role: 'user', content: '我想减脂，每周能练 4 次，帮我生成 8 周计划' }],
  profile,
  askedFields: [],
}

function sseText(events: string[]): string {
  return events.map((event) => `data: ${event}\n\n`).join('')
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 把一段文本切成若干块，模拟网络分包（含跨行、跨事件边界）。 */
function chunksOf(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size))
  }
  return chunks
}

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  return { calls, fetchImpl }
}

async function collect(
  client: { send(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> },
  signal?: AbortSignal,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = []
  for await (const event of client.send(request, signal)) events.push(event)
  return events
}

describe('createHttpChatClient', () => {
  it('按契约顺序解析 SSE，忽略心跳注释，容忍任意分包与 CRLF', async () => {
    const wire = sseText([
      '{"type":"stage","stage":"collect"}',
      '{"type":"delta","text":"第一段"}',
      '{"type":"delta","text":"第二段"}',
      '{"type":"questions","questions":[{"id":"q1","field":"goal","prompt":"目标是什么？","options":["减脂","增肌"]}]}',
      '{"type":"profilePatch","patch":{"age":29,"unknownField":"丢弃"}}',
      '{"type":"stage","stage":"propose"}',
      '{"type":"proposal","proposal":{"title":"8 周减脂","goal":"减脂","cadence":"weekly","weeklyTargets":[{"label":"训练","unit":"次","perWeek":4}],"milestones":[],"profilePatch":{},"assumptions":[],"warnings":[],"highlights":[]}}',
      '{"type":"warnings","warnings":["膝盖不适请先就医"]}',
      '{"type":"done"}',
    ]).replace(/\n/g, '\r\n')
    const withHeartbeat = `: ping\r\n\r\n${wire}`
    const { fetchImpl, calls } = stubFetch(() => streamResponse(chunksOf(withHeartbeat, 17)))

    const events = await collect(createHttpChatClient({ fetchImpl }))

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/chat')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(events.map((event) => event.type)).toEqual([
      'stage',
      'delta',
      'delta',
      'questions',
      'profilePatch',
      'stage',
      'proposal',
      'warnings',
      'done',
    ])
    expect(events[1]).toEqual({ type: 'delta', text: '第一段' })
    expect(events[3]).toEqual({
      type: 'questions',
      questions: [{ id: 'q1', field: 'goal', prompt: '目标是什么？', options: ['减脂', '增肌'] }],
    })
    // 未知档案字段在前端再过滤一次，不让 UI 拿到不认识的 key。
    expect(events[4]).toEqual({ type: 'profilePatch', patch: { age: 29 } })
  })

  it('把 turns / profile 发到 /api/chat，未指定 askedFields 时不带该字段', async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      streamResponse([sseText(['{"type":"stage","stage":"collect"}', '{"type":"done"}'])]),
    )
    await collect(createHttpChatClient({ fetchImpl }))

    const init = calls[0]?.init
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    const body = JSON.parse(String(init?.body)) as ChatRequest
    expect(body.turns).toEqual(request.turns)
    expect(body.profile).toEqual(profile)
    expect('askedFields' in body).toBe(false)
  })

  it('服务端 503 时抛出 ChatUnavailableError，并透出服务端文案', async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse(
        { error: { code: 'ai_not_configured', message: '服务端尚未配置模型密钥。' } },
        503,
      ),
    )
    const client = createHttpChatClient({ fetchImpl })

    await expect(collect(client)).rejects.toBeInstanceOf(ChatUnavailableError)
    await expect(collect(client)).rejects.toMatchObject({
      status: 503,
      message: '服务端尚未配置模型密钥。',
    })
  })

  it('流中的 error 事件转成 ChatUnavailableError，不会被当成正常完成', async () => {
    const { fetchImpl } = stubFetch(() =>
      streamResponse([
        sseText([
          '{"type":"stage","stage":"collect"}',
          '{"type":"error","code":"timeout","message":"模型服务超时了。"}',
        ]),
      ]),
    )
    const client = createHttpChatClient({ fetchImpl })

    await expect(collect(client)).rejects.toMatchObject({
      name: 'ChatUnavailableError',
      message: '模型服务超时了。',
    })
  })

  it('无法解析的 data 行直接报错，不静默跳过', async () => {
    const { fetchImpl } = stubFetch(() => streamResponse(['data: {not json}\n\n']))
    await expect(collect(createHttpChatClient({ fetchImpl }))).rejects.toBeInstanceOf(
      ChatUnavailableError,
    )
  })

  it('网络层失败转成 ChatUnavailableError', async () => {
    const { fetchImpl } = stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(collect(createHttpChatClient({ fetchImpl }))).rejects.toMatchObject({
      name: 'ChatUnavailableError',
      message: '无法连接模型服务。',
    })
  })
})

describe('probeAiChat', () => {
  it('只有 ai=deepseek 才认为可用', async () => {
    const healthy = stubFetch(() =>
      jsonResponse({ status: 'ok', service: 'persist-server', ai: 'deepseek' }),
    )
    const disabled = stubFetch(() =>
      jsonResponse({ status: 'ok', service: 'persist-server', ai: 'disabled' }),
    )

    await expect(probeAiChat({ fetchImpl: healthy.fetchImpl })).resolves.toBe(true)
    await expect(probeAiChat({ fetchImpl: disabled.fetchImpl })).resolves.toBe(false)
    expect(healthy.calls[0]?.url).toBe('/api/health')
  })

  it('网络失败或非 200 一律视为不可用', async () => {
    const offline = stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const broken = stubFetch(() => jsonResponse({ error: 'boom' }, 500))

    await expect(probeAiChat({ fetchImpl: offline.fetchImpl })).resolves.toBe(false)
    await expect(probeAiChat({ fetchImpl: broken.fetchImpl })).resolves.toBe(false)
  })
})

describe('createAppChatClient', () => {
  it('未开启授权时永不发请求，始终走本地 Mock', async () => {
    const { fetchImpl, calls } = stubFetch(() => {
      throw new Error('不应该发请求')
    })
    const client = createAppChatClient({
      consent: false,
      fetchImpl,
      mockOptions: { chunkDelayMs: 0 },
    })

    await expect(client.probe()).resolves.toBe('mock')
    const events = await collect(client)
    expect(calls).toHaveLength(0)
    expect(events[0]).toEqual({ type: 'stage', stage: 'collect' })
    expect(events.at(-1)).toEqual({ type: 'done' })
    expect(client.status()).toEqual({ source: 'mock', fallback: false })
    expect(client.label).toBe(MOCK_CHAT_LABEL)
  })

  it('allowRealAi=false keeps chat local even when consent is enabled', async () => {
    const { fetchImpl, calls } = stubFetch(() => {
      throw new Error('network must not be used')
    })
    const client = createAppChatClient({
      consent: true,
      allowRealAi: false,
      fetchImpl,
      mockOptions: { chunkDelayMs: 0 },
    })

    await expect(client.probe()).resolves.toBe('mock')
    const events = await collect(client)

    expect(calls).toHaveLength(0)
    expect(events[0]).toEqual({ type: 'stage', stage: 'collect' })
    expect(events.at(-1)).toEqual({ type: 'done' })
    expect(client.status()).toEqual({ source: 'mock', fallback: false })
    expect(client.label).toBe(MOCK_CHAT_LABEL)
  })

  it('服务可用时走真实模型，来源标成 DeepSeek', async () => {
    const { fetchImpl, calls } = stubFetch((url) => {
      if (url === '/api/health') {
        return jsonResponse({ status: 'ok', service: 'persist-server', ai: 'deepseek' })
      }
      return streamResponse([
        sseText([
          '{"type":"stage","stage":"collect"}',
          '{"type":"delta","text":"真实回答。"}',
          '{"type":"done"}',
        ]),
      ])
    })
    const client = createAppChatClient({
      consent: true,
      fetchImpl,
      mockOptions: { chunkDelayMs: 0 },
    })

    const events = await collect(client)

    expect(calls.map((call) => call.url)).toEqual(['/api/health', '/api/chat'])
    expect(events).toEqual([
      { type: 'stage', stage: 'collect' },
      { type: 'delta', text: '真实回答。' },
      { type: 'done' },
    ])
    expect(client.status()).toEqual({ source: 'ai', fallback: false })
    expect(client.label).toBe(AI_CHAT_LABEL)
  })

  it('服务不可用（首块内容前失败）时回退 Mock，并如实记录原因', async () => {
    const { fetchImpl, calls } = stubFetch((url) => {
      if (url === '/api/health') {
        return jsonResponse({ status: 'ok', service: 'persist-server', ai: 'deepseek' })
      }
      return jsonResponse(
        { error: { code: 'ai_failed', message: '模型服务暂时不可用，请稍后重试。' } },
        503,
      )
    })
    const client = createAppChatClient({
      consent: true,
      fetchImpl,
      mockOptions: { chunkDelayMs: 0 },
    })

    const events = await collect(client)

    expect(calls.map((call) => call.url)).toEqual(['/api/health', '/api/chat'])
    // 回退后仍然是完整的 Mock 事件流，UI 能继续出草案。
    expect(events[0]).toEqual({ type: 'stage', stage: 'collect' })
    expect(events.at(-1)).toEqual({ type: 'done' })
    expect(events.some((event) => event.type === 'delta')).toBe(true)
    expect(client.status()).toEqual({
      source: 'mock',
      fallback: true,
      reason: '模型服务暂时不可用，请稍后重试。',
    })
    expect(client.label).toBe(MOCK_CHAT_LABEL)
  })

  it('已经输出内容后再失败不自动回退，避免出现两套答案', async () => {
    const { fetchImpl } = stubFetch((url) => {
      if (url === '/api/health') {
        return jsonResponse({ status: 'ok', service: 'persist-server', ai: 'deepseek' })
      }
      return streamResponse([
        sseText([
          '{"type":"stage","stage":"collect"}',
          '{"type":"delta","text":"真实开头"}',
          '{"type":"error","code":"ai_failed","message":"模型服务返回 500。"}',
        ]),
      ])
    })
    const client = createAppChatClient({
      consent: true,
      fetchImpl,
      mockOptions: { chunkDelayMs: 0 },
    })

    await expect(collect(client)).rejects.toThrow('模型服务返回 500。')
    expect(client.status()).toEqual({
      source: 'unknown',
      fallback: false,
      reason: '模型服务返回 500。',
    })
  })

  it('模型请求被中断时不回退，也不把中断当失败展示', async () => {
    const abortError = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError',
    })
    const { fetchImpl } = stubFetch((url) => {
      if (url === '/api/health') {
        return jsonResponse({ status: 'ok', service: 'persist-server', ai: 'deepseek' })
      }
      throw abortError
    })
    const client = createAppChatClient({
      consent: true,
      fetchImpl,
      mockOptions: { chunkDelayMs: 0 },
    })

    await expect(collect(client)).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.status().fallback).toBe(false)
  })
})
