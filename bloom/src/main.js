/**
 * 瞳孔散开之后 —— 手势控制的粒子花。
 *
 * 只有两种状态：**花朵** 与 **满屏散开**，由一个参数 `disperse` 连续控制：
 *   disperse = 0 → 聚成三层花瓣的花；= 1 → 粒子铺满整个视口。
 *
 * 自动模式（没开摄像头）：花朵停留 → 缓慢散开 → 停留 → 缓慢聚合，循环。
 * 手势模式：**手掌张开 → 散开；手掌捏合 → 聚成花**（方向与"捏合"语义一致）。
 *           双手时取两只手张开度的平均值，单手时用该手。
 *
 * ## 调试参数
 *
 * | 参数 | 作用 |
 * | --- | --- |
 * | `?disperse=0.7` | 锁死扩散度（0 = 成花，1 = 满屏） |
 * | `?still=1`      | 冻结动画与缓动，出静帧 |
 * | `?n=20000`      | 粒子数（5000–40000） |
 * | `?sim=1`        | 鼠标上下滑动模拟扩散度 |
 * | `?debug=1`      | HUD：disperse / hands / openness / fps |
 * | `?hand=1`       | 进页面直接尝试开摄像头 |
 * | `?cycleSpeed=4` | 自动循环加速，验收整圈用 |
 * | `?meteor=0`     | 关掉背景流星雨层 |
 */
import * as THREE from '../vendor/three/three.module.js'
import { createFlower, FLOWER_DEFAULTS } from './flower.js'
import { createMeteors } from './meteors.js'
import { TensionTracker, approach, clamp01, handsOpenness } from './gesture/tension.js'
import { HandTracker } from './gesture/hand-tracker.js'
import { createOverlay } from './gesture/overlay.js'

const params = new URLSearchParams(location.search)
const num = (key, fallback) => {
  const v = Number.parseFloat(params.get(key))
  return Number.isFinite(v) ? v : fallback
}
const flag = (key) => params.get(key) === '1'
const $ = (sel) => document.querySelector(sel)

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches

const cfg = {
  count: Math.round(Math.min(40000, Math.max(5000, num('n', isCoarsePointer ? 14000 : 32000)))),
  forceDisperse: params.has('disperse') ? clamp01(num('disperse', 0)) : null,
  still: flag('still') || prefersReducedMotion,
  sim: flag('sim'),
  debug: flag('debug') || params.has('disperse'),
  autoHand: flag('hand'),
  hazeScale: params.has('haze') ? Math.max(0, num('haze', 1)) : 1,
  cycleSpeed: Math.max(0.1, num('cycleSpeed', 1)),
  meteorShown: params.get('meteor') !== '0',
}

// —— DOM ——
const canvas = $('#webgl')
const meteorCanvas = $('#meteors')
const video = $('#cam')
const overlayCanvas = $('#hand-overlay')
const btnHand = $('#btn-hand')
const statusEl = $('#status')
const toastEl = $('#toast')
const hudEl = $('#hud')
const stageEl = $('#stage')

let toastTimer = 0
function showToast(title, hint) {
  toastEl.innerHTML = ''
  const h = document.createElement('strong')
  h.textContent = title
  toastEl.append(h)
  if (hint) {
    const p = document.createElement('span')
    p.textContent = hint
    toastEl.append(p)
  }
  toastEl.classList.add('is-open')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('is-open'), 14000)
}
toastEl.addEventListener('click', () => toastEl.classList.remove('is-open'))

function setStatus(text, tone = '') {
  statusEl.textContent = text
  statusEl.dataset.tone = tone
}

// —— WebGL 兜底 ——
function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

if (!hasWebGL2()) {
  stageEl.classList.add('is-unsupported')
  $('#fallback').hidden = false
  btnHand.disabled = true
  setStatus('浏览器不支持 WebGL2', 'error')
  window.__bloom = { ready: false, reason: 'no-webgl2', frames: 0 }
  throw new Error('WebGL2 不可用')
}

// —— 渲染器 / 场景 ——
const dpr = Math.min(window.devicePixelRatio || 1, isCoarsePointer ? 1.75 : 2)
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: true,
  premultipliedAlpha: false,
  powerPreference: 'high-performance',
})
renderer.setPixelRatio(dpr)
renderer.setClearAlpha(0)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 40)
camera.position.set(0, 0.05, 4.05)
camera.lookAt(0, 0, 0)

