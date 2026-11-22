<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { EyePlayer } from '../three/EyePlayer.js'
import { MeteorField } from '../three/MeteorField.js'

const emit = defineEmits(['finish'])

const overlay = ref(null)
const eyeCanvas = ref(null)
const meteorCanvas = ref(null)
const particleCanvas = ref(null)
const enterHint = ref(null)
const camEl = ref(null)
const tipEl = ref(null)
/** file:// 下摄像头不可用，「开启手势」直接不显示 */
const canGesture = ref(true)

let eye = null
let meteor = null
let stage = null
let tracker = null
let gestures = null
let raf = 0
let frames = 0
let lastAt = 0
let revealAt = 0
let started = false
let done = false
let meteorOn = false
let particleOn = false
let waiting = false
let handEnabled = false
const sceneId = ref('flower')
let uiVisible = false
let tipTimer = 0
let timers = []
let clickBound = false
let startedAt = 0
/** 验收用：注入的手势快照（非 null 时优先于真实摄像头） */
let forced = null

// 时间线：
//   3.6s  = 预热粒子舞台（建上下文、编译着色器，遮罩仍 0）
//   4.6s  = 瞳孔推进开始（T_Z0），星空底图+流星淡入；同帧粒子从瞳孔中心径向揭开
//   7.6s  = 界面壳淡入（场景切换 / 开启手势 / 全屏）
//   7.8s  = 推进结束（T_Z0+T_ZD）；停眼睛、粒子定格、显示「点击任意位置进入」
//   之后：点任意空白处进落地页；点按钮不触发（按钮都 stopPropagation）
const EYE_T_Z0 = 6.2 // 眼睛段：从睁眼到瞳孔推进开始的时长（原 4.6，本轮延长 1.6s）
const EYE_T_ZD = 3.2 // 瞳孔推进时长
const T = {
  warm: EYE_T_Z0 - 1.0, // 粒子舞台预热（提前 1s 建上下文/编译着色器）
  meteor: EYE_T_Z0, // 瞳孔推进开始：星空 + 流星 + 粒子揭开
  particle: EYE_T_Z0,
  ui: EYE_T_Z0 + EYE_T_ZD - 0.2, // 推进结束前 0.2s 界面壳淡入
  wait: EYE_T_Z0 + EYE_T_ZD, // 推进结束：定格，等点击
}

const ENTER_MS = 3000

/**
 * 无手势呼吸循环：模仿圣诞树的 16s 循环。
 *
 * 圣诞树的做法（`lights-tree.js`）：16s 一圈，三角波（0→1→0）过 smoothstep，
 * 两端自然减速形成"停留感"；再用逐帧低通 `approach(mix, target, 0.05, dt)` 软化。
 *
 * 花瓣照搬这套节奏，但因为"花瓣 disperse 在 0.1–0.5 之间会把花心掏空、六瓣糊成云"，
 * 这里用**双重 smoothstep**（S 形更陡）：两端（六瓣 / 满屏粒子场）停留更久，
 * 中间那段"半散"快速掠过，既保留圣诞树的呼吸感，又不暴露难看的中间态。
 */
const AUTO_PERIOD = 16

function autoDisperse(seconds) {
  const p = (((seconds % AUTO_PERIOD) + AUTO_PERIOD) % AUTO_PERIOD) / AUTO_PERIOD
  const half = p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5 // 0→1→0
  const s1 = half * half * (3 - 2 * half)
  return s1 * s1 * (3 - 2 * s1)
}

/** 逐帧低通（与圣诞树同一个 0.05 系数）：目标突然变化时也不会一帧跳到位 */
function approach(cur, target, perFrame, dt) {
  const k = 1 - Math.pow(1 - perFrame, dt * 60)
  return cur + (target - cur) * k
}
const SCENES = [
  { id: 'flower', label: '花瓣' },
  { id: 'lights', label: '圣诞树' },
]
const IDLE = { active: false, hands: 0, palm: 0, fist: 0, pinch: 0, spread: 0, fingers: 0, pos: { x: 0, y: 0 } }

function at(sec, fn) { timers.push(setTimeout(fn, sec * 1000)) }
function clearTimers() { timers.forEach(clearTimeout); timers = [] }

function detectMobile() {
  const ua = navigator.userAgent || ''
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  return window.innerWidth < 820 || coarse || /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua)
}

