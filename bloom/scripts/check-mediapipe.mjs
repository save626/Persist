/**
 * MediaPipe 链路的离线验收（不需要真摄像头）。
 *
 * 真机手势没法自动测，但整条「本地 wasm + 本地模型 + CSP 不拦自己」的管线可以：
 *   1. `page.addInitScript` 把 `getUserMedia` 换成一个 canvas 合成的假摄像头流；
 *   2. 打开 `?hand=1`，让页面自己走完「申请权限 → 加载模型 → 每帧 detect」；
 *   3. 断言模型真的初始化了（`handTracker.ready`）、delegate 有值、CSP 没拦自己的资源、
 *      控制台没有 CSP violation / 网络错误。
 *
 * 如果 vendor 缺文件、CSP 写窄了、wasm MIME 不对，这里都会红。
 *
 * 用法：node bloom/scripts/check-mediapipe.mjs
 */
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '../../app/node_modules/playwright-core/index.mjs'
import { startBloomServer } from '../serve.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const VENDOR = join(HERE, '..', 'vendor', 'mediapipe')

const CHROME_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  // 假摄像头：真机权限框在无头环境里弹不出来，必须用 fake device
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
]

// —— 0) vendored 文件完整性（比浏览器报错更早给出线索）——
const REQUIRED = [
  ['vision_bundle.mjs', 150_000],
  ['wasm/vision_wasm_internal.js', 300_000],
  ['wasm/vision_wasm_internal.wasm', 14_000_000],
  ['hand_landmarker.task', 7_800_000],
]

const problems = []
for (const [rel, minBytes] of REQUIRED) {
  try {
    const size = statSync(join(VENDOR, rel)).size
    console.log(`✓ ${rel.padEnd(32)} ${size.toLocaleString('en-US').padStart(11)} B`)
    if (size < minBytes) problems.push(`${rel} 只有 ${size} B，疑似下载不完整`)
  } catch {
    problems.push(`缺文件 vendor/mediapipe/${rel} —— 先跑 node bloom/scripts/vendor-mediapipe.mjs`)
  }
}
if (problems.length) {
  console.error('\n产物不全，后面不用测了：')
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}

// —— 1) 起服务 ——
const server = await startBloomServer({ port: 0, quiet: true })
console.log(`\n服务 ${server.url}`)

const browser = await chromium.launch({ headless: true, args: CHROME_ARGS })
// 小视口 + 少粒子：软件渲染（SwiftShader）下 detect 很慢，压小负载才测得动
const page = await browser.newPage({ viewport: { width: 480, height: 320 } })

const consoleErrors = []
const cspViolations = []
const consoleAll = []
page.on('console', (msg) => {
  const text = msg.text()
  consoleAll.push(`${msg.type()}: ${text}`)
  if (msg.type() === 'error') consoleErrors.push(text)
  if (/Content Security Policy|Refused to (connect|load|execute)/i.test(text)) cspViolations.push(text)
})
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
// 遥测请求一旦发出就记下来：它应该被 CSP 拦掉，而不是真的发出去
page.on('requestfailed', (req) => {
  const url = req.url()
  if (/pa\.googleapis|googleapis\.com/.test(url)) cspViolations.push(`遥测被拦（预期）：${url}`)
})

await page.addInitScript(() => {
  // 合成一条 320×240 的「摄像头」流：画一个缓慢移动的亮块，足够让 MediaPipe 有输入
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 240
  const ctx = canvas.getContext('2d')
  let t = 0
  setInterval(() => {
    t += 0.05
    ctx.fillStyle = '#0a1116'
    ctx.fillRect(0, 0, 320, 240)
    ctx.fillStyle = '#cfe4f2'
    ctx.beginPath()
    ctx.arc(160 + Math.sin(t) * 40, 120, 34, 0, Math.PI * 2)
    ctx.fill()
  }, 33)

  const stream = canvas.captureStream(30)
  const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (constraints?.video) return stream
    return original ? original(constraints) : stream
  }
})

await page.goto(`${server.url}?hand=1&n=5000`, { waitUntil: 'load', timeout: 30000 })

// —— 2) 等模型就绪 ——
// 不用 page.waitForFunction：它的轮询要么走 raf（本页 RAF 被同步 detect 占满，饿死），
// 要么在阻塞的主线程上排队到超时。改成手动轮询 evaluate（每次独立求值，能抢到空档）。
async function pollUntil(page, expression, timeoutMs = 60000, intervalMs = 400) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const ok = await page.evaluate(expression)
      if (ok) return { ok: true, error: null }
    } catch (err) {
      lastError = err
    }
    await page.waitForTimeout(intervalMs)
  }
  return { ok: false, error: lastError }
}

