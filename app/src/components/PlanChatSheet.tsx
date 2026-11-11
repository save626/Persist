import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from './Icon'
import { PageSheet } from './PageSheet'
import { useRuntimeMode } from '../context/runtime-mode-context'
import { PREBUILT_DEMO_PLAN_CHAT } from '../data/prebuilt-demo-ai'
import type {
  ChatMessage,
  ChatPlanProposal,
  ChatQuestion,
  ChatTurn,
  ProfileFieldKey,
} from '../lib/chat-types'
import { AI_CHAT_LABEL, createAppChatClient } from '../lib/ai-chat-client'
import { cadenceLabel } from '../lib/long-term-plan'
import { MOCK_CHAT_LABEL } from '../lib/mock-chat-client'
import { mergeProfilePatch, profilePatchEntries } from '../lib/plan-draft'
import type { ProfileData } from '../types'

/**
 * AI 建档对话面板。
 *
 * 只负责「对话 + 收集待确认信息」：流式输出的档案补丁只在本地累积，
 * 真正的写入发生在用户点「去确认草案」之后的确认页，这里绝不落库。
 *
 * 来源标注是硬要求：
 * - 开启 AI 数据处理授权且服务端健康时，走 `/api/chat` 的真实模型，标题标 DeepSeek；
 * - 未授权 / 服务不可用 / 首块内容前失败时回退本地 Mock，标题标 Mock 并说明原因。
 */

const PROBING_LABEL = '正在检测模型服务…'

const INTRO_ID = 'assistant-intro'

const MOCK_INTRO =
  '我是本地 Mock 建档助手：只会按规则整理你说过的信息，不联网、也不调用真实模型。说说你的目标、每周能安排几次、有什么器械或时间限制，我先整理一版草案；档案和计划都要你确认后才会写入。'

const AI_INTRO =
  '我是 AI 建档助手：你的对话和档案摘要会经本站服务端发送给 DeepSeek 模型，用来整理建档草案；不会自动改档案，你确认后才会写入。说说你的目标、每周能安排几次、有什么器械或时间限制。'

const FALLBACK_NOTE = '真实模型暂时不可用，本次已回退到本地 Mock（规则匹配）。'

// 消息 id 用本地自增序号生成，避免在渲染期间调用 Date.now()。
let messageSeq = 0
function nextMessageId(role: ChatMessage['role']) {
  messageSeq += 1
  return `${role}-${messageSeq}`
}

const INTRO_MESSAGE: ChatMessage = {
  id: INTRO_ID,
  role: 'assistant',
  content: MOCK_INTRO,
  createdAt: 0,
}

const STARTERS = [
  '我想减脂，每周能练 4 次，家里有哑铃',
  '我在备考，每周能学 5 次，每次 90 分钟',
  '先帮我出一版计划看看',
]

export interface PlanChatReviewPayload {
  proposal: ChatPlanProposal
  patch: Partial<ProfileData>
}

interface PlanChatSheetProps {
  profile: ProfileData
  onClose: () => void
  onReview: (payload: PlanChatReviewPayload) => void
}

function turnsOf(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content }))
}

function PrebuiltPlanChatSheet({ onClose }: { onClose: () => void }) {
  const proposal = PREBUILT_DEMO_PLAN_CHAT.proposal
  return (
    <PageSheet
      title="AI 建档对话"
      subtitle="部署前真实生成 · 当前只读"
      onClose={onClose}
      className="plan-chat-sheet"
    >
      <div className="plan-chat">
        <div className="plan-chat-scroll" aria-label="预生成对话记录">
          <div className="plan-chat-message assistant">
            <div className="plan-chat-bubble">
              这段建档对话和长期计划在部署前通过 DeepSeek 生成并固化；演示模式只读，不会再次调用
              AI。
            </div>
          </div>
          <div className="plan-chat-message user">
            <div className="plan-chat-bubble">{PREBUILT_DEMO_PLAN_CHAT.userText}</div>
          </div>
          <div className="plan-chat-message assistant">
            <div className="plan-chat-bubble">{PREBUILT_DEMO_PLAN_CHAT.assistantText}</div>
          </div>
          <div className="plan-chat-proposal">
            <span className="plan-chat-proposal-kicker">预生成计划草案</span>
            <h3>{proposal.title}</h3>
            <p className="plan-chat-proposal-goal">{proposal.goal}</p>
            <ul className="plan-chat-targets">
              {proposal.weeklyTargets.map((target) => (
                <li key={`${target.label}-${target.perWeek}`}>
                  <span>{target.label}</span>
                  <strong>
                    {target.perWeek} {target.unit} / 周
                  </strong>
                </li>
              ))}
            </ul>
            {PREBUILT_DEMO_PLAN_CHAT.warnings.length > 0 && (
              <p className="plan-chat-warn">
                需要注意：{PREBUILT_DEMO_PLAN_CHAT.warnings.join('；')}
              </p>
            )}
          </div>
        </div>
        <div className="surface-form-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </PageSheet>
  )
}

