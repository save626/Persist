/**
 * 渲染验收（裁剪后：只有「花瓣」与「圣诞树」两个场景）
 *
 * 检查项：
 *   1. 场景列表恰好两个，且顺序为 flower → lights
 *   2. 两个场景都能出图（亮像素 > 0.4%），截图不空白
 *   3. 颜色选择器生效：改色后"绿色相对红色"明显更占优
 *   4. 全屏按钮存在、颜色输入框存在
 *   5. 双手张合：张开应明显比捏合更"散"
 *   6. 控制台零渲染报错
 *   7. 旧场景文件确已删除（防止死代码回流）
 *
 * 用法：node scripts/shoot.mjs
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '../../app/node_modules/playwright-core/index.mjs'
import { startServer } from '../serve.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const OUT = join(ROOT, 'preview')
mkdirSync(OUT, { recursive: true })

const REMOVED = ['forms.js', 'tree.js', 'cosmos.js', 'solar.js', 'iron.js', 'multi.js']

const server = await startServer({ port: 0, quiet: true })
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(server.url, { waitUntil: 'load', timeout: 30000 })
await page.waitForFunction(() => window.__fusion && window.__fusion.ready, null, { timeout: 20000 })

const scenes = await page.evaluate(() => window.__fusion.scenes)
console.log('场景：', scenes.join(', '))

const rows = []
for (const id of scenes) {
  await page.evaluate((sid) => window.__fusion.loadScene(sid), id)
  await page.waitForTimeout(1500)
  const m = await page.evaluate(() => window.__fusion.measure())
  await page.screenshot({ path: join(OUT, `scene-${id}.png`) })
  rows.push({ id, ...m })
  console.log(`  ${id.padEnd(8)} 亮像素 ${(m.litRatio * 100).toFixed(2)}%  平均亮度 ${m.meanLum.toFixed(1)}`)
}

// 颜色选择器
await page.evaluate(() => window.__fusion.loadScene('lights'))
await page.waitForTimeout(600)
const beforeColor = await page.evaluate(() => window.__fusion.measure())
await page.evaluate(() => window.__fusion.setColor('#00ff88'))
await page.waitForTimeout(600)
const afterColor = await page.evaluate(() => window.__fusion.measure())
await page.screenshot({ path: join(OUT, 'lights-tinted.png') })
const beforeGain = beforeColor.avgRGB.g - beforeColor.avgRGB.r
const afterGain = afterColor.avgRGB.g - afterColor.avgRGB.r
console.log(`颜色选择器：绿−红 ${beforeGain.toFixed(1)} → ${afterGain.toFixed(1)}`)
await page.evaluate(() => window.__fusion.setColor('#ffffff'))

// 全屏 / 颜色控件存在性
const controls = await page.evaluate(() => ({
  fullscreen: !!document.querySelector('#btn-fullscreen'),
  fullscreenText: document.querySelector('#btn-fullscreen')?.textContent?.trim() || '',
  color: !!document.querySelector('#color'),
  colorType: document.querySelector('#color')?.type,
  formNav: !!document.querySelector('#form-nav'),
}))
console.log('控件：', JSON.stringify(controls))

// 双手张合（花瓣场景）
await page.evaluate(() => window.__fusion.loadScene('flower'))
await page.waitForTimeout(500)
await page.evaluate(() => window.__fusion.inject({ active: true, hands: 2, palm: 1, fist: 0, pinch: 0, spread: 1, fingers: 5 }))
await page.waitForTimeout(1600)
const openHand = await page.evaluate(() => window.__fusion.measure())
await page.screenshot({ path: join(OUT, 'flower-hand-open.png') })
await page.evaluate(() => window.__fusion.inject({ active: true, hands: 2, palm: 0, fist: 1, pinch: 0.1, spread: 0, fingers: 0 }))
await page.waitForTimeout(1600)
const closedHand = await page.evaluate(() => window.__fusion.measure())
await page.screenshot({ path: join(OUT, 'flower-hand-closed.png') })

// 两指捏合（拇指+食指，其余三指伸开）：palm 仍高、pinch 很高。
// 2026-11-24 真机反馈的正是这一种 —— 以前场景只吃 palm，这种姿势花不收。
await page.evaluate(() => window.__fusion.inject({ active: true, hands: 1, palm: 0.72, fist: 0.28, pinch: 0.92, spread: 0, fingers: 3 }))
await page.waitForTimeout(1600)
const pinchHand = await page.evaluate(() => window.__fusion.measure())
await page.screenshot({ path: join(OUT, 'flower-hand-pinch.png') })

console.log(
  `双手张合（花瓣）：张开 亮像素 ${(openHand.litRatio * 100).toFixed(2)}% / 捏合 ${(closedHand.litRatio * 100).toFixed(2)}% / 两指捏合 ${(pinchHand.litRatio * 100).toFixed(2)}%`,
)

// 流星雨 / 星轨（只在花瓣场景）
await page.evaluate(() => window.__fusion.loadScene('flower'))
await page.waitForTimeout(1400)
const meteorInfo = await page.evaluate(() => {
  const body = document.body.classList.contains('has-meteors')
  const mc = document.querySelector('#meteors')
  if (!mc) return { body, exists: false }
  const data = mc.getContext('2d').getImageData(0, 0, mc.width, mc.height).data
  let lit = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) lit++
  return { body, exists: true, ratio: lit / (mc.width * mc.height), w: mc.width, h: mc.height }
})
await page.screenshot({ path: join(OUT, 'flower-meteors.png') })
console.log(`流星雨层：${JSON.stringify(meteorInfo)}`)

// 圣诞树：无手势时应能满屏散开（采样一个周期内的最大包围盒）
await page.evaluate(() => window.__fusion.inject(null))
await page.evaluate(() => window.__fusion.loadScene('lights'))
await page.waitForTimeout(1200)
let treeMaxExtent = 0
let treeMinExtent = 1
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(900)
  const m = await page.evaluate(() => window.__fusion.measure())
  const bbox = m.bbox || { minX: 0, maxX: 0 }
  const ext = bbox.maxX - bbox.minX
  treeMaxExtent = Math.max(treeMaxExtent, ext)
  treeMinExtent = Math.min(treeMinExtent, ext)
}
await page.screenshot({ path: join(OUT, 'lights-auto.png') })
console.log(`圣诞树自动循环：横向包围盒 ${(treeMinExtent * 100).toFixed(1)}% → ${(treeMaxExtent * 100).toFixed(1)}%`)

await browser.close()
await server.close()

const problems = []
if (scenes.length !== 2) problems.push(`场景应只剩 2 个，实际 ${scenes.length}：${scenes.join(',')}`)
if (scenes[0] !== 'flower' || scenes[1] !== 'lights') problems.push(`场景顺序应为 flower, lights：${scenes.join(',')}`)
for (const r of rows) {
  if (!(r.litRatio > 0.004)) problems.push(`${r.id} 几乎全黑（${(r.litRatio * 100).toFixed(2)}%）`)
  if (statSync(join(OUT, `scene-${r.id}.png`)).size < 8000) problems.push(`scene-${r.id}.png 疑似空白`)
}
if (!(afterGain > beforeGain + 8)) problems.push(`颜色选择器疑似失效：绿−红 ${beforeGain.toFixed(1)} → ${afterGain.toFixed(1)}`)
if (!controls.fullscreen || !controls.fullscreenText) problems.push('全屏按钮异常')
if (!controls.color || controls.colorType !== 'color') problems.push('颜色选择器缺失')
if (controls.formNav) problems.push('形态子导航应已移除，但 #form-nav 仍存在')
for (const f of REMOVED) {
  if (existsSync(join(ROOT, 'src', 'scenes', f))) problems.push(`已删除的场景文件仍在：${f}`)
}
if (!(openHand.litRatio > closedHand.litRatio * 1.15)) {
  problems.push(`双手张合幅度异常：张开 ${(openHand.litRatio * 100).toFixed(2)}% vs 捏合 ${(closedHand.litRatio * 100).toFixed(2)}%`)
}
// 两指捏合也必须是「收拢」：以前只吃 palm，这种姿势等于没收（花的亮像素和张开一样）
if (!(pinchHand.litRatio < openHand.litRatio * 0.75)) {
  problems.push(
    `两指捏合没有收拢：捏合 ${(pinchHand.litRatio * 100).toFixed(2)}% vs 张开 ${(openHand.litRatio * 100).toFixed(2)}%` +
    `（场景应该用 closingOf(g) = max(fist, pinch)，不能只看 palm）`,
  )
}
if (!meteorInfo.exists || !meteorInfo.body) problems.push('花瓣场景没有启用流星雨层（#meteors 或 has-meteors 缺失）')
else if (!(meteorInfo.ratio > 0.002)) problems.push(`流星雨层几乎没有像素（${(meteorInfo.ratio * 100).toFixed(3)}%）`)
if (!(treeMaxExtent > 0.8)) problems.push(`圣诞树无手势时没有满屏散开（最大横向 ${(treeMaxExtent * 100).toFixed(1)}%）`)
if (!(treeMaxExtent - treeMinExtent > 0.2)) problems.push(`圣诞树自动循环幅度太小（${(treeMinExtent * 100).toFixed(1)}% → ${(treeMaxExtent * 100).toFixed(1)}%）`)
const bad = errors.filter((e) => /shader|webgl|glsl|three|Uncaught|failed to fetch|import/i.test(e))
if (bad.length) problems.push(`运行报错：${bad.slice(0, 3).join(' | ')}`)

writeFileSync(
  join(OUT, 'fusion-report.json'),
  JSON.stringify({ at: new Date().toISOString(), scenes, rows, controls, color: { beforeGain, afterGain }, openHand, closedHand, pinchHand, errors }, null, 2),
)

if (problems.length) {
  console.error('\n验收未通过：')
  for (const p of problems) console.error('  ✗ ' + p)
  if (errors.length) {
    console.error('\n控制台（前 8 条）：')
    for (const e of errors.slice(0, 8)) console.error('  ! ' + e.slice(0, 240))
  }
  process.exit(1)
}

console.log('\n验收通过：只剩两个场景、均能出图、颜色选择器与全屏可用、双手张合正常、零运行报错')
