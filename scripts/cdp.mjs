// 真机 WebView 调试助手：通过 Chrome DevTools Protocol 在页面里求值 / 点击 / 截图。
// 用法：
//   node scripts/cdp.mjs eval '<js 表达式>'      # 返回 JSON
//   node scripts/cdp.mjs text                     # 打印页面可见文本
//   node scripts/cdp.mjs shot <输出路径.png>
//   node scripts/cdp.mjs goto <url>
import { chromium } from '../app/node_modules/playwright-core/index.mjs'

const ENDPOINT = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222'
const [, , cmd, ...rest] = process.argv

const browser = await chromium.connectOverCDP(ENDPOINT)
const contexts = browser.contexts()
const pages = contexts.flatMap((c) => c.pages())
if (!pages.length) throw new Error('没有可用的页面，确认 adb forward 与 WebView 已启动')
const page = pages[0]

try {
  if (cmd === 'eval') {
    const expr = rest.join(' ')
    const value = await page.evaluate(expr)
    console.log(JSON.stringify(value, null, 2))
  } else if (cmd === 'text') {
    const text = await page.evaluate(() => document.body.innerText)
    console.log(text)
  } else if (cmd === 'shot') {
    await page.screenshot({ path: rest[0] ?? 'shot.png' })
    console.log('saved', rest[0] ?? 'shot.png')
  } else if (cmd === 'goto') {
    await page.goto(rest[0], { waitUntil: 'networkidle' })
    console.log('at', page.url())
  } else {
    console.log('用法: node scripts/cdp.mjs <eval|text|shot|goto> ...')
  }
} finally {
  // connectOverCDP 只断开连接，不关闭真机上的页面
  await browser.close()
}
