// 抓一张「花瓣完全聚拢」的静帧，用来和 bloom 的参考图对比
import { chromium } from '../../app/node_modules/playwright-core/index.mjs'
import { startServer } from '../serve.mjs'

const server = await startServer({ port: 0, quiet: true })
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await page.goto(server.url, { waitUntil: 'load' })
await page.waitForFunction(() => window.__fusion && window.__fusion.ready)
// 捏合手势 → 完整花瓣（disperse 0）
await page.evaluate(() => window.__fusion.inject({ active: true, hands: 2, palm: 0, fist: 1, pinch: 0, spread: 0, fingers: 0 }))
await page.waitForTimeout(2500)
const m = await page.evaluate(() => window.__fusion.measure())
await page.screenshot({ path: 'preview/flower-gathered.png' })
console.log('花瓣聚拢态：亮像素', (m.litRatio * 100).toFixed(2) + '%', '平均亮度', m.meanLum.toFixed(1))
await browser.close()
await server.close()
