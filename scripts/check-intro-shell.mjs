/**
 * 开场「融合界面壳」验收（桌面端）
 *
 * 覆盖本轮需求：
 *   1. 眼睛 → 瞳孔推进 → 花瓣融合界面（粒子层 + 界面壳）
 *   2. 两个场景都支持手势聚合（用手势快照注入验证 wiring，不依赖真实摄像头）
 *   3. 两个场景都有切换按钮，可来回切
 *   4. 点任意空白处 → 落地页；点按钮不触发
 *   5. 全屏按钮存在且能进入全屏
 *   6. 没有颜色选择器
 *
 * 用法：node scripts/check-intro-shell.mjs   （需要 4173 静态服务在跑）
 */
import fs from 'node:fs'
import { chromium } from '../app/node_modules/playwright-core/index.mjs'

const URL = process.env.INTRO_URL || 'http://127.0.0.1:4173/landing/index.html'
const OUT = 'preview'

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
const state = () => page.evaluate(() => window.__persistIntroState?.() ?? null)
async function waitIntro(sec) {
  await page.waitForFunction(
    (t) => {
      const s = window.__persistIntroState?.()
      return Boolean(s && s.elapsed >= t)
    },
    sec,
    { timeout: 90000, polling: 100 },
  )
}

// —— 1) 到 7.9s：界面壳应该已经淡入 ——
await waitIntro(7.9)
// headless 主线程被三个动画循环占满时，setTimeout 会晚几百毫秒才加 is-ui；
// 这里等到淡入真正跑完（opacity > 0.9）再采样，避免采到过渡第一帧。
await page.waitForFunction(
  () => {
    const el = document.querySelector('#introActions')
    return Boolean(el) && Number(getComputedStyle(el).opacity) > 0.9
  },
  null,
  { timeout: 30000, polling: 100 },
)
const shell = await page.evaluate(() => {
  const q = (s) => document.querySelector(s)
  const acts = [...document.querySelectorAll('#introActions .intro-act')].map((b) => b.textContent.trim())
  return {
    elapsed: +window.__persistIntroState().elapsed.toFixed(2),
    sceneId: window.__persistIntroState().sceneId,
    uiVisible: window.__persistIntroState().uiVisible,
    actions: acts,
    hasSceneFlower: !!q('[data-scene="flower"]'),
    hasSceneLights: !!q('[data-scene="lights"]'),
    hasHands: !!q('#introHands'),
    hasFullscreen: !!q('#introFullscreen'),
    hasColorPicker: !!q('input[type="color"]'),
    uiClass: q('#intro').classList.contains('is-ui'),
    actionsVisible: Number(getComputedStyle(q('#introActions')).opacity),
  }
})
await page.screenshot({ path: `${OUT}/intro-shell-1-flower.png` })

// —— 2) 切到圣诞树 ——
await page.click('[data-scene="lights"]')
await page.waitForTimeout(1200)
const tree = await page.evaluate(() => {
  const st = window.__persistIntroState()
  return { sceneId: st.sceneId, activeLabel: document.querySelector('[data-scene="lights"]').className }
})
await page.screenshot({ path: `${OUT}/intro-shell-2-tree.png` })

// —— 3) 切回花瓣 ——
await page.click('[data-scene="flower"]')
await page.waitForTimeout(1000)
const back = await page.evaluate(() => window.__persistIntroState().sceneId)

// —— 4) 全屏按钮 ——
const fsBefore = await page.evaluate(() => !!document.fullscreenElement)
await page.click('#introFullscreen')
await page.waitForTimeout(700)
const fsAfter = await page.evaluate(() => !!document.fullscreenElement)
await page.screenshot({ path: `${OUT}/intro-shell-3-fullscreen.png` })
if (fsAfter) {
  await page.evaluate(() => document.exitFullscreen?.())
  await page.waitForTimeout(400)
}

