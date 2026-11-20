import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/**
 * 满屏 3D 粒子流星雨（Three.js 版，交棒段专用）。
 *
 * 设计约束（来自需求）：
 *   · 用 Points + BufferGeometry + PointsMaterial，**不写自定义 shader**
 *   · AdditiveBlending 叠加发光；PC 端叠 UnrealBloomPass 辉光
 *   · 自动区分移动端/PC：移动端减粒子数 + 关 Bloom，PC 全效果
 *   · 页面不可见（visibilitychange）暂停渲染，恢复可见再继续
 *   · dispose()：停 rAF、释放几何/材质/贴图/渲染器/Bloom/RenderTarget 全部资源
 *
 * 3D 纵深的来源（不用 shader）：正交相机下坐标=像素，直观可控；
 * 分「远/中/近」三层 Points，层的 size / 亮度 / 速度不同 —— 远的小而暗而慢，
 * 近的大而亮而快，肉眼即读出空间纵深。每层另配一层拖尾点。
 *
 * 灰蓝色阶与产品令牌同族：深 #467692 → 主 #78aac8 → 亮 #dbeaf3。
 * 所有轨迹从画外左上同一辐射点发出 —— 近平行 = 流星雨，随机 = 下雨。
 */

const LAYERS = [
  { name: 'far', size: 7, opacity: 0.42, speed: 0.72, color: '#467692', share: 0.42 },
  { name: 'mid', size: 15, opacity: 0.68, speed: 1.0, color: '#78aac8', share: 0.34 },
  { name: 'near', size: 27, opacity: 0.95, speed: 1.34, color: '#dbeaf3', share: 0.24 },
]
const BASE_BG = new THREE.Color('#111a22')

export class MeteorField {
  constructor(canvas, opts = {}) {
    this.canvas = canvas
    this.opts = opts
    this.disposed = false
    this.running = false
    this.visible = !document.hidden
    this.frames = 0
    this.last = 0
    this.raf = 0
    this.spawnAcc = 0
    this.particles = []

    // 移动端判定由外部传入（Vue 侧已做 UA + 指针 + 视口三重检测）。
    this.mobile = opts.mobile === true
    this.maxParticles = this.mobile ? 200 : 520
    this.useBloom = !this.mobile && opts.bloom !== false
    this.spawnPerSec = this.mobile ? 30 : 66

    this._initThree()
    this._initLayers()
    this._initBloom()
    this._initSampleTarget()
    this._bindVisibility()
    this.resize()
  }

