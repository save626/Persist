/**
 * 把一段文本交给用户带走。
 *
 * 桌面浏览器与 Android WebView 的差别比想象的大，这里踩过两个坑：
 * - 桌面：`Blob` + `<a download>`，浏览器接管保存，可靠。
 * - Capacitor WebView：`<a download>` 对 `blob:` 一律**静默忽略**——不报错、
 *   不触发下载、也不弹提示，从 JS 侧看就像成功了。
 * - `showSaveFilePicker` 在这个环境里 `typeof` 是 function，但真被点击时立即抛
 *   `AbortError: The user aborted a request.`（实测 Chrome 138 / Android 16，
 *   用户根本没看到对话框）。能力检测不能只看 typeof。
 * - `navigator.share` 是 undefined（Web Share 路线也走不通）。
 *
 * 结论：本机导出只有「桌面下载」和「写剪贴板」两种真实出口；
 * 谁都不许在什么都没发生时报成功。
 */

export type FileExportOutcome =
  | { kind: 'downloaded'; fileName: string }
  | { kind: 'copied'; fileName: string; bytes: number }

interface CapacitorLike {
  isNativePlatform?: () => boolean
}

/** 原生壳（APK）判定：只有 Capacitor 原生平台才需要绕过浏览器下载。 */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  const capacitor = (window as unknown as { Capacitor?: CapacitorLike }).Capacitor
  return capacitor?.isNativePlatform?.() === true
}

/** 人类可读的体量，给 toast 用（不引入依赖）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

/**
 * 导出文本文件。
 * - 浏览器：触发下载，返回 `downloaded`
 * - 原生 WebView：写剪贴板，返回 `copied`（调用方必须换一套话术）
 * - 两者都不行：抛错，绝不返回成功
 */
export async function exportTextFile(
  fileName: string,
  text: string,
  mimeType = 'application/json;charset=utf-8',
): Promise<FileExportOutcome> {
  if (!isNativeShell()) {
    downloadInBrowser(fileName, text, mimeType)
    return { kind: 'downloaded', fileName }
  }

  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clipboard?.writeText) {
    await clipboard.writeText(text)
    return { kind: 'copied', fileName, bytes: new TextEncoder().encode(text).length }
  }

  throw new Error('当前设备既不能保存文件，也不能写剪贴板')
}

function downloadInBrowser(fileName: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 立即 revoke 会掐断部分浏览器尚未开始的下载，留一段时间再回收。
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
