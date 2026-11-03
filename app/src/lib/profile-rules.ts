import type { ProfileData } from '../types'
import type { ProfileFieldKey } from './chat-types'

/**
 * 档案字段的唯一事实来源（single source of truth）。
 *
 * 三处共用同一套规则，避免再次出现「档案页允许 14–100 岁、AI 规则抽取却接受 1–13 岁」这种分叉：
 * 1. pages/ProfilePage.tsx 的表单校验；
 * 2. lib/chat-extract.ts 的规则抽取结果；
 * 3. AI 写回档案前的过滤（sanitizeProfilePatch）。
 *
 * 原则：越界字段一律丢弃并提示，不抛错、不中断对话，也不把非法数字静默改成边界值。
 */

export interface ProfileNumberRule {
  min: number
  max: number
  /** 越界提示，档案页与对话写回共用同一句话 */
  message: string
}

export const PROFILE_NUMBER_RULES = {
  age: { min: 14, max: 100, message: '年龄需要在 14–100 岁之间。' },
  height: { min: 120, max: 230, message: '身高需要在 120–230 cm 之间。' },
  weight: { min: 35, max: 250, message: '体重需要在 35–250 kg 之间。' },
  targetWeight: { min: 35, max: 250, message: '目标体重需要在 35–250 kg 之间。' },
  sleepHours: { min: 3, max: 14, message: '平均睡眠需要在 3–14 小时之间。' },
} as const satisfies Record<string, ProfileNumberRule>

export type ProfileNumberField = keyof typeof PROFILE_NUMBER_RULES

const NUMBER_FIELDS = Object.keys(PROFILE_NUMBER_RULES) as ProfileNumberField[]

/** 自由文本字段：去空格后不能为空，并且限制长度，防止对话里塞进超长文本。 */
export const PROFILE_TEXT_FIELDS = [
  'goal',
  'experience',
  'frequency',
  'equipment',
  'dietPreference',
  'allergies',
  'bedtime',
  'stress',
] as const satisfies readonly ProfileFieldKey[]

export const MAX_PROFILE_TEXT_LENGTH = 120

export function isProfileNumberInRange(field: ProfileNumberField, value: number) {
  const rule = PROFILE_NUMBER_RULES[field]
  return Number.isFinite(value) && value >= rule.min && value <= rule.max
}

export interface SanitizedProfilePatch {
  patch: Partial<ProfileData>
  /** 被丢弃的字段名，UI 用来提示「有 N 项没有写入」 */
  dropped: ProfileFieldKey[]
}

/**
 * 过滤一份「想写进档案」的补丁。它只做过滤，不抛错：
 * - 数字字段越界或不是有限数 ⇒ 丢弃并记入 dropped；
 * - 文本字段去首尾空格，空串视为「没提供」直接忽略（不计入 dropped）；
 * - 超长文本丢弃并记入 dropped；
 * - aiConsent 永远不允许通过补丁写入，授权只能由用户在设置页亲自点。
 */
export function sanitizeProfilePatch(input: Partial<ProfileData>): SanitizedProfilePatch {
  const patch: Partial<ProfileData> = {}
  const dropped: ProfileFieldKey[] = []
  const source = input as Record<string, unknown>

  for (const field of NUMBER_FIELDS) {
    if (!(field in source)) continue
    const value = source[field]
    if (typeof value === 'number' && isProfileNumberInRange(field, value)) {
      patch[field] = value
      continue
    }
    dropped.push(field)
  }

  for (const field of PROFILE_TEXT_FIELDS) {
    if (!(field in source)) continue
    const value = source[field]
    if (typeof value !== 'string') {
      dropped.push(field)
      continue
    }
    const text = value.trim()
    if (!text) continue
    if (text.length > MAX_PROFILE_TEXT_LENGTH) {
      dropped.push(field)
      continue
    }
    patch[field] = text
  }

  return { patch, dropped }
}
