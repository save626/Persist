import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  getStatus: vi.fn(),
  addListener: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
}))

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: mocks.getStatus,
    addListener: mocks.addListener,
  },
}))

import { useNetworkOnline } from './network-status'

function setBrowserOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

beforeEach(() => {
  vi.clearAllMocks()
  setBrowserOnline(true)
})

describe('useNetworkOnline', () => {
  it('网页环境跟随 online / offline 事件', () => {
    mocks.isNativePlatform.mockReturnValue(false)
    const { result } = renderHook(() => useNetworkOnline())

    expect(result.current).toBe(true)
    setBrowserOnline(false)
    act(() => window.dispatchEvent(new Event('offline')))
    expect(result.current).toBe(false)
    setBrowserOnline(true)
    act(() => window.dispatchEvent(new Event('online')))
    expect(result.current).toBe(true)
  })

  it('原生环境使用 Capacitor Network 的实时状态并清理监听', async () => {
    let listener: ((status: { connected: boolean; connectionType: string }) => void) | null = null
    const remove = vi.fn()
    mocks.isNativePlatform.mockReturnValue(true)
    mocks.getStatus.mockResolvedValue({ connected: false, connectionType: 'none' })
    mocks.addListener.mockImplementation(async (_event: string, callback: typeof listener) => {
      listener = callback
      return { remove }
    })

    const { result, unmount } = renderHook(() => useNetworkOnline())
    await waitFor(() => expect(result.current).toBe(false))

    act(() => listener?.({ connected: true, connectionType: 'wifi' }))
    expect(result.current).toBe(true)

    unmount()
    expect(remove).toHaveBeenCalledOnce()
  })
})
