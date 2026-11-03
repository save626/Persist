import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: '快速记录', exact: true }).first().click()

const result = await page.evaluate(() => {
  const heading = document.querySelector('#quickTitle')
  const chain = []
  let node = heading

  while (node && chain.length < 6) {
    const style = getComputedStyle(node)
    chain.push({
      tag: node.tagName,
      cls: node.className,
      position: style.position,
      zIndex: style.zIndex,
      opacity: style.opacity,
      display: style.display,
      pointerEvents: style.pointerEvents,
      html: node.outerHTML.slice(0, 350),
    })
    node = node.parentElement
  }

  const rules = [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules]
        .filter((rule) => rule.selectorText?.includes('backdrop'))
        .map((rule) => rule.cssText)
    } catch {
      return []
    }
  })

  return { chain, rules }
})

console.log(JSON.stringify(result, null, 2))
await browser.close()
