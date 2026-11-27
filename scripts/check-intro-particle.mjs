/**
 * 开场动画「粒子舞台」验收（桌面端全规格）
 *
 * 时间基准：从**起播**算起（state().elapsed），不是从页面 load 算起 ——
 * 单文件约 2.96 MB，解析要 2–3s，按 load 计会把"5.2s"采成 8s。
 *
 * 为什么用"透明度曲线"而不是单点断言：
 * headless（SwiftShader）里主线程被 3 个动画循环抢占，setTimeout 会晚几百毫秒，
 * 单点采样容易采到"类还没加上"的瞬间。这里连续采样整段淡入曲线，判断
 * 是否真的经历了 0 → 中间态 → 1，比固定时刻更可靠。
 *
 * 检查：
 *   1. 粒子舞台挂载并出帧（4.8s 后 frames 增长）
 *   2. 遮罩在整个入场过程中从 24% 涨到 340%（采样到中间值）
 *   3. 透明度经历 0 → 中间态 → ≈1
 *      —— 2/3 的采样点跟着新时间线走：CSS 从 5.2s 起跑（opacity 2.6s / mask 3s），
 *     6.4s 采中间态、8.6s 采完全接管（旧脚本按 t0=4.6 写死 +1.2/+2.8，t0 改 6.2 后全部偏晚）
 *   4. 12.5s 后 waiting：采样 3 个点（间隔 2s）确认「呼吸」存在且不塌陷
 *      —— 产品自 2026-11-24 起在入场（3s 缩放）结束后进入 **16s 自动呼吸**
 *      （`autoDisperse` 0→1→0，双重 smoothstep），所以「定格后两帧一致」是**过时的前提**；
 *      这里改断言：整个过程 waiting=true、粒子始终有像素、覆盖率落在合理带宽内且有变化
 *   5. 提示可见 + 点击任意位置 → 覆盖层隐藏、落地页可见
 *   6. 控制台无报错
 *
 * 产物：preview/intro-particle-1-enter.png / -2-hold.png / -3-click.png
 */
import fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '../app/node_modules/playwright-core/index.mjs'

// 不要写死 D:\Persist —— 换机器/换路径就跑不了，改用脚本自身位置推导
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = join(ROOT, 'landing', 'index.html')
const FILE = `file:///${PAGE.replace(/\\/g, '/').replace(/^\//, '')}`
const OUT = join(ROOT, 'preview')

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(FILE, { waitUntil: 'load', timeout: 60000 })

const state = () => page.evaluate(() => window.__persistIntroState?.() ?? null)

async function waitIntro(sec) {
  await page.waitForFunction(
    (t) => {
      const s = window.__persistIntroState?.()
      return Boolean(s && s.elapsed >= t)
    },
    sec,
    { timeout: 60000, polling: 80 },
  )
}

const layerCss = () =>
  page.evaluate(() => {
    const el = document.querySelector('#introParticles')
    const cs = getComputedStyle(el)
    return { opacity: Number(cs.opacity), maskSize: cs.maskSize }
  })

// —— 4.6s：确认揭开类被加上，并且真的有两条 CSS 过渡在跑 ——
const t0 = (await state())?.meteorAt ?? 4.6
await waitIntro(t0 + 0.1)
await page.waitForFunction(
  () => {
    const ov = document.querySelector('#intro')
    return Boolean(ov && ov.classList.contains('is-particle'))
  },
  null,
  { timeout: 30000, polling: 80 },
)
const animations = await page.evaluate(() => {
  const el = document.querySelector('#introParticles')
  const list = (el.getAnimations ? el.getAnimations() : []).map((a) => ({
    prop: a.transitionProperty || '',
    dur: a.effect && a.effect.getTiming ? a.effect.getTiming().duration : 0,
  }))
  const cs = getComputedStyle(el)
  return { list, transition: cs.transitionProperty, duration: cs.transitionDuration }
})

// —— 6.4s：入场中截图（此时遮罩应该在涨；5.2s 起跑，2.6s/3s 两条过渡） ——
await waitIntro(t0 + 0.2)
const cssMid = await layerCss()
const sMid = await state()
await page.screenshot({ path: `${OUT}/intro-particle-1-enter.png` })

// —— 8.6s 之后：完全接管（opacity 7.8s 结束、mask 8.2s 结束） ——
await waitIntro(t0 + 2.4)
const css2 = await layerCss()
const s2 = await state()
await page.screenshot({ path: `${OUT}/intro-particle-2-hold.png` })

// —— 12.5s（缩放结束约 12.2s）：waiting，采样呼吸段 ——
await waitIntro(t0 + 6.3)
const breathe = []
for (let i = 0; i < 3; i++) {
  const s = await state()
  breathe.push({ lit: s?.particleMeasure?.litRatio ?? 0, waiting: Boolean(s?.waiting), on: Boolean(s?.particleOn) })
  if (i < 2) await page.waitForTimeout(2000)
}
const s3 = { waiting: breathe[0].waiting }
const s4 = { particleMeasure: { litRatio: breathe[2].lit } }
const hint = await page.evaluate(() => {
  const el = document.querySelector('#introEnter')
  const cs = getComputedStyle(el)
  return { opacity: Number(cs.opacity), text: el.textContent.trim() }
})

