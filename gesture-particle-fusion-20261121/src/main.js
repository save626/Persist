/**
 * 统一入口：一个渲染引擎 + 一套手势状态 + 六个可切换场景。
 *
 * 这里刻意不做"每个场景自己 new 一个 renderer / 自己起一个 rAF"——
 * 原五个仓库都是那样的结构，共存会互相抢 canvas 与帧率。
 */
import { createParticleStage } from './stage.js'
import { GestureState } from './core/gestures.js'
import { HandTracker } from './core/hand-tracker.js'
import { createOverlay } from './core/overlay.js'
import { createMeteors } from './core/meteors.js'
import { SCENES } from './scenes/index.js'
import { createUI } from './ui/ui.js'

const canvas = document.querySelector('#stage')
const overlayCanvas = document.querySelector('#hand-overlay')
const meteorCanvas = document.querySelector('#meteors')

// 渲染层收进 stage（同一份代码也被落地页开场复用），这里只做壳
const stage = createParticleStage({ canvas, sceneId: 'flower' })
const engine = stage.engine
const gestures = new GestureState()
const overlay = createOverlay(overlayCanvas)
const tracker = new HandTracker({ numHands: 2 })
/** 背景流星雨 + 星轨（只在「花瓣」场景显示；该场景 WebGL 清成透明） */
const meteors = createMeteors(meteorCanvas)
meteors.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2))
window.addEventListener('resize', () => {
  meteors.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2))
})

let current = null
let currentId = SCENES[0].id
let handEnabled = false
let paused = false
/** 验收/演示用的手势快照；非 null 时优先于真实摄像头 */
let forced = null
let fps = 0
let frameCount = 0
let fpsAt = performance.now()

const ui = createUI({
  scenes: SCENES,
  onSelect: (id) => loadScene(id),
  onToggleHands: () => toggleHands(),
  onFullscreen: () => toggleFullscreen(),
  onColor: (hex) => {
    tintColor = hex
    current?.setTint?.(hex)
  },
})

/** 当前选中的粒子颜色（切场景时重新套用） */
let tintColor = '#ffffff'

function loadScene(id) {
  const inst = stage.loadScene(id)
  current = inst
  currentId = stage.sceneId
  const entry = SCENES.find((s) => s.id === currentId) || SCENES[0]
  ui.setActive(entry)
  // 新场景套用当前颜色
  current.setTint?.(tintColor)
  // 只有透出背景层的场景才显示流星雨/星轨
  document.body.classList.toggle('has-meteors', Boolean(inst.transparentBackground))
  if (!inst.transparentBackground) meteors.clear()
}

async function toggleHands() {
  if (handEnabled) {
    tracker.stop()
    handEnabled = false
    overlay.clear()
    ui.setHandsState('idle')
    ui.status('手势已关闭 · 自动循环')
    return
  }
  const cap = HandTracker.capability()
  if (!cap.ok) {
    ui.toast(cap.message, cap.hint)
    return
  }
  ui.setHandsState('loading')
  ui.status('正在申请摄像头…')
  try {
    await tracker.start(document.querySelector('#cam'))
    handEnabled = true
    ui.setHandsState('on')
    ui.status('手势已开启 · 张手/握拳/捏合/双手张距')
  } catch (err) {
    ui.setHandsState('error')
    ui.status(err.message, 'error')
    ui.toast(err.message, err.hint || '仍可切场景查看自动动画')
    handEnabled = false
  }
}

function toggleFullscreen() {
  const el = document.documentElement
  if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {})
  else document.exitFullscreen?.().catch(() => {})
}

document.addEventListener('fullscreenchange', () => ui.setFullscreen(Boolean(document.fullscreenElement)))

document.addEventListener('visibilitychange', () => {
  paused = document.hidden
})

// 键盘：1-6 切场景、F 全屏、H 手势
window.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= String(SCENES.length)) loadScene(SCENES[Number(e.key) - 1].id)
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen()
  else if (e.key === 'h' || e.key === 'H') toggleHands()
})

loadScene(currentId)

const video = document.querySelector('#cam')

function frame(now) {
  requestAnimationFrame(frame)
  if (paused) return

  const dt = Math.min(0.05, Math.max(0, (now - (frame.last || now)) / 1000))
  frame.last = now

  let hands = []
  if (handEnabled) {
    const res = tracker.detect(now)
    hands = res.hands || []
    if (hands[0]) overlay.draw(hands[0], { mirror: true, alpha: 0.9 })
    else overlay.clear()
  }
  if (forced) {
    // 验收 / 演示：直接把快照写进手势状态，跳过真实输入
    Object.assign(gestures, {
      active: forced.active ?? true,
      hands: forced.hands ?? 1,
      palm: forced.palm ?? 0,
      fist: forced.fist ?? 1 - (forced.palm ?? 0),
      pinch: forced.pinch ?? 0,
      spread: forced.spread ?? 0,
      fingers: forced.fingers ?? 0,
    })
  } else {
    gestures.update(hands, dt, now)
  }

  engine.update(dt, gestures)

  // 背景流星雨/星轨：只有花瓣场景（WebGL 透明）才更新，其它场景清空
  if (current?.transparentBackground) meteors.update(dt)
  else meteors.clear()

  engine.render()

  frameCount++
  if (now - fpsAt > 500) {
    fps = Math.round((frameCount * 1000) / (now - fpsAt))
    frameCount = 0
    fpsAt = now
  }
  ui.hud({
    fps,
    scene: SCENES.find((s) => s.id === currentId),
    gestures,
    label: current?.focusLabel ?? current?.shapeLabel ?? '',
  })
}

/**
 * 验收用的像素测量：立刻画一帧再读回，统计亮像素比例与包围盒。
 * 六个场景共用，省得每个场景自己写一遍。
 */
function measure() {
  engine.render()
  const gl = engine.renderer.getContext()
  const w = gl.drawingBufferWidth
  const h = gl.drawingBufferHeight
  const buf = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)

  let lit = 0
  let sum = 0
  let sr = 0
  let sg = 0
  let sb = 0
  let minX = w
  let maxX = 0
  let minY = h
  let maxY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]
      if (lum < 12) continue
      lit++
      sum += lum
      sr += buf[i]
      sg += buf[i + 1]
      sb += buf[i + 2]
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
    meanLum: lit ? sum / lit : 0,
    /** 平均色（用于验证颜色选择器是否生效） */
    avgRGB: lit ? { r: sr / lit, g: sg / lit, b: sb / lit } : null,
    bbox: lit ? { minX: minX / w, maxX: maxX / w, minY: minY / h, maxY: maxY / h } : null,
  }
}

requestAnimationFrame(frame)

// 供验收脚本使用
window.__fusion = {
  ready: true,
  measure,
  get sceneId() {
    return currentId
  },
  get fps() {
    return fps
  },
  get gestures() {
    return {
      active: gestures.active,
      hands: gestures.hands,
      palm: gestures.palm,
      pinch: gestures.pinch,
      spread: gestures.spread,
      fingers: gestures.fingers,
    }
  },
  loadScene,
  get scenes() {
    return SCENES.map((s) => s.id)
  },
  setColor(hex) {
    tintColor = hex
    current?.setTint?.(hex)
  },
  get tint() {
    return tintColor
  },
  /** 注入一次手势快照（无摄像头时验收 / 演示用）。传 null 释放回真实输入。 */
  inject(patch) {
    if (patch === null) {
      forced = null
      return
    }
    forced = { ...patch }
  },
  toggleHands,
  video,
}