  _initThree() {
    // 正交相机：1 世界单位 = 1 像素，坐标推理直观，边界可控。
    this.scene = new THREE.Scene()
    this.scene.background = BASE_BG.clone()

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    this.camera.position.z = 2

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: this.mobile ? 'low-power' : 'high-performance',
      preserveDrawingBuffer: true,
    })
    this.renderer.setClearColor(BASE_BG, 1)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.autoClear = true
  }

  _initLayers() {
    this.sprite = this._makeSprite()
    this.groups = []
    for (const L of LAYERS) {
      const cap = Math.max(8, Math.round(this.maxParticles * L.share))
      const headGeo = new THREE.BufferGeometry()
      const tailGeo = new THREE.BufferGeometry()
      const headPos = new Float32Array(cap * 3)
      const headCol = new Float32Array(cap * 3)
      const TAIL = 9
      const tailPos = new Float32Array(cap * TAIL * 3)
      const tailCol = new Float32Array(cap * TAIL * 3)
      headPos.fill(1e6)
      tailPos.fill(1e6)
      headGeo.setAttribute('position', new THREE.BufferAttribute(headPos, 3))
      headGeo.setAttribute('color', new THREE.BufferAttribute(headCol, 3))
      tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPos, 3))
      tailGeo.setAttribute('color', new THREE.BufferAttribute(tailCol, 3))

      const color = new THREE.Color(L.color)
      const headMat = new THREE.PointsMaterial({
        size: L.size, map: this.sprite, vertexColors: true,
        transparent: true, opacity: L.opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
        sizeAttenuation: false,
      })
      const tailMat = new THREE.PointsMaterial({
        size: L.size * 0.55, map: this.sprite, vertexColors: true,
        transparent: true, opacity: L.opacity * 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
        sizeAttenuation: false,
      })
      const headPoints = new THREE.Points(headGeo, headMat)
      const tailPoints = new THREE.Points(tailGeo, tailMat)
      headPoints.frustumCulled = false
      tailPoints.frustumCulled = false
      // 先画拖尾再画头，层次的 z 也错开一点
      tailPoints.renderOrder = 1
      headPoints.renderOrder = 2
      this.scene.add(tailPoints, headPoints)

      this.groups.push({
        def: L, color, cap, TAIL,
        headGeo, tailGeo, headMat, tailMat, headPoints, tailPoints,
        headPos, headCol, tailPos, tailCol,
      })
    }
  }

  _makeSprite() {
    const s = 64
    const c = document.createElement('canvas')
    c.width = c.height = s
    const g = c.getContext('2d')
    const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    rg.addColorStop(0, 'rgba(255,255,255,1)')
    rg.addColorStop(0.22, 'rgba(230,242,250,.9)')
    rg.addColorStop(0.5, 'rgba(120,170,200,.35)')
    rg.addColorStop(1, 'rgba(70,118,146,0)')
    g.fillStyle = rg
    g.fillRect(0, 0, s, s)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  _initBloom() {
    this.composer = null
    this.bloomPass = null
    if (!this.useBloom) return
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.12)
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass())
  }

  _initSampleTarget() {
    // 独立的小 RenderTarget 供像素自检：Bloom 走 composer 到屏幕，
    // 这里单独把 scene 渲染到离屏 target 再 readRenderTargetPixels，稳定可靠。
    this.sampleTarget = new THREE.WebGLRenderTarget(240, 150)
  }

  _bindVisibility() {
    this._onVis = () => {
      this.visible = !document.hidden
      if (this.visible) {
        this.last = performance.now()
        if (this.running && !this.raf) this.raf = requestAnimationFrame(this._tick)
      } else if (this.raf) {
        cancelAnimationFrame(this.raf)
        this.raf = 0
      }
    }
    document.addEventListener('visibilitychange', this._onVis)
  }

  resize() {
    if (this.disposed) return
    const w = window.innerWidth || 1280
    const h = window.innerHeight || 800
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), this.mobile ? 1.5 : 2)
    this.width = w
    this.height = h
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.canvas.style.width = w + 'px'
    this.canvas.style.height = h + 'px'
    this.camera.left = -w / 2
    this.camera.right = w / 2
    this.camera.top = h / 2
    this.camera.bottom = -h / 2
    this.camera.updateProjectionMatrix()
    if (this.composer) this.composer.setSize(w, h)
    if (this._onResize) window.removeEventListener('resize', this._onResize)
    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)
    // 辐射点：画外左上，用世界坐标（中心为原点，y 向上为正）。
    // 视锥 x∈[-w/2,w/2]、y∈[-h/2,h/2]，所以 -0.62w 在左画外、+0.60h 在上画外。
    this.radiant = {
      x: -w * 0.62,
      y: h * 0.60,
    }
  }

  _spawn() {
    if (this.particles.length >= this.maxParticles) return
    // 辐射角：朝右下（世界坐标 vx>0, vy<0），约 40°±8°
    const angle = (Math.PI * 0.22) + (Math.random() - 0.5) * 0.28
    const gi = Math.random() < 0.42 ? 0 : (Math.random() < 0.58 ? 1 : 2)
    const g = this.groups[gi]
    const base = 640 + Math.random() * 460 // px/s
    const speed = base * g.def.speed
    const spread = 34
    this.particles.push({
      x: this.radiant.x + (Math.random() - 0.5) * spread,
      y: this.radiant.y + (Math.random() - 0.5) * spread,
      vx: Math.cos(angle) * speed,
      vy: -Math.sin(angle) * speed,
      gi,
      life: 0,
      maxLife: 1.15 + Math.random() * 1.15,
      bright: 0.72 + Math.random() * 0.28,
    })
  }

  _writeBuffers() {
    for (const g of this.groups) {
      g.headPos.fill(1e6)
      g.tailPos.fill(1e6)
      g._n = 0
    }
    for (const p of this.particles) {
      const g = this.groups[p.gi]
      if (!g || g._n >= g.cap) continue
      const fade = Math.max(0, 1 - p.life / p.maxLife)
      const c = g.color
      const i = g._n++
      // 粒子坐标本身就是世界坐标（正交相机中心在原点），直接使用
      const wx = p.x
      const wy = p.y
      const r = c.r * fade * p.bright, gg = c.g * fade * p.bright, b = c.b * fade * p.bright
      g.headPos[i * 3] = wx
      g.headPos[i * 3 + 1] = wy
      g.headPos[i * 3 + 2] = 0
      g.headCol[i * 3] = r
      g.headCol[i * 3 + 1] = gg
      g.headCol[i * 3 + 2] = b
      // 拖尾沿速度反方向
      for (let t = 0; t < g.TAIL; t++) {
        const k = i * g.TAIL + t
        const back = (t + 1) * 2.6
        g.tailPos[k * 3] = wx - p.vx * back * 0.016
        g.tailPos[k * 3 + 1] = wy - p.vy * back * 0.016
        g.tailPos[k * 3 + 2] = 0
        const tf = fade * p.bright * (1 - (t + 1) / (g.TAIL + 1)) * 0.85
        g.tailCol[k * 3] = c.r * tf
        g.tailCol[k * 3 + 1] = c.g * tf
        g.tailCol[k * 3 + 2] = c.b * tf
      }
    }
    for (const g of this.groups) {
      g.headGeo.attributes.position.needsUpdate = true
      g.headGeo.attributes.color.needsUpdate = true
      g.tailGeo.attributes.position.needsUpdate = true
      g.tailGeo.attributes.color.needsUpdate = true
    }
  }

  _tick = (now) => {
    if (this.disposed || !this.running) return
    if (!this.visible) { this.raf = 0; return }
    const dt = Math.min((now - this.last) / 1000, 0.05)
    this.last = now

    this.spawnAcc += dt * this.spawnPerSec
    while (this.spawnAcc >= 1) { this._spawn(); this.spawnAcc -= 1 }

    const w = this.width, h = this.height
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life += dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.life >= p.maxLife || p.x > w * 0.62 || p.y < -h * 0.62) {
        this.particles.splice(i, 1)
      }
    }
    this._writeBuffers()

    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
    this.frames++
    this.raf = requestAnimationFrame(this._tick)
  }

  start() {
    if (this.disposed || this.running) return
    this.running = true
    this.last = performance.now()
    if (this.visible && !this.raf) this.raf = requestAnimationFrame(this._tick)
  }

  /** 像素采样（自检/验收用）：把 scene 渲到小 target 再读，避开 composer。 */
  samplePixels() {
    if (this.disposed) return null
    const prev = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.sampleTarget)
    this.renderer.render(this.scene, this.camera)
    const w = this.sampleTarget.width, h = this.sampleTarget.height
    const buf = new Uint8Array(w * h * 4)
    this.renderer.readRenderTargetPixels(this.sampleTarget, 0, 0, w, h, buf)
    this.renderer.setRenderTarget(prev)
    let warm = 0, magenta = 0, lit = 0, blueish = 0, total = 0
    for (let i = 0; i < buf.length; i += 4) {
      const R = buf[i], G = buf[i + 1], B = buf[i + 2]
      total++
      if (R > 140 && G > 80 && B < 90 && R > B * 1.8) warm++
      if (R > 70 && B > 55 && G < R * 0.72 && B > G * 1.25) magenta++
      if (R + G + B > 60) lit++
      if (B > R) blueish++
    }
    return { warm, magenta, lit, blueish, total, sampling: total }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis)
    if (this._onResize) window.removeEventListener('resize', this._onResize)

    this.particles.length = 0
    for (const g of this.groups) {
      g.headGeo.dispose()
      g.tailGeo.dispose()
      g.headMat.dispose()
      g.tailMat.dispose()
    }
    if (this.sprite) this.sprite.dispose()
    if (this.bloomPass) this.bloomPass.dispose()
    if (this.composer) {
      this.composer.passes.forEach((p) => p.dispose && p.dispose())
      this.composer.dispose()
    }
    if (this.sampleTarget) this.sampleTarget.dispose()
    if (this.renderer) {
      this.renderer.dispose()
      this.renderer.forceContextLoss()
    }
    this.scene && this.scene.clear()
  }
}
