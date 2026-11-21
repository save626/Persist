/**
 * 极简静态服务器（零依赖）。
 *
 * 存在的理由不是「懒得开服务」，而是**摄像头和 wasm 都挑环境**：
 *
 *  - `getUserMedia` 只在安全上下文里可用。`file://` 双击打开在 Chrome 下拿不到摄像头
 *    （`isSecureContext` 都不成立），所以这个项目**必须**走 http://localhost。
 *  - MediaPipe 的 `.wasm` 必须带 `application/wasm`，否则会被浏览器拒绝编译。
 *  - 部分浏览器里 MediaPipe 依赖 SharedArrayBuffer，那要求跨源隔离（COOP/COEP）。
 *    默认就带上，两个头只作用于本站资源，没有副作用。
 *
 * 用法：
 *   node bloom/serve.mjs                 # http://localhost:4180
 *   node bloom/serve.mjs 4300            # 换端口
 *   COI=0 node bloom/serve.mjs           # 关掉跨源隔离（排查问题时用）
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces } from 'node:os'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)))

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  // MediaPipe 的模型 / 数据文件；octet-stream 是官方推荐的兜底类型
  '.task': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
  '.binarypb': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * CSP：**这条是硬要求，不是可选项**。
 *
 * `@mediapipe/tasks-vision` 默认会把运行指标 POST 到
 * `https://odml.pa.googleapis.com/v1/log`（包内明文地址，官方 README 的 Privacy Notice
 * 也写明了）。它没有公开的关闭开关（`enableLogging()` 只在 .d.ts 里，bundle 里被裁掉了），
 * 所以只能靠 `connect-src 'self'` 从网络层掐断 —— 顺带也保证了「不依赖任何 CDN」。
 *
 * `'wasm-unsafe-eval'` 是编译 WebAssembly 必需的；没有它 MediaPipe 直接起不来。
 * `script-src 'self'` 覆盖 MediaPipe 用 `<script crossorigin=anonymous>` 注入 wasm loader 的行为。
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  // 唯一的外联出口：只允许自己。MediaPipe 的遥测请求会在这里被浏览器拦下
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

/**
 * 建一个只读静态服务（不 listen）。验收脚本直接复用它，不必再起第二个实现。
 * @param {{root?:string, coi?:boolean, quiet?:boolean, csp?:boolean}} opts
 */
export function createBloomServer({ root = ROOT, coi = true, quiet = false, csp = true } = {}) {
  return createServer(async (req, res) => {
    const started = performance.now()
    let urlPath
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    } catch {
      res.writeHead(400).end('bad request')
      return
    }

    if (urlPath === '/') urlPath = '/index.html'

    // 目录穿越防护：resolved 必须仍在 root 之内
    const target = resolve(join(root, urlPath))
    if (target !== root && !target.startsWith(root + sep)) {
      res.writeHead(403).end('forbidden')
      return
    }

    try {
      const info = await stat(target)
      if (!info.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' })

      const body = await readFile(target)
      const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream'

      const headers = {
        'Content-Type': type,
        'Content-Length': body.length,
        'Cache-Control': 'no-store, must-revalidate',
        'Cross-Origin-Resource-Policy': 'same-origin',
        // 摄像头只在自有文档里允许，防第三方 iframe 蹭权限
        'Permissions-Policy': 'camera=(self), microphone=()',
      }
      if (csp) headers['Content-Security-Policy'] = CSP
      if (coi) {
        headers['Cross-Origin-Opener-Policy'] = 'same-origin'
        headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
      }

      res.writeHead(200, headers).end(body)
      if (!quiet) log(200, urlPath, body.length, started)
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`404 ${urlPath}`)
        if (!quiet) log(404, urlPath, 0, started)
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('500 internal')
        if (!quiet) log(500, urlPath, 0, started)
        console.error(err)
      }
    }
  })
}

/** 建好并 listen，返回真实端口（`port: 0` 时由系统分配，供验收脚本用）。 */
export function startBloomServer({ port = 4180, host = '127.0.0.1', coi = true, quiet = false, csp = true } = {}) {
  const server = createBloomServer({ coi, quiet, csp })
  return new Promise((resolvePromise, reject) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(Object.assign(new Error(`端口 ${port} 已被占用，换一个：node bloom/serve.mjs ${port + 1}`), { code: err.code }))
      } else {
        reject(err)
      }
    }
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
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

function log(status, path, bytes, started) {
  const ms = (performance.now() - started).toFixed(0).padStart(4)
  const size = bytes ? `${(bytes / 1024).toFixed(0)}KB`.padStart(7) : '      -'
  console.log(`${status} ${size} ${ms}ms  ${path}`)
}

// —— CLI 入口（被 import 时不执行）——
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  const port = Number(process.env.PORT || process.argv[2] || 4180)
  const host = process.env.HOST || '127.0.0.1'
  const coi = process.env.COI !== '0'

  const { url } = await startBloomServer({ port, host, coi })
  console.log(`\n  指尖绽放  ${url}`)
  console.log(`  root   ${ROOT}`)
  console.log(`  COI    ${coi ? 'on (COOP/COEP)' : 'off'}\n`)

  // 摄像头只认安全上下文：局域网走 http 拿不到权限，这里必须说明白
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
  if (lan.length) {
    console.log('  局域网地址（只能看画面，摄像头会被浏览器拒绝）：')
    for (const ip of lan) console.log(`    http://${ip}:${port}/`)
    console.log('')
  }
}
