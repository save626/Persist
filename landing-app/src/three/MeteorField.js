/**
 * 满屏流星雨（Canvas 2D 版）——完整移植「服务器部署版」landing/index.html（4be7a0f）
 * 的 Canvas 星空实现，去掉 "Hello World" SVG 遮罩扫描文案动画。
 *
 * 视觉构成（与线上那版逐参数一致）：
 *   · 星轨：几何圆弧，绕画面正上方之外的极点公转，长曝光式；4 档亮度 + 3 段渐弱
 *   · 流星：单条渐变尾迹（头部高光 → 尾部透明）+ 头部径向光晕，globalCompositeOperation='lighter'
 *   · 冷蓝色相 hue 192–216，与产品蓝 #467692/#78aac8 同族
 *
 * 本轮变化：不再用 Three.js / WebGL / Bloom / 自定义 shader；改用纯 2D canvas，
 * 文件体积更小、软件渲染兼容、file:// 打开即跑。对外状态接口保持不变，
 * useBloom 兼容字段现在表示「PC 完整效果」（移动端降级）。
 */

const CFG = {
  // 2026-11-23：星空照片底图删掉后，星轨不再有银河照片作衬底。
  // 先按「少而淡」调过一版（52–96 条、亮度上限 0.38），实测太弱、像划痕；
  // 用户要求「数量更多、亮度更高」，于是把数量抬回接近原值、亮度也抬回来。
  trailMin: 130, trailMax: 220,     // 星轨数量，按面积自适应
  arcLen: [0.060, 0.190],           // 星轨弧的角跨度（弧度）
  omega: [0.0025, 0.0110],          // 公转角速度 rad/s
  growT: [5.0, 16.0],               // 弧长长到满所需秒数
  meteorCount: 40,
  meteorSpeed: [300, 620],
  meteorLength: [110, 260],
  meteorAngle: [118, 148],          // 度：向下偏左，与线上版一致
  meteorWidth: [1.2, 2.8],
  meteorHue: [192, 216],            // 冷蓝
  spawnInterval: 0.065,             // 每秒约 15.4 颗
}
const BUCKETS = [0.22, 0.36, 0.52, 0.72]
const SEGS = [
  { f0: 0.00, f1: 0.55, a: 0.18, w: 0.70 },
  { f0: 0.55, f1: 0.85, a: 0.42, w: 1.05 },
  { f0: 0.85, f1: 1.00, a: 0.85, w: 1.45 },
]
const POLE = { x: 0.5, y: -0.30 }   // 相对坐标，画面正上方外部

/**
 * 移动端流星参数（2026-11-23 第二次调整）。
 *
 * 第一版是等距点阵（5 轨 × 6 颗、同向同速）——用户反馈「太规整」。
 * 现在回到随机分布，但把随机限制在一条窄带里：方向、长度、间距都随机，
 * 区间比最早的随机版收窄、数量加密。既不"随机闪一下"，也不像网格。
 *
 * 竖屏专用的两个偏移：
 *   · 角度更偏竖直（104–128°）：桌面 118–148° 的斜线在手机上走不到屏底就出界，
 *     屏幕上只剩右上角在下雨；
 *   · 长度按屏宽取（0.20–0.44 × 390 ≈ 78–172px）：绝对像素长度在窄屏上会顶到 2/3 屏宽。
 */
const MOBILE = {
  count: 46,                  // 同屏上限（最早 22，太稀）
  speed: [250, 360],          // 收窄：不会忽快忽慢，但仍随机
  angle: [104, 128],
  lengthRatio: [0.20, 0.44],  // × 屏宽
  width: [1.0, 2.2],
  alpha: [0.5, 0.95],
  life: [2.0, 3.4],
  spawn: 0.020,               // 约 50 颗/s 的补充抽签 —— 密度靠它顶住
}



function rand(a, b) { return a + Math.random() * (b - a) }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v) }

