<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import IntroOverlay from './components/IntroOverlay.vue'

// 构建期注入的合规信息片段（ICP / 公安备案号）。
// 唯一来源 deploy/site-info.json，渲染函数与静态页共用
// deploy/scripts/site-info-core.mjs 的 siteInfoRender —— 两端必须逐字节相同，
// 否则 Vue hydrate 会报内容不匹配（check-landing 会红）。
const SITE_INFO = typeof __SITE_INFO_RENDER__ === 'undefined'
  ? { className: 'site-info-pending', html: '备案信息待下发' }
  : __SITE_INFO_RENDER__

const reduce = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const STILL = typeof window !== 'undefined'
  && (/[?&]still=1/.test(location.search) || reduce)

const motionOn = ref(!reduce)
let wmPaths = []
let moveHandler = null
let readyFired = false

function drawTitle() {
  const paths = wmPaths
  paths.forEach((el) => {
    let len = 0
    try { len = el.getTotalLength() } catch (e) { /* noop */ }
    if (!len) { el.classList.add('is-drawn'); return }
    el.style.setProperty('--len', len.toFixed(1))
  })
  paths.forEach((el, i) => {
    setTimeout(() => el.classList.add('is-drawn'), reduce ? 0 : 260 + i * 115)
  })
}

function showTitleNow() {
  wmPaths.forEach((el) => el.classList.add('is-drawn'))
}

function onIntroFinish() {
  // 开场交棒后才开始写标题
  if (readyFired) return
  readyFired = true
  drawTitle()
}

function applyMotion(on) {
  motionOn.value = on
  document.documentElement.setAttribute('data-motion', on ? 'on' : 'off')
  if (!on) showTitleNow()
}

function toggleMotion() {
  const on = motionOn.value !== true
  applyMotion(on)
  try { localStorage.setItem('persist.motion', on ? 'on' : 'off') } catch (e) { /* 隐私模式忽略 */ }
}

function onMove(e) {
  const eye = document.getElementById('emEye')
  if (reduce || !eye) return
  const b = eye.getBoundingClientRect()
  if (!b.width) return
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2
  let nx = (e.clientX - cx) / Math.max(240, window.innerWidth * 0.32)
  let ny = (e.clientY - cy) / Math.max(240, window.innerHeight * 0.32)
  const d = Math.sqrt(nx * nx + ny * ny)
  if (d > 1) { nx /= d; ny /= d }
  eye.setAttribute('transform', 'translate(' + (nx * 2.6).toFixed(2) + ',' + (ny * 2.6).toFixed(2) + ')')
}

function liveState() {
  const wm = document.getElementById('wordmark')
  const cta = document.getElementById('cta')
  const wr = wm ? wm.getBoundingClientRect() : null
  const cr = cta ? cta.getBoundingClientRect() : null
  const paths = Array.prototype.slice.call(document.querySelectorAll('.wm-path'))
  return {
    wrapW: window.innerWidth, wrapH: window.innerHeight,
    hasSkyCanvas: !!document.getElementById('sky'),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    wmPaths: paths.length,
    wmDrawn: paths.filter((p) => p.classList.contains('is-drawn')).length,
    wmRect: wr ? { top: +wr.top.toFixed(1), bottom: +wr.bottom.toFixed(1), w: +wr.width.toFixed(1) } : null,
    ctaRect: cr ? { top: +cr.top.toFixed(1), bottom: +cr.bottom.toFixed(1) } : null,
    wmInViewport: wr ? (wr.top >= 0 && wr.bottom <= window.innerHeight) : null,
    ctaInViewport: cr ? (cr.top >= 0 && cr.bottom <= window.innerHeight) : null,
    hasTerminal: !!document.querySelector('.term'),
    hasEyemark: !!document.getElementById('eyemark'),
    keys: document.querySelectorAll('.keys li').length,
    narrow: window.innerWidth <= 900,
    reduce, still: STILL,
    motion: document.documentElement.getAttribute('data-motion'),
  }
}

onMounted(() => {
  wmPaths = Array.prototype.slice.call(document.querySelectorAll('.wm-path'))
  // 动效偏好：尊重 localStorage 与系统设置
  let stored = null
  try { stored = localStorage.getItem('persist.motion') } catch (e) { /* noop */ }
  const wantOn = stored === null ? !reduce : stored === 'on'
  applyMotion(wantOn)

  window.addEventListener('mousemove', onMove)
  window.__persistLandingState = liveState

  // 子组件 IntroOverlay 的 onMounted 与 emit 时序不稳定：无开场时它 emit('finish')
  // 可能早于本组件准备好 wmPaths。这里独立判定「无开场」并直接画标题，不依赖 emit。
  const params = new URLSearchParams(location.search)
  const noIntro = params.get('intro') === '0' || reduce || params.get('still') === '1'
  if (noIntro) {
    // 不检查 readyFired：IntroOverlay 的 emit 可能已把它置 true，
    // 但那次 drawTitle 读到的是空数组。这里强制重画一次。
    readyFired = true
    requestAnimationFrame(drawTitle)
  }

  // 自检块（?selftest=1）
  if (/[?&]selftest=1/.test(location.search)) {
    setTimeout(() => {
      const d = document.createElement('pre')
      d.id = 'selftest'
      d.style.cssText = 'position:fixed;left:0;bottom:0;z-index:9;font:11px monospace;color:#046;background:#fffc;padding:6px;max-width:100vw;white-space:pre-wrap'
      d.textContent = JSON.stringify(liveState(), null, 2)
      document.body.appendChild(d)
    }, 2600)
  }

  // 兜底：15s 后无论开场如何都写标题
  setTimeout(() => { if (!readyFired) { readyFired = true; showTitleNow() } }, 15000)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMove)
  if (window.__persistLandingState) delete window.__persistLandingState
})
</script>