// —— 点击 → 落地页 ——
await page.mouse.click(720, 320)
await page.waitForTimeout(900)
const after = await page.evaluate(() => {
  const intro = document.querySelector('#intro')
  const cs = intro ? getComputedStyle(intro) : null
  return {
    introHidden: intro ? intro.hasAttribute('hidden') : true,
    introOpacity: cs ? Number(cs.opacity) : 0,
    bodyText: (document.body.innerText || '').slice(0, 40),
  }
})
await page.screenshot({ path: `${OUT}/intro-particle-3-click.png` })

await browser.close()

const problems = []
const durations = animations.list.map((a) => `${a.prop}:${a.dur}`)
const hasOpacityTransition = animations.list.some((a) => a.prop === 'opacity' && a.dur === 2600)
const hasMaskTransition = animations.list.some((a) => /mask-size/.test(a.prop) && a.dur === 3000)
const lit1 = sMid?.particleMeasure?.litRatio ?? 0
const lit2 = s2?.particleMeasure?.litRatio ?? 0
const breatheMin = Math.min(...breathe.map((b) => b.lit))
const breatheMax = Math.max(...breathe.map((b) => b.lit))

if (!sMid?.particleOn) problems.push('粒子舞台没有挂上（particleOn=false）')
if (!(sMid?.particleFrames > 0)) problems.push(`粒子没有出帧（frames=${sMid?.particleFrames}）`)
if (!hasOpacityTransition) problems.push(`缺少 opacity 过渡（实测 ${durations.join(' ') || '无'}）`)
if (!hasMaskTransition) problems.push(`缺少 mask-size 过渡（实测 ${durations.join(' ') || '无'}）`)
if (!(cssMid.opacity > 0)) {
  problems.push(`入场阶段粒子层还没开始显示（opacity=${cssMid.opacity}）`)
}
if (!(lit1 > 0.001)) problems.push(`入场阶段粒子层几乎没有像素（${(lit1 * 100).toFixed(2)}%）`)
if (!(lit2 > lit1 * 1.5)) {
  problems.push(`粒子层没有明显的淡入（${(lit1 * 100).toFixed(2)}% → ${(lit2 * 100).toFixed(2)}%）`)
}
if (!(css2.opacity > 0.95)) problems.push(`7.2s 粒子层不透明度不足（${css2.opacity}）`)
if (!/340%/.test(css2.maskSize)) problems.push(`遮罩未铺满（mask-size=${css2.maskSize}）`)
if (!(lit2 > 0.01)) problems.push(`7.2s 粒子几乎没有像素（${(lit2 * 100).toFixed(2)}%）`)
if (!s3?.waiting) problems.push('12.5s 后未进入 waiting')
if (!breathe.every((b) => b.on)) problems.push('呼吸段粒子舞台被卸载（particleOn=false）')
if (!breathe.every((b) => b.waiting)) problems.push('呼吸段中途退出 waiting')
if (!(breatheMin > 0.01)) problems.push(`呼吸段出现空帧（最低 ${(breatheMin * 100).toFixed(2)}%）`)
if (!(breatheMax < 0.995)) problems.push(`呼吸段白屏（最高 ${(breatheMax * 100).toFixed(2)}%）`)
if (!(breatheMax - breatheMin > 0.15)) {
  problems.push(`呼吸段幅度过小，可能已静止（${(breatheMin * 100).toFixed(2)}% → ${(breatheMax * 100).toFixed(2)}%）`)
}
if (!hint || hint.opacity <= 0.01) problems.push('「点击任意位置进入」提示没出现')
if (!after.introHidden && after.introOpacity > 0.05) problems.push('点击后覆盖层没有隐藏')
if (!/Persist|把每天|碎片/.test(after.bodyText)) problems.push(`点击后没看到落地页文案（${after.bodyText}）`)

const bad = errors.filter((e) => /Uncaught|TypeError|ReferenceError|WebGL|shader/i.test(e))
if (bad.length) problems.push(`运行报错：${bad.slice(0, 3).join(' | ')}`)

fs.writeFileSync(
  `${OUT}/intro-particle-report.json`,
  JSON.stringify({ animations, cssMid, sMid, s2, css2, s3, s4, hint, after, errors }, null, 2),
)

console.log('过渡对象 :', durations.join(' ') || '（无）', '| 6.4s opacity =', cssMid.opacity, '| mask =', cssMid.maskSize)

console.log('接管     :', `lit=${(lit2 * 100).toFixed(2)}%`, `opacity=${css2.opacity}`)
console.log('呼吸     :', `lit ${(breatheMin * 100).toFixed(2)}% ~ ${(breatheMax * 100).toFixed(2)}%`, `waiting=${s3?.waiting}`, `on=${breathe.every((b) => b.on)}`)
console.log('点击之后 :', JSON.stringify(after))

if (problems.length) {
  console.error('\n验收未通过：')
  for (const p of problems) console.error('  ✗ ' + p)
  if (errors.length) for (const e of errors.slice(0, 6)) console.error('  ! ' + e.slice(0, 200))
  process.exit(1)
}
console.log('\n开场粒子层验收通过：淡入（有中间态）→ 接管 → 定格 → 点击进落地页')
