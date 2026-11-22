// 重拍落地页开场动画的证据图（对齐仓库根 preview/ 与 landing/preview/ 两处）。
// 时间线：深色字符画眼睛(近黑底 #010203，产品灰蓝家族三色：瞳孔深墨蓝/虹膜产品蓝/巩膜浅灰蓝，居中)
// → 4.6s 起服务器部署版流星雨(3000档原画质星空底图零裁剪零黑边完整显示 + Canvas 2D 星轨/流星翻倍寿命延长，去 Hello World)
// 逐渐淡入 → 7.8s 完全接管等点击 → 落地页。
import fs from 'node:fs'
import { join } from 'node:path'
import { chromium } from '../app/node_modules/playwright-core/index.mjs'

const FILE = 'file:///D:/Persist/landing/index.html'
const SHOTS = [
  { name: 'intro-1-eye-drawn.png', at: 2600, note: '近黑底上，产品灰蓝三色眼睛（瞳孔深墨蓝/虹膜产品蓝/巩膜浅灰蓝），居中' },
  { name: 'intro-2-gaze.png', at: 5200, note: '眨眼后，瞳孔推进开始（视线锁定居中）' },
  { name: 'intro-3-push-pupil.png', at: 7000, note: '瞳孔推进中，星空与粒子开始进入' },
  { name: 'intro-4-meteor-fullscreen.png', at: 8800, note: '3000档星空底图零裁剪零黑边完整显示 + 翻倍流星(40颗/寿命延长)铺满视口' },
  { name: 'intro-5-waiting-click.png', at: 10200, note: '停在流星雨界面不再变化，显示「点击任意位置进入」' },
]
const LANDSCAPE_SHOT = { name: 'intro-6-handoff-landing.png', note: '点击交棒后的落地页' }

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })

function save(name, buf) {
  for (const dir of ['D:/Persist/preview', 'D:/Persist/landing/preview']) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(join(dir, name), buf)
  }
}

await page.goto(FILE + '?intro=1', { waitUntil: 'load' })
for (const s of SHOTS) {
  await page.waitForFunction((t) => performance.now() >= t, s.at, { polling: 16 })
  save(s.name, await page.screenshot())
  console.log('shot', s.name, '·', s.note)
}
// 交棒：点击任意位置后才进落地页
await page.mouse.click(720, 300)
await page.waitForTimeout(2200)
save(LANDSCAPE_SHOT.name, await page.screenshot())
console.log('shot', LANDSCAPE_SHOT.name, '·', LANDSCAPE_SHOT.note)

const st = await page.evaluate(() => window.__persistIntroState ? window.__persistIntroState() : null)
console.log('state:', JSON.stringify(st))
console.log('errors:', errs.length ? errs : 'none')
await browser.close()