export class MeteorField {
  constructor(canvas, opts = {}) {
    this.canvas = canvas
    this.ctx = canvas ? canvas.getContext('2d') : null
    this.disposed = false
    this.running = false
    this.visible = !document.hidden
    this.frames = 0
    this.last = 0
    this.raf = 0
    this.spawnAcc = 0
    this.W = 0
    this.H = 0
    this.DPR = 1
    this.trails = []
    this.buckets = [[], [], [], []]
    this.meteors = []

    // 移动端降级：星轨 / 流星数量减半（线上版无此适配，这里按本项目规范补齐）
    this.mobile = opts.mobile === true
    // 兼容字段：PC 全效果 / 移动端降级（Canvas 2D 无 Bloom，字段语义为「完整效果」）
    this.useBloom = !this.mobile && opts.bloom !== false

    this._bindVisibility()
    this.resize()
    this._seed()
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
    this.W = window.innerWidth || 1280
    this.H = window.innerHeight || 800
    this.DPR = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.floor(this.W * this.DPR)
    this.canvas.height = Math.floor(this.H * this.DPR)
    this.canvas.style.width = this.W + 'px'
    this.ctx.clearRect(0, 0, this.W, this.H)
    this.canvas.style.height = this.H + 'px'
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0)
    this._buildTrails()
    for (const m of this.meteors) this._resetMeteor(m, true)

