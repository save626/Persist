import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { UIContext, type ToastMessage } from './ui-context'

export function UIProvider({ children }: { children: ReactNode }) {
  const [quickOpen, setQuickOpen] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openQuickRecord = useCallback(() => setQuickOpen(true), [])
  const closeQuickRecord = useCallback(() => setQuickOpen(false), [])

  const showToast = useCallback((message: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ id: Date.now(), message })
    timerRef.current = setTimeout(() => setToast(null), 2_200)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const value = useMemo(
    () => ({ quickOpen, openQuickRecord, closeQuickRecord, toast, showToast }),
    [closeQuickRecord, openQuickRecord, quickOpen, showToast, toast],
  )

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}
