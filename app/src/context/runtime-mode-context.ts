import { createContext, useContext } from 'react'
import { getRuntimeModeConfig, type RuntimeModeConfig } from '../lib/runtime-mode'

const DEFAULT_CONFIG = getRuntimeModeConfig('owner')

export const RuntimeModeContext = createContext<RuntimeModeConfig>(DEFAULT_CONFIG)

export function useRuntimeMode(): RuntimeModeConfig {
  return useContext(RuntimeModeContext)
}
