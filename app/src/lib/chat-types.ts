import type { LongTermPlanTargetDraft } from './long-term-plan'
import type { PlanCadence, PlanModule, ProfileData, WeeklyTargetUnit } from '../types'

/**
 * 对话层契约。
 *
 * 现在只有本地 Mock 实现（mock-chat-client.ts，纯规则匹配，不联网）。
 * 未来接真实服务端时，只要让服务端按同样的 ChatEvent 流式返回，
 * UI 与档案写入逻辑都不需要改 —— 这是本轮唯一为后续阶段预留的接口。
 */

export type ChatRole = 'user' | 'assistant'

export type ChatStage = 'collect' | 'propose' | 'applied'

export type ChatMessageKind = 'text' | 'question' | 'proposal' | 'notice'

export interface ChatQuestion {
  id: string
  field: ProfileFieldKey | 'plan'
  prompt: string
  hint?: string
  options?: string[]
}

export type ProfileFieldKey = Exclude<keyof ProfileData, 'aiConsent'>

export interface ChatPlanProposal {
  title: string
  goal: string
  cadence: PlanCadence
  /** 建议开始日期（YYYY-MM-DD）；缺省时按草案创建当天开始 */
  startDate?: string
  /** 建议结束日期（YYYY-MM-DD）；缺省时按最后一个里程碑收尾 */
  endDate?: string
  weeklyTargets: LongTermPlanTargetDraft[]
  milestones: { date: string; label: string; metric?: string }[]
  profilePatch: Partial<ProfileData>
  assumptions: string[]
  warnings: string[]
  highlights: string[]
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  kind?: ChatMessageKind
  questions?: ChatQuestion[]
  proposal?: ChatPlanProposal
  warnings?: string[]
  /** 流式输出中：UI 显示光标并禁止再次提交 */
  streaming?: boolean
}

export type ChatEvent =
  | { type: 'stage'; stage: ChatStage }
  | { type: 'delta'; text: string }
  | { type: 'questions'; questions: ChatQuestion[] }
  /**
   * 本轮对话识别出的档案补丁。它只是「待确认」的候选值：
   * UI 必须累积它、等用户确认后才写回档案，任何实现都不得直接落库。
   */
  | { type: 'profilePatch'; patch: Partial<ProfileData> }
  | { type: 'proposal'; proposal: ChatPlanProposal }
  | { type: 'warnings'; warnings: string[] }
  | { type: 'done' }

export interface ChatTurn {
  role: ChatRole
  content: string
}

export interface ChatRequest {
  turns: ChatTurn[]
  profile: ProfileData
  /** 已经问过的字段，用于避免重复追问（Mock 引擎用，真实服务端可忽略） */
  askedFields?: string[]
}

export interface ChatClient {
  send(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent>
  /** 如实标注实现来源，避免把 Mock 说成真实模型 */
  label: string
}

export type WeeklyTargetDraftWithUnit = LongTermPlanTargetDraft & {
  unit: WeeklyTargetUnit
  module?: PlanModule
}