    if (this._onResize) window.removeEventListener('resize', this._onResize)
    let timer = 0
    this._onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => this.resize(), 180)
    }
    window.addEventListener('resize', this._onResize)
  }

  _buildTrails() {
    const { W, H, ctx } = this
    void ctx
    this.trails.length = 0
    const areaScale = Math.min(1, (W * H) / (1600 * 900))
    let count = Math.round(clamp(
      CFG.trailMin + (CFG.trailMax - CFG.trailMin) * areaScale,
      CFG.trailMin, CFG.trailMax,
    ))
    if (this.mobile) count = Math.round(count * 0.55)
    const px = W * POLE.x, py = H * POLE.y

    for (let i = 0; i < count; i++) {
      // 直接在画面内取点再反算极坐标 —— 保证星一定落在可见区域
      const sx = rand(W * 0.01, W * 0.99)
      const sy = rand(H * 0.02, H * 0.99)
      const dx = sx - px, dy = sy - py
      const r = Math.sqrt(dx * dx + dy * dy)
      if (r < 40) continue
      const bucket = Math.floor(Math.random() * BUCKETS.length)
      this.trails.push({
        r, a: Math.atan2(dy, dx),
        omega: rand(CFG.omega[0], CFG.omega[1]),
        arcMax: rand(CFG.arcLen[0], CFG.arcLen[1]),
        grow: rand(0.15, 1.0),
        growT: rand(CFG.growT[0], CFG.growT[1]),
        b: bucket,
        headR: rand(0.35, 0.95),
        phase: rand(0, Math.PI * 2),
        tw: rand(0.5, 1.4),
      })
    }
    this.buckets = [[], [], [], []]
    for (const t of this.trails) this.buckets[t.b].push(t)
  }

  _resetMeteor(m, initial) {
    if (this.mobile) {
      m.angle = rand(MOBILE.angle[0], MOBILE.angle[1]) * Math.PI / 180
      m.speed = rand(MOBILE.speed[0], MOBILE.speed[1])
      m.length = this.W * rand(MOBILE.lengthRatio[0], MOBILE.lengthRatio[1])
      m.width = rand(MOBILE.width[0], MOBILE.width[1])
      m.alpha = rand(MOBILE.alpha[0], MOBILE.alpha[1])
      m.life = rand(MOBILE.life[0], MOBILE.life[1])
      m.hue = rand(CFG.meteorHue[0], CFG.meteorHue[1])
      m.x = rand(-this.W * 0.15, this.W * 1.15)
      // 初次铺开时撒满整屏（否则开场头两秒只有上半屏在下）；之后都从屏上方重新进入
      m.y = initial ? rand(-this.H * 0.35, this.H * 0.9) : rand(-this.H * 0.4, -20)
      m.maxLife = m.life
      m.delay = initial ? rand(0, 1.2) : rand(0, 0.3)
      return
    }
    m.angle = rand(CFG.meteorAngle[0], CFG.meteorAngle[1]) * Math.PI / 180
    m.speed = rand(CFG.meteorSpeed[0], CFG.meteorSpeed[1])
    m.length = rand(CFG.meteorLength[0], CFG.meteorLength[1])
    m.width = rand(CFG.meteorWidth[0], CFG.meteorWidth[1])
    m.hue = rand(CFG.meteorHue[0], CFG.meteorHue[1])
    m.x = rand(-this.W * 0.1, this.W * 1.15)
    m.y = initial ? rand(-this.H * 0.2, this.H * 0.35) : rand(-this.H * 0.35, -20)
    m.life = rand(1.6, 3.2)          // 寿命翻倍：流星在屏上停留更久
    m.maxLife = m.life
    m.alpha = rand(0.55, 1)
    m.delay = initial ? rand(0, 1.4) : rand(0, 0.5)
  }

  _seed() {
    this.meteors.length = 0
    const n = this.mobile ? MOBILE.count : CFG.meteorCount
    for (let i = 0; i < n; i++) {
      const m = {}
      this._resetMeteor(m, true)
      this.meteors.push(m)
    }
  }

  _updateTrails(dt) {
    for (const t of this.trails) {
      t.a += t.omega * dt
      if (t.grow < 1) t.grow = Math.min(1, t.grow + dt / t.growT)
    }
  }

  _drawTrails(tSec) {
    const { ctx, W, H } = this
    const px = W * POLE.x, py = H * POLE.y
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#d8ecff'

    for (let b = 0; b < this.buckets.length; b++) {
      const list = this.buckets[b]
      if (!list.length) continue
      for (const seg of SEGS) {
        ctx.globalAlpha = BUCKETS[b] * seg.a
        ctx.lineWidth = seg.w
        ctx.beginPath()
        for (const t of list) {
          const span = t.arcMax * t.grow
          if (span < 0.0008) continue
          const a0 = t.a - span
          const s0 = a0 + span * seg.f0
          const s1 = a0 + span * seg.f1
          if (s1 - s0 < 0.0004) continue
          ctx.moveTo(px + t.r * Math.cos(s0), py + t.r * Math.sin(s0))
          ctx.arc(px, py, t.r, s0, s1)
        }
        ctx.stroke()
      }
    }

    // 星头：量化成 4 档 alpha 批量填充，带轻微闪烁
    for (let b = 0; b < this.buckets.length; b++) {
      const list = this.buckets[b]
      if (!list.length) continue
      ctx.beginPath()
      let drawn = 0
      for (const t of list) {
        const flick = 0.62 + 0.38 * Math.sin(tSec * t.tw + t.phase)
        const q = Math.round(clamp(flick, 0, 1) * 3) / 3
        if (q <= 0) continue
        const hx = px + t.r * Math.cos(t.a)
        const hy = py + t.r * Math.sin(t.a)
        ctx.moveTo(hx + t.headR, hy)
        ctx.arc(hx, hy, t.headR, 0, Math.PI * 2)
        drawn++
      }
      if (drawn) {
        ctx.globalAlpha = BUCKETS[b]
        ctx.fillStyle = '#e6f3ff'
        ctx.fill()
      }
    }
    ctx.restore()
  }

  _drawMeteor(m) {
    if (m.delay > 0 || m.life <= 0) return
    const lifeRatio = Math.max(0, m.life / m.maxLife)
    this._stroke(m, m.x, m.y, m.length, m.alpha * Math.min(1, lifeRatio * 2.2))
  }

  /** 画一条流星（头部光晕 + 渐变尾迹）；x/y 是头部当前坐标 */
  _stroke(m, x, y, len, alpha) {
    const { ctx } = this
    const tailX = x - Math.cos(m.angle) * len
    const tailY = y - Math.sin(m.angle) * len

    const grad = ctx.createLinearGradient(x, y, tailX, tailY)
    grad.addColorStop(0, `hsla(${m.hue}, 100%, 96%, ${alpha})`)
    grad.addColorStop(0.18, `hsla(${m.hue}, 100%, 82%, ${alpha * 0.9})`)
    grad.addColorStop(0.55, `hsla(${m.hue}, 100%, 72%, ${alpha * 0.35})`)
    grad.addColorStop(1, `hsla(${m.hue}, 100%, 70%, 0)`)

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = grad
    ctx.lineWidth = m.width
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(tailX, tailY)
    ctx.stroke()

    const glow = ctx.createRadialGradient(x, y, 0, x, y, m.width * 7)
    glow.addColorStop(0, `hsla(${m.hue}, 100%, 98%, ${alpha})`)
    glow.addColorStop(0.35, `hsla(${m.hue}, 100%, 85%, ${alpha * 0.45})`)
    glow.addColorStop(1, `hsla(${m.hue}, 100%, 80%, 0)`)
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, m.width * 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  _tick = (now) => {
    if (this.disposed || !this.running) return
    if (!this.visible) { this.raf = 0; return }
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    const tSec = now / 1000
    const { ctx, W, H } = this

    // 每帧全清，不做低 alpha 覆盖，杜绝残影堆积
    ctx.clearRect(0, 0, W, H)
    this._updateTrails(dt)
    this._drawTrails(tSec)

    // 密度靠「更短的补充间隔 + 更高的上限」顶住：移动端约 29 颗/s、上限 34 颗
    const cap = this.mobile ? MOBILE.count : CFG.meteorCount
    const gap = this.mobile ? MOBILE.spawn : CFG.spawnInterval
    this.spawnAcc += dt
    if (this.spawnAcc >= gap) {
      this.spawnAcc = 0
      if (this.meteors.length < cap) {
        const m = {}
        this._resetMeteor(m, false)
        this.meteors.push(m)
      }
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i]
      if (m.delay > 0) { m.delay -= dt; continue }
      m.x += Math.cos(m.angle) * m.speed * dt
      m.y += Math.sin(m.angle) * m.speed * dt
      m.life -= dt
      if (m.life <= 0 || m.x < -m.length || m.y > H + m.length) {
        this.meteors.splice(i, 1)
      } else {
        this._drawMeteor(m)
      }
    }
    this.frames++
    this.raf = requestAnimationFrame(this._tick)
  }

  /** 兼容旧状态接口（验收脚本读 particles.length 作为粒子数）。 */
  get particles() {
    return this.meteors
  }

  start() {
    if (this.disposed || this.running) return
    this.running = true
    this.last = performance.now()
    if (this.visible && !this.raf) this.raf = requestAnimationFrame(this._tick)
  }

  /** 像素采样（自检/验收用）：直接读 2D canvas 的 getImageData。 */
  samplePixels() {
    if (this.disposed || !this.ctx) return null
    const { ctx, canvas } = this
    const sw = Math.min(240, canvas.width), sh = Math.min(150, canvas.height)
    // 从中心裁一块缩略区域统计（getImageData 用设备像素坐标）
    const x0 = Math.floor((canvas.width - sw) / 2)
    const y0 = Math.floor((canvas.height - sh) / 2)
    let buf
    try { buf = ctx.getImageData(x0, y0, sw, sh).data } catch (e) { return null }
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
    this.trails.length = 0
    this.buckets = [[], [], [], []]
    this.meteors.length = 0
    this.ctx = null
  }
}
