// 产品介绍首页验收（landing/home.html · 12 段结构 · 面向普通用户）。
//
// 为什么需要它：首页是纯静态说明页，改坏了**不会报错**——只会变成
// 「术语黑话堆砌」「段落顺序乱了」「链接指向不存在的锚点」「手机上挤成一团」。
// 这个脚本把方案的硬约束变成可复现的断言：
//   · 12 段结构齐全、锚点唯一，顶栏导航的每个锚点都能落地
//   · 禁用词表生效：技术术语只允许出现在第 10 段「技术细节」里
//   · 诚实性：不得出现「永久免费」「绝不上传」这类做不到的承诺
//   · 6 个视口无横向滚动，首屏内可见标题与主 CTA
//   · 关掉 JS 时全部内容可读（渐进增强的硬要求）
//   · prefers-reduced-motion 下内容直接可见、不空屏
//   · FAQ / 技术细节用原生 <details>，可展开、键盘可达
//   · CTA 指向真实存在的入口（demo / guest），不放死链
//   · 零外部请求、零 <img>（方案 Q2：真实产品留在 demo/体验入口里）
//   · 关键色对对比度达标（正文 4.5 / 图形 3.0）
//
// 用法：
//   node scripts/check-home.mjs              # 只跑断言
//   node scripts/check-home.mjs --shots      # 额外重拍 landing/preview/home-*.png
//
// 退出码：0 = 通过；1 = 有失败项。

import { chromium } from '../app/node_modules/playwright-core/index.mjs'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = join(ROOT, 'landing', 'home.html')
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

// 方案的 12 段（§2.3）：顺序即叙事顺序 —— 收益 → 能力 → 信任 → 转化。
const SECTIONS = [
  ['top', 'Hero：主张 + CTA + 产品示意'],
  ['problem', '痛点 3 条'],
  ['product', '三个模块'],
  ['day', '一天怎么过（5 步）'],
  ['story', '体验案例'],
  ['long', '长期变化'],
  ['trust', '信任与特色'],
  ['who', '适合谁 / 不适合谁'],
  ['faq', 'FAQ'],
  ['tech', '技术细节（折叠）'],
  ['start', '开始使用'],
]

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
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/* ---------- 报告 ---------- */
let failures = 0
let checks = 0
function ok(label) {
  checks++
  console.log(`  ✓ ${label}`)
}
function fail(label, detail) {
  checks++
  failures++
  console.log(`  ✗ ${label}${detail ? ` —— ${detail}` : ''}`)
}
function head(title) {
  console.log(`\n── ${title} ──`)
}

/* ========================================================================
   1. 静态源码检查（不需要浏览器）
   ======================================================================== */