export function PlanChatSheet({ profile, onClose, onReview }: PlanChatSheetProps) {
  const runtime = useRuntimeMode()
  const realChatAllowed = runtime.ai.chat
  const chatClient = useMemo(
    () => createAppChatClient({ consent: profile.aiConsent, allowRealAi: realChatAllowed }),
    [profile.aiConsent, realChatAllowed],
  )
  const [messages, setMessages] = useState<ChatMessage[]>([INTRO_MESSAGE])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subtitle, setSubtitle] = useState(
    profile.aiConsent && realChatAllowed ? PROBING_LABEL : MOCK_CHAT_LABEL,
  )
  const [fallbackNote, setFallbackNote] = useState<string | null>(null)
  const [questions, setQuestions] = useState<ChatQuestion[]>([])
  const [patch, setPatch] = useState<Partial<ProfileData>>({})
  const [proposal, setProposal] = useState<ChatPlanProposal | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const askedRef = useRef<string[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!profile.aiConsent || !realChatAllowed) return
    let active = true
    void chatClient.probe().then((source) => {
      if (!active) return
      setSubtitle(source === 'ai' ? AI_CHAT_LABEL : MOCK_CHAT_LABEL)
      setMessages((prev) =>
        prev.length === 1 && prev[0]?.id === INTRO_ID
          ? [{ ...INTRO_MESSAGE, content: source === 'ai' ? AI_INTRO : MOCK_INTRO }]
          : prev,
      )
    })
    return () => {
      active = false
    }
  }, [chatClient, profile.aiConsent, realChatAllowed])

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, questions, proposal])

  const stream = async (turns: ChatTurn[], assistantId: string) => {
    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)
    setError(null)
    setFallbackNote(null)
    try {
      for await (const event of chatClient.send(
        { turns, profile, askedFields: askedRef.current },
        controller.signal,
      )) {
        if (controller.signal.aborted) break
        if (event.type === 'delta') {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + event.text }
                : message,
            ),
          )
        } else if (event.type === 'questions') {
          setQuestions(event.questions)
        } else if (event.type === 'profilePatch') {
          setPatch((prev) => mergeProfilePatch(prev, event.patch))
        } else if (event.type === 'proposal') {
          setProposal(event.proposal)
        } else if (event.type === 'warnings') {
          setWarnings(event.warnings)
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        setError('对话中断了，可以点「重试」再试一次。')
      }
    } finally {
      const status = chatClient.status()
      if (status.source === 'ai') setSubtitle(AI_CHAT_LABEL)
      else if (status.source === 'mock') setSubtitle(MOCK_CHAT_LABEL)
      if (status.fallback) setFallbackNote(status.reason ?? FALLBACK_NOTE)
      setStreaming(false)
      abortRef.current = null
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId ? { ...message, streaming: false } : message,
        ),
      )
    }
  }

  const send = (text: string) => {
    const value = text.trim()
    if (!value || streaming) return
    const turns = [...turnsOf(messages), { role: 'user' as const, content: value }]
    const userId = nextMessageId('user')
    const assistantId = nextMessageId('assistant')
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: value, createdAt: 0 },
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: 0,
        streaming: true,
      },
    ])
    setInput('')
    setQuestions([])
    void stream(turns, assistantId)
  }

  const retry = () => {
    if (streaming) return
    const usable = messages.filter((message) => message.content.trim().length > 0)
    if (usable.length === 0) return
    const assistantId = nextMessageId('assistant')
    setMessages([
      ...usable,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: 0,
        streaming: true,
      },
    ])
    setQuestions([])
    void stream(turnsOf(usable), assistantId)
  }

  const answer = (question: ChatQuestion, option: string) => {
    if (question.field !== 'plan') {
      const field: ProfileFieldKey = question.field
      if (!askedRef.current.includes(field)) askedRef.current = [...askedRef.current, field]
    }
    send(option)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    send(input)
  }

  const patchEntries = profilePatchEntries(patch, profile)
  const hasUserMessage = messages.some((message) => message.role === 'user')

  if (runtime.mode === 'demo') return <PrebuiltPlanChatSheet onClose={onClose} />

  return (
    <PageSheet title="AI 建档对话" subtitle={subtitle} onClose={onClose}>
      <div className="plan-chat">
        <div className="plan-chat-scroll" ref={scrollRef} aria-label="对话记录">
          {messages.map((message) => (
            <div key={message.id} className={`plan-chat-message ${message.role}`}>
              <div className="plan-chat-bubble">
                {message.content || (message.streaming ? '' : '…')}
                {message.streaming && <span className="plan-chat-cursor" aria-hidden="true" />}
              </div>
            </div>
          ))}

          {questions.length > 0 && !streaming && (
            <div className="plan-chat-questions">
              {questions.map((question) => (
                <div key={question.id} className="plan-chat-question">
                  <p>{question.prompt}</p>
                  {question.hint && <span className="plan-chat-hint">{question.hint}</span>}
                  {question.options && question.options.length > 0 && (
                    <div className="plan-chat-options">
                      {question.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className="plan-chip"
                          onClick={() => answer(question, option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {proposal && !streaming && (
            <div className="plan-chat-proposal">
              <span className="plans-kicker">草案 · {cadenceLabel(proposal.cadence)}</span>
              <h3>{proposal.title}</h3>
              <p className="plan-chat-proposal-goal">{proposal.goal}</p>
              <ul className="plan-chat-targets">
                {proposal.weeklyTargets.map((target, index) => (
                  <li key={`${target.label}-${index}`}>
                    <span>{target.label}</span>
                    <span>
                      {target.perWeek} {target.unit}/周
                    </span>
                  </li>
                ))}
              </ul>
              {proposal.assumptions.length > 0 && (
                <p className="plan-chat-note">假设：{proposal.assumptions.join('；')}</p>
              )}
              {warnings.length > 0 && (
                <p className="plan-chat-warn">需要注意：{warnings.join('；')}</p>
              )}
              <button
                className="btn primary"
                type="button"
                onClick={() => onReview({ proposal, patch })}
              >
                <Icon name="check" className="icon-sm" />
                去确认草案
              </button>
            </div>
          )}

          {patchEntries.length > 0 && !streaming && (
            <div className="plan-chat-patch">
              <span className="plans-kicker">确认后写入档案的改动</span>
              <ul>
                {patchEntries.map((entry) => (
                  <li key={entry.field}>
                    <span>{entry.label}</span>
                    <span>
                      {entry.previous} → {entry.next}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {!hasUserMessage && (
          <div className="plan-chat-starters">
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                className="plan-chip"
                onClick={() => send(starter)}
                disabled={streaming}
              >
                {starter}
              </button>
            ))}
          </div>
        )}

        <div className="plan-chat-composer">
          <textarea
            className="plan-chat-input"
            aria-label="对话输入"
            placeholder="说说你的目标、时间和训练条件…"
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
          />
          {streaming ? (
            <button
              className="btn secondary"
              type="button"
              onClick={() => abortRef.current?.abort()}
            >
              停止
            </button>
          ) : (
            <button
              className="btn primary"
              type="button"
              onClick={() => send(input)}
              disabled={!input.trim()}
            >
              发送
            </button>
          )}
        </div>

        {fallbackNote && (
          <p className="plan-chat-note" role="status">
            {fallbackNote}
          </p>
        )}

        {error && (
          <div className="plan-chat-error" role="alert">
            <span>{error}</span>
            <button className="link" type="button" onClick={retry}>
              重试
            </button>
          </div>
        )}

        <p className="plan-chat-note">
          对话不会自动改档案或计划：只有你在草案页点「确认并启用」后才会写入。
        </p>
      </div>
    </PageSheet>
  )
}
