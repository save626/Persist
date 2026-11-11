import { useCallback, useEffect, useRef, useState } from 'react'
import { parseReportContent, requestAiReport } from './ai-report-client'
import { digestFingerprint } from './report-digest'
import type { ReportContent, ReportRequest, ReportType } from './report-types'

export type AiObservationMode = 'disabled' | 'loading' | 'ai' | 'fallback'

export interface AiObservationState {
  mode: AiObservationMode
  content: ReportContent | null
  error: string | null
  fingerprint: string | null
  fromCache: boolean
  stale: boolean
}

interface CachedObservation {
  fingerprint: string
  content: ReportContent
  generatedAt: string
}

const STORAGE_PREFIX = 'persist.ai-observation.v2'
const inFlight = new Map<string, Promise<ReportContent>>()
const DISABLED_STATE: AiObservationState = {
  mode: 'disabled',
  content: null,
  error: null,
  fingerprint: null,
  fromCache: false,
  stale: false,
}

function storageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function observationCacheKey(type: ReportType, dateKey: string): string {
  return `${STORAGE_PREFIX}:${type}:${dateKey}`
}

export function readObservationCache(
  type: ReportType,
  dateKey: string,
  storage: Storage | null = storageOrNull(),
): CachedObservation | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(observationCacheKey(type, dateKey))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.fingerprint !== 'string' || typeof record.generatedAt !== 'string') {
      return null
    }
    const content = parseReportContent(record.content)
    return content
      ? { fingerprint: record.fingerprint, content, generatedAt: record.generatedAt }
      : null
  } catch {
    return null
  }
}

function writeObservationCache(
  type: ReportType,
  dateKey: string,
  fingerprint: string,
  content: ReportContent,
): void {
  const storage = storageOrNull()
  if (!storage) return
  try {
    const value: CachedObservation = {
      fingerprint,
      content,
      generatedAt: new Date().toISOString(),
    }
    storage.setItem(observationCacheKey(type, dateKey), JSON.stringify(value))
  } catch {
    // 隐私模式或配额不足时仍可使用本次生成结果，只是不缓存。
  }
}

function requestObservation(request: ReportRequest, cacheKey: string): Promise<ReportContent> {
  const existing = inFlight.get(cacheKey)
  if (existing) return existing
  const pending = requestAiReport(request).finally(() => inFlight.delete(cacheKey))
  inFlight.set(cacheKey, pending)
  return pending
}

export interface UseAiObservationOptions {
  enabled: boolean
  request: ReportRequest | null
  dateKey: string
}

export function useAiObservation({ enabled, request, dateKey }: UseAiObservationOptions) {
  const requestRef = useRef(request)
  const type = request?.type ?? null
  const inactive = !enabled || !type
  const [state, setState] = useState<AiObservationState>(DISABLED_STATE)

  useEffect(() => {
    requestRef.current = request
  }, [request])

  const load = useCallback(
    async (regenerate: boolean) => {
      const current = requestRef.current
      if (!enabled || !current || !type) return
      const fingerprint = digestFingerprint(current.digest)
      if (!regenerate) {
        const cached = readObservationCache(type, dateKey)
        if (cached) {
          setState({
            mode: 'ai',
            content: cached.content,
            error: null,
            fingerprint: cached.fingerprint,
            fromCache: true,
            stale: cached.fingerprint !== fingerprint,
          })
          return
        }
      }

      setState((currentState) => ({
        ...currentState,
        mode: 'loading',
        error: null,
      }))
      try {
        const content = await requestObservation(current, `${type}:${dateKey}:${fingerprint}`)
        writeObservationCache(type, dateKey, fingerprint, content)
        setState({
          mode: 'ai',
          content,
          error: null,
          fingerprint,
          fromCache: false,
          stale: false,
        })
      } catch (error) {
        setState({
          mode: 'fallback',
          content: null,
          error: error instanceof Error ? error.message : 'AI 观察生成失败。',
          fingerprint: null,
          fromCache: false,
          stale: false,
        })
      }
    },
    [dateKey, enabled, type],
  )

  useEffect(() => {
    if (inactive) return
    void load(false)
  }, [inactive, load])

  const regenerate = useCallback(() => {
    void load(true)
  }, [load])

  const currentFingerprint = request ? digestFingerprint(request.digest) : null
  return {
    ...(inactive ? DISABLED_STATE : state),
    stale:
      !inactive &&
      state.mode === 'ai' &&
      state.fingerprint !== null &&
      currentFingerprint !== null &&
      state.fingerprint !== currentFingerprint,
    regenerate,
  }
}
