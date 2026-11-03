import { analyzeChat, type ChatAnalysis } from './chat-extract'
import type { ChatClient, ChatEvent, ChatRequest } from './chat-types'

/**
 * 本地 Mock 对话实现。
 *
 * 明确说明：这里没有任何模型调用，全部是 chat-extract.ts 的规则匹配结果，
 * 再按 DeepSeek 风格逐块吐出。接入真实服务端时替换本文件即可，UI 不用改。
 */

export const MOCK_CHAT_LABEL = '本地 Mock 对话（规则匹配，未接入真实模型）'

function splitChunks(text: string): string[] {
  const chunks = text.match(/[^。！？\n]+[。！？\n]?/g) ?? [text]
  return chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .flatMap((chunk) => {
      if (chunk.length <= 18) return [chunk]
      const parts: string[] = []
      for (let index = 0; index < chunk.length; index += 14) {
        parts.push(chunk.slice(index, index + 14))
      }
      return parts
    })
}

export interface MockChatOptions {
  chunkDelayMs?: number
}

export function createMockChatClient(options: MockChatOptions = {}): ChatClient {
  const delay = options.chunkDelayMs ?? 18
  return {
    label: MOCK_CHAT_LABEL,
    async *send(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
      if (signal?.aborted) return

      const analysis: ChatAnalysis = analyzeChat({
        turns: request.turns,
        profile: request.profile,
        askedFields: request.askedFields,
      })

      // 事件顺序是契约的一部分（真实服务端也必须一致）：
      // stage(collect) → delta* → questions? → profilePatch? → stage(propose) → proposal? → warnings? → done
      yield { type: 'stage', stage: 'collect' }

      for (const chunk of splitChunks(analysis.reply)) {
        if (signal?.aborted) return
        if (delay > 0) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, delay)
          })
        }
        yield { type: 'delta', text: chunk }
      }
      if (signal?.aborted) return

      if (analysis.questions.length > 0) {
        yield { type: 'questions', questions: analysis.questions }
      }
      // 档案补丁只是「待确认」的候选值，UI 必须累积到用户点确认后才写回。
      if (Object.keys(analysis.patch).length > 0) {
        yield { type: 'profilePatch', patch: analysis.patch }
      }
      if (analysis.proposal) {
        yield { type: 'stage', stage: 'propose' }
        yield { type: 'proposal', proposal: analysis.proposal }
      }
      if (analysis.warnings.length > 0) {
        yield { type: 'warnings', warnings: analysis.warnings }
      }
      if (signal?.aborted) return
      yield { type: 'done' }
    },
  }
}
