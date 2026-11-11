import {
  ReportContractError,
  ReportUnavailableError,
  parseReportContent,
  requestAiReport,
  type FetchLike,
} from './ai-report-client'
import { digestFingerprint, digestSourceLabels, hasDigestSources } from './report-digest'
import type { ReportContent, ReportDigest, ReportRequest } from './report-types'

/**
 * 今日页「晨间简报」的真实模型接入。
 *
 * 与报告页的差异：
 * - 晨间简报在打开面板时才发起请求，拿到文字后立刻展示；
 * - 同一会话内、且摘要内容没变化时复用缓存，避免重复打开重复花钱；
 * - 数字、引用范围始终由本机确定性计算，模型只写文字结论（与服务端契约一致）。
 *
 * 诚实性约束：
 * - 没授权、没有可引用来源、服务不可用、结构不合契约时，一律回退到本机规则，
 *   并在面板底部如实写明原因，绝不把规则文案标成 AI 生成。
 */

export const MORNING_BRIEF_TYPE = '今日简报' as const
export const MORNING_BRIEF_RANGE_DAYS = 7 as const
export const MORNING_BRIEF_CACHE_PREFIX = 'persist.morning-brief.'

export type MorningBriefStatus =
  'ai' | 'prebuilt' | 'experience-mock' | 'no-consent' | 'no-data' | 'unavailable' | 'contract'

export interface MorningBriefResult {
  status: MorningBriefStatus
  /** 只有 `status === 'ai'` 时才有值；其他状态一律保持 null，页面因此不会误用模型输出。 */
  content: ReportContent | null
}

export function morningBriefCacheKey(date: string): string {
  return `${MORNING_BRIEF_CACHE_PREFIX}${date}`
}

export function safeSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

interface CachedBrief {
  digestKey: string
  content: ReportContent
}

/**
 * 读取同会话缓存。
 * 缓存指纹覆盖实际发送给模型的数据：用户中途补了记录，旧文案必须失效而不是继续展示。
 */
export function readCachedMorningBrief(
  storage: Storage | null,
  date: string,
  digest: ReportDigest,
): ReportContent | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(morningBriefCacheKey(date))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const cached = parsed as Partial<CachedBrief>
    if (cached.digestKey !== digestFingerprint(digest)) return null
    return parseReportContent(cached.content)
  } catch {
    return null
  }
}

export function writeCachedMorningBrief(
  storage: Storage | null,
  date: string,
  digest: ReportDigest,
  content: ReportContent,
): void {
  if (!storage) return
  try {
    const payload: CachedBrief = { digestKey: digestFingerprint(digest), content }
    storage.setItem(morningBriefCacheKey(date), JSON.stringify(payload))
  } catch {
    // 隐私模式或配额不足：缓存失败不影响本次展示，下次打开会重新请求。
  }
}

export function buildMorningBriefRequest(digest: ReportDigest): ReportRequest {
  return { type: MORNING_BRIEF_TYPE, rangeDays: MORNING_BRIEF_RANGE_DAYS, digest }
}

export function morningBriefNote(status: MorningBriefStatus, digest: ReportDigest): string {
  const labels = digestSourceLabels(digest).join('、')

  switch (status) {
    case 'ai':
      return `文字由 DeepSeek 生成 · 经本站服务端代理；数字与引用依据来自本机记录${
        labels ? `（${labels}）` : ''
      }。`
    case 'prebuilt':
      return '这份简报在部署前通过 DeepSeek 生成并固化；演示模式只读，不会再次调用 AI。'
    case 'experience-mock':
      return '桌面体验模式固定使用本机 Mock，不向服务端发送任何记录。'
    case 'no-consent':
      return '未开启 AI 数据授权，本次使用本机规则生成，不向服务端发送任何记录。'
    case 'no-data':
      return '当前没有打开任何数据来源，本次使用本机规则生成，不向服务端发送任何记录。'
    case 'contract':
      return '模型返回的内容不符合契约，本次已回退到本机规则，未使用模型输出。'
    case 'unavailable':
    default:
      return '真实模型暂时不可用，本次已回退到本机规则，未使用模型输出。'
  }
}

export const MORNING_BRIEF_LOADING_NOTE =
  '正在请求 DeepSeek 生成文字结论，数字与引用依据始终由本机计算。'

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export interface GenerateMorningBriefOptions {
  digest: ReportDigest
  aiConsent: boolean
  /** false: public experience mode must not touch /api/health or /api/report. */
  allowRealAi?: boolean
  /** 用于按天缓存，避免第二天继续展示昨天的文字。 */
  date: string
  /** 显式传 null 表示不缓存；不传则使用 sessionStorage。 */
  storage?: Storage | null
  fetchImpl?: FetchLike
  signal?: AbortSignal
}

export async function generateMorningBrief(
  options: GenerateMorningBriefOptions,
): Promise<MorningBriefResult> {
  const { aiConsent, digest, date, signal } = options
  const storage = options.storage === undefined ? safeSessionStorage() : options.storage

  if (options.allowRealAi === false) return { status: 'experience-mock', content: null }
  if (!aiConsent) return { status: 'no-consent', content: null }
  if (!hasDigestSources(digest)) return { status: 'no-data', content: null }

  const cached = readCachedMorningBrief(storage, date, digest)
  if (cached) return { status: 'ai', content: cached }

  try {
    const content = await requestAiReport(buildMorningBriefRequest(digest), {
      fetchImpl: options.fetchImpl,
      signal,
    })
    writeCachedMorningBrief(storage, date, digest, content)
    return { status: 'ai', content }
  } catch (error) {
    if (isAbortError(error)) throw error
    if (error instanceof ReportContractError) return { status: 'contract', content: null }
    if (error instanceof ReportUnavailableError) return { status: 'unavailable', content: null }
    return { status: 'unavailable', content: null }
  }
}