/** 桌面端才挂 3D 粒子；移动端保留流星雨 + 点击进入（不挂降配版粒子） */
function particleEligible() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return false
  return window.innerWidth >= 900
}

/** 手势需要安全上下文 + 同源 MediaPipe 资源目录（build 时同步到 landing/fusion/mediapipe） */
function gestureEligible() {
  return location.protocol !== 'file:'
}

let disperseMix = 0
let stageError = ''
let uiHintShown = false

/** 界面壳只在粒子舞台真的起来后显示；否则按钮点了也没东西可切 */
function showUiOnce() {
  if (uiHintShown || !stage) return
  uiHintShown = true
  uiVisible = true
  if (overlay.value) overlay.value.classList.add('is-ui')
  // 进入界面时给一次提示：手势不自动开启，要用户自己点
  tip(
    canGesture.value
      ? '可用手势：点「开启手势」后，张手散开 / 捏合聚合（不会自动开摄像头）'
      : '可用手势需要 http://localhost 或 https 打开；当前仅自动演示',
    5200,
  )
}

function smoothstep(k) {
  const x = Math.max(0, Math.min(1, k))
  return x * x * (3 - 2 * x)
}

function tip(text, ms = 3200) {
  if (!tipEl.value) return
  tipEl.value.textContent = text || ''
  tipEl.value.classList.toggle('is-on', Boolean(text))
  clearTimeout(tipTimer)
  if (text) tipTimer = setTimeout(() => tipEl.value && tipEl.value.classList.remove('is-on'), ms)
}

async function mountParticle() {
  if (!particleEligible()) {
    // 窄窗口（非触屏）也给一句解释，否则用户会以为"粒子没了"
    if (!window.matchMedia('(pointer: coarse)').matches) {
      tip('窗口宽度不足 900px，已跳过 3D 粒子段（流星雨与点击进入仍然可用）', 5200)
    }
    return
  }
  if (!particleCanvas.value || stage) return
  try {
    const { createParticleStage } = await import('@fusion/stage.js')
    stage = createParticleStage({ canvas: particleCanvas.value, sceneId: sceneId.value })
    stage.setAuto(false)
    stage.setDisperse(0)
    stage.setScale(0.4)
    // 保留 bloom 原始配色；开场不做颜色选择器
    stage.setTint('#ffffff')
    window.__introParticle = stage
    particleOn = true
    stageError = ''
    if (overlay.value) overlay.value.classList.add('is-particle')
    // 若预热刚好跨过了 7.6s，补一次界面壳（否则会永远不显示）
    if (startedAt && (performance.now() - startedAt) / 1000 >= T.ui) showUiOnce()
    loop()
  } catch (err) {
    stageError = String((err && err.message) || err)
    console.warn('[intro] 粒子舞台初始化失败，退回流星雨层：', err)
    stage = null
    particleOn = false
    // 没有舞台就不显示界面壳；给一句人话，而不是让按钮看起来"点了没反应"
    tip('当前窗口或显卡无法运行 3D 粒子（WebGL 不可用 / 窗口过窄），已跳过粒子段', 5200)
  }
}

function revealParticle() {
  if (!stage) return
  revealAt = performance.now() - 16
}

function loop(now) {
  if (!stage) return
  raf = requestAnimationFrame(loop)
  const t = now || performance.now()
  const dt = Math.min(0.05, Math.max(0, (t - (lastAt || t)) / 1000))
  lastAt = t

  const gestureMode = handEnabled || forced !== null
  let g = IDLE
  if (handEnabled && tracker && gestures) {
    const res = tracker.detect(t)
    gestures.update(res.hands || [], dt, t)
    g = gestures
  } else if (forced) {
    g = forced
  }

  if (sceneId.value === 'flower' && !gestureMode && revealAt) {
    const sinceReveal = t - revealAt
    if (sinceReveal < ENTER_MS) {
      // 入场：从瞳孔长出来（缩放 0.4→1），扩散度保持 0
      stage.setDisperse(0)
      stage.setScale(0.4 + 0.6 * smoothstep(sinceReveal / ENTER_MS))
    } else {
      // 入场之后：16s 呼吸循环（同圣诞树），逐帧低通后再下发
      const target = autoDisperse((sinceReveal - ENTER_MS) / 1000)
      disperseMix = approach(disperseMix, target, 0.05, dt)
      stage.setDisperse(disperseMix)
      stage.setScale(1)
    }
  }

  stage.update(dt, g)
  stage.render()
  frames++
}

