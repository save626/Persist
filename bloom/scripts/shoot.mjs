/**
 * 粒子花的真实渲染验收：起静态服务 → 无头 Chromium → 截图 + 读回像素统计。
 *
 * 这一版要证的事情：
 *   1. **只有两态**：disperse=0 是完整花朵，disperse=1 铺满整屏；
 *   2. 花瓣没有堆成一团白：`blownRatio`（近饱和像素占比）要低；
 *   3. 花朵构图完整、不溢出画面；
 *   4. 自动循环在花朵与满屏之间完整往返；
 *   5. 背景流星雨独立成层；
 *   6. 控制台无渲染报错。
 *
 * 用法：node bloom/scripts/shoot.mjs
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '../../app/node_modules/playwright-core/index.mjs'
import { startBloomServer } from '../serve.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'preview')
const VIEWPORT = { width: 1440, height: 900 }
const PARTICLES = 32000
const STEPS = [0, 0.25, 0.5, 0.75, 1]

const CHROME_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--hide-scrollbars',
]

const fmt = (n, digits = 4) => (Number.isFinite(n) ? n.toFixed(digits) : String(n))

const server = await startBloomServer({ port: 0, quiet: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true, args: CHROME_ARGS })
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

const rows = []
for (const dsp of STEPS) {
  await page.goto(`${server.url}?disperse=${dsp}&still=1&n=${PARTICLES}`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForFunction(() => window.__bloom && window.__bloom.frames > 20, null, { timeout: 20000 })
  const m = await page.evaluate(() => window.__bloom.measure())
  const name = `bloom-${String(Math.round(dsp * 100)).padStart(3, '0')}.png`
  await page.screenshot({ path: join(OUT, name) })
  const bbox = m.bbox || { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  const extentX = bbox.maxX - bbox.minX
  const extentY = bbox.maxY - bbox.minY
  rows.push({ disperse: dsp, m, extentX, extentY, name })
  console.log(
    `disperse ${fmt(dsp, 2)} → 亮像素 ${(m.litRatio * 100).toFixed(2)}%  过曝占比 ${(m.blownRatio * 100).toFixed(1)}%  ` +
      `宽 ${fmt(extentX, 3)} 高 ${fmt(extentY, 3)}  边缘 ${m.edge}  meanLum ${fmt(m.meanLum, 1)}`,
  )
}

// —— 自动循环 ——
await page.goto(`${server.url}?cycleSpeed=4&n=16000`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__bloom && window.__bloom.frames > 10)
const cycle = []
const startedAt = Date.now()
for (let i = 0; i < 26; i++) {
  await page.waitForTimeout(260)
  cycle.push(await page.evaluate(() => window.__bloom.disperse))
}
const dspMax = Math.max(...cycle)
const dspMin = Math.min(...cycle)
console.log(`自动循环（${((Date.now() - startedAt) / 1000).toFixed(1)}s）：disperse 最高 ${dspMax.toFixed(3)} / 最低 ${dspMin.toFixed(3)}`)

// 循环实况（含流星雨）
await page.goto(`${server.url}?cycleSpeed=0.5&n=16000`, { waitUntil: 'load' })
await page.waitForTimeout(4200)
await page.screenshot({ path: join(OUT, 'bloom-live.png') })
const meteorCoverage = await page.evaluate(() => {
  const mc = document.querySelector('#meteors')
  if (!mc) return null
  const data = mc.getContext('2d').getImageData(0, 0, mc.width, mc.height).data
  let lit = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) lit++
  return { ratio: lit / (mc.width * mc.height), w: mc.width, h: mc.height }
})
console.log(`流星雨层：${meteorCoverage ? (meteorCoverage.ratio * 100).toFixed(2) + '% / ' + meteorCoverage.w + '×' + meteorCoverage.h : '缺失'}`)

// —— 鼠标模拟：上移应更散 ——
await page.goto(`${server.url}?sim=1&debug=1&n=${PARTICLES}`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__bloom && window.__bloom.frames > 10)
await page.mouse.move(720, 200)
await page.waitForTimeout(1400)
const simHigh = await page.evaluate(() => window.__bloom.disperse)
await page.mouse.move(720, 800)
await page.waitForTimeout(1600)
const simLow = await page.evaluate(() => window.__bloom.disperse)
console.log(`sim 上移 → disperse ${fmt(simHigh, 3)}；下移 → ${fmt(simLow, 3)}`)

// —— 移动端 ——
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
await mobile.goto(`${server.url}?disperse=0&still=1&n=14000`, { waitUntil: 'load' })
await mobile.waitForFunction(() => window.__bloom && window.__bloom.frames > 15)
await mobile.screenshot({ path: join(OUT, 'bloom-mobile.png') })
const mobileMeasure = await mobile.evaluate(() => window.__bloom.measure())
console.log(`移动端（花朵）→ 亮像素 ${(mobileMeasure.litRatio * 100).toFixed(2)}%`)

await browser.close()
await server.close()

// —— 断言 ——
const problems = []
const flowerState = rows[0]
const scattered = rows[rows.length - 1]

// 1) 花朵：完整、不溢出、不糊成一团白
if (!(flowerState.m.litRatio > 0.08)) {
  problems.push(`disperse=0 花朵太暗：亮像素 ${(flowerState.m.litRatio * 100).toFixed(2)}%`)
}
if (!(flowerState.m.litRatio < 0.45)) {
  problems.push(`disperse=0 花朵糊成一片：亮像素 ${(flowerState.m.litRatio * 100).toFixed(2)}%`)
}
if (flowerState.m.edge > 0) problems.push(`disperse=0 有 ${flowerState.m.edge} 个亮像素贴边（花瓣溢出画面）`)
if (!(flowerState.extentX > 0.3)) problems.push(`disperse=0 花朵太窄：${fmt(flowerState.extentX, 3)}`)
// 2) 粒子堆积：近饱和像素占比要低（花心不该是一片死白）
if (!(flowerState.m.blownRatio < 0.12)) {
  problems.push(`花瓣堆积/过曝：${(flowerState.m.blownRatio * 100).toFixed(1)}% 像素接近全白（应 < 12%）`)
}
// 3) 扩散：包围盒单调铺开，最终满屏
for (let i = 1; i < rows.length; i++) {
  if (rows[i].extentX < rows[i - 1].extentX - 0.01) {
    problems.push(`扩散时包围盒没有变大：disperse ${fmt(rows[i - 1].disperse, 2)} → ${fmt(rows[i].disperse, 2)}`)
  }
}
if (!(scattered.extentX > 0.85 && scattered.extentY > 0.85)) {
  problems.push(`disperse=1 没有铺满画面（宽 ${fmt(scattered.extentX, 2)} / 高 ${fmt(scattered.extentY, 2)}）`)
}
if (!(scattered.m.litRatio > 0.12)) {
  problems.push(`disperse=1 亮像素只有 ${(scattered.m.litRatio * 100).toFixed(2)}%`)
}
// 散开后的**亮度**：曾经因为沿用花朵态的窄处衰减，散开一片漆黑（meanLum 7.8）。
// 这条断言专门防止再退回去 —— 散开态的平均亮度不能明显低于成花态。
if (!(scattered.m.meanLum > 30)) {
  problems.push(`disperse=1 太暗：平均亮度 ${fmt(scattered.m.meanLum, 1)}（要求 > 30）`)
}
if (!(scattered.m.blownRatio < 0.05)) {
  problems.push(`disperse=1 过曝：${(scattered.m.blownRatio * 100).toFixed(1)}% 像素接近全白（要求 < 5%）`)
}
// 4) 循环
if (!(dspMax > 0.9)) problems.push(`自动循环没有散开（最高 ${fmt(dspMax, 3)}）`)
if (!(dspMin < 0.06)) problems.push(`自动循环没有聚回花（最低 ${fmt(dspMin, 3)}）`)
// 5) 流星层
if (!meteorCoverage) problems.push('#meteors 画布不存在')
else if (meteorCoverage.ratio < 0.0008) problems.push(`流星雨层几乎没有像素（${(meteorCoverage.ratio * 100).toFixed(3)}%）`)
// 6) 模拟器方向：上移（数值↑）应更散
if (!(simHigh > simLow)) problems.push(`sim 上移没有比下移更散：${fmt(simHigh, 3)} vs ${fmt(simLow, 3)}`)
// 7) 报错与截图
const shaderErrors = consoleErrors.filter((e) => /shader|webgl|glsl|three/i.test(e))
if (shaderErrors.length) problems.push(`渲染报错：${shaderErrors.slice(0, 3).join(' | ')}`)
for (const r of rows) {
  const size = statSync(join(OUT, r.name)).size
  if (size < 8000) problems.push(`${r.name} 只有 ${size}B，疑似空白`)
}

writeFileSync(
  join(OUT, 'bloom-report.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      viewport: VIEWPORT,
      particles: PARTICLES,
      rows: rows.map((r) => ({
        disperse: r.disperse,
        lit: r.m.litRatio,
        blown: r.m.blownRatio,
        extentX: r.extentX,
        extentY: r.extentY,
        meanLum: r.m.meanLum,
      })),
      cycle: { dspMax, dspMin },
      consoleErrors,
    },
    null,
    2,
  ),
)

if (consoleErrors.length) {
  console.log(`\n控制台错误 ${consoleErrors.length} 条：`)
  for (const e of consoleErrors.slice(0, 5)) console.log('  ! ' + e.slice(0, 200))
}

if (problems.length) {
  console.error('\n验收未通过：')
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}

console.log('\n验收通过：两态清晰 / 花朵不溢出 / 无堆叠过曝 / 可散满整屏 / 循环完整')
