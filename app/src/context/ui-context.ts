import { createContext, useContext } from 'react'

export interface ToastMessage {
  id: number
  message: string
}

export interface UIContextValue {
  quickOpen: boolean
  openQuickRecord: () => void
  closeQuickRecord: () => void
  toast: ToastMessage | null
  showToast: (message: string) => void
}

export const UIContext = createContext<UIContextValue | null>(null)

export function useUI() {
  const value = useContext(UIContext)
  if (!value) throw new Error('useUI must be used within UIProvider')
  return value
}
