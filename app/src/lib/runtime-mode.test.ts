import { describe, expect, it } from 'vitest'
import {
  RUNTIME_MODE_STORAGE_KEY,
  getRuntimeModeConfig,
  resolveRuntimeMode,
  resolveRuntimeSurface,
} from './runtime-mode'

function createStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

describe('runtime mode', () => {
  it('uses explicit public modes on web and keeps them for later in-app navigation', () => {
    const storage = createStorage()
    expect(resolveRuntimeMode('?mode=demo', { surface: 'web', storage })).toBe('demo')
    expect(storage.getItem(RUNTIME_MODE_STORAGE_KEY)).toBe('demo')
    expect(resolveRuntimeMode('', { surface: 'web', storage })).toBe('demo')
    expect(resolveRuntimeMode('?mode=guest', { surface: 'web', storage })).toBe('guest')
    expect(resolveRuntimeMode('', { surface: 'web', storage })).toBe('guest')
  })

  it('never resolves owner on web and defaults to guest', () => {
    const storage = createStorage({ [RUNTIME_MODE_STORAGE_KEY]: 'owner' })
    expect(resolveRuntimeMode('', { surface: 'web', storage })).toBe('guest')
    expect(storage.getItem(RUNTIME_MODE_STORAGE_KEY)).toBeNull()
    expect(resolveRuntimeMode('?mode=owner', { surface: 'web', storage })).toBe('guest')
    expect(resolveRuntimeMode('?mode=typo', { surface: 'web', storage })).toBe('guest')
    expect(resolveRuntimeMode('', { surface: 'web', storage: null })).toBe('guest')
  })

  it('defaults to owner on mobile while still allowing explicit preview modes', () => {
    const storage = createStorage()
    expect(resolveRuntimeMode('', { surface: 'mobile', storage })).toBe('owner')
    expect(resolveRuntimeMode('?mode=owner', { surface: 'mobile', storage })).toBe('owner')
    expect(resolveRuntimeMode('?mode=demo', { surface: 'mobile', storage })).toBe('demo')
    expect(resolveRuntimeMode('', { surface: 'mobile', storage })).toBe('demo')
    expect(resolveRuntimeMode('?mode=typo', { surface: 'mobile', storage })).toBe('owner')
    expect(resolveRuntimeMode('', { surface: 'mobile', storage: null })).toBe('owner')
  })

  it('only treats the exact Vite mobile mode as the packaged app surface', () => {
    expect(resolveRuntimeSurface('mobile')).toBe('mobile')
    expect(resolveRuntimeSurface('development')).toBe('web')
    expect(resolveRuntimeSurface('production')).toBe('web')
    expect(resolveRuntimeSurface(undefined)).toBe('web')
  })

  it('isolates storage and AI capabilities per mode', () => {
    const owner = getRuntimeModeConfig('owner')
    const demo = getRuntimeModeConfig('demo')
    const guest = getRuntimeModeConfig('guest')

    expect(new Set([owner.storageDbName, demo.storageDbName, guest.storageDbName]).size).toBe(3)
    expect(demo.ai).toEqual({
      report: false,
      chat: false,
      morningBrief: false,
      serverAnalysis: false,
    })
    expect(guest.ai).toEqual({
      report: false,
      chat: false,
      morningBrief: false,
      serverAnalysis: false,
    })
    expect(guest.waterBaselineMilliliters).toBe(0)
    expect(owner.sync).toBe(true)
    expect(demo.sync).toBe(false)
    expect(guest.sync).toBe(false)
    expect(owner.readOnly).toBe(false)
    expect(owner.persist).toBe(true)
    expect(demo.readOnly).toBe(true)
    expect(demo.persist).toBe(false)
    expect(guest.readOnly).toBe(false)
    expect(guest.persist).toBe(true)
  })
})
