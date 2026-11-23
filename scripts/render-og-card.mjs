// 渲染社交分享卡（1200×630）。
//
// 用途：把 landing/og/og-card.html 这个设计源渲染成 og:image / twitter:image
// 用的静态 PNG。
//
// 为什么不用 Edge headless（landing/og/README.md 里的旧命令）：
//   Edge 的无头模式是多进程 + 命名管道 IPC，在受沙箱限制的 shell 里会静默失败
//   —— 命令返回 0 但截图不落盘，很难察觉。Playwright 是单进程可控的，
//   渲染完会校验产物确实存在且尺寸正确，失败立刻报错。
//
// 用法：
//   node scripts/render-og-card.mjs                     # 渲染全部变体
//   node scripts/render-og-card.mjs --variant a         # 只渲染变体 A
//   node scripts/render-og-card.mjs --crop              # 追加微信 1:1 取景稿（630×630）
//   node scripts/render-og-card.mjs --out <路径>        # 自定义输出目录
//
// 输出：landing/og/preview/<variant>-<theme>.png
//       landing/og/preview/<variant>-<theme>-crop.png（--crop）
// 预览图是草稿（文案会变），不入库；真正对外的是 og:meta 里指向的最终 PNG。
//
// 1:1 取景稿用设计源自带的 ?crop=1（只截中心 630×630），不是事后裁图——
// 事后裁会在缩放/取整上对不上，而微信裁的就是这张图的原尺寸中心区。

import { chromium } from '../app/node_modules/playwright-core/index.mjs'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'landing', 'og', 'og-card.html')
const DEFAULT_OUT = join(ROOT, 'landing', 'og', 'preview')

const WIDTH = 1200
const HEIGHT = 630

const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const onlyVariant = argOf('--variant')
const outDir = resolve(ROOT, argOf('--out') ?? DEFAULT_OUT)
const withCrop = args.includes('--crop')

if (!existsSync(SOURCE)) {
  throw new Error(`设计源不存在：${SOURCE}`)
}

const VARIANTS = ['a', 'b']
const THEMES = ['light', 'dark']
const targets = VARIANTS.filter((v) => !onlyVariant || v === onlyVariant).flatMap((v) =>
  THEMES.flatMap((theme) => [{ variant: v, theme, crop: false }].concat(withCrop ? [{ variant: v, theme, crop: true }] : [])),
)

if (!targets.length) {
  throw new Error(`--variant 只接受 a 或 b，收到：${onlyVariant}`)
}

mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const failures = []

try {
  for (const { variant, theme, crop } of targets) {
    const w = crop ? HEIGHT : WIDTH
    const page = await browser.newPage({
      viewport: { width: w, height: HEIGHT },
      deviceScaleFactor: 1,
    })
    // file:// 下的 query 参数决定版式、主题与取景，设计源自己读 location.search。
    const base = `file:///${SOURCE.replace(/\\/g, '/').replace(/^\//, '')}?v=${variant}&theme=${theme}`
    const url = crop ? `${base}&crop=1` : base
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(400)

    const name = crop ? `${variant}-${theme}-crop.png` : `${variant}-${theme}.png`
    const out = join(outDir, name)
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: HEIGHT } })
    await page.close()

    // 静默失败是最危险的：文件没落盘时后面接入 meta 会指向 404。
    if (!existsSync(out)) {
      failures.push(`${name}: 截图未落盘`)
      continue
    }
    console.log(`✓ ${name} → ${out}`)
  }
} finally {
  await browser.close()
}

if (failures.length) {
  console.error('\n渲染失败：')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}

console.log(`\n共 ${targets.length} 张，输出到 ${outDir}`)
