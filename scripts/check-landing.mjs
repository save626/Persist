// 落地页验收（landing/index.html）。
//
// 为什么需要它：落地页是「陌生人看到的第一屏」，视觉与文案一旦被改坏，
// 页面**不会报错**——只是变得看不懂、点不动。这个脚本把「3 秒能不能看懂」
// 变成可复现的断言：
//   · 6 个视口下不出现横向滚动，标题与主 CTA 落在首屏内
//   · 首屏文字真的可见（入场动画跑完后 opacity = 1）
//   · 关掉 JS 时内容完整可读（渐进增强的硬要求）
//   · prefers-reduced-motion 下出静态终帧，不空屏
//   · 3D 粒子流星雨真的在跑（粒子数 > 0、帧数递增）
//   · 关键色对对比度达标（正文 4.5 / 图形 3.0）
//
// 用法：
//   node scripts/check-landing.mjs              # 只跑断言
//   node scripts/check-landing.mjs --shots      # 额外重拍 landing/preview/*.png
//
// 退出码：0 = 通过；1 = 有失败项。

import { chromium } from '../app/node_modules/playwright-core/index.mjs'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = join(ROOT, 'landing', 'index.html')
const SHOTS = join(ROOT, 'landing', 'preview')
const WANT_SHOTS = process.argv.includes('--shots')

const VIEWPORTS = [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-360', width: 360, height: 800 },
]

const fileUrl = `file:///${PAGE.replace(/\\/g, '/').replace(/^\//, '')}`

