import { loadEnv } from 'vite'

export function normalizeAndroidApiBase(raw) {
  const value = raw?.trim()
  if (!value) {
    throw new Error(
      '缺少 VITE_PERSIST_API_BASE_URL。请复制 app/.env.mobile.example 为 app/.env.mobile.local 并填写服务器 origin。',
    )
  }
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('VITE_PERSIST_API_BASE_URL 不是合法 URL。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('VITE_PERSIST_API_BASE_URL 只支持 http / https。')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_PERSIST_API_BASE_URL 不能包含账号、查询参数或片段。')
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('VITE_PERSIST_API_BASE_URL 只能填服务器 origin，不要追加 /api 或子路径。')
  }
  return url.origin
}

export function readAndroidApiBase(cwd = process.cwd()) {
  const env = loadEnv('mobile', cwd, '')
  return normalizeAndroidApiBase(
    process.env.VITE_PERSIST_API_BASE_URL ?? env.VITE_PERSIST_API_BASE_URL,
  )
}
