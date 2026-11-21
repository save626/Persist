/**
 * 本地静态服务器（零依赖）。
 *
 * 作用与花瓣项目里的同款一致：给 `.wasm` 正确的 MIME、给摄像头一个安全上下文、
 * 用 CSP 把 MediaPipe 的遥测请求从网络层掐断（`connect-src 'self'`）。
 *
 * 用法：node serve.mjs [port]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)))
const PORT = Number(process.env.PORT || process.argv[2] || 4190)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

export function createServerInstance({ root = ROOT, quiet = false } = {}) {
  return createServer(async (req, res) => {
    let path
    try {
      path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    } catch {
      res.writeHead(400).end('bad request')
      return
    }
    if (path === '/') path = '/index.html'

    const target = resolve(join(root, path))
    if (target !== root && !target.startsWith(root + sep)) {
      res.writeHead(403).end('forbidden')
      return
    }

    try {
      const info = await stat(target)
      if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' })
      const body = await readFile(target)
      res.writeHead(200, {
        'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-store, must-revalidate',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(self), microphone=()',
        'Content-Security-Policy': CSP,
      })
      res.end(body)
      if (!quiet) console.log(200, path)
    } catch (err) {
      const code = err.code === 'ENOENT' || err.code === 'ENOTDIR' ? 404 : 500
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`${code} ${path}`)
      if (!quiet) console.log(code, path)
    }
  })
}

export function startServer({ port = PORT, host = '127.0.0.1', quiet = false } = {}) {
  const server = createServerInstance({ quiet })
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const addr = server.address()
      resolvePromise({
        server,
        port: addr.port,
        url: `http://${host}:${addr.port}/`,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  const { url } = await startServer({ quiet: true })
  console.log(`\n  手势粒子融合  ${url}`)
  console.log(`  root  ${ROOT}`)
  console.log('  提示：摄像头只在 localhost / https 下可用\n')
}