async function toggleHands() {
  if (handEnabled) {
    tracker && tracker.stop()
    handEnabled = false
    setGestureMode(false)
    tip('手势已关闭 · 自动演示')
    return
  }
  if (!gestureEligible()) {
    tip('手势需要 http://localhost 或 https 打开（file:// 下浏览器不允许摄像头）')
    return
  }
  tip('正在申请摄像头…')
  try {
    if (!tracker) {
      const [{ GestureState }, { HandTracker }] = await Promise.all([
        import('@fusion/core/gestures.js'),
        import('@fusion/core/hand-tracker.js'),
      ])
      gestures = new GestureState()
      // build 会把 vendor/mediapipe 同步到 landing/fusion/mediapipe
      tracker = new HandTracker({ numHands: 2, base: './fusion/mediapipe' })
    }
    await tracker.start(camEl.value)
    handEnabled = true
    setGestureMode(true)
    tip('手势已开启 · 张手散开 / 握拳聚合')
  } catch (err) {
    handEnabled = false
    tip(err && err.message ? err.message : '手势启动失败')
  }
}

/** 手势模式下：花瓣跟手掌走；关掉时回到"定格完整六瓣" */
function setGestureMode(on) {
  if (!stage) return
  if (sceneId.value === 'flower') {
    stage.setAuto(false)
    stage.setDisperse(on ? null : 0)
    stage.setScale(1)
    disperseMix = 0
  }
}

function switchScene(id) {
  const label = (SCENES.find((s) => s.id === id) || {}).label || id
  if (id === sceneId.value) {
    // 点已经选中的场景以前是"静默 return"，看起来就像按钮坏了
    tip(`已经是「${label}」场景`)
    return
  }
  if (!stage) {
    tip('粒子舞台没有起来，无法切换（' + (stageError || 'WebGL 不可用或窗口过窄') + '）')
    return
  }
  try {
    sceneId.value = id
    stage.loadScene(id)
    const yes = handEnabled || forced !== null
    setGestureMode(yes)
    tip(id === 'lights' ? '圣诞树 · 张手炸散 / 握拳收树' : '花瓣 · 张手散开 / 捏合聚合')
  } catch (err) {
    // 切场景失败不能静默：报错 + 回滚按钮状态
    console.error('[intro] 切换场景失败：', err)
    tip('切换场景失败：' + ((err && err.message) || err))
  }
}

function toggleFullscreen() {
  const el = document.documentElement
  const req = document.fullscreenElement ? el.ownerDocument.exitFullscreen?.() : el.requestFullscreen?.()
  Promise.resolve(req).catch((err) => {
    // 全屏被浏览器策略拒绝时给出可读提示（不是"点了没反应"）
    tip('全屏被浏览器拒绝：' + ((err && err.message) || '需要用户手势或页面已限制'))
  })
}

function play() {
  if (started || done) return
  started = true
  startedAt = performance.now()
  if (!overlay.value) return
  overlay.value.hidden = false
  requestAnimationFrame(() => overlay.value && overlay.value.classList.add('is-on'))

  eye = new EyePlayer(eyeCanvas.value, { tZ0: EYE_T_Z0, tZd: EYE_T_ZD })
  eye.start()
  document.documentElement.setAttribute('data-intro', 'on')

  at(T.warm, () => { mountParticle() })

  at(T.meteor, () => {
    meteorOn = true
    if (overlay.value) overlay.value.classList.add('is-meteor')
    try {
      meteor = new MeteorField(meteorCanvas.value, { mobile: detectMobile() })
      meteor.start()
    } catch (e) {
      console.warn('[intro] 流星雨画布初始化失败，降级为纯色底：', e)
    }
  })

  at(T.particle, () => { revealParticle() })

  // 推进开始 2.4s 后眼睛已完全淡出，提前释放 2D 画布
  at(EYE_T_Z0 + 2.4, () => {
    if (eye) { eye.dispose(); eye = null }
  })

  at(T.ui, () => {
    // 粒子舞台没起来就不显示界面壳（避免"按钮点了没反应"）；若挂载晚于 UI 时刻，
    // mountParticle 成功后自己补一次 showUiOnce
    if (!stage) return
    showUiOnce()
  })

  at(T.wait, () => {
    waiting = true
    if (overlay.value) overlay.value.classList.add('is-waiting')
    if (eye) { eye.dispose(); eye = null }
  })
}