const flower = createFlower({
  count: cfg.count,
  hazeOpacity: FLOWER_DEFAULTS.hazeOpacity * cfg.hazeScale,
})
scene.add(flower.group)

/** 背景流星雨：独立 2D 画布，与花朵无共享状态 */
const meteors = createMeteors(meteorCanvas)

const overlay = createOverlay(overlayCanvas)
const tracker = new TensionTracker({ tau: 0.07 })

// —— 状态 ——
const state = {
  disperse: cfg.forceDisperse ?? 0,
  targetDisperse: 0,
  openness: 0,
  hands: 0,
  scale: 1,
  fps: 0,
  frames: 0,
  handEnabled: false,
  handVisible: false,
  mode: 'auto',
  lastFrame: performance.now(),
  engineError: null,
}

// —— 手势 ——
const hand = { x: 0, y: 0, active: false, tx: 0, ty: 0 }
const handTracker = new HandTracker({ numHands: 2 })

// —— 鼠标模拟 ——
const sim = { value: 0.6, smooth: 0.6, active: false }
if (cfg.sim) {
  const onPointer = (e) => {
    sim.active = true
    sim.value = clamp01(1 - e.clientY / window.innerHeight)
    hand.tx = (e.clientX / window.innerWidth) * 2 - 1
    hand.ty = 1 - (e.clientY / window.innerHeight) * 2
  }
  window.addEventListener('pointermove', onPointer, { passive: true })
  window.addEventListener('pointerdown', onPointer, { passive: true })
}

/**
 * 自动循环：**花朵 → 散开 → 停留 → 聚合**。两态之间缓慢过渡，没有第三种形态。
 *
 *   0–2s    花朵停留
 *   2–9s    缓慢散开（disperse 0→1）
 *   9–12.5s 满屏停留
 *   12.5–20s 缓慢聚合（disperse 1→0）
 *   20–24s  花朵停留
 */
const CYCLE = {
  period: 24,
  /** [秒, disperse]；首尾同值 */
  keys: [
    [0.0, 0.0],
    [2.0, 0.0],
    [9.0, 1.0],
    [12.5, 1.0],
    [20.0, 0.0],
    [24.0, 0.0],
  ],
}

/** 三次 Hermite（切线取相邻关键帧差商）：通过关键帧时速度连续，不会顿一下。 */
function hermite(t) {
  const keys = CYCLE.keys
  const period = CYCLE.period
  const n = keys.length
  const phase = ((t % period) + period) % period

  let i = 0
  for (let k = 0; k < n - 1; k++) {
    if (phase >= keys[k][0] && phase <= keys[k + 1][0]) {
      i = k
      break
    }
  }
  const t0 = keys[i][0]
  const t1 = keys[i + 1][0]
  const v0 = keys[i][1]
  const v1 = keys[i + 1][1]
  const span = t1 - t0 || 1
  const u = (phase - t0) / span

  const prev = keys[(i - 1 + n - 1) % (n - 1)]
  const next = keys[(i + 2) % (n - 1)]
  const m0 = ((v1 - prev[1]) / ((t1 - prev[0]) || 1)) * span
  const m1 = ((next[1] - v0) / ((next[0] - t0) || 1)) * span

  const u2 = u * u
  const u3 = u2 * u
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * m1
}

const bootAt = performance.now() / 1000
function autoTarget() {
  // cycleSpeed 缩放的是**时间**，不是数值（写成值会直接把扩散度乘爆）
  return clamp01(hermite((performance.now() / 1000 - bootAt) * cfg.cycleSpeed))
}

function updateHandFromLandmarks(lm) {
  if (!lm) return
  const a = lm[8]
  const b = lm[12]
  hand.tx = (0.5 - (a.x + b.x) / 2) * 2.4
  hand.ty = (0.5 - (a.y + b.y) / 2) * 1.8
}

