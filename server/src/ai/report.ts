/**
 * 报告结果的净化。
 *
 * 模型只负责「文字」：标题、状态、摘要、结论、建议动作。
 * 数字、指标与引用依据由前端按本地记录确定性生成，服务端不接受模型改这些字段
 * （prompt 里已经约束，这里再按契约白名单逐字段校验，未知字段直接丢弃）。
 *
 * 任何一项不达标都整份作废：宁可让前端显示「这次生成没有完成」，
 * 也不把结构残缺的报告伪装成成功。
 */

import type { ReportContent } from '../contract.js'

const LIMITS = {
  title: { min: 2, max: 30 },
  status: { min: 2, max: 10 },
  summary: { min: 20, max: 400 },
  conclusions: { min: 2, max: 4, length: { min: 4, max: 80 } },
  actions: { min: 2, max: 4, length: { min: 4, max: 80 } },
  warnings: { min: 0, max: 4, length: { min: 4, max: 80 } },
} as const

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** 折叠空白、去掉控制字符；空串、超长、含 Markdown 代码块一律视为无效。 */
function asText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length < min || text.length > max) return null
  if (text.includes('```')) return null
  return text
}

function asTextList(
  value: unknown,
  rule: { min: number; max: number; length: { min: number; max: number } },
): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length < rule.min || value.length > rule.max) return null
  const items: string[] = []
  for (const item of value) {
    const text = asText(item, rule.length.min, rule.length.max)
    if (!text) return null
    // 结论/建议重复没有意义，直接判为无效而不是去重后凑数。
    if (items.includes(text)) return null
    items.push(text)
  }
  return items
}

export type SanitizedReport = { ok: true; value: ReportContent } | { ok: false; reason: string }

export function sanitizeReportContent(raw: unknown): SanitizedReport {
  const record = asRecord(raw)
  if (!record) return { ok: false, reason: '模型没有返回 JSON 对象。' }

  const title = asText(record.title, LIMITS.title.min, LIMITS.title.max)
  if (!title) return { ok: false, reason: 'title 缺失或长度不合规。' }

  const status = asText(record.status, LIMITS.status.min, LIMITS.status.max)
  if (!status) return { ok: false, reason: 'status 缺失或长度不合规。' }

  const summary = asText(record.summary, LIMITS.summary.min, LIMITS.summary.max)
  if (!summary) return { ok: false, reason: 'summary 缺失或长度不合规。' }

  const conclusions = asTextList(record.conclusions, LIMITS.conclusions)
  if (!conclusions) return { ok: false, reason: 'conclusions 必须是 2–4 条合规短句。' }

  const actions = asTextList(record.actions, LIMITS.actions)
  if (!actions) return { ok: false, reason: 'actions 必须是 2–4 条合规短句。' }

  const warnings = record.warnings === undefined ? [] : asTextList(record.warnings, LIMITS.warnings)
  if (!warnings) return { ok: false, reason: 'warnings 必须最多 4 条合规短句。' }

  return { ok: true, value: { title, status, summary, conclusions, actions, warnings } }
}
