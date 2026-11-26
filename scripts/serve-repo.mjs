/**
 * 仓库根静态服务（预览用）
 *
 * 为什么不直接用 `gesture-particle-fusion-20261121/serve.mjs`：
 *   · 它的 root 固定在自己目录，托管不到 `landing/`；
 *   · 它的 CSP 是 `script-src 'self'`，而 `landing/index.html` 是**单文件**产物
 *     （内联开场引擎 + 内联 Vue 包 + 内联样式），会被这条 CSP 直接拦掉。
 *
 * 这里只做预览，不发 CSP；生产部署仍以落地页自身的构建产物为准。
 *
 * 用法：
 *   node scripts/serve-repo.mjs 4173
 *   → http://localhost:4173/landing/index.html
 */
import { createServer } from 'node:http'
import { readFile, lstat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PORT = Number(process.env.PORT || process.argv[2] || 4173)
const HOST = process.env.HOST || '127.0.0.1'

/**
 * 敏感路径黑名单（2026-11-25 安全审查）。
 * 本服务以仓库根为 root，能直接请求到 /server/.env、/.git/config 等；预览时不应暴露这些。
 * 按 URL 路径片段匹配，大小写不敏感；命中即 403，不做文件读取。
 */
const BLOCKED_SEGMENTS = ['.env', '.git', 'node_modules', 'backup', '.bak', '.sqlite', '.key', '.pem']
function isBlocked(pathname) {
  const lower = decodeURIComponent(pathname).toLowerCase()
  return BLOCKED_SEGMENTS.some((seg) => lower.includes(seg))
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
}

const server = createServer(async (req, res) => {
  let path
  try {
    path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  } catch {
    res.writeHead(400).end('bad request')
    return
  }
  if (path === '/') path = '/landing/index.html'
  if (isBlocked(path)) {
    res.writeHead(403).end('forbidden')
    return
  }

  const target = resolve(join(ROOT, path))
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    res.writeHead(403).end('forbidden')
    return
  }

  try {
    const info = await lstat(target)
    // 跟随符号链接可能逃出 ROOT（黑名单只挡路径名挡不住 symlink 目标），一律拒绝链接。
    if (info.isSymbolicLink()) {
      res.writeHead(403).end('forbidden')
      return
    }
    if (info.isDirectory()) {
      res.writeHead(302, { Location: path.replace(/\/?$/, '/') + 'index.html' }).end()
      return
    }
    const body = await readFile(target)
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store, must-revalidate',
      // 摄像头/手势只在安全上下文可用；localhost 已满足
      'Permissions-Policy': 'camera=(self), microphone=()',
    })
    res.end(body)
    console.log(200, path)
  } catch (err) {
    const code = err.code === 'ENOENT' || err.code === 'ENOTDIR' ? 404 : 500
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`${code} ${path}`)
    console.log(code, path)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`\n  仓库根静态服务  http://${HOST}:${PORT}/`)
  console.log(`  落地页          http://${HOST}:${PORT}/landing/index.html`)
  console.log(`  融合工程         http://localhost:4190/`)
  console.log(`  root            ${ROOT}\n`)
})
