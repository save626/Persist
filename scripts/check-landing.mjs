// 落地页验收（landing/index.html · 科技展示型 · 浅色产品色系 + 开场动画）。
//
// 为什么需要它：这是纯视觉页面，改坏了**不会报错**——只会变得不炫、
// 掉帧、或在手机上卡死。这个脚本把「炫技但不失控」变成可复现的断言：
//   · 6 个视口下不出现横向滚动，标题与 CTA 落在首屏内
//   · 手写标题的每条路径都被逐条画出（不是一下子全出现）
//   · 落地页自身安静：不再有常驻流星雨 canvas（流星雨已移到入场层）
//   · 页面里不再残留仿真终端
//   · 关掉 JS 时内容完整可读（渐进增强的硬要求）
//   · prefers-reduced-motion 下出静态终帧，不空屏
//   · 「动效关」时标题直接显示终态
//   · 眼睛标记存在，且虹膜跟随光标但不越界
//   · 关键色对对比度达标（正文 4.5 / 图形 3.0）
//   · 开场动画：字符画眼睛 → 满屏 3D 粒子流星雨 → 等点击 → 进落地页
//     满屏用独立全屏 canvas（1440×900）；流星雨灰蓝无暖色；
//     点击任意位置后才交棒；跳过按钮可直接交棒
//     （减动效 / ?intro=0 / 关 JS 时都不该出现开场层）
//
// 用法：
//   node scripts/check-landing.mjs              # 只跑断言
//   node scripts/check-landing.mjs --shots      # 额外重拍 landing/preview/*.png
//
// 退出码：0 = 通过；1 = 有失败项。