<template>
  <IntroOverlay @finish="onIntroFinish" />

  <div class="stage" id="stage" aria-hidden="true">
    <div class="grid"></div>
    <div class="glow"></div>
    <div class="vignette"></div>
  </div>

  <div class="wrap">
    <header class="topbar">
      <a class="brand" href="home.html">
        <svg class="eyemark" id="eyemark" viewBox="0 0 44 26" aria-hidden="true">
          <defs>
            <clipPath id="eyeClip">
              <path d="M 2,13 C 10,1.5 34,1.5 42,13 C 34,24.5 10,24.5 2,13 Z"></path>
            </clipPath>
          </defs>
          <g clip-path="url(#eyeClip)">
            <g class="em-eye" id="emEye">
              <circle class="em-iris" cx="22" cy="13" r="8.6"></circle>
              <circle class="em-pupil" cx="22" cy="13" r="3.9"></circle>
              <circle class="em-glint" cx="24.8" cy="10.4" r="1.9"></circle>
            </g>
          </g>
          <path class="em-lid" d="M 2,13 C 10,1.5 34,1.5 42,13 C 34,24.5 10,24.5 2,13 Z"></path>
        </svg>
        <span>Persist</span>
      </a>
      <div class="top-actions">
        <button class="motion-toggle" id="motionToggle" type="button" :aria-pressed="motionOn ? 'true' : 'false'" @click="toggleMotion">
          <span class="motion-dot" aria-hidden="true"></span>
          <span id="motionLabel">{{ motionOn ? '动效 开' : '动效 关' }}</span>
        </button>
        <a class="toplink" href="home.html">产品介绍</a>
      </div>
    </header>

    <main class="stage-main">
      <svg class="wordmark" id="wordmark" viewBox="-6.0 -176.0 342.3 186.0" role="img" aria-label="Persist">
        <g transform="skewX(-11)">
          <path class="wm-path" d="M 4,0 C 6,-52 8,-112 10,-158 C 42,-166 60,-148 58,-124 C 56,-102 32,-92 12,-94"></path>
          <path class="wm-path" d="M -2,-56 L 46,-56" transform="translate(65,0)"></path>
          <path class="wm-path" d="M 46,-56 C 46,-84 34,-102 18,-100 C 2,-98 -6,-76 0,-56 C 6,-30 26,-16 44,-32" transform="translate(65,0)"></path>
          <path class="wm-path" d="M 2,0 C 3,-30 5,-60 7,-92" transform="translate(130,0)"></path>
          <path class="wm-path" d="M 7,-92 C 12,-99 24,-97 28,-86" transform="translate(130,0)"></path>
          <path class="wm-path" d="M 32,-88 C 24,-102 0,-102 0,-84 C 0,-68 30,-70 30,-46 C 30,-26 8,-16 0,-32" transform="translate(167,0)"></path>
          <path class="wm-path" d="M 0,0 C 2,-32 3,-66 4,-100" transform="translate(206,0)"></path>
          <path class="wm-path" d="M 6,-118 C 9,-126 16,-127 19,-122" transform="translate(206,0)"></path>
          <path class="wm-path" d="M 32,-88 C 24,-102 0,-102 0,-84 C 0,-68 30,-70 30,-46 C 30,-26 8,-16 0,-32" transform="translate(231,0)"></path>
          <path class="wm-path" d="M 12,-142 C 8,-104 5,-56 5,-24 C 5,-8 20,-4 30,-16" transform="translate(270,0)"></path>
          <path class="wm-path" d="M -10,-96 C 8,-102 24,-100 38,-94" transform="translate(270,0)"></path>
        </g>
      </svg>
      <p class="slogan" id="slogan">把每天的碎片写下来，<em>晚上看懂自己</em>。</p>

      <ul class="keys" aria-label="关键词">
        <li><b>记录</b></li>
        <li><b>复盘</b></li>
        <li><b>变化</b></li>
        <li>离线可用</li>
        <li>数据自持</li>
      </ul>

      <div class="cta" id="cta">
        <a class="btn btn-primary" href="home.html">看看它能做什么</a>
        <a class="btn btn-ghost" href="home.html#story">先看一段解读</a>
      </div>
      <p class="note">不用注册。数据默认只存在你自己的设备上。</p>
    </main>
  </div>

  <footer class="foot">
    <span class="site-info"><!--site-info--><span :class="SITE_INFO.className" v-html="SITE_INFO.html"></span><!--/site-info--></span>
  </footer>
</template>
