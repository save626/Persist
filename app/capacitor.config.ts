import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CapacitorConfig } from '@capacitor/cli'

/**
 * 读取 app/.env.mobile.local 里的 VITE_PERSIST_API_BASE_URL。
 *
 * 本文件由 Capacitor CLI 在 Node 里加载（不是 Vite），拿不到 Vite 的
 * import.meta.env，只能自己读文件。Capacitor CLI 通常在 app/ 目录下运行，
 * 但为稳妥起见两个常见 cwd 都试一遍。
 */
function readApiBaseUrl(): string {
  const candidates = [
    resolve(process.cwd(), '.env.mobile.local'),
    resolve(process.cwd(), 'app', '.env.mobile.local'),
  ]
  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, 'utf8')
      const matched = /^\s*VITE_PERSIST_API_BASE_URL\s*=\s*(.+?)\s*$/m.exec(content)
      if (matched?.[1]) return matched[1].trim()
    } catch {
      // 读不到就试下一个候选。
    }
  }
  return ''
}

const apiBaseUrl = readApiBaseUrl()

/**
 * cleartext 开关由 API 基址的协议推导，而不是手工维护第二份配置。
 *
 * 理由：这两个值必须一致，否则会出现「基址还是 http:// 但明文被关掉」——
 * 应用照常构建成功，但真机上所有 /api 请求静默失败（Android API 28+ 默认
 * 禁止明文流量）。反向不一致（https 基址 + 允许明文）只是不够干净，不会坏。
 * 推导规则让前者不可能发生。
 *
 * 规则与 app/android/app/build.gradle 中的同名推导保持一致，两处都读同一个
 * .env.mobile.local。若要改规则，两处必须一起改。
 */
const allowCleartext = !/^https:\/\//i.test(apiBaseUrl)

const config: CapacitorConfig = {
  appId: 'com.save626.persist',
  appName: 'Persist',
  webDir: 'dist-mobile',
  backgroundColor: '#f4f7f9',
  android: {
    backgroundColor: '#f4f7f9',
    // 混合内容（同页里的 http 资源）与 cleartext 同源：基址是 https 就不需要。
    allowMixedContent: allowCleartext,
  },
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
    cleartext: allowCleartext,
  },
}

export default config
