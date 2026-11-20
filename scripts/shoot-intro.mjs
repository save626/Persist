// 重拍落地页开场动画的 6 张证据图（对齐仓库根 preview/ 与 landing/preview/ 两处）
import fs from 'node:fs'
import { join } from 'node:path'
import { chromium } from '../app/node_modules/playwright-core/index.mjs'

const FILE = 'file:///D:/Persist/landing/index.html'
const SHOTS = [
  { name: 'intro-1-eye-drawn.png', at: 2600, note: '眼睑睁开，琥珀虹膜与瞳孔露出' },
  { name: 'intro-2-gaze.png', at: 4400, note: '眨眼后，视线游移' },
  { name: 'intro-3-push-pupil.png', at: 6000, note: '镜头向瞳孔推进' },
  { name: 'intro-4-fly-through-stars.png', at: 7200, note: '瞳孔铺满，切到星空' },
  { name: 'intro-5-starfield.png', at: 8200, note: '星场，接近交棒' },
  { name: 'intro-6-handoff-landing.png', at: 11500, note: '交棒后的落地页' },
]

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })

await page.goto(FILE + '?intro=1', { waitUntil: 'load' })
for (const s of SHOTS) {
  await page.waitForFunction((t) => performance.now() >= t, s.at, { polling: 16 })
  const buf = await page.screenshot()
  for (const dir of ['D:/Persist/preview', 'D:/Persist/landing/preview']) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(join(dir, s.name), buf)
  }
  console.log('shot', s.name, '·', s.note)
}
const st = await page.evaluate(() => window.__persistIntroState ? window.__persistIntroState() : null)
console.log('state:', JSON.stringify(st))
console.log('errors:', errs.length ? errs : 'none')
await browser.close()
