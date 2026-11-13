import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Network, type ConnectionStatus } from '@capacitor/network'
import { useEffect, useState } from 'react'

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * Android WebView 在部分机型上不会及时更新 navigator.onLine。
 * 原生环境改听 Capacitor Network 事件，Web 环境仍使用浏览器在线事件。
 */
export function useNetworkOnline(): boolean {
  const [online, setOnline] = useState(browserOnline)

  useEffect(() => {
    let disposed = false
    let nativeListener: PluginListenerHandle | null = null
    const setFromBrowser = () => setOnline(browserOnline())
    const applyStatus = (status: Pick<ConnectionStatus, 'connected'>) => {
      if (!disposed) setOnline(status.connected)
    }

    if (!Capacitor.isNativePlatform()) {
      setFromBrowser()
      window.addEventListener('online', setFromBrowser)
      window.addEventListener('offline', setFromBrowser)
      return () => {
        disposed = true
        window.removeEventListener('online', setFromBrowser)
        window.removeEventListener('offline', setFromBrowser)
      }
    }

    void Network.getStatus()
      .then(applyStatus)
      .catch(() => {
        if (!disposed) setFromBrowser()
      })
    void Network.addListener('networkStatusChange', applyStatus)
      .then((handle) => {
        if (disposed) {
          void handle.remove()
          return
        }
        nativeListener = handle
      })
      .catch(() => {})

    return () => {
      disposed = true
      if (nativeListener) void nativeListener.remove()
    }
  }, [])

  return online
}
