// 落地页验收（landing/index.html · 科技展示型 · 浅色产品色系）。
//
// 为什么需要它：这是纯视觉页面，改坏了**不会报错**——只会变得不炫、
// 掉帧、或在手机上卡死。这个脚本把「炫技但不失控」变成可复现的断言：
//   · 6 个视口下不出现横向滚动，标题与 CTA 落在首屏内
//   · 手写标题的每条路径都被逐条画出（不是一下子全出现）
//   · 流星雨真的在跑，且轨迹是**近平行**的（共享主方向 = 流星雨，不是下雨）
//   · 页面里不再残留仿真终端
//   · 关掉 JS 时内容完整可读（渐进增强的硬要求）
//   · prefers-reduced-motion 下出静态终帧，不空屏
//   · 「动效关」时流星雨真的停住、标题直接是终态
//   · 眼睛标记存在，且虹膜跟随光标但不越界
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

const BG = '#f4f7f9'        // 页面底色（= 产品 body 背景）
const SURFACE = '#fbfcfd'   // 卡片/关键词底

const COLOR_PAIRS = [
  { label: '主文字 / 页面底', fg: '#202830', bg: BG, min: 4.5 },
  { label: 'slogan / 页面底', fg: '#202830', bg: BG, min: 4.5 },
  { label: '次级文字 / 页面底', fg: '#4d5965', bg: BG, min: 4.5 },
  { label: '弱化文字 / 页面底', fg: '#55616d', bg: BG, min: 4.5 },
  { label: '注脚小字 / 页面底', fg: '#616d79', bg: BG, min: 4.5 },
  { label: '强调色 / 页面底', fg: '#467692', bg: BG, min: 4.5 },
  { label: '顶栏链接 / 页面底', fg: '#55616d', bg: BG, min: 4.5 },
  { label: '主按钮文字 / 主按钮底', fg: '#ffffff', bg: '#467692', min: 4.5 },
  { label: '主按钮文字 / 渐变上档', fg: '#ffffff', bg: '#42718c', min: 4.5 },
  { label: '主按钮文字 / 渐变下档', fg: '#ffffff', bg: '#3c6a84', min: 4.5 },
  { label: '次按钮文字 / 次按钮底', fg: '#202830', bg: '#ffffff', min: 4.5 },
  { label: '关键词 / 关键词底', fg: '#55616d', bg: SURFACE, min: 4.5 },
  { label: '关键词强调 / 关键词底', fg: '#467692', bg: SURFACE, min: 4.5 },
  { label: '页脚备案 / 页面底', fg: '#616d79', bg: BG, min: 4.5 },
  { label: '手写标题笔画 / 页面底', fg: '#467692', bg: BG, min: 3.0 },
  { label: '虹膜 / 页面底', fg: '#5c8ba9', bg: BG, min: 3.0 },
  { label: '瞳孔 / 虹膜', fg: '#16323f', bg: '#5c8ba9', min: 3.0 },
  { label: '眼睑描边 / 页面底', fg: '#467692', bg: BG, min: 3.0 },
  { label: '高光 / 虹膜', fg: '#ffffff', bg: '#5c8ba9', min: 3.0 },
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
  /* ---------- 1. 多视口布局 + 动效 + 流星雨 ---------- */
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
    await page.waitForTimeout(3600)

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
    if (!data.wmInViewport) {
      fail(vp.name, `手写标题不在首屏内（top ${data.wmRect?.top} / bottom ${data.wmRect?.bottom} / 视口 ${vp.height}）`)
    }
    if (!data.ctaInViewport) {
      fail(vp.name, `CTA 不在首屏内（top ${data.ctaRect?.top} / bottom ${data.ctaRect?.bottom}）`)
    }
    if (data.wmPaths < 10) fail(vp.name, `手写标题路径数 ${data.wmPaths} 偏少，字母可能没画全`)
    if (data.wmDrawn !== data.wmPaths) {
      fail(vp.name, `手写标题只画出了 ${data.wmDrawn}/${data.wmPaths} 条路径`)
    }
    if (data.keys < 3) fail(vp.name, `关键词应为至少 3 个，实际 ${data.keys}`)
    if (data.hasTerminal) fail(vp.name, '页面里仍残留仿真终端元素')
    if (!data.hasEyemark) fail(vp.name, '缺少眼睛标记（点缀 2）')
    if (data.meteors < 1) fail(vp.name, `流星数为 0（流星雨没跑起来）`)
    if (data.frames < 10) fail(vp.name, `渲染帧数 ${data.frames} 太少，动画可能没推进`)
    if (data.trails < data.meteors) fail(vp.name, `拖尾点数 ${data.trails} < 流星数 ${data.meteors}，拖尾没成形`)
    if (consoleErrors.length) {
      fail(vp.name, `控制台报错：${consoleErrors.join(' | ')}`)
    }

    // 流星必须是「从同一个辐射点发出」的：每道轨迹的方向与「辐射点→头部」
    // 的夹角都必须很小。偏差大 = 各飞各的 = 下雨，不是流星雨。
    const angles = data.angles || []
    if (angles.length >= 2) {
      if (data.radialDev > 0.2) {
        fail(vp.name, `流星没有汇聚到同一辐射点（最大偏角 ${data.radialDev} rad，应 ≤0.2）`)
      }
      const min = Math.min(...angles)
      const max = Math.max(...angles)
      const spread = max - min
      if (spread < 0.1) {
        fail(vp.name, `流星方向完全一致（跨度 ${spread.toFixed(2)} rad），没有放射感`)
      }
    } else {
      fail(vp.name, `可测方向的流星只有 ${angles.length} 道，拖尾可能没铺开`)
    }

    // 窄屏预算：低端机不能和桌面一样密
    if (vp.width <= 390 && data.maxMeteors > 12) {
      fail(vp.name, `窄屏流星预算过高：${data.maxMeteors}`)
    }

    notes.push(
      `${vp.name.padEnd(13)} 流星 ${String(data.meteors).padStart(2)}/${data.maxMeteors} · 拖尾点 ${String(data.trails).padStart(3)} · 帧 ${String(data.frames).padStart(3)} · 标题 ${data.wmDrawn}/${data.wmPaths} · 横向 ${data.scrollWidth}/${data.clientWidth}`,
    )

    if (WANT_SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      const file = join(SHOTS, `landing-${vp.name}.png`)
      // 另开一次不带 selftest 的加载：自检块是等宽字，不能混进证据图
      await page.goto(fileUrl, { waitUntil: 'load' })
      await page.waitForTimeout(3000)
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
      const wm = document.querySelector('.wordmark')
      const slogan = document.querySelector('.slogan')
      const cta = document.querySelector('.cta')
      const keys = document.querySelectorAll('.keys li').length
      const foot = document.querySelector('.foot')
      const eye = document.querySelector('.eyemark')
      const vis = (el) => {
        if (!el) return false
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.9 && r.height > 0
      }
      const paths = Array.prototype.slice.call(document.querySelectorAll('.wm-path'))
      const strokeVisible = paths.length > 0 && paths.every((p) => {
        const s = getComputedStyle(p)
        return s.strokeDasharray === 'none' || Number(s.strokeDashoffset) === 0
      })
      return {
        wmVisible: vis(wm),
        strokeVisible,
        pathCount: paths.length,
        sloganVisible: vis(slogan),
        sloganText: slogan ? slogan.textContent.trim() : '',
        ctaVisible: vis(cta),
        ctaLinks: cta ? cta.querySelectorAll('a').length : 0,
        keys,
        footVisible: vis(foot),
        eyeVisible: vis(eye),
        hasTerminal: !!document.querySelector('.term'),
      }
    })
    if (!plain.wmVisible) fail('no-js', '关掉 JS 后手写标题不可见')
    if (!plain.strokeVisible) fail('no-js', '关掉 JS 后手写标题的描边被藏起来了（应为可见实线）')
    if (plain.pathCount < 10) fail('no-js', `关掉 JS 后路径数只有 ${plain.pathCount}`)
    if (!plain.sloganVisible) fail('no-js', '关掉 JS 后 slogan 不可见')
    if (!plain.ctaVisible || plain.ctaLinks < 2) fail('no-js', '关掉 JS 后 CTA 不可用')
    if (plain.keys < 3) fail('no-js', `关掉 JS 后关键词只有 ${plain.keys} 个`)
    if (!plain.footVisible) fail('no-js', '关掉 JS 后备案信息不可见')
    if (!plain.eyeVisible) fail('no-js', '关掉 JS 后眼睛标记不可见')
    if (plain.hasTerminal) fail('no-js', '关掉 JS 后仍有终端元素')
    if (!plain.sloganText.includes('看懂自己')) fail('no-js', `关掉 JS 后 slogan 文案缺失（实为「${plain.sloganText}」）`)
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
    await page.waitForTimeout(3600)
    const data = await page.evaluate(() => {
      const el = document.getElementById('selftest')
      const j = el ? JSON.parse(el.textContent) : {}
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
      const paths = Array.prototype.slice.call(document.querySelectorAll('.wm-path'))
      return {
        ...j,
        canvasNonEmpty: nonEmpty,
        wmAllDrawn: paths.length > 0 && paths.every((p) => p.classList.contains('is-drawn')),
      }
    })
    if (!data.reduce) fail('reduced-motion', '没有识别到 prefers-reduced-motion')
    if (!data.still) fail('reduced-motion', '减动效下没有进入静态终帧')
    if (!data.canvasNonEmpty) fail('reduced-motion', '减动效下画布是空的（首屏没有视觉）')
    if (!data.wmAllDrawn) fail('reduced-motion', '减动效下手写标题没有直接显示终态')
    if (data.meteors < 1) fail('reduced-motion', `减动效下流星数为 ${data.meteors}，静态终帧没有流星`)
    notes.push(`reduced-motion 静态终帧：流星 ${data.meteors} · 画布有内容 ${data.canvasNonEmpty} · 标题全显 ${data.wmAllDrawn}`)
    await ctx.close()
  }

  /* ---------- 4. 动效开关：关掉后流星雨真的停住 ---------- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    })
    const page = await ctx.newPage()
    await page.goto(`${fileUrl}?selftest=1`, { waitUntil: 'load' })
    await page.waitForTimeout(1500)
    // 实时状态函数：自检块是一次性快照，比较帧数必须读实时值
    const readState = () => page.evaluate(() => {
      if (typeof window.__persistLandingState !== 'function') return null
      return window.__persistLandingState()
    })

    const before = await readState()
    if (!before) {
      fail('motion-toggle', '页面没有暴露 __persistLandingState，无法验证动效开关')
    } else {
      await page.click('#motionToggle')
      await page.waitForTimeout(400)
      const off = await readState()
      const pressed = await page.getAttribute('#motionToggle', 'aria-pressed')
      if (pressed !== 'false') fail('motion-toggle', `开关的 aria-pressed 应为 false，实为 ${pressed}`)
      if (off.motion !== 'off') fail('motion-toggle', `data-motion 应为 off，实为 ${off.motion}`)

      // 等一拍，帧数不应再涨
      await page.waitForTimeout(900)
      const after = await readState()
      if (after.frames !== off.frames) {
        fail('motion-toggle', `关掉动效后帧数仍在增长（${off.frames} → ${after.frames}），流星雨没停`)
      }

      // 关掉动效后，手写标题必须直接是终态（不能还停在半途）
      if (off.wmDrawn !== off.wmPaths) {
        fail('motion-toggle', `关掉动效后标题只画出了 ${off.wmDrawn}/${off.wmPaths} 条`)
      }

      // 开回去应该还能再动
      await page.click('#motionToggle')
      await page.waitForTimeout(800)
      const on = await readState()
      const pressedOn = await page.getAttribute('#motionToggle', 'aria-pressed')
      if (pressedOn !== 'true') fail('motion-toggle', `重新开启后 aria-pressed 应为 true，实为 ${pressedOn}`)
      if (on.frames <= after.frames) {
        fail('motion-toggle', `重新开启后帧数没有继续增长（${after.frames} → ${on.frames}）`)
      }
      notes.push(`动效开关：关 → 帧数冻结于 ${off.frames}；再开 → ${on.frames}`)
    }
    await ctx.close()
  }

  /* ---------- 5. 眼睛标记：虹膜跟随光标，且不越界 ---------- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    })
    const page = await ctx.newPage()
    await page.goto(fileUrl, { waitUntil: 'load' })
    await page.waitForTimeout(800)
    const getT = () => page.evaluate(() => {
      const el = document.getElementById('emEye')
      return el ? el.getAttribute('transform') : null
    })
    const t0 = await getT()
    await page.mouse.move(1300, 200)
    await page.waitForTimeout(700)
    const t1 = await getT()
    if (t0 === t1) {
      fail('eyemark', `虹膜没有跟随光标（transform 一直是 ${t0}）`)
    } else {
      const num = (t) => {
        const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(t || '')
        return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0]
      }
      const [x, y] = num(t1)
      const dist = Math.sqrt(x * x + y * y)
      if (dist > 3.2) fail('eyemark', `虹膜偏移 ${dist.toFixed(2)}px 越界（上限 2.6px + 余量）`)
      notes.push(`眼睛标记：光标移动后虹膜偏移 (${x.toFixed(2)}, ${y.toFixed(2)})px`)
    }
    await ctx.close()
  }

  /* ---------- 6. 对比度 ---------- */
  for (const pair of COLOR_PAIRS) {
    const ratio = contrast(pair.fg, pair.bg)
    const ok = ratio >= pair.min
    notes.push(
      `${ok ? '✓' : '✗'} ${pair.label.padEnd(24)} ${ratio.toFixed(2)}:1（门槛 ${pair.min}）`,
    )
    if (!ok) fail('对比度', `${pair.label} 仅 ${ratio.toFixed(2)}:1，低于 ${pair.min}`)
  }
} finally {
  await browser.close()
}

console.log('落地页验收：landing/index.html（科技展示型 · 浅色产品色系）\n')
for (const n of notes) console.log('  ' + n)

if (failures.length) {
  console.error('\n失败项：')
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}

console.log('\n全部通过。')