// —— 5) 手势 wiring：注入快照，看花瓣是否"张手散开 / 握拳聚合" ——
await page.evaluate(() => {
  window.__introSetGestures({ active: true, hands: 2, palm: 1, fist: 0, pinch: 0, spread: 1, fingers: 5 })
})
await page.waitForTimeout(1600)
const openLit = await page.evaluate(() => window.__persistIntroState().particleMeasure)
await page.evaluate(() => {
  window.__introSetGestures({ active: true, hands: 2, palm: 0, fist: 1, pinch: 0.1, spread: 0, fingers: 0 })
})
await page.waitForTimeout(1600)
const closedLit = await page.evaluate(() => window.__persistIntroState().particleMeasure)
await page.evaluate(() => window.__introSetGestures(null))
await page.screenshot({ path: `${OUT}/intro-shell-4-gesture.png` })

// —— 6) 点按钮不应进落地页；点空白处才进 ——
await page.click('[data-scene="flower"]')
await page.waitForTimeout(500)
const stillIntro = await page.evaluate(() => !document.querySelector('#intro').hidden)
await page.mouse.click(240, 220)
await page.waitForTimeout(900)
const after = await page.evaluate(() => ({
  hidden: document.querySelector('#intro').hasAttribute('hidden'),
  text: (document.body.innerText || '').slice(0, 30),
}))
await page.screenshot({ path: `${OUT}/intro-shell-5-handoff.png` })

await browser.close()

const problems = []
if (!shell.uiVisible) problems.push('7.9s 时界面壳没有淡入（uiVisible=false）')
if (!shell.hasSceneFlower || !shell.hasSceneLights) problems.push(`场景切换按钮缺失（${shell.actions.join('/')}）`)
if (!shell.hasHands) problems.push('缺少「开启手势」按钮')
if (!shell.hasFullscreen) problems.push('缺少「全屏」按钮')
if (shell.hasColorPicker) problems.push('出现了颜色选择器（本轮明确不要）')
if (!(shell.actionsVisible > 0.9)) problems.push(`界面壳不透明度只有 ${shell.actionsVisible}`)
if (tree.sceneId !== 'lights') problems.push(`点击圣诞树后 sceneId=${tree.sceneId}`)
if (back !== 'flower') problems.push(`切回花瓣后 sceneId=${back}`)
if (!fsBefore && !fsAfter) problems.push('全屏按钮点击后没有进入全屏')
const openRatio = openLit?.litRatio ?? 0
const closedRatio = closedLit?.litRatio ?? 0
if (!(openRatio > closedRatio * 1.15)) {
  problems.push(`手势→粒子没有生效：张手 ${(openRatio * 100).toFixed(2)}% vs 握拳 ${(closedRatio * 100).toFixed(2)}%`)
}
if (!stillIntro) problems.push('点击场景按钮把开场关掉了（按钮没有 stopPropagation）')
if (!after.hidden) problems.push('点击空白处没有进入落地页')
if (!/Persist|把每天|碎片/.test(after.text)) problems.push(`落地页文案不可见（${after.text}）`)

const bad = errors.filter((e) => /Uncaught|TypeError|ReferenceError|WebGL|shader/i.test(e))
if (bad.length) problems.push(`运行报错：${bad.slice(0, 3).join(' | ')}`)

fs.writeFileSync(
  `${OUT}/intro-shell-report.json`,
  JSON.stringify({ shell, tree, back, fsBefore, fsAfter, openLit, closedLit, stillIntro, after, errors }, null, 2),
)

console.log('界面壳 :', JSON.stringify(shell))
console.log('切换   :', `lights=${tree.sceneId} → flower=${back}`)
console.log('全屏   :', `${fsBefore} → ${fsAfter}`)
console.log('手势   :', `张手 ${(openRatio * 100).toFixed(2)}% / 握拳 ${(closedRatio * 100).toFixed(2)}%`)
console.log('交棒   :', JSON.stringify(after))

if (problems.length) {
  console.error('\n验收未通过：')
  for (const p of problems) console.error('  ✗ ' + p)
  if (errors.length) for (const e of errors.slice(0, 6)) console.error('  ! ' + e.slice(0, 200))
  process.exit(1)
}
console.log('\n开场融合壳验收通过：两场景 + 切换 + 全屏 + 手势 + 点击交棒')
