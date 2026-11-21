<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { EyePlayer } from '../three/EyePlayer.js'
import { MeteorField } from '../three/MeteorField.js'

const emit = defineEmits(['finish'])

const overlay = ref(null)
const eyeCanvas = ref(null)
const meteorCanvas = ref(null)
const enterHint = ref(null)

let eye = null
let meteor = null
let started = false
let done = false
let meteorOn = false
let waiting = false
let timers = []
let clickBound = false

// 时间线（本轮需求）：
//   4.6s  = 瞳孔推进开始，流星雨画布开始逐渐淡入（与推进同步）
//   7.8s  = 推进结束（T_Z0 4.6 + T_ZD 3.2），流星雨完全接管、停眼睛引擎
//   之后不再自动变化，等点击任意位置才进落地页
const T = { meteor: 4.6, wait: 7.8 }

function at(sec, fn) { timers.push(setTimeout(fn, sec * 1000)) }
function clearTimers() { timers.forEach(clearTimeout); timers = [] }

function detectMobile() {
  const ua = navigator.userAgent || ''
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  return window.innerWidth < 820 || coarse || /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua)
}

function play() {
  if (started || done) return
  started = true
  if (!overlay.value) return
  overlay.value.hidden = false
  // 下一帧再加 is-on，触发 opacity 过渡
  requestAnimationFrame(() => overlay.value && overlay.value.classList.add('is-on'))

  eye = new EyePlayer(eyeCanvas.value)
  eye.start()
  document.documentElement.setAttribute('data-intro', 'on')

  // 4.6s：瞳孔开始推进 → 字符画淡出、流星雨画布逐渐淡入铺满（服务器部署版星轨+流星）
  at(T.meteor, () => {
    meteorOn = true
    if (overlay.value) overlay.value.classList.add('is-meteor')
    // 不立即 freeze 眼睛：推进的 3.2s 里字符画与流星雨交叉淡入，
    // 瞳孔居中的推进帧依然可见，直到 7.8s 眼睛引擎才停。
    try {
      meteor = new MeteorField(meteorCanvas.value, { mobile: detectMobile() })
      meteor.start()
    } catch (e) {
      // 2D 画布不可用时降级：保留深底，不阻塞交棒
      console.warn('[intro] 流星雨画布初始化失败，降级为纯色底：', e)
    }
  })

  // 7.8s：推进结束、流星雨完全接管 → 停眼睛引擎，显示「点击任意位置进入」
  //       之后界面不再自动变化，只等点击
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
  clearTimers()
  if (eye) { eye.dispose(); eye = null }
  if (meteor) { meteor.dispose(); meteor = null }
  if (clickBound) {
    window.removeEventListener('click', onGlobalClick)
    window.removeEventListener('keydown', onGlobalKey)
    clickBound = false
  }
  if (overlay.value) {
    overlay.value.classList.remove('is-on', 'is-meteor', 'is-waiting')
    overlay.value.classList.add('is-out')
    const ov = overlay.value
    setTimeout(() => { ov.hidden = true }, 500)
  }
  document.documentElement.setAttribute('data-intro', 'off')
  emit('finish')
}

function onGlobalClick(e) {
  // 等点击阶段：任意位置都进落地页；但关闭按钮自己有 stop
  if (waiting) finish()
}
function onGlobalKey(e) {
  if (waiting && (e.key === 'Enter' || e.key === ' ')) finish()
}

function onSkip() { finish() }
function onOverlayClick(e) {
  // 冒泡兜底（等待阶段的全局监听已覆盖，这里只在 waiting 时响应）
  if (waiting) finish()
}

function state() {
  return {
    playing: started && !done,
    done,
    waiting,
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
    ...(eye ? eye.state() : { cellW: 8, cellH: 15, cols: 78, rows: 30, frames: 0, heartDisabled: true, tSpace: 7.8, gazeLocked: true, paper: '#010203' }),
    meteorAt: T.meteor,
    waitAt: T.wait,
  }
}

onMounted(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const params = new URLSearchParams(location.search)
  const noIntro = params.get('intro') === '0' || reduce || params.get('still') === '1'
  if (noIntro) {
    // 不播：立刻交棒，让落地页写字
    if (overlay.value) overlay.value.hidden = true
    document.documentElement.setAttribute('data-intro', 'off')
    emit('finish')
  } else {
    window.addEventListener('click', onGlobalClick)
    window.addEventListener('keydown', onGlobalKey)
    clickBound = true
    play()
  }
  // 暴露给验收脚本
  window.__persistIntroState = state
})

onBeforeUnmount(() => {
  clearTimers()
  if (eye) { eye.dispose(); eye = null }
  if (meteor) { meteor.dispose(); meteor = null }
  if (clickBound) {
    window.removeEventListener('click', onGlobalClick)
    window.removeEventListener('keydown', onGlobalKey)
  }
  if (window.__persistIntroState) delete window.__persistIntroState
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
    <canvas ref="meteorCanvas" class="intro-meteor" id="introMeteor" aria-hidden="true"></canvas>
    <div ref="enterHint" class="intro-enter" id="introEnter" aria-hidden="true">点击任意位置进入</div>
    <!-- 可见的关闭动画按钮：点击立即停止并清理全部动画资源 -->
    <button class="intro-skip" id="introSkip" type="button" @click.stop="onSkip" aria-label="关闭动画并进入">
      关闭动画
    </button>
  </div>
</template>
