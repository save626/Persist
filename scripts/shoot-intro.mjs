// 重拍落地页开场动画的证据图（对齐仓库根 preview/ 与 landing/preview/ 两处）。
// 时间线：字符画眼睛(0-6.9s) → 满屏 3D 粒子流星雨(6.9-8.5s) → 等点击 → 落地页。
import fs from 'node:fs'
import { join } from 'node:path'
import { chromium } from '../app/node_modules/playwright-core/index.mjs'

const FILE = 'file:///D:/Persist/landing/index.html'
const SHOTS = [
  { name: 'intro-1-eye-drawn.png', at: 2600, note: '眼睑睁开，灰蓝字符画虹膜与瞳孔露出' },
  { name: 'intro-2-gaze.png', at: 4400, note: '眨眼后，视线游移' },
  { name: 'intro-3-push-pupil.png', at: 6000, note: '镜头向瞳孔推进' },
  { name: 'intro-4-meteor-fullscreen.png', at: 7500, note: '满屏 3D 粒子流星雨（铺满整个视口）' },
  { name: 'intro-5-waiting-click.png', at: 9300, note: '停在粒子层，显示「点击任意位置进入」' },
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
