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
  // 原来的「6 万像素里撒 200 条随机长短弧」在照片上是"星点拖影"，在纯黑上就是划痕。
  // 重调为「少而长、慢而淡」：条数减半、弧长翻倍、线宽变细、亮度压到 0.38 上限，
  // 读起来是长曝光星轨的同心弧，而不是随机噪点。
  trailMin: 52, trailMax: 96,       // 星轨数量，按面积自适应（原 90–210）
  arcLen: [0.080, 0.220],           // 星轨弧的角跨度（弧度）—— 原 0.030–0.150
  omega: [0.0020, 0.0080],          // 公转角速度 rad/s，更慢更稳（原 0.0035–0.0140）
  growT: [6.0, 18.0],               // 弧长长到满所需秒数
  // 第十二轮：数量翻倍（20→40）、生成率翻倍、寿命翻倍（0.8–1.6s → 1.6–3.2s）、
  // 速度降到 0.7 倍 —— 让每颗流星在屏幕上停留更久，画面更密更从容。
  meteorCount: 40,
  meteorSpeed: [300, 620],
  meteorLength: [110, 260],
  meteorAngle: [118, 148],          // 度：向下偏左，与线上版一致
  meteorWidth: [1.2, 2.8],
  meteorHue: [192, 216],            // 冷蓝
  spawnInterval: 0.065,             // 每秒约 15.4 颗（原 7.7）
}
const BUCKETS = [0.10, 0.17, 0.26, 0.38]
const SEGS = [
  { f0: 0.00, f1: 0.55, a: 0.10, w: 0.55 },
  { f0: 0.55, f1: 0.85, a: 0.26, w: 0.85 },
  { f0: 0.85, f1: 1.00, a: 0.62, w: 1.20 },
]
const POLE = { x: 0.5, y: -0.30 }   // 相对坐标，画面正上方外部

/**
 * 移动端「规整流星雨」（2026-11-23）。
 *
 * 原来的移动端只是把桌面参数按 0.55 缩、上限 22 颗，其余全是随机：
 * 角度 118–148°、速度 300–620、长度 110–260（在 390 宽的屏上等于 1/3 屏长）、
 * 寿命 1.6–3.2s，再按 0.065s 抽签补一颗 —— 在手机上读起来是"随机闪一下"，
 * 不是"流星雨"。
 *
 * 现在改成**确定性传送带**：所有流星同方向、同速度、等距分道、等间隔进入，
 * 沿同一个周期循环。屏幕上看永远是 N 条平行、等距、匀速的斜线，
 * 不会因为随机寿命/随机速度而互相追尾或扎堆成团。
 *
 * 几何：把 N 条平行轨道按**垂直方向等距**排布（间距 = 视口在该方向上的投影 / N），
 * 起点放在画面中心沿反方向退 L 处、终点对称前进 L，所以每条轨道都必然穿过画面，
 * 且在 u=0 / u=1 时都在屏外 —— 不会出现"从画面中间凭空冒出来"。
 */