async function enableHands() {
  if (state.handEnabled) {
    handTracker.stop()
    state.handEnabled = false
    state.handVisible = false
    hand.active = false
    video.classList.remove('is-live')
    btnHand.textContent = '开启手势'
    btnHand.dataset.state = 'idle'
    setStatus('自动模式 · 花朵与满屏之间循环')
    overlay.clear()
    return
  }

  const cap = HandTracker.capability()
  if (!cap.ok) {
    showToast(cap.message, cap.hint)
    setStatus(cap.message, 'error')
    return
  }

  btnHand.disabled = true
  btnHand.dataset.state = 'loading'
  btnHand.textContent = '启动中…'
  setStatus('正在申请摄像头…')

  try {
    await handTracker.start(video)
    state.handEnabled = true
    video.classList.add('is-live')
    btnHand.disabled = false
    btnHand.textContent = '关闭手势'
    btnHand.dataset.state = 'on'
    setStatus('手势模式 · 张手散开，捏合聚成花')
    setTimeout(() => {
      if (state.handVisible) return
      showToast('还没检测到手', '把手放进画面、距离 40–80cm，光线别太暗。')
    }, 3400)
  } catch (err) {
    btnHand.disabled = false
    btnHand.dataset.state = 'error'
    btnHand.textContent = '开启手势'
    state.handEnabled = false
    state.engineError = err
    setStatus(err.message, 'error')
    showToast(err.message, err.hint || '继续用自动模式即可。')
  }
}

btnHand.addEventListener('click', enableHands)

// —— 尺寸 ——
const FLOWER_EXTENT = 1.58
function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  overlay.resize(w, h, dpr)
  flower.resize(w, h, dpr)
  meteors.resize(w, h, dpr)

  const halfFov = (camera.fov * Math.PI) / 360
  const needH = FLOWER_EXTENT / Math.tan(halfFov)
  const needW = FLOWER_EXTENT / (Math.tan(halfFov) * camera.aspect)
  camera.position.z = Math.max(needH, needW)

  const halfHeight = Math.tan(halfFov) * camera.position.z
  flower.setScatterExtent(halfHeight * camera.aspect * 1.02, halfHeight * 1.02)
}
window.addEventListener('resize', resize)
resize()

// —— 主循环 ——
let paused = false
document.addEventListener('visibilitychange', () => {
  paused = document.hidden
  state.lastFrame = performance.now()
  meteors.setPaused(paused)
})

function frame(now) {
  requestAnimationFrame(frame)
  if (paused) return

  const dt = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000))
  state.lastFrame = now
  state.frames++
  const t = cfg.still ? 0 : now / 1000

  // 1) 目标值
  let target
  let targetScale = 1
  let mode = 'auto'

  if (cfg.forceDisperse !== null) {
    target = cfg.forceDisperse
    mode = 'forced'
  } else if (cfg.sim && sim.active) {
    sim.smooth = approach(sim.smooth, sim.value, 0.12, dt)
    target = sim.smooth
    targetScale = 1 + 0.1 * sim.smooth
    mode = 'sim'
  } else if (state.handEnabled) {
    const detect = handTracker.detect(now)
    if (detect.landmarks) updateHandFromLandmarks(detect.landmarks)

    const hands = detect.hands || []
    state.hands = hands.length
    const openness = handsOpenness(hands)

    if (openness !== null) {
      state.openness = openness
      // 方向修正：**手掌张开 → 散开（disperse→1）；捏合 → 聚成花（→0）**
      target = openness
      targetScale = 1 + 0.1 * openness
      state.handVisible = true
      hand.active = true
      overlay.draw(hands[0], { mirror: true, alpha: 0.9 })
      mode = hands.length >= 2 ? 'hand-2' : 'hand-1'
    } else {
      // 丢手：交回自动循环
      hand.active = false
      state.handVisible = false
      overlay.clear()
      target = autoTarget()
      mode = 'hand-lost'
    }
  } else {
    target = autoTarget()
  }

  // 2) 缓动（帧率归一）；离目标足够近时吸附，避免停在半成品
  state.targetDisperse = clamp01(target)
  state.mode = mode
  if (cfg.still) {
    state.disperse = state.targetDisperse
  } else {
    state.disperse = approach(state.disperse, state.targetDisperse, 0.1, dt)
    if (Math.abs(state.disperse - state.targetDisperse) < 0.004) state.disperse = state.targetDisperse
  }
  state.scale = approach(state.scale, targetScale, 0.08, dt)

  // 3) 手位置平滑
  hand.x = approach(hand.x, hand.tx, 0.18, dt)
  hand.y = approach(hand.y, hand.ty, 0.18, dt)

  // 4) 喂给 GPU
  const freeze = cfg.still || prefersReducedMotion
  flower.setDisperse(state.disperse)
  flower.setScale(state.scale)
  flower.setHand({ x: hand.x, y: hand.y, active: hand.active && !freeze })
  flower.update(freeze ? 0 : dt)

  if (!freeze) {
    camera.position.x = Math.sin(t * 0.063) * 0.1
    camera.position.y = 0.05 + Math.sin(t * 0.081 + 1.3) * 0.055
    camera.lookAt(0, 0, 0)
  }

  if (cfg.still || !cfg.meteorShown) meteors.clear()
  else meteors.update(dt)

  renderer.render(scene, camera)

  if (cfg.debug && state.frames % 6 === 0) updateHud(mode)
}