function finish() {
  if (done) return
  done = true
  waiting = false
  meteorOn = false
  particleOn = false
  clearTimers()
  if (eye) { eye.dispose(); eye = null }
  if (meteor) { meteor.dispose(); meteor = null }
  if (tracker) { tracker.stop(); tracker = null }
  handEnabled = false
  if (raf) { cancelAnimationFrame(raf); raf = 0 }
  if (stage) { stage.dispose(); stage = null }
  if (clickBound) {
    window.removeEventListener('click', onGlobalClick)
    window.removeEventListener('keydown', onGlobalKey)
    clickBound = false
  }
  if (overlay.value) {
    overlay.value.classList.remove('is-on', 'is-meteor', 'is-particle', 'is-ui', 'is-waiting')
    overlay.value.classList.add('is-out')
    const ov = overlay.value
    setTimeout(() => { ov.hidden = true }, 500)
  }
  document.documentElement.setAttribute('data-intro', 'off')
  emit('finish')
}

function onGlobalClick() {
  // 全屏是"只看画面"：这一状态下点击不交棒（否则没有提示、误触就跳走了）
  if (document.fullscreenElement) return
  if (waiting) finish()
}
function onGlobalKey(e) {
  if (document.fullscreenElement) return
  if (waiting && (e.key === 'Enter' || e.key === ' ')) finish()
}
function onSkip() { finish() }
function onOverlayClick() {
  if (document.fullscreenElement) return
  if (waiting) finish()
}

function state() {
  let measure = null
  try {
    if (stage) {
      const m = stage.measure()
      measure = { litRatio: Number(m.litRatio.toFixed(4)), width: m.width, height: m.height }
    }
  } catch (e) {
    measure = { error: String(e && e.message) }
  }
  return {
    playing: started && !done,
    done,
    waiting,
    elapsed: startedAt ? (performance.now() - startedAt) / 1000 : 0,
    hasCanvas: !!eyeCanvas.value,
    hasSkip: !!overlay.value && !!overlay.value.querySelector('.intro-skip'),
    hasMeteorCanvas: !!meteorCanvas.value,
    meteorOn,
    meteorIsFullscreen: meteorCanvas.value
      ? meteorCanvas.value.clientWidth >= window.innerWidth : false,
    meteorCount: meteor ? meteor.particles.length : 0,
    meteorFrames: meteor ? meteor.frames : 0,
    meteorPixels: meteor ? meteor.samplePixels() : null,
    meteorMobile: meteor ? meteor.mobile : null,
    meteorBloom: meteor ? meteor.useBloom : null,
    particleEligible: particleEligible(),
    particleOn,
    hasParticleCanvas: !!particleCanvas.value,
    particleFrames: frames,
    particleMeasure: measure,
    sceneId: sceneId.value,
    uiVisible,
    handEnabled,
    stageReady: Boolean(stage),
    stageError,
    gestureEligible: gestureEligible(),
    gestureState: gestures
      ? { active: gestures.active, palm: +gestures.palm.toFixed(2), pinch: +gestures.pinch.toFixed(2), spread: +gestures.spread.toFixed(2) }
      : null,
    ...(eye ? eye.state() : { cellW: 8, cellH: 15, cols: 78, rows: 30, frames: 0, heartDisabled: true, tSpace: EYE_T_Z0 + EYE_T_ZD, gazeLocked: true, paper: '#010203' }),
    meteorAt: T.meteor,
    waitAt: T.wait,
  }
}