/* ---------- 对比度 ---------- */
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}
function relLum([r, g, b]) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(a, b) {
  const l1 = relLum(hexToRgb(a))
  const l2 = relLum(hexToRgb(b))
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

const BG_DARK = '#05070C'   // 舞台最暗处
const BG_HERO = '#0B1220'   // 舞台中部（hero 文字所在）

const COLOR_PAIRS = [
  { label: '主标题 / 舞台底', fg: '#F2F7FC', bg: BG_HERO, min: 4.5 },
  { label: '副标题 / 舞台底', fg: '#C6D4E1', bg: BG_HERO, min: 4.5 },
  { label: '弱化文字 / 舞台底', fg: '#93A6B8', bg: BG_HERO, min: 4.5 },
  { label: 'eyebrow / 舞台底', fg: '#8AD0F5', bg: BG_HERO, min: 4.5 },
  { label: '主按钮文字 / 主按钮底', fg: '#04121C', bg: '#8AD0F5', min: 4.5 },
  { label: '次按钮文字 / 舞台底', fg: '#F2F7FC', bg: BG_HERO, min: 4.5 },
  { label: '页脚备案占位 / 舞台底', fg: '#A3B6C6', bg: BG_DARK, min: 4.5 },
  { label: '页脚备案占位 / 浅底', fg: '#A3B6C6', bg: BG_HERO, min: 4.5 },
]

const failures = []
const notes = []
function fail(where, msg) {
  failures.push(`${where}：${msg}`)
}

if (!existsSync(PAGE)) {
  console.error(`落地页不存在：${PAGE}`)
  process.exit(1)
}

const browser = await chromium.launch({ headless: true })

try {
  /* ---------- 1. 多视口布局 + 动画 + 粒子 ---------- */
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    })
    const page = await ctx.newPage()
    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))

    await page.goto(`${fileUrl}?selftest=1`, { waitUntil: 'load' })
    await page.waitForTimeout(3200)

    const data = await page.evaluate(() => {
      const el = document.getElementById('selftest')
      if (!el) return null
      try {
        return JSON.parse(el.textContent)
      } catch {
        return null
      }
    })
    if (!data) {
      fail(vp.name, '自检块没有产出（脚本可能抛错）')
      await ctx.close()
      continue
    }

    if (data.scrollWidth > data.clientWidth) {
      fail(vp.name, `出现横向滚动：scrollWidth ${data.scrollWidth} > clientWidth ${data.clientWidth}`)
    }
    if (!data.h1InViewport) {
      fail(vp.name, `标题不在首屏内（top ${data.h1Rect?.top} / bottom ${data.h1Rect?.bottom} / 视口 ${vp.height}）`)
    }
    if (!data.ctaInViewport) {
      fail(vp.name, `主 CTA 不在首屏内（top ${data.ctaRect?.top} / bottom ${data.ctaRect?.bottom}）`)
    }
    if (!data.staggerIn) fail(vp.name, '入场动画没有给所有元素加上 is-in')
    if (Number(data.staggerOpacity) < 0.99) {
      fail(vp.name, `入场后仍有元素不可见（opacity ${data.staggerOpacity}）`)
    }
    if (data.values !== 3) fail(vp.name, `底部价值条应为 3 条，实际 ${data.values}`)
    if (data.lastValueBottom !== null && data.footTop !== null) {
      if (data.lastValueBottom > data.footTop) {
        fail(vp.name, `价值条压到了固定页脚（底部 ${data.lastValueBottom} > 页脚顶部 ${data.footTop}）`)
      }
    }
    if (data.meteors < 1) fail(vp.name, `粒子数为 0（3D 流星雨没跑起来）`)
    if (data.frames < 10) fail(vp.name, `渲染帧数 ${data.frames} 太少，动画可能没推进`)
    if (consoleErrors.length) {
      fail(vp.name, `控制台报错：${consoleErrors.join(' | ')}`)
    }

    // 移动端粒子预算：窄屏不能和桌面一样密
    if (vp.width <= 390 && data.maxMeteors > 60) {
      fail(vp.name, `窄屏粒子预算过高：${data.maxMeteors}`)
    }

    notes.push(
      `${vp.name.padEnd(13)} 粒子 ${String(data.meteors).padStart(3)}/${data.maxMeteors} · 帧 ${String(data.frames).padStart(3)} · 横向 ${data.scrollWidth}/${data.clientWidth}`,
    )

    if (WANT_SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      const file = join(SHOTS, `landing-${vp.name}.png`)
      // 另开一次不带 selftest 的加载：自检块是绿色等宽字，不能混进证据图
      await page.goto(fileUrl, { waitUntil: 'load' })
      await page.waitForTimeout(2600)
      await page.screenshot({ path: file })
    }

    await ctx.close()
  }

  /* ---------- 2. 关掉 JS：内容必须完整可读 ---------- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      javaScriptEnabled: false,
    })
    const page = await ctx.newPage()
    await page.goto(fileUrl, { waitUntil: 'load' })
    const plain = await page.evaluate(() => {
      const h1 = document.querySelector('h1')
      const cta = document.querySelector('.cta')
      const note = document.querySelector('.note')
      const values = document.querySelectorAll('.value').length
      const foot = document.querySelector('.foot')
      const vis = (el) => {
        if (!el) return false
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.9 && r.height > 0
      }
      return {
        h1Text: h1 ? h1.textContent.trim() : '',
        h1Visible: vis(h1),
        ctaVisible: vis(cta),
        ctaLinks: cta ? cta.querySelectorAll('a').length : 0,
        noteVisible: vis(note),
        values,
        footVisible: vis(foot),
      }
    })
    if (!plain.h1Visible) fail('no-js', '关掉 JS 后标题不可见')
    if (!plain.ctaVisible || plain.ctaLinks < 2) fail('no-js', '关掉 JS 后主 CTA 不可用')
    if (!plain.noteVisible) fail('no-js', '关掉 JS 后说明文案不可见')
    if (plain.values !== 3) fail('no-js', `关掉 JS 后价值条数量为 ${plain.values}`)
    if (!plain.footVisible) fail('no-js', '关掉 JS 后备案信息不可见')
    if (!plain.h1Text.includes('把每天记下来')) fail('no-js', '关掉 JS 后标题文案缺失')
    await ctx.close()
  }

  /* ---------- 3. 减动效：出静态终帧，不空屏 ---------- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    })
    const page = await ctx.newPage()
    await page.goto(`${fileUrl}?selftest=1`, { waitUntil: 'load' })
    // 自检块在页面里延迟 2.6s 才写出，等够时间再读
    await page.waitForTimeout(3200)
    const data = await page.evaluate(() => {
      const el = document.getElementById('selftest')
      const canvas = document.getElementById('sky')
      let nonEmpty = false
      if (canvas) {
        const c = canvas.getContext('2d')
        const d = c.getImageData(0, 0, canvas.width, canvas.height).data
        for (let i = 3; i < d.length; i += 4 * 97) {
          if (d[i] > 0) {
            nonEmpty = true
            break
          }
        }
      }
      const first = document.querySelector('.stagger')
      return {
        still: el ? JSON.parse(el.textContent).still : null,
        reduce: el ? JSON.parse(el.textContent).reduce : null,
        opacity: first ? getComputedStyle(first).opacity : null,
        canvasNonEmpty: nonEmpty,
        meteors: el ? JSON.parse(el.textContent).meteors : 0,
      }
    })
    if (!data.reduce) fail('reduced-motion', '没有识别到 prefers-reduced-motion')
    if (!data.still) fail('reduced-motion', '减动效下没有进入静态终帧')
    if (Number(data.opacity) < 0.99) fail('reduced-motion', `减动效下文字不透明（${data.opacity}）`)
    if (!data.canvasNonEmpty) fail('reduced-motion', '减动效下画布是空的（首屏没有视觉）')
    notes.push(`reduced-motion 静态终帧：粒子 ${data.meteors} · 画布有内容 ${data.canvasNonEmpty}`)
    await ctx.close()
  }

  /* ---------- 4. 对比度 ---------- */
  for (const pair of COLOR_PAIRS) {
    const ratio = contrast(pair.fg, pair.bg)
    const ok = ratio >= pair.min
    notes.push(
      `${ok ? '✓' : '✗'} ${pair.label.padEnd(22)} ${ratio.toFixed(2)}:1（门槛 ${pair.min}）`,
    )
    if (!ok) fail('对比度', `${pair.label} 仅 ${ratio.toFixed(2)}:1，低于 ${pair.min}`)
  }
} finally {
  await browser.close()
}

console.log('落地页验收：landing/index.html\n')
for (const n of notes) console.log('  ' + n)

if (failures.length) {
  console.error('\n失败项：')
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}

console.log('\n全部通过。')
