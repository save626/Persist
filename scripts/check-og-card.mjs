// 校验社交分享卡的「版式硬约束」——不靠肉眼。
//
// 为什么需要它：微信把 og:image 裁成中心 630×630（x ∈ [285, 915]，纵向整高）。
// 只要品牌 / 标题 / 副标题 / 徽标 / 页脚有任何一个越出这一列，方图里就会被切掉，
// 而这件事在 1200×630 的整卡预览上**完全看不出来**。所以必须用几何量值断言。
//
// 用法：
//   node scripts/check-og-card.mjs                    # 校验四个变体 + 四张 1:1 取景稿
//   node scripts/check-og-card.mjs --variant a        # 只校验变体 A
//
// 校验项（任一不通过 → 退出码 1）：
//   · 舞台必须是 1200×630，文档不产生滚动（整卡零滚动是截图前提）
//   · 信息节点全部落在安全区内（整卡 285..915；取景稿 0..630）
//   · 标题不横向溢出（CJK 字宽 = 1em，58px × 10 字正好卡在 630 列内）
//   · 取景稿必须是 630×630，且四张变体 PNG 都已落盘
//   · 字体栈已加载（document.fonts.status === 'loaded'）
//
// 只读：不写任何文件。
//
// 依赖 app/node_modules/playwright-core（会起无头 Chromium）；沙箱里会被拦
// （spawn EPERM），需要一次性放宽权限，与另三套验收脚本相同。

import { chromium } from '../app/node_modules/playwright-core/index.mjs'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'landing', 'og', 'og-card.html')
const PREVIEW = join(ROOT, 'landing', 'og', 'preview')

const CARD_W = 1200
const CARD_H = 630
const SAFE_L = 285
const SAFE_R = 915

const args = process.argv.slice(2)
const only = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : undefined
const VARIANTS = ['a', 'b'].filter((v) => !only || v === only)
const THEMES = ['light', 'dark']

const errors = []
const err = (m) => errors.push(m)

const fileUrl = (query) =>
  `file:///${SOURCE.replace(/\\/g, '/').replace(/^\//, '')}?${query}`

const browser = await chromium.launch({ headless: true })

try {
  for (const variant of VARIANTS) {
    for (const theme of THEMES) {
      // ——— 整卡（1200×630） ———
      const page = await browser.newPage({ viewport: { width: CARD_W, height: CARD_H }, deviceScaleFactor: 1 })
      await page.goto(fileUrl(`v=${variant}&theme=${theme}&selfcheck=1`), { waitUntil: 'load' })
      const raw = await page.$eval('#selfcheck', (el) => el.textContent)
      await page.close()
      const r = JSON.parse(raw)
      const tag = `${variant}-${theme}`

      if (r.stage.w !== CARD_W || r.stage.h !== CARD_H) {
        err(`${tag}：舞台 ${r.stage.w}×${r.stage.h}，应为 ${CARD_W}×${CARD_H}`)
      }
      if (r.docScroll.w > CARD_W || r.docScroll.h > CARD_H) {
        err(`${tag}：文档出现滚动 ${r.docScroll.w}×${r.docScroll.h}（截图会被截断）`)
      }
      if (r.fonts !== 'loaded') err(`${tag}：字体未加载（document.fonts.status=${r.fonts}）`)
      if (r.h1OverflowX > 0) err(`${tag}：标题横向溢出 ${r.h1OverflowX}px`)

      const bad = Object.entries(r.items).filter(([, o]) => o.x < SAFE_L || o.r > SAFE_R)
      for (const [node, o] of bad) {
        err(`${tag}：${node} 越出微信安全区（x=${o.x}, right=${o.r}，允许 ${SAFE_L}..${SAFE_R}）`)
      }
      console.log(
        `✓ ${tag}  舞台 ${r.stage.w}×${r.stage.h} · 字体 ${r.fonts} · 标题 ${r.h1Lines} 行 / 溢出 ${r.h1OverflowX}px · 安全区越界 ${bad.length}`,
      )

      // ——— 1:1 取景稿（630×630） ———
      const cropPage = await browser.newPage({ viewport: { width: CARD_H, height: CARD_H }, deviceScaleFactor: 1 })
      await cropPage.goto(fileUrl(`v=${variant}&theme=${theme}&crop=1&selfcheck=1`), { waitUntil: 'load' })
      const cropRaw = await cropPage.$eval('#selfcheck', (el) => el.textContent)
      await cropPage.close()
      const c = JSON.parse(cropRaw)
      const cropBad = Object.entries(c.items).filter(([, o]) => o.x < 0 || o.r > CARD_H)
      if (!c.crop) err(`${tag}-crop：?crop=1 未生效`)
      for (const [node, o] of cropBad) {
        err(`${tag}-crop：${node} 被取景框切掉（x=${o.x}, right=${o.r}，允许 0..${CARD_H}）`)
      }
      console.log(`✓ ${tag}-crop  630×630 取景 · 被切信息节点 ${cropBad.length}`)
    }
  }
} finally {
  await browser.close()
}

// ——— 产物落盘 ———
const expected = VARIANTS.flatMap((v) =>
  THEMES.flatMap((t) => [`${v}-${t}.png`, `${v}-${t}-crop.png`]).map((n) => join(PREVIEW, n)),
)
for (const f of expected) {
  if (!existsSync(f)) {
    err(`缺少渲染稿 ${f.replace(ROOT + '\\', '')}——先跑 node scripts/render-og-card.mjs --crop`)
    continue
  }
  const size = statSync(f).size
  if (size < 20_000) err(`${f.replace(ROOT + '\\', '')} 只有 ${size} B，疑似空图`)
}

console.log('')
if (errors.length) {
  for (const e of errors) console.log(`✗ ${e}`)
  console.log(`\n结果：不通过（${errors.length} 个错误）`)
  process.exit(1)
}
console.log('结果：通过（版式与微信 1:1 安全区均达标）')