onMounted(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const params = new URLSearchParams(location.search)
  const noIntro = params.get('intro') === '0' || reduce || params.get('still') === '1'
  if (noIntro) {
    if (overlay.value) overlay.value.hidden = true
    document.documentElement.setAttribute('data-intro', 'off')
    emit('finish')
  } else {
    window.addEventListener('click', onGlobalClick)
    window.addEventListener('keydown', onGlobalKey)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    clickBound = true
    play()
  }
  canGesture.value = gestureEligible()
  window.__persistIntroState = state
  // 排障：一键导出"为什么按钮没反应"相关的环境事实
  window.__introDiag = () => {
    const bar = document.querySelector('#introActions')
    const r = bar ? bar.getBoundingClientRect() : null
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null
    return {
      url: location.href,
      viewport: [window.innerWidth, window.innerHeight],
      coarsePointer: window.matchMedia('(pointer: coarse)').matches,
      particleEligible: particleEligible(),
      stageReady: Boolean(stage),
      stageError,
      uiVisible,
      sceneId: sceneId.value,
      handEnabled,
      overlayHidden: overlay.value ? overlay.value.hidden : null,
      barOpacity: bar ? Number(getComputedStyle(bar).opacity) : null,
      barPointerEvents: bar ? getComputedStyle(bar).pointerEvents : null,
      barRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      hitAtBarCenter: hit ? (hit.id || hit.className || hit.tagName) : null,
      elapsed: startedAt ? (performance.now() - startedAt) / 1000 : 0,
    }
  }
  // 验收/演示：注入手势快照（跳过摄像头）
  window.__introSetGestures = (g) => {
    forced = g || null
    if (sceneId.value === 'flower') setGestureMode(Boolean(forced))
  }
})

function onFullscreenChange() {
  // 全屏时收起状态栏与提示：全屏就是"只看画面"
  const on = Boolean(document.fullscreenElement)
  if (overlay.value) overlay.value.classList.toggle('is-fullscreen', on)
  if (on) tipEl.value && tipEl.value.classList.remove('is-on')
}

onBeforeUnmount(() => {
  clearTimers()
  if (eye) { eye.dispose(); eye = null }
  if (meteor) { meteor.dispose(); meteor = null }
  if (tracker) { tracker.stop(); tracker = null }
  if (raf) { cancelAnimationFrame(raf); raf = 0 }
  if (stage) { stage.dispose(); stage = null }
  if (clickBound) {
    window.removeEventListener('click', onGlobalClick)
    window.removeEventListener('keydown', onGlobalKey)
    document.removeEventListener('fullscreenchange', onFullscreenChange)
  }
  delete window.__persistIntroState
  delete window.__introDiag
  delete window.__introSetGestures
  delete window.__introParticle
})

defineExpose({ state })
</script>

<template>
  <div
    ref="overlay"
    class="intro"
    id="intro"
    hidden
    @click="onOverlayClick"
  >
    <canvas ref="eyeCanvas" class="intro-canvas" id="introCanvas" aria-hidden="true"></canvas>
    <!-- 星空照片底图单独一层：花瓣段要把它淡掉，只留深色底 + 流星 -->
    <div class="intro-sky" id="introSky" aria-hidden="true"></div>
    <canvas ref="meteorCanvas" class="intro-meteor" id="introMeteor" aria-hidden="true"></canvas>
    <canvas ref="particleCanvas" class="intro-particles" id="introParticles" aria-hidden="true"></canvas>
    <video ref="camEl" class="intro-cam" id="introCam" playsinline muted autoplay aria-hidden="true"></video>

    <div ref="enterHint" class="intro-enter" id="introEnter" aria-hidden="true">点击任意位置进入</div>

    <!-- 融合界面壳：场景切换 / 开启手势 / 全屏（都没有颜色选择器） -->
    <div class="intro-actions" id="introActions" aria-label="粒子场景操作">
      <div class="intro-scenes" role="group" aria-label="切换场景">
        <button
          v-for="s in SCENES"
          :key="s.id"
          type="button"
          class="intro-act intro-scene"
          :class="{ 'is-active': sceneId === s.id }"
          :data-scene="s.id"
          :aria-pressed="sceneId === s.id"
          @click.stop="switchScene(s.id)"
        >{{ s.label }}</button>
      </div>
      <span class="intro-sep" aria-hidden="true"></span>
      <button
        v-if="canGesture"
        type="button"
        class="intro-act"
        id="introHands"
        :class="{ 'is-on': handEnabled }"
        :aria-pressed="handEnabled"
        @click.stop="toggleHands"
      >{{ handEnabled ? '手势已开' : '开启手势' }}</button>
      <button type="button" class="intro-act" id="introFullscreen" @click.stop="toggleFullscreen">全屏</button>
    </div>

    <div ref="tipEl" class="intro-tip" id="introTip" role="status" aria-live="polite"></div>

    <!-- 可见的关闭动画按钮：点击立即停止并清理全部动画资源 -->
    <button class="intro-skip" id="introSkip" type="button" @click.stop="onSkip" aria-label="关闭动画并进入">
      关闭动画
    </button>
  </div>
</template>