function checkSource(html) {
  head('源码结构')

  // 12 段：11 个带 id 的段 + 页脚
  for (const [id, label] of SECTIONS) {
    const re = new RegExp(`id="${id}"`)
    if (re.test(html)) ok(`第 ${SECTIONS.findIndex((s) => s[0] === id) + 1} 段存在：${label} (#${id})`)
    else fail(`缺少段落 #${id}`, label)
  }

  // id 唯一
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (dup.length) fail('存在重复 id', [...new Set(dup)].join(', '))
  else ok(`所有 id 唯一（${ids.length} 个）`)

  // 顶栏导航锚点必须都能落地
  const navLinks = [...html.matchAll(/class="nav-links"[\s\S]*?<\/nav>/g)]
    .flatMap((m) => [...m[0].matchAll(/href="#([^"]+)"/g)].map((x) => x[1]))
  const missing = navLinks.filter((id) => !ids.includes(id))
  if (missing.length) fail('顶栏导航指向不存在的锚点', missing.join(', '))
  else ok(`顶栏 ${navLinks.length} 个导航锚点全部有效（${navLinks.join(', ')}）`)

  // 零外部请求。
  // canonical / og:* / twitter:* 里的绝对 URL 不会产生资源请求（爬虫按需抓取），
  // 必须放行；除此之外任何绝对 URL 都意味着页面会向外请求。
  const ext = [...html.matchAll(/<(?:meta|link|script|img|iframe|source)\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /https?:\/\//.test(tag))
    .filter((tag) => !/\b(?:property|name|rel)="(?:og:[^"]*|twitter:[^"]*|canonical)"/.test(tag))
  if (ext.length) fail('页面里有外部资源请求', ext.join(' | '))
  else ok('零外部资源请求（canonical / og / twitter 的绝对 URL 已放行）')

  // 零 <img>：方案 Q2 拍板 —— 真实产品留在「看演示 / 自己试试」入口里，
  // 首页继续用纯 CSS/SVG 示意展示产品内容。
  const imgs = [...html.matchAll(/<img\b/gi)].length
  if (imgs) fail(`页面里有 ${imgs} 个 <img>`, 'Q2 拍板：首页展示沿用纯 CSS 示意')
  else ok('零 <img>（纯 CSS/SVG 示意）')

  // 禁用词表（方案 §1.5）——只允许出现在 #tech 段内
  const techStart = html.indexOf('id="tech"')
  const beforeTech = techStart > 0 ? html.slice(0, techStart) : html
  const techPart = techStart > 0 ? html.slice(techStart) : ''
  const banned = [
    'RAG', '检索增强', '知识库', 'Agent', '模型调度', '推理链',
    'Token', 'token', '上下文窗口', '配额', '向量', 'Embedding',
    '相似度', '本地优先', 'Schema', 'IndexedDB', '同步协议',
  ]
  const hits = banned.filter((w) => beforeTech.includes(w))
  if (hits.length) fail('技术术语出现在第 10 段之前', hits.join(', '))
  else ok(`第 10 段之前无禁用词（${banned.length} 个词全查）`)

  // 技术词确实被放进了技术段（否则上一条是「因为压根没写」的空通过）
  const techTerms = ['IndexedDB', '事实包', '留存']
  const techHit = techTerms.filter((w) => techPart.includes(w))
  if (techHit.length >= 2) ok(`技术术语集中在技术段内（${techHit.join(', ')}）`)
  else fail('技术段内没有技术内容', `只命中 ${techHit.length} 项`)

  // 诚实性检查：不得出现做不到的承诺
  const forbidden = [
    ['永久免费', '正式价格还没定，不得这么写'],
    ['绝不上传', '开启同步后会上传到用户自己的服务器'],
    ['绝不上传服务器', '开启同步后会上传到用户自己的服务器'],
    ['永不丢失', '不能做这个保证'],
    ['100% 安全', '不能做这个保证'],
    ['无限', '不能做这个保证'],
    ['免费使用', '正式价格还没定'],
  ]
  const bad = forbidden.filter(([w]) => html.includes(w))
  if (bad.length) fail('出现做不到的承诺', bad.map(([w, why]) => `${w}（${why}）`).join('; '))
  else ok('无做不到的承诺（价格 / 上传 / 保证类）')

  // 必须诚实说明的部分
  const mustHave = [
    ['正式价格还没定', 'FAQ 需要说清价格未定'],
    ['暂不开放注册', '需要说清内测状态'],
    ['同步默认关闭', '需要说清同步默认值'],
    ['只存在你自己的设备上', '需要说清数据存放位置'],
    ['示例', '案例段需要标明是示例内容'],
  ]
  for (const [w, why] of mustHave) {
    if (html.includes(w)) ok(`诚实性要点在页：${w}`)
    else fail(`缺少诚实性要点：${w}`, why)
  }

  // CTA 目标
  if (html.includes('/app/?mode=demo')) ok('CTA 指向 /app/?mode=demo')
  else fail('缺少 demo 入口 CTA')
  if (html.includes('/app/?mode=guest')) ok('CTA 指向 /app/?mode=guest')
  else fail('缺少 guest 入口 CTA')
  if (!/href="[^"]*#(how|report|privacy)"/.test(html)) ok('无指向旧版锚点的死链')
  else fail('存在指向旧版锚点的死链（#how / #report / #privacy）')

  // 站内链接不得指向不存在的页面。
  // 分两类：
  //   · 相对路径（index.html 之类）→ 必须有对应文件
  //   · 绝对路径（/app/?mode=demo 之类）→ 服务端路由，只允许白名单里的入口
  const ROUTES = ['/app/', '/app/?mode=demo', '/app/?mode=guest']
  const localLinks = [...html.matchAll(/href="(?!https?:|#|mailto:)([^"]+)"/g)].map((m) => m[1])
  const badLocal = []
  const badRoute = []
  for (const h of localLinks) {
    if (h.startsWith('/')) {
      if (!ROUTES.includes(h)) badRoute.push(h)
    } else if (!existsSync(join(ROOT, 'landing', h))) {
      badLocal.push(h)
    }
  }
  if (badLocal.length) fail('站内链接指向不存在的文件', badLocal.join(', '))
  else ok(`站内相对链接全部有效（${localLinks.filter((h) => !h.startsWith('/')).join(', ') || '无'}）`)
  if (badRoute.length) fail('指向未登记的服务端路由', badRoute.join(', '))
  else ok(`服务端路由全部在白名单内（${[...new Set(localLinks.filter((h) => h.startsWith('/')))].join(', ')}）`)
}

/* ========================================================================
   2. 浏览器检查
   ======================================================================== */
async function checkBrowser(browser) {
  /* ---------- 2.1 6 视口布局 ---------- */
  head('多视口布局')
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
    const page = await ctx.newPage()
    await page.goto(fileUrl, { waitUntil: 'load' })
    await page.waitForTimeout(500)

    const m = await page.evaluate(() => {
      const de = document.documentElement
      const h1 = document.querySelector('h1')
      const cta = document.querySelector('.hero .btn--primary')
      const rect = (el) => (el ? el.getBoundingClientRect() : null)
      const r1 = rect(h1)
      const rc = rect(cta)
      return {
        overflow: de.scrollWidth - de.clientWidth,
        h1Text: h1 ? h1.textContent.trim() : '',
        h1Bottom: r1 ? Math.round(r1.bottom) : -1,
        ctaBottom: rc ? Math.round(rc.bottom) : -1,
        ctaVisible: rc ? rc.width > 0 && rc.height > 0 : false,
        vh: window.innerHeight,
      }
    })

    if (m.overflow > 1) fail(`${vp.name} 出现横向滚动`, `溢出 ${m.overflow}px`)
    else ok(`${vp.name} 无横向滚动`)

    if (!m.h1Text) fail(`${vp.name} 首屏没有 H1`)
    else if (m.h1Bottom > m.vh) fail(`${vp.name} H1 掉出首屏`, `bottom=${m.h1Bottom} vh=${m.vh}`)
    else ok(`${vp.name} H1 在首屏内`)

    if (!m.ctaVisible) fail(`${vp.name} 主 CTA 不可见`)
    else if (m.ctaBottom > m.vh) fail(`${vp.name} 主 CTA 掉出首屏`, `bottom=${m.ctaBottom} vh=${m.vh}`)
    else ok(`${vp.name} 主 CTA 在首屏内`)

    await ctx.close()
  }

  /* ---------- 2.2 关掉 JS ---------- */
  head('渐进增强（关掉 JS）')
  {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(fileUrl, { waitUntil: 'load' })

    const m = await page.evaluate(() => {
      const vis = (el) => {
        if (!el) return false
        const r = el.getBoundingClientRect()
        const st = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && st.opacity !== '0' && st.visibility !== 'hidden'
      }
      const visText = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return ''
        const r = el.getBoundingClientRect()
        const st = getComputedStyle(el)
        return r.height > 0 && st.opacity !== '0' ? el.textContent.trim() : ''
      }
      const tech = document.querySelector('#tech details')
      return {
        h1: visText('h1'),
        heroSub: visText('.hero-sub'),
        ctas: [...document.querySelectorAll('.hero .btn')].filter(vis).length,
        sections: [...document.querySelectorAll('main section[id]')].length,
        techSummary: tech ? tech.querySelector('summary')?.textContent.trim() : '',
        faqCount: document.querySelectorAll('.qa-item').length,
        faqAnswers: [...document.querySelectorAll('.qa-item .qa-a')].filter((el) => el.textContent.trim().length > 20).length,
        footText: visText('.foot-desc'),
        compliance: !!document.querySelector('.site-info'),
        techOpenable: tech instanceof HTMLDetailsElement,
      }
    })

    if (m.h1) ok(`关 JS 后 H1 可见：「${m.h1.slice(0, 18)}…」`)
    else fail('关 JS 后 H1 不可见')
    if (m.heroSub) ok('关 JS 后副标题可见')
    else fail('关 JS 后副标题不可见')
    if (m.ctas >= 2) ok(`关 JS 后 ${m.ctas} 个 CTA 可见`)
    else fail('关 JS 后 CTA 不可见', `只看到 ${m.ctas} 个`)
    if (m.sections === 11) ok(`关 JS 后 ${m.sections} 个内容段齐全`)
    else fail('关 JS 后段落数不对', `${m.sections}（应为 11）`)
    if (m.techSummary) ok(`关 JS 后技术段标题可见：「${m.techSummary.slice(0, 16)}…」`)
    else fail('关 JS 后技术段标题不可见')
    if (m.techOpenable) ok('技术段是原生 <details>（关 JS 也能展开）')
    else fail('技术段不是原生 <details>')
    if (m.faqCount === 6) ok(`FAQ 共 ${m.faqCount} 问`)
    else fail('FAQ 数量不对', `${m.faqCount}（应为 6）`)
    if (m.faqAnswers === 6) ok('FAQ 答案内容完整（6 条）')
    else fail('FAQ 答案缺失', `${m.faqAnswers}/6 条有内容`)
    if (m.compliance) ok('备案注入位存在')
    else fail('备案注入位缺失')

    await ctx.close()
  }

  /* ---------- 2.3 prefers-reduced-motion ---------- */
  head('减动效偏好')
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
    })
    const page = await ctx.newPage()
    await page.goto(fileUrl, { waitUntil: 'load' })
    await page.waitForTimeout(400)

    const m = await page.evaluate(() => {
      const h1 = document.querySelector('h1')
      const st = h1 ? getComputedStyle(h1) : null
      const tl = document.getElementById('timeline')
      return {
        h1Opacity: st ? st.opacity : '0',
        h1Text: h1 ? h1.textContent.trim() : '',
        tlTransform: tl ? getComputedStyle(tl.querySelector('.tl-line')).transform : '',
        revealsHidden: [...document.querySelectorAll('.reveal')].filter((el) => {
          const s = getComputedStyle(el)
          return s.opacity === '0'
        }).length,
      }
    })

    if (m.h1Opacity === '1' && m.h1Text) ok('减动效下 H1 直接可见')
    else fail('减动效下 H1 不可见', `opacity=${m.h1Opacity}`)
    if (m.revealsHidden === 0) ok('减动效下无隐藏的内容块（不空屏）')
    else fail('减动效下有内容永久隐藏', `${m.revealsHidden} 个 .reveal 仍是 opacity:0`)
    if (m.tlTransform === 'none' || /matrix\(1,/.test(m.tlTransform)) {
      ok('减动效下时间线连线直接显示')
    } else {
      fail('减动效下时间线连线未显示', `transform=${m.tlTransform}`)
    }

    await ctx.close()
  }

  /* ---------- 2.4 details 可交互 ---------- */
  head('FAQ / 技术细节可展开')
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(fileUrl, { waitUntil: 'load' })
    await page.waitForTimeout(300)

    const faq = await page.evaluate(() => {
      const first = document.querySelector('.qa-item')
      const before = first.open
      first.querySelector('summary').click()
      return { before, after: first.open, tag: first.tagName }
    })
    if (faq.tag === 'DETAILS' && faq.after === true && faq.before === false) {
      ok('FAQ 点击 summary 能展开（原生 details）')
    } else {
      fail('FAQ 展开异常', JSON.stringify(faq))
    }

    const tech = await page.evaluate(() => {
      const d = document.querySelector('#tech details')
      const before = d.open
      d.querySelector('summary').click()
      const body = d.querySelector('.tech-body')
      const r = body.getBoundingClientRect()
      return { before, after: d.open, bodyH: Math.round(r.height), items: d.querySelectorAll('.tech-item').length }
    })
    if (tech.after === true && tech.bodyH > 100 && tech.items === 5) {
      ok(`技术段可展开（${tech.items} 条，展开高度 ${tech.bodyH}px）`)
    } else {
      fail('技术段展开异常', JSON.stringify(tech))
    }

    await ctx.close()
  }

  /* ---------- 2.5 控制台无报错 ---------- */
  head('运行时')
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errs.push(m.text())
    })
    await page.goto(fileUrl, { waitUntil: 'load' })
    await page.waitForTimeout(900)
    if (errs.length) fail('控制台有报错', errs.slice(0, 3).join(' | '))
    else ok('控制台零报错')
    await ctx.close()
  }

  /* ---------- 2.6 对比度 ---------- */
  head('关键色对对比度')
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(fileUrl, { waitUntil: 'load' })
    await page.waitForTimeout(400)

    const pairs = await page.evaluate(() => {
      // 找一个元素**真正**身处的底色：
      //   · 自身有渐变 → 取渐变里最浅的一档（白字最不利的情况）
      //   · 否则往上找第一个不透明背景色
      const bgOf = (el) => {
        const grad = getComputedStyle(el).backgroundImage
        if (grad && grad.includes('gradient')) {
          const stops = grad.match(/rgba?\([^)]+\)/g) || []
          if (stops.length) return stops
        }
        let n = el
        while (n && n !== document.documentElement) {
          const c = getComputedStyle(n).backgroundColor
          const m = c.match(/rgba?\(([^)]+)\)/)
          if (m) {
            const p = m[1].split(',').map((x) => parseFloat(x))
            if (p.length < 4 || p[3] > 0.95) {
              return [`rgb(${p[0]}, ${p[1]}, ${p[2]})`]
            }
          }
          n = n.parentElement
        }
        return ['rgb(244, 247, 249)']
      }
      const rgb2hex = (c) => {
        const p = c.match(/[\d.]+/g).map(Number)
        return '#' + p.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
      }
      const out = []
      const probe = (label, sel, kind) => {
        const el = document.querySelector(sel)
        if (!el) return
        const fg = getComputedStyle(el).color.match(/[\d.]+/g).map(Number)
        const bgs = bgOf(el).map(rgb2hex)
        // 渐变底要取最差的一档
        out.push({ label, fg: rgb2hex(`rgb(${fg[0]}, ${fg[1]}, ${fg[2]})`), bgs, kind })
      }
      // 图形类：量的是「图形自身的颜色」对底色，不是文字色
      const probeGraphic = (label, sel, prop, kind) => {
        const el = document.querySelector(sel)
        if (!el) return
        const st = getComputedStyle(el)
        if (prop === 'gradient') {
          // 渐变按钮：逐档量，取最差的一档
          const stops = (st.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(rgb2hex)
          if (!stops.length) return
          out.push({ label, fg: '#ffffff', bgs: stops, kind })
          return
        }
        const raw = prop === 'borderTop' ? st.borderTopColor : st.backgroundColor
        const p = raw.match(/[\d.]+/g).map(Number)
        if (!p.length) return
        const fg = rgb2hex(`rgb(${p[0]}, ${p[1]}, ${p[2]})`)
        const bgs = bgOf(el).map(rgb2hex)
        out.push({ label, fg, bgs, kind })
      }
      probe('正文（副标题）', '.hero-sub', 'text')
      probe('正文（模块说明）', '.mod p', 'text')
      probe('正文（案例解读）', '.rep p', 'text')
      probe('正文（FAQ 答案）', '.qa-a', 'text')
      probe('正文（信任条目）', '.trust-item p', 'text')
      probe('弱化文字（hero-note）', '.hero-note', 'text')
      probe('次级文字（.notes）', '.notes', 'text')
      probe('eyebrow', '.eyebrow', 'text')
      probe('导航链接', '.nav-links a', 'text')
      probe('主 CTA 文字', '.btn--primary', 'text')
      probe('次 CTA 文字', '.hero .btn:not(.btn--primary)', 'text')
      probe('时间线说明', '.tl-p', 'text')
      probe('页脚文字', '.foot-desc', 'text')
      probe('合规行', '.foot-compliance', 'text')
      probe('技术段说明', '.tech>summary span', 'text')

      // 有意义的图形：承载信息，必须达 3:1
      //   · mini 进度条填充 —— 表达比例，没有文字等价物（对**轨道底**比，见下）
      //   · 次按钮描边 —— 白底按钮与页面底几乎同色，描边是唯一边界
      //   · 主 CTA 渐变 —— 文字压在渐变上，逐档取最差
      probeGraphic('图形：次按钮描边', '.hero .btn:not(.btn--primary)', 'borderTop', 'graphic')
      probeGraphic('图形：主 CTA 渐变各档', '.btn--primary', 'gradient', 'graphic')

      // 进度条填充要对**轨道底**比（填充本身即底色，自比无意义）
      {
        const mods = [
          ['健身', '.mini-bar i', '.mini-bar'],
          ['饮食', '.mini-bar--food i', '.mini-bar--food'],
          ['学习', '.mini-bar--study i', '.mini-bar--study'],
        ]
        for (const [name, fillSel, trackSel] of mods) {
          const fill = document.querySelector(fillSel)
          const track = document.querySelector(trackSel)
          if (!fill || !track) continue
          out.push({
            label: `图形：进度条填充（${name}）/ 轨道底`,
            fg: rgb2hex(getComputedStyle(fill).backgroundColor),
            bgs: [rgb2hex(getComputedStyle(track).backgroundColor)],
            kind: 'graphic',
          })
        }
      }
      return out
    })

    for (const p of pairs) {
      const need = p.kind === 'text' ? 4.5 : 3.0
      // 取所有候选底色里最差的那个比值
      let worst = Infinity
      let worstBg = p.bgs[0]
      for (const bg of p.bgs) {
        const r = contrast(p.fg, bg)
        if (r < worst) {
          worst = r
          worstBg = bg
        }
      }
      const detail = p.bgs.length > 1 ? `（底色候选 ${p.bgs.join(' / ')}）` : ''
      if (worst >= need) {
        ok(`${p.label} ${p.fg} / ${worstBg} = ${worst.toFixed(2)}:1（门槛 ${need}）${detail}`)
      } else {
        fail(`${p.label} ${p.fg} / ${worstBg} = ${worst.toFixed(2)}:1（门槛 ${need}）`, `不达标 ${detail}`)
      }
    }

    await ctx.close()
  }

  /* ---------- 2.7 证据图 ---------- */
  if (WANT_SHOTS) {
    head('证据图')
    if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true })
    const browser2 = await chromium.launch({ headless: true })
    for (const vp of VIEWPORTS) {
      const ctx = await browser2.newContext({ viewport: { width: vp.width, height: vp.height } })
      const page = await ctx.newPage()
      await page.goto(fileUrl, { waitUntil: 'load' })
      await page.waitForTimeout(1200)
      await page.screenshot({ path: join(SHOTS, `home-${vp.name}.png`), fullPage: true })
      await ctx.close()
    }
    await browser2.close()
    ok(`证据图已写入 landing/preview/home-*.png（${VIEWPORTS.length} 张整页）`)
  }
}

/* ========================================================================
   主流程
   ======================================================================== */
async function main() {
  console.log('=== 产品介绍首页验收（landing/home.html · 12 段） ===\n')

  const html = readFileSync(PAGE, 'utf8')
  checkSource(html)

  const browser = await chromium.launch({ headless: true })
  try {
    await checkBrowser(browser)
  } finally {
    await browser.close()
  }

  console.log(`\n${'-'.repeat(52)}`)
  if (failures) {
    console.log(`结果：不通过（${failures} 项失败 / 共 ${checks} 项）`)
    process.exit(1)
  }
  console.log(`结果：通过（${checks} 项全绿）`)
}

await main()
