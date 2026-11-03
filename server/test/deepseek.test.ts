import { describe, expect, it } from 'vitest'
import { AiError, createDeepSeekClient, type FetchLike } from '../src/ai/deepseek.js'

function makeConfig(overrides: Partial<Parameters<typeof createDeepSeekClient>[0]> = {}) {
  return {
    deepseekApiKey: 'sk-test',
    deepseekBaseUrl: 'https://api.example.com',
    deepseekModel: 'deepseek-chat',
    aiTimeoutMs: 2_000,
    aiMaxRetries: 1,
    ...overrides,
  }
}

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } })
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function deltaChunk(text: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
}

describe('createDeepSeekClient', () => {
  it('streamChat 逐块解析 SSE 并忽略 [DONE]', async () => {
    const fetchImpl: FetchLike = async () =>
      sseResponse([deltaChunk('你好'), deltaChunk('，'), 'data: [DONE]\n\n'])
    const client = createDeepSeekClient(makeConfig(), fetchImpl)
    const chunks: string[] = []
    for await (const text of client.streamChat([{ role: 'user', content: 'hi' }])) {
      chunks.push(text)
    }
    expect(chunks).toEqual(['你好', '，'])
  })

  it('streamChat 在已输出内容后失败时不再重试（避免重复文本）', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls += 1
      let reads = 0
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            reads += 1
            if (reads === 1) {
              controller.enqueue(new TextEncoder().encode(deltaChunk('开头')))
              return
            }
            controller.error(new Error('network broke'))
          },
        }),
        { status: 200 },
      )
    }
    const client = createDeepSeekClient(makeConfig({ aiMaxRetries: 2 }), fetchImpl)
    const iterator = client.streamChat([{ role: 'user', content: 'hi' }])
    await expect(iterator.next()).resolves.toMatchObject({ value: '开头' })
    await expect(iterator.next()).rejects.toBeInstanceOf(AiError)
    expect(calls).toBe(1)
  })

  it('completeJson 解析带代码块围栏的 JSON', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ choices: [{ message: { content: '```json\n{"proposal": null}\n```' } }] })
    const client = createDeepSeekClient(makeConfig(), fetchImpl)
    await expect(client.completeJson([{ role: 'user', content: 'x' }])).resolves.toEqual({
      proposal: null,
    })
  })

  it('对 429 重试后成功', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls += 1
      if (calls === 1) return new Response('busy', { status: 429 })
      return jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] })
    }
    const client = createDeepSeekClient(makeConfig(), fetchImpl)
    await expect(client.completeJson([{ role: 'user', content: 'x' }])).resolves.toEqual({
      ok: true,
    })
    expect(calls).toBe(2)
  })

  it('4xx 业务错误不重试并带上状态码', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls += 1
      return new Response('unauthorized', { status: 401 })
    }
    const client = createDeepSeekClient(makeConfig({ aiMaxRetries: 3 }), fetchImpl)
    const error = await client
      .completeJson([{ role: 'user', content: 'x' }])
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AiError)
    expect(error).toMatchObject({ code: 'upstream', status: 401 })
    expect(calls).toBe(1)
  })

  it('超时映射为 timeout 错误且不重试', async () => {
    let calls = 0
    const fetchImpl: FetchLike = (_input, init) => {
      calls += 1
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    }
    const client = createDeepSeekClient(makeConfig({ aiTimeoutMs: 30, aiMaxRetries: 3 }), fetchImpl)
    const error = await client
      .completeJson([{ role: 'user', content: 'x' }])
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'timeout' })
    expect(calls).toBe(1)
  })

  it('未配置密钥时立刻失败，不发起请求', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls += 1
      return jsonResponse({})
    }
    const client = createDeepSeekClient(makeConfig({ deepseekApiKey: null }), fetchImpl)
    await expect(client.completeJson([{ role: 'user', content: 'x' }])).rejects.toMatchObject({
      status: 503,
    })
    expect(calls).toBe(0)
  })
})
