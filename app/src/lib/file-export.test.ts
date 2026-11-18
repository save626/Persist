import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportTextFile, formatBytes, isNativeShell } from './file-export'

/**
 * 这组测试盯的是一个具体事故：APK 里点「导出备份」，toast 说已导出，
 * 但 Blob 下载被 WebView 静默忽略，手机上没有任何文件。
 * 所以每条分支都必须能被区分：下载 / 剪贴板 / 明确失败。
 */

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

function defineClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  })
}

function defineCapacitor(isNative: boolean | null) {
  if (isNative === null) {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
    return
  }
  Object.defineProperty(window, 'Capacitor', {
    value: { isNativePlatform: () => isNative },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:persist-test')
  URL.revokeObjectURL = vi.fn()
  // jsdom 的 anchor 点击会尝试导航，替换成空实现看调用次数即可。
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  defineCapacitor(null)
  defineClipboard(undefined)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('isNativeShell', () => {
  it('没有 Capacitor 时按浏览器处理', () => {
    defineCapacitor(null)
    expect(isNativeShell()).toBe(false)
  })

  it('Capacitor 明确报告非原生时仍按浏览器处理', () => {
    defineCapacitor(false)
    expect(isNativeShell()).toBe(false)
  })

  it('Capacitor 报告原生时进入原生分支', () => {
    defineCapacitor(true)
    expect(isNativeShell()).toBe(true)
  })
})

describe('exportTextFile', () => {
  it('桌面浏览器触发下载并返回 downloaded', async () => {
    defineCapacitor(null)
    const outcome = await exportTextFile('persist-backup-2026-11-18.json', '{"a":1}')

    expect(outcome).toEqual({ kind: 'downloaded', fileName: 'persist-backup-2026-11-18.json' })
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
    // 下载触发后链接节点不应留在 DOM 里
    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  })

  it('下载用的 blob 类型是 JSON', async () => {
    defineCapacitor(null)
    const create = vi.fn((blob: Blob) => {
      expect(blob.type).toContain('application/json')
      return 'blob:typed'
    })
    URL.createObjectURL = create as unknown as typeof URL.createObjectURL

    await exportTextFile('a.json', '{}')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('原生环境下写剪贴板并返回 copied 与真实字节数', async () => {
    defineCapacitor(true)
    const writeText = vi.fn(async () => {})
    defineClipboard(writeText)

    const text = '{"hello":"世界"}'
    const outcome = await exportTextFile('persist-backup.json', text)

    expect(writeText).toHaveBeenCalledWith(text)
    expect(outcome.kind).toBe('copied')
    if (outcome.kind === 'copied') {
      expect(outcome.bytes).toBe(new TextEncoder().encode(text).length)
      expect(outcome.fileName).toBe('persist-backup.json')
    }
    // 原生环境不允许再走假的浏览器下载
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('原生环境没有剪贴板时抛错，绝不返回成功', async () => {
    defineCapacitor(true)
    defineClipboard(undefined)

    await expect(exportTextFile('a.json', '{}')).rejects.toThrow('既不能保存文件')
  })

  it('剪贴板写入失败时错误向上抛，不吞掉', async () => {
    defineCapacitor(true)
    const writeText = vi.fn(async () => {
      throw new Error('denied')
    })
    defineClipboard(writeText)

    await expect(exportTextFile('a.json', '{}')).rejects.toThrow('denied')
  })
})

describe('formatBytes', () => {
  it('按量级选择单位', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(48 * 1024)).toBe('48 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