let fpsWindow = { t: 0, n: 0 }
function updateHud(mode) {
  const now = performance.now()
  fpsWindow.n++
  if (now - fpsWindow.t > 500) {
    state.fps = Math.round((fpsWindow.n * 1000) / (now - fpsWindow.t))
    fpsWindow = { t: now, n: 0 }
  }
  hudEl.innerHTML = `
    <div class="hud-row"><b>mode</b><span>${mode}</span></div>
    <div class="hud-row"><b>disperse</b><span>${state.disperse.toFixed(3)}</span></div>
    <div class="hud-row"><b>openness</b><span>${state.openness.toFixed(2)}</span></div>
    <div class="hud-row"><b>hands</b><span>${state.hands}</span></div>
    <div class="hud-row"><b>particles</b><span>${flower.stats.particles.toLocaleString()}</span></div>
    <div class="hud-row"><b>fps</b><span>${state.fps}</span></div>
  `
}

/** 无头验收用的像素测量：立刻重绘一帧并读回。 */
function measure() {
  renderer.render(scene, camera)
  const gl = renderer.getContext()
  const w = gl.drawingBufferWidth
  const h = gl.drawingBufferHeight
  const buf = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)

  let lit = 0
  let sum = 0
  let sx = 0
  let sy = 0
  let minX = w
  let maxX = 0
  let minY = h
  let maxY = 0
  let edge = 0
  let bright = 0

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const alpha = buf[i + 3]
      if (alpha < 8) continue
      const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]
      lit++
      sum += lum
      if (lum > 245) bright++
      sx += x
      sy += y
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) edge++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  const total = w * h
  return {
    width: w,
    height: h,
    litRatio: lit / total,
    /** 过曝像素占比：用来量化「花心糊成一团白」 */
    blownRatio: lit ? bright / lit : 0,
    edge,
    meanLum: lit ? sum / lit : 0,
    centroid: lit ? { x: sx / lit / w, y: sy / lit / h } : null,
    bbox: lit ? { minX: minX / w, maxX: maxX / w, minY: minY / h, maxY: maxY / h } : null,
    disperse: state.disperse,
    particles: flower.stats.particles,
  }
}

requestAnimationFrame(frame)

// —— 对外句柄 ——
window.__bloom = {
  ready: true,
  THREE,
  renderer,
  scene,
  camera,
  flower,
  meteors,
  measure,
  get frames() {
    return state.frames
  },
  get disperse() {
    return state.disperse
  },
  get mode() {
    return state.mode
  },
  get engineError() {
    return state.engineError ? { message: state.engineError.message, hint: state.engineError.hint } : null
  },
  config: cfg,
  handTracker,
  setDisperse(v) {
    cfg.forceDisperse = clamp01(v)
    state.disperse = cfg.forceDisperse
    state.targetDisperse = cfg.forceDisperse
    flower.setDisperse(state.disperse)
  },
  release() {
    cfg.forceDisperse = null
  },
}

if (cfg.autoHand) enableHands().catch(() => {})

if (cfg.debug) {
  hudEl.hidden = false
  document.body.classList.add('is-debug')
}

setStatus(cfg.sim ? '鼠标模拟 · 上下移动改变扩散度' : '自动模式 · 花朵与满屏之间循环')