const RAIN = {
  tracks: 5,          // 轨道条数（垂直方向等距铺满视口）
  perTrack: 6,        // 每条轨道上沿运动方向均匀放 6 颗 → 30 颗的规整点阵
  // 竖屏很窄很高：128° 的斜线在手机上走不到屏底就从左边出界，读起来"只在右上角下"。
  // 移动端用 112°（更偏竖直）—— 每颗都能从顶走到底，整屏都在下，且方向统一。
  angle: 112,
  speed: 320,         // px/s，所有流星一致 —— 这是"有规律"的关键
  lengthRatio: 0.30,  // 尾迹长度 = 屏宽 × 0.30
  lengthMin: 84,
  lengthMax: 132,
  width: 1.5,
  fadeIn: 0.06,
  fadeOut: 0.10,
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
    // 移动端走「规整流星雨」（确定性传送带），桌面端保持原来的随机流星
    this.regular = this.mobile
    this.rain = null
    this.rainT = 0
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
    if (this.regular) this._buildRain()
    else for (const m of this.meteors) this._resetMeteor(m, true)

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
    if (this.regular) { this._buildRain(); return }
    const n = this.mobile ? 22 : CFG.meteorCount
    for (let i = 0; i < n; i++) {
      const m = {}
      this._resetMeteor(m, true)
      this.meteors.push(m)
    }
  }

  /**
   * 规整模式的几何：N_t 条等距平行轨道 × 每条轨道上 N_m 颗等距流星。
   *
   * 只按「每条轨道一个相位」排会退化成一列斜线：轨道索引同时决定了位置和相位，
   * 整片雨会像一条斜带扫过屏幕，两侧始终是空的。这里把相位按
   * `m/N_m + t/(N_m·N_t)` 铺开，得到一个走斜向的规整点阵 ——
   * 任何时刻屏幕上都是同一套等距分布，不会一会儿扎堆一会儿空。
   */
  _buildRain() {
    const { W, H } = this
    if (!W || !H) return
    const N_t = RAIN.tracks, N_m = RAIN.perTrack
    const ang = RAIN.angle * Math.PI / 180
    const dx = Math.cos(ang), dy = Math.sin(ang)
    const nx = -dy, ny = dx                      // 轨道排布方向（与运动方向垂直）
    const len = clamp(W * RAIN.lengthRatio, RAIN.lengthMin, RAIN.lengthMax)
    const perpExtent = Math.abs(nx) * W + Math.abs(ny) * H
    const spacing = perpExtent / N_t
    const L = (W + H) / 2 + len                  // 起点/终点都在画面外
    const D = 2 * L
    const cx = W / 2, cy = H / 2
    const lanes = []
    for (let t = 0; t < N_t; t++) {
      const s = (t - (N_t - 1) / 2) * spacing
      const x0 = cx - dx * L + nx * s
      const y0 = cy - dy * L + ny * s
      for (let m = 0; m < N_m; m++) {
        // 只抖视觉（色相/粗细/亮度），不抖节奏 —— 确定性伪随机，每次刷新同一张网
        const r1 = ((t * N_m + m) * 0.6180339887) % 1
        const r2 = ((t * N_m + m) * 0.3819660113) % 1
        lanes.push({
          angle: ang,
          x0,
          y0,
          hue: CFG.meteorHue[0] + (CFG.meteorHue[1] - CFG.meteorHue[0]) * r1,
          alpha: 0.55 + 0.25 * r2,
          width: RAIN.width * (0.85 + 0.30 * r1),
          phase: (m / N_m + t / (N_m * N_t)) % 1,
        })
      }
    }
    this.rain = { dx, dy, len, D, P: D / RAIN.speed, lanes }
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

  /** 规整模式：按共享周期算出每条轨道的位置，再交给同一套笔触 */
  _drawRain() {
    const r = this.rain
    if (!r || !r.P) return
    for (const lane of r.lanes) {
      let u = (this.rainT / r.P + lane.phase) % 1
      if (u < 0) u += 1
      const fade = u < RAIN.fadeIn ? u / RAIN.fadeIn
        : (u > 1 - RAIN.fadeOut ? (1 - u) / RAIN.fadeOut : 1)
      if (fade <= 0.01) continue
      this._stroke(
        lane,
        lane.x0 + r.dx * r.D * u,
        lane.y0 + r.dy * r.D * u,
        r.len,
        lane.alpha * fade,
      )
    }
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

    if (this.regular) {
      // 规整模式：没有"生成/消亡"，只有一条恒速传送带 —— 节奏永远均匀
      this.rainT += dt
      this._drawRain()
    } else {
      this.spawnAcc += dt
      if (this.spawnAcc >= CFG.spawnInterval) {
        this.spawnAcc = 0
        if (this.meteors.length < (this.mobile ? 22 : CFG.meteorCount)) {
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
        if (m.life <= 0 || m.x < -m.length * 2 || m.y > H + m.length * 2) {
          this.meteors.splice(i, 1)
        } else {
          this._drawMeteor(m)
        }
      }
    }
    this.frames++
    this.raf = requestAnimationFrame(this._tick)
  }

  /** 兼容旧状态接口（验收脚本读 particles.length 作为粒子数）。规整模式下报轨道数。 */
  get particles() {
    if (this.regular && this.rain) return this.rain.lanes
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
    this.rain = null
    this.ctx = null
  }
}
