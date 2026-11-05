/**
 * 综合分析结果的净化与数字校验（步骤 13）。
 *
 * 模型只写文字，但「只写文字」不等于「可以随便写数字」：事实包是唯一数据源，
 * 正文里出现事实包里没有的数（自行求和、平均、百分比）就必须整份作废——
 * 否则报告看起来专业、实际是编的，比没有报告更糟。
 *
 * 净化策略与 8c 简报一致：结构/太短直接判非法，超长截断（不让一句话超限毁掉整份报告）。
 */

import type { ReportContentV2, ReportFactsV2 } from '@persist/shared/contract/analysis'
import { ANALYSIS_CONTENT_LIMITS } from '@persist/shared/contract/analysis'
import type { AiClient } from './deepseek.js'
import { buildAnalysisMessages } from './prompts.js'

export class AnalysisContentError extends Error {
  readonly reasons: string[]

  constructor(reasons: string[]) {
    super(`模型返回的分析内容不符合契约：${reasons.join('；')}`)
    this.name = 'AnalysisContentError'
    this.reasons = reasons
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** 折叠空白、去控制字符；含代码块一律非法。`max` 之后截断而不是判死。 */
function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length === 0 || text.includes('```')) return null
  return text
}

function clampText(value: unknown, min: number, max: number): string | null {
  const text = normalizeText(value)
  if (!text || text.length < min) return null
  return text.length > max ? text.slice(0, max).trim() : text
}

function clampList(
  value: unknown,
  rule: { min: number; max: number; itemMin: number; itemMax: number },
): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length < rule.min) return null
  const items: string[] = []
  for (const raw of value.slice(0, rule.max)) {
    const text = clampText(raw, rule.itemMin, rule.itemMax)
    if (!text) return null
    if (items.includes(text)) return null
    items.push(text)
  }
  return items
}

export function sanitizeAnalysisContent(raw: unknown): ReportContentV2 {
  const record = asRecord(raw)
  if (!record) throw new AnalysisContentError(['模型没有返回 JSON 对象。'])

  const limits = ANALYSIS_CONTENT_LIMITS
  const title = clampText(record.title, limits.title.min, limits.title.max)
  if (!title) throw new AnalysisContentError(['title 缺失、过短或含代码块。'])

  const status = clampText(record.status, limits.status.min, limits.status.max)
  if (!status) throw new AnalysisContentError(['status 缺失、过短或含代码块。'])

  const summary = clampText(record.summary, limits.summary.min, limits.summary.max)
  if (!summary) throw new AnalysisContentError(['summary 缺失或少于 40 字。'])

  if (!Array.isArray(record.analysis)) {
    throw new AnalysisContentError(['analysis 必须是数组。'])
  }
  if (
    record.analysis.length < limits.analysis.min ||
    record.analysis.length > limits.analysis.max
  ) {
    throw new AnalysisContentError([
      `analysis 必须是 ${limits.analysis.min}–${limits.analysis.max} 段。`,
    ])
  }
  const analysis: string[] = []
  for (const paragraph of record.analysis) {
    const text = clampText(paragraph, limits.analysis.minLength, limits.analysis.maxLength)
    if (!text) throw new AnalysisContentError(['analysis 某一段少于 40 字或含代码块。'])
    if (analysis.includes(text)) throw new AnalysisContentError(['analysis 有重复段落。'])
    analysis.push(text)
  }

  const conclusions = clampList(record.conclusions, limits.conclusions)
  if (!conclusions) throw new AnalysisContentError(['conclusions 必须是 2–4 条合规短句。'])

  const actions = clampList(record.actions, limits.actions)
  if (!actions) throw new AnalysisContentError(['actions 必须是 2–4 条合规短句。'])

  const warnings =
    record.warnings === undefined ? [] : clampList(record.warnings, { min: 0, ...limits.warnings })
  if (!warnings) throw new AnalysisContentError(['warnings 必须最多 4 条合规短句。'])

  return { title, status, summary, analysis, conclusions, actions, warnings }
}

const NUMBER_TOKEN = /\d+(?:\.\d+)?/g

function collectFactNumbers(facts: ReportFactsV2): Set<number> {
  const allowed = new Set<number>()
  const captured = JSON.stringify(facts).match(NUMBER_TOKEN)
  if (captured) {
    for (const token of captured) {
      const value = Number(token)
      if (Number.isFinite(value)) allowed.add(value)
    }
  }
  return allowed
}

function contentTexts(content: ReportContentV2): string[] {
  return [
    content.title,
    content.status,
    content.summary,
    ...content.analysis,
    ...content.conclusions,
    ...content.actions,
    ...content.warnings,
  ]
}

/**
 * 数字白名单校验：返回正文里出现、但事实包里找不到的数字（去重）。
 * 只要非空就判为「编造数字」，不给部分通过的机会。
 */
export function findUnsourcedNumbers(content: ReportContentV2, facts: ReportFactsV2): string[] {
  const allowed = collectFactNumbers(facts)
  const unsourced = new Set<string>()
  for (const text of contentTexts(content)) {
    const tokens = text.match(NUMBER_TOKEN)
    if (!tokens) continue
    for (const token of tokens) {
      const value = Number(token)
      if (!Number.isFinite(value) || !allowed.has(value)) unsourced.add(token)
    }
  }
  return [...unsourced]
}

export function assertNumbersSourced(content: ReportContentV2, facts: ReportFactsV2): void {
  const unsourced = findUnsourcedNumbers(content, facts)
  if (unsourced.length > 0) {
    throw new AnalysisContentError([
      `正文出现事实包里没有的数字（${unsourced.slice(0, 6).join('、')}），按编造处理。`,
    ])
  }
}

export interface GenerateAnalysisOptions {
  model: string
  /** 综合分析正文更长，默认给 2_600 tokens；可用配置覆盖。 */
  maxTokens?: number
  timeoutMs?: number
  signal?: AbortSignal
  /** 重试时带上的纠正说明：上一次为什么被判不合规。 */
  retryNote?: string
}

/**
 * 调模型 → 净化 → 数字校验。任何一步不合规都抛错，由调用方决定降级还是 502：
 * - AiError timeout/upstream：降级规则模板（数据没坏，只是模型不可用）；
 * - AiError invalid_response / AnalysisContentError：按契约违规返回 502，不拿半份报告凑数。
 */
export async function generateAnalysisContent(
  ai: AiClient,
  facts: ReportFactsV2,
  options: GenerateAnalysisOptions,
): Promise<ReportContentV2> {
  const raw = await ai.completeJson(buildAnalysisMessages(facts, options.retryNote), {
    maxTokens: options.maxTokens ?? 2_600,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  const content = sanitizeAnalysisContent(raw)
  assertNumbersSourced(content, facts)
  return content
}