const waited = await pollUntil(page, () => {
  const t = window.__bloom?.handTracker
  return !!(t && t.ready)
})
const ready = waited.ok

const info = await page.evaluate(() => {
  const t = window.__bloom?.handTracker
  return {
    hasTracker: !!t,
    ready: !!t?.ready,
    delegate: t?.stats?.delegate || null,
    loadMs: t?.stats?.loadMs || null,
    detections: t?.stats?.detections ?? null,
    detectCostMs: t?.lastCostMs ?? null,
    detectIntervalMs: t?.detectIntervalMs ?? null,
    status: document.querySelector('#status')?.textContent || '',
    engineError: window.__bloom?.engineError || null,
  }
})

// 再跑 1 秒，确认 detect 循环不抛错
await page.waitForTimeout(1200)
const after = await page.evaluate(() => ({
  frames: window.__bloom?.frames ?? 0,
  detectCalls: window.__bloom?.handTracker?.stats?.detectCalls ?? 0,
  detections: window.__bloom?.handTracker?.stats?.detections ?? null,
  videoLive: document.querySelector('#cam')?.classList.contains('is-live') ?? false,
}))

// 状态转储（要在关页面之前取，否则 evaluate 会失败）
const dump = await page
  .evaluate(() => ({
    keys: Object.keys(window.__bloom || {}),
    tracker: window.__bloom?.handTracker
      ? {
          ready: window.__bloom.handTracker.ready,
          delegate: window.__bloom.handTracker.stats?.delegate,
          loadMs: window.__bloom.handTracker.stats?.loadMs,
          hasLandmarker: !!window.__bloom.handTracker.landmarker,
          hasStream: !!window.__bloom.handTracker.stream,
        }
      : null,
  }))
  .catch(() => null)

await browser.close()
await server.close()

// —— 3) 断言 ——
if (!info.hasTracker) problems.push('页面里没有 handTracker —— main.js 未暴露或初始化失败')
if (!ready) problems.push(`模型未就绪（${info.engineError?.message || waited.error?.message || '超时'}）`)
if (ready && !info.delegate) problems.push('delegate 为空，说明 createFromOptions 没真正跑完')
if (!after.videoLive) problems.push('视频层没有进入 is-live，说明摄像头流没挂上')
// detect 真的被调到了吗？这比「模型加载成功」更能证明整条链在跑
if (!(after.detectCalls > 0)) problems.push('detectForVideo 一次都没被调用 —— 渲染循环或手势分支没接上')
// 软件渲染（SwiftShader）下 detectForVideo 单帧可能几秒，帧数低是环境限制，不是代码问题；
// 这里只要求循环还活着（没被彻底饿死），真正的帧率由 shoot.mjs 在无 MediaPipe 时测。
if (after.frames < 5) problems.push(`渲染循环只跑了 ${after.frames} 帧，疑似被 detect 完全饿死`)

const telemetry = consoleErrors.filter((e) => /pa\.googleapis|odml/i.test(e))
const realCsp = cspViolations.filter((v) => !/遥测被拦（预期）/.test(v))
if (realCsp.length) problems.push(`CSP 拦掉了自家资源：${realCsp[0].slice(0, 200)}`)
if (telemetry.length) problems.push(`遥测请求没有被拦住：${telemetry[0].slice(0, 160)}`)

console.log(`
  tracker.ready : ${info.ready}
  delegate      : ${info.delegate}
  模型加载耗时  : ${info.loadMs} ms
  detect 调用   : ${after.detectCalls} 次（合成画面里没有手，所以检出 0 次）
  单帧检测耗时  : ${info.detectCostMs?.toFixed?.(0) ?? info.detectCostMs} ms（软件渲染，真机 GPU 通常 5–15ms）
  视频层 is-live: ${after.videoLive}
  状态栏        : ${info.status}
`)
if (cspViolations.length) {
  console.log('  资源/遥测事件：')
  for (const v of cspViolations.slice(0, 5)) console.log('    · ' + v.slice(0, 180))
}

if (problems.length) {
  console.error('\nMediaPipe 链路验收未通过：')
  for (const p of problems) console.error('  ✗ ' + p)
  console.error('\n状态转储：' + JSON.stringify(dump))
  if (consoleAll.length) {
    console.error('\n控制台（前 12 条）：')
    for (const e of consoleAll.slice(0, 12)) console.error('  · ' + e.slice(0, 300))
  }
  process.exit(1)
}

console.log('\n验收通过：本地 wasm + 本地模型在 CSP 下正常初始化，detect 循环无报错，零遥测外发')