import { chromium } from '../app/node_modules/playwright-core/index.mjs'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
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
// 落地页本体一律 ?intro=0：开场动画会盖住页面 7 秒，
// 布局/流星/标题这些断言要测的是落地页本身，不是开场层。

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
  /* ---------- 0. 入口边界：落地页不得直达产品 ----------
     落地页是炫技展示页，产品入口统一由 home.html 承接。
     这条约束必须由脚本守住 —— 因为「顺手加个立即体验」是最容易被无声破坏的：
     它不会报错、不会崩，只会让落地页变成第二个产品入口，
     于是「先讲清楚再进产品」的顺序被悄悄打乱。 */
  {
    const html = readFileSync(PAGE, 'utf8')
    // 只看可点的 href/src，不看注释与文档字符串
    const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    const productLinks = links.filter((h) => /^\/app(\/|\?|$)/.test(h))
    if (productLinks.length) {
      fail('入口边界', `落地页出现直达产品的链接：${productLinks.join(', ')}`)
    } else {
      notes.push('✓ 落地页无任何直达产品的链接（产品入口只由 home.html 承接）')
    }
    // CTA 的两个按钮都必须指向 home.html
    const ctaHtml = html.match(/<div class="cta"[^>]*>([\s\S]*?)<\/div>/)
    const ctaHrefs = ctaHtml
      ? [...ctaHtml[1].matchAll(/href="([^"]+)"/g)].map((m) => m[1])
      : []
    if (ctaHrefs.length < 2) {
      fail('入口边界', `CTA 链接只有 ${ctaHrefs.length} 个`)
    } else if (!ctaHrefs.every((h) => h.startsWith('home.html'))) {
      fail('入口边界', `CTA 有指向 home.html 以外的链接：${ctaHrefs.join(', ')}`)
    } else {
      notes.push(`✓ CTA 全部指向 home.html（${ctaHrefs.join(' / ')}）`)
    }
  }

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

    await page.goto(`${fileUrl}?selftest=1&intro=0`, { waitUntil: 'load' })
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
    if (data.hasSkyCanvas) fail(vp.name, '落地页仍有 #sky 流星雨 canvas（流星雨应只在入场层）')
    if (consoleErrors.length) {
      fail(vp.name, `控制台报错：${consoleErrors.join(' | ')}`)
    }

    notes.push(
      `${vp.name.padEnd(13)} 无常驻动画 · 标题 ${data.wmDrawn}/${data.wmPaths} · 横向 ${data.scrollWidth}/${data.clientWidth}`,
    )

    if (WANT_SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      const file = join(SHOTS, `landing-${vp.name}.png`)
      // 另开一次不带 selftest 的加载：自检块是等宽字，不能混进证据图
      await page.goto(`${fileUrl}?intro=0`, { waitUntil: 'load' })
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
      const intro = document.getElementById('intro')
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
        introHidden: intro ? intro.hasAttribute('hidden') : true,
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
    if (!plain.introHidden) fail('no-js', '关掉 JS 后开场层仍然可见（应整层不出现）')
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
      const paths = Array.prototype.slice.call(document.querySelectorAll('.wm-path'))
      return {
        ...j,
        titleVisible: (() => {
          const wm = document.getElementById('wordmark')
          if (!wm) return false
          const s = getComputedStyle(wm)
          return s.display !== 'none' && Number(s.opacity) > 0.9
        })(),
        wmAllDrawn: paths.length > 0 && paths.every((p) => p.classList.contains('is-drawn')),
      }
    })
    if (!data.reduce) fail('reduced-motion', '没有识别到 prefers-reduced-motion')
    if (!data.still) fail('reduced-motion', '减动效下没有进入静态终帧')
    if (data.hasSkyCanvas) fail('reduced-motion', '减动效下仍有流星雨 canvas')
    if (!data.titleVisible) fail('reduced-motion', '减动效下标题不可见（首屏没有视觉）')
    if (!data.wmAllDrawn) fail('reduced-motion', '减动效下手写标题没有直接显示终态')
    notes.push(`reduced-motion 静态终帧：无流星雨 canvas · 标题可见 ${data.titleVisible} · 全显 ${data.wmAllDrawn}`)
    await ctx.close()
  }

  /* ---------- 4. 动效开关：关掉后标题直接显示终态 ---------- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    })
    const page = await ctx.newPage()
    await page.goto(`${fileUrl}?selftest=1&intro=0`, { waitUntil: 'load' })
    await page.waitForTimeout(1500)
    // 实时状态函数：自检块是一次性快照，验证标题状态必须读实时值
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

      // 关掉动效后，手写标题必须直接是终态（不能还停在半途）
      if (off.wmDrawn !== off.wmPaths) {
        fail('motion-toggle', `关掉动效后标题只画出了 ${off.wmDrawn}/${off.wmPaths} 条`)
      }

      // 开回去：开关状态要恢复
      await page.click('#motionToggle')
      await page.waitForTimeout(300)
      const on = await readState()
      const pressedOn = await page.getAttribute('#motionToggle', 'aria-pressed')
      if (pressedOn !== 'true') fail('motion-toggle', `重新开启后 aria-pressed 应为 true，实为 ${pressedOn}`)
      if (on.motion !== 'on') fail('motion-toggle', `重新开启后 data-motion 应为 on，实为 ${on.motion}`)
      notes.push('动效开关：关 → 标题终态；再开 → 状态恢复 on')
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
    await page.goto(`${fileUrl}?intro=0`, { waitUntil: 'load' })
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

  /* ---------- 6. 开场动画（eyeTutorial 复刻引擎：睁眼 → 推进 → 星空 → 落地页） ---------- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    })
    const page = await ctx.newPage()
    const consoleErrors = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await page.goto(`${fileUrl}?intro=1`, { waitUntil: 'load' })

    // 6.1 开场进行中：引擎在跑，落地页标题被按住（还没开始写）
    await page.waitForTimeout(1300)
    const early = await page.evaluate(() => {
      const overlay = document.getElementById('intro')
      const canvas = document.getElementById('introCanvas')
      const r = canvas ? canvas.getBoundingClientRect() : null
      const st = typeof window.__persistIntroState === 'function' ? window.__persistIntroState() : null
      return {
        overlayVisible: overlay ? !overlay.hidden : false,
        overlayOpacity: overlay ? Number(getComputedStyle(overlay).opacity) : 0,
        canvasW: r ? r.width : 0,
        canvasH: r ? r.height : 0,
        playing: st ? st.playing : null,
        hasCanvas: st ? st.hasCanvas : null,
        hasSkip: st ? st.hasSkip : null,
        hasMeteorCanvas: st ? st.hasMeteorCanvas : null,
        cellW: st ? st.cellW : 0,
        cellH: st ? st.cellH : 0,
        cols: st ? st.cols : 0,
        rows: st ? st.rows : 0,
        frames: st ? st.frames : 0,
        heartDisabled: st ? st.heartDisabled : null,
        meteorAt: st ? st.meteorAt : 0,
        waitAt: st ? st.waitAt : 0,
        wmDrawn: document.querySelectorAll('.wm-path.is-drawn').length,
      }
    })
    if (!early.overlayVisible) fail('intro', '开场层没有出现（?intro=1 应强制播放）')
    if (early.overlayOpacity < 0.8) fail('intro', `开场层透明度只有 ${early.overlayOpacity}`)
    if (early.canvasW < 400 || early.canvasH < 300) fail('intro', `开场画布尺寸异常 ${early.canvasW}×${early.canvasH}`)
    if (!early.playing) fail('intro', '开场状态没有标记为 playing')
    if (!early.hasCanvas || !early.hasSkip) fail('intro', '开场层缺少画布/跳过按钮')
    if (!early.hasMeteorCanvas) fail('intro', '开场层缺少满屏粒子画布 #introMeteor')
    if (early.wmDrawn !== 0) fail('intro', `开场期间手写标题已经画了 ${early.wmDrawn} 条（应等点击交棒后再写）`)

    // 6.2 网格必须与 Python 原版一致：78 列 × 30 行、字符格 8:15。
    if (early.rows !== 30) fail('intro', `字符行数应为原版的 30，实为 ${early.rows}`)
    if (early.cols !== 78) fail('intro', `字符列数应为原版的 78，实为 ${early.cols}`)
    const ratio = early.cellW / early.cellH
    if (Math.abs(ratio - 8 / 15) > 0.06) fail('intro', `字符格比例应为 8:15（0.533），实为 ${ratio.toFixed(3)}`)
    if (early.frames < 10) fail('intro', `1.3s 只画了 ${early.frames} 帧（引擎没在跑）`)
    if (!early.heartDisabled) fail('intro', '心形星云没有被禁用')
    if (Math.abs(early.meteorAt - 6.9) > 0.8) fail('intro', `粒子流星雨起点应 ~6.9s，实为 ${early.meteorAt}s`)
    if (Math.abs(early.waitAt - 8.5) > 0.8) fail('intro', `等待点击时点应 ~8.5s，实为 ${early.waitAt}s`)

    // 6.3 灰蓝色调：字符色不再是原版琥珀（暖色像素应为 0）。
    //     底色已由近黑改成深灰蓝 #0d151d，所以「近黑占比」改用「近底色占比」——
    //     字符之间有大量留白底，这正是疏朗感的量化。
    await page.waitForTimeout(1300)   // ≈ 2.6s，眼睛已睁开
    const density = await page.evaluate(() => {
      const c = document.getElementById('introCanvas')
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const lums = []
      let nearBase = 0, warm = 0, blueish = 0
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2]
        const L = 0.30 * R + 0.60 * G + 0.10 * B
        lums.push(L)
        // 底色 #0d151d = (13,21,29)，容差 10
        if (Math.abs(R - 13) < 10 && Math.abs(G - 21) < 10 && Math.abs(B - 29) < 10) nearBase++
        if (R > 140 && G > 80 && B < 90 && R > B * 1.8) warm++
        if (B > R + 8) blueish++
      }
      lums.sort((a, b) => a - b)
      const q = (p) => lums[Math.floor(lums.length * p)]
      return {
        nearBase: +(nearBase / lums.length * 100).toFixed(1),
        warm, blueish,
        p90: +q(0.9).toFixed(1),
        p99: +q(0.99).toFixed(1),
      }
    })
    if (density.nearBase < 40) fail('intro', `留白底色占比只有 ${density.nearBase}%，字符过于密集`)
    if (density.warm > 3000) fail('intro', `字符里还有 ${density.warm} 个暖色像素（应统一为灰蓝）`)
    if (density.blueish < density.warm) fail('intro', '字符没有偏蓝（灰蓝色调未生效）')

    // 6.4 满屏 3D 粒子流星雨：6.9s 后独立全屏 canvas 接管，铺满整个视口、
    //     灰蓝无暖色、有星点拖尾（不是空白）。
    await page.waitForTimeout(5100)   // ≈ 7.7s，粒子层已淡入
    const deep = await page.evaluate(() => {
      const cv = document.getElementById('introMeteor')
      const st = window.__persistIntroState()
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      let warm = 0, magenta = 0, lit = 0, blueish = 0, total = d.length / 4
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2]
        if (R > 140 && G > 80 && B < 90 && R > B * 1.8) warm++
        if (R > 70 && B > 55 && G < R * 0.72 && B > G * 1.25) magenta++
        if (R + G + B > 60) lit++
        if (B > R) blueish++
      }
      const ov = document.getElementById('intro')
      return {
        fullscreen: st.meteorIsFullscreen,
        cssW: cv.clientWidth, cssH: cv.clientHeight,
        vw: window.innerWidth, vh: window.innerHeight,
        meteorOn: st.meteorOn, meteorCount: st.meteorCount,
        meteorFrames: st.meteorFrames,
        isMeteor: ov.classList.contains('is-meteor'),
        warm, magenta, lit, blueish, total,
      }
    })
    if (!deep.fullscreen || deep.cssW !== deep.vw || deep.cssH !== deep.vh) {
      fail('intro', `粒子层未铺满视口：canvas ${deep.cssW}×${deep.cssH} vs 视口 ${deep.vw}×${deep.vh}`)
    }
    if (!deep.isMeteor || !deep.meteorOn) fail('intro', '7.7s 时粒子层没有接管（is-meteor / meteorOn 未置位）')
    if (deep.meteorFrames < 20) fail('intro', `粒子层只画了 ${deep.meteorFrames} 帧（粒子动画没在跑）`)
    if (deep.meteorCount < 5) fail('intro', `粒子数只有 ${deep.meteorCount}（流星雨没生成）`)
    if (deep.magenta > 3000) fail('intro', `粒子层出现 ${deep.magenta} 个粉紫像素（星云残留）`)
    if (deep.warm > 3000) fail('intro', `粒子层出现 ${deep.warm} 个暖色像素（应统一灰蓝）`)
    const litPct = deep.lit / deep.total * 100
    if (litPct < 0.1) fail('intro', `粒子层几乎全空（亮像素 ${litPct.toFixed(2)}%）`)

    // 6.5 等待点击：8.5s 后停在粒子层，不自动进落地页
    await page.waitForTimeout(1600)   // ≈ 9.3s
    const waiting = await page.evaluate(() => {
      const st = window.__persistIntroState()
      const ov = document.getElementById('intro')
      return {
        waiting: st.waiting,
        done: st.done,
        introHidden: ov.hidden,
        promptOpacity: Number(getComputedStyle(document.getElementById('introEnter')).opacity),
        wmDrawn: document.querySelectorAll('.wm-path.is-drawn').length,
        wmTotal: document.querySelectorAll('.wm-path').length,
      }
    })
    if (!waiting.waiting) fail('intro', '9.3s 没有进入等待点击状态')
    if (waiting.done) fail('intro', '开场自动交棒了（应等用户点击）')
    if (waiting.introHidden) fail('intro', '等待期间开场层被隐藏了')
    if (waiting.promptOpacity < 0.5) fail('intro', `「点击任意位置进入」提示没显示（opacity ${waiting.promptOpacity}）`)
    if (waiting.wmDrawn !== 0) fail('intro', `等待点击时标题已经画了 ${waiting.wmDrawn}/${waiting.wmTotal} 条`)

    // 6.6 点击任意位置 → 交棒落地页，标题才开始写
    await page.mouse.click(720, 300)
    // 11 条笔画延迟 260+10×115 ≈ 1.4s，留足缓冲到 1.9s
    await page.waitForTimeout(1900)
    const done = await page.evaluate(() => {
      const overlay = document.getElementById('intro')
      const paths = Array.prototype.slice.call(document.querySelectorAll('.wm-path'))
      return {
        overlayHidden: overlay ? overlay.hidden : true,
        introAttr: document.documentElement.getAttribute('data-intro'),
        wmDrawn: paths.filter((p) => p.classList.contains('is-drawn')).length,
        wmTotal: paths.length,
        ctaVisible: !!document.querySelector('.cta'),
        hasSkyCanvas: !!document.getElementById('sky'),
      }
    })
    if (!done.overlayHidden) fail('intro', '点击后开场层没有隐藏')
    if (done.introAttr !== 'off') fail('intro', `点击后 data-intro 应为 off，实为 ${done.introAttr}`)
    if (done.wmDrawn !== done.wmTotal) fail('intro', `点击后标题只画了 ${done.wmDrawn}/${done.wmTotal} 条`)
    if (!done.ctaVisible) fail('intro', '点击后 CTA 不见了')
    if (done.hasSkyCanvas) fail('intro', '落地页仍有流星雨 canvas')
    if (consoleErrors.length) fail('intro', `控制台报错：${consoleErrors.join(' | ')}`)
    notes.push(`开场：${early.cols}×${early.rows} 格 ${early.cellW}×${early.cellH} · 粒子层 ${deep.cssW}×${deep.cssH} 铺满 · 粒子 ${deep.meteorCount} 颗/${deep.meteorFrames} 帧 · 暖色 ${deep.warm} · 等点击后交棒 标题 ${done.wmDrawn}/${done.wmTotal}`)
    await ctx.close()
  }

  /* ---------- 6b. 跳过按钮：点了立刻交棒 ---------- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'no-preference',
    })
    const page = await ctx.newPage()
    await page.goto(`${fileUrl}?intro=1`, { waitUntil: 'load' })
    await page.waitForTimeout(1000)
    await page.click('#introSkip')
    await page.waitForTimeout(2200)   // 逐笔浮现约需 1.3s
    const after = await page.evaluate(() => ({
      introAttr: document.documentElement.getAttribute('data-intro'),
      overlayHidden: document.getElementById('intro').hidden,
      wmDrawn: document.querySelectorAll('.wm-path.is-drawn').length,
      wmTotal: document.querySelectorAll('.wm-path').length,
    }))
    if (after.introAttr !== 'off') fail('intro-skip', `跳过后 data-intro 应为 off，实为 ${after.introAttr}`)
    if (!after.overlayHidden) fail('intro-skip', '跳过后开场层没有隐藏')
    if (after.wmDrawn !== after.wmTotal) fail('intro-skip', `跳过后标题只画了 ${after.wmDrawn}/${after.wmTotal} 条`)
    notes.push(`跳过开场：0s 内交棒，标题 ${after.wmDrawn}/${after.wmTotal}`)
    await ctx.close()
  }

  /* ---------- 6c. ?intro=0 / 减动效：都不该出现开场层 ---------- */
  {
    for (const [label, url, opts] of [
      ['intro=0', `${fileUrl}?intro=0`, { reducedMotion: 'no-preference' }],
      ['reduced-motion', `${fileUrl}`, { reducedMotion: 'reduce' }],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts })
      const page = await ctx.newPage()
      await page.goto(url, { waitUntil: 'load' })
      await page.waitForTimeout(2000)
      const st = await page.evaluate(() => ({
        hidden: document.getElementById('intro').hidden,
        opacity: Number(getComputedStyle(document.getElementById('intro')).opacity),
        wmDrawn: document.querySelectorAll('.wm-path.is-drawn').length,
        wmTotal: document.querySelectorAll('.wm-path').length,
      }))
      if (!st.hidden) fail(label, '开场层出现了（本该直接进落地页）')
      if (st.opacity > 0.05) fail(label, `开场层透明度 ${st.opacity}，没有隐藏`)
      if (st.wmDrawn !== st.wmTotal) fail(label, `标题只画了 ${st.wmDrawn}/${st.wmTotal} 条`)
      notes.push(`${label}：无开场层，标题 ${st.wmDrawn}/${st.wmTotal}`)
      await ctx.close()
    }
  }

  /* ---------- 7. 对比度 ---------- */
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
