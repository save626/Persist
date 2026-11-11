import type { ReactNode } from 'react'
import { getRuntimeModeConfig, type RuntimeMode } from '../lib/runtime-mode'
import { RuntimeModeContext } from './runtime-mode-context'

export function RuntimeModeProvider({
  mode,
  children,
}: {
  mode: RuntimeMode
  children: ReactNode
}) {
  return (
    <RuntimeModeContext.Provider value={getRuntimeModeConfig(mode)}>
      {children}
    </RuntimeModeContext.Provider>
  )
}
