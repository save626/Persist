/**
 * eyeTutorial 字符画眼睛播放器（从旧 landing/index.html 的播放器脚本迁移）。
 * 引擎是 vendored 的 window.EyeEngine（third_party/eyetutorial-replica/engine.js），
 * 原样内联、不手改。这里只做调用侧：网格布局、灰蓝色映射、差量绘制、时间线。
 *
 * 所有已验收参数保持不变：
 *   · 网格 78 列 × 30 行、字符格 8:15（Python 原版物理尺寸）
 *   · 心形星云禁用（T_HEART=1e6）+ 时间线约束（T_ZD=3.2 < 3.5）
 *
 * 本轮改动（用户拍板，第十一轮）：
 *   · 眼睛颜色改「产品首页灰蓝家族」：深底 #010203 与星空底图保留（第十轮成果），
 *     但虹膜/巩膜/瞳孔从原生琥珀改为不同灰蓝色相（产品蓝 #467692 / 浅灰蓝
 *     #c7dae6 / 深墨蓝 #1a2a36），与产品介绍首页色调统一，同时保留颜色对比。
 *     不是第九轮那种单蓝亮度映射（会把色相抹成只有深浅）。
 *   · 瞳孔居中：画布 CSS 已用 margin:auto 修正（见 landing.css）；引擎 gaze
 *     在推进阶段仍锁 (0,0) 消除视线放大偏移。两处都修，vendored 引擎不动。
 */

export class EyePlayer {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas ? canvas.getContext('2d') : null
    this.engine = typeof window !== 'undefined' ? window.EyeEngine : null
    this.disposed = false
    this.running = false
    this.frames = 0
    this.raf = 0
    this.t0 = 0
    this.visible = true
    // 参考版 web/index.html 的近黑画布底色（深色系原版观感）
    this.paper = '#010203'

    this._configure()
    this._layout()
    this._initState()
    this._bindVisibility()
  }

  _configure() {
    const E = this.engine
    if (!E) return
    const CFG = E.CFG
    this.T_Z0 = 4.6
    this.T_ZD = 3.2
    this.T_SPACE = this.T_Z0 + this.T_ZD
    CFG.T_Z0 = this.T_Z0
    CFG.T_ZD = this.T_ZD
    CFG.T_SPACE = this.T_SPACE
    CFG.T_HEART = 1e6
    CFG.T_HEART_D = 1
    CFG.ZEND = 20
    this.QL = E.QL
    this.CFG = CFG
  }

  _layout() {
    const CELL_W = 8, CELL_H = 15, BASE_ROWS = 30
    this.rows = BASE_ROWS
    this.cols = Math.floor((this.rows * CELL_H * 1.4) / CELL_W / 2) * 2 // = 78
    const availW = (window.innerWidth || 1200) * 0.96
    const availH = (window.innerHeight || 800) * 0.92
    const baseW = this.cols * CELL_W, baseH = this.rows * CELL_H
    let scale = Math.min(availW / baseW, availH / baseH)
    if (scale > 1.9) scale = 1.9
    if (scale < 0.62) scale = 0.62
    this.cellW = CELL_W * scale
    this.cellH = CELL_H * scale
    const cssW = this.cols * this.cellW
    const cssH = this.rows * this.cellH
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2)
    if (this.canvas) {
      this.canvas.width = Math.round(cssW * dpr)
      this.canvas.height = Math.round(cssH * dpr)
      this.canvas.style.width = cssW + 'px'
      this.canvas.style.height = cssH + 'px'
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // 字号 = 格宽 × 1.75（Consolas advance ≈ 0.55em，横向刚好填满一格）。
      // ★ 必须跟着缩放后的格宽走，且用常规体 —— 写死字号或加粗都会糊成符号墙。
      this.ctx.font = Math.round(this.cellW * 1.75) + 'px Consolas, "Cascadia Mono", "Courier New", monospace'
      this.ctx.textAlign = 'center'
      this.ctx.textBaseline = 'middle'
    }
  }

  _initState() {
    const n = this.cols * this.rows
    this.prevIdx = new Int32Array(n).fill(-1)
    this.prevQ = new Uint8Array(n * 3).fill(255)
    this.hexCache = new Map()
    this.rgb = [0, 0, 0]
    // 先铺满底色，避免首帧字符格之间有透明缝露出 intro 底色
    if (this.ctx) {
      this.ctx.fillStyle = this.paper
      this.ctx.fillRect(0, 0, this.cols * this.cellW, this.rows * this.cellH)
    }
    this.renderer = null
    if (this.engine) {
      this.renderer = new this.engine.Renderer(this.cellW, this.cellH, this.rows, {
        smooth: 0, contrast: 0, levels: 0, hash: 0.07,
      })
      // ★ 瞳孔居中：包装实例的 gaze()（不动 vendored 引擎源码）。
      //   推进阶段（≥ T_Z0）返回 (0,0)，瞳孔中心锁在网格几何中心；
      //   推进之前保留引擎自带的轻微视线游移，观感不变。
      const rawGaze = this.renderer.gaze.bind(this.renderer)
      const z0 = this.T_Z0
      this.renderer.gaze = (t) => (t >= z0 ? [0, 0] : rawGaze(t))
    }
  }

  _palette(q0, q1, q2, out) {
    const QL = this.QL || 24
    const inv = 255 / (QL - 1)
    const R = q0 * inv, G = q1 * inv, B = q2 * inv
    // 引擎原生 q0/q1/q2 = R/G/B，琥珀虹膜是 R>G>B（irR≈.8 irG≈.45 irB≈.1），
    // 巩膜 R≈G≈B 高值，瞳孔三通道都低。第十一轮：不用原生琥珀，也不做单蓝亮度
    // 映射（那会把色相抹成深浅）——而是按「暖度识别虹膜 + 亮度区分瞳孔/巩膜」
    // 重新映射到产品首页的灰蓝家族，且三者色相不同，保住颜色对比：
    //   瞳孔 → 深墨蓝 #1a2a36    虹膜 → 产品蓝 #467692    巩膜 → 浅灰蓝 #c7dae6
    const lum = (0.30 * R + 0.60 * G + 0.10 * B) / 255
    const warm = Math.max(0, (R - B) / 255)
    const t = Math.pow(Math.max(0, Math.min(1, lum)), 0.82)
    // 灰蓝主轴：暗部深墨蓝 → 亮部浅灰蓝
    let r = 26 + t * (199 - 26)
    let g = 42 + t * (218 - 42)
    let b = 54 + t * (230 - 54)
    // 虹膜区（暖度高）压 R/G，落到产品蓝一带 → 冷蓝青色相，与巩膜/瞳孔拉开
    const iris = Math.min(1, warm * 1.25)
    r -= iris * 92
    g -= iris * 34
    b -= iris * 10
    const cl = (v) => Math.max(0, Math.min(255, Math.round(v)))
    out[0] = cl(r)
    out[1] = cl(g)
    out[2] = cl(b)
  }

  _colorOf(q0, q1, q2) {
    const QL = this.QL || 24
    const key = q0 * QL * QL + q1 * QL + q2
    let s = this.hexCache.get(key)
    if (s === undefined) {
      this._palette(q0, q1, q2, this.rgb)
      s = 'rgb(' + this.rgb[0] + ',' + this.rgb[1] + ',' + this.rgb[2] + ')'
      this.hexCache.set(key, s)
    }
    return s
  }

  _drawFrame(idx, q) {
    const ctx = this.ctx
    if (!ctx) return
    const n = idx.length
    for (let p = 0; p < n; p++) {
      const po = p * 3
      const i0 = idx[p]
      if (
        i0 === this.prevIdx[p] &&
        Math.abs(q[po] - this.prevQ[po]) < 3 &&
        Math.abs(q[po + 1] - this.prevQ[po + 1]) < 3 &&
        Math.abs(q[po + 2] - this.prevQ[po + 2]) < 3
      ) continue
      const c = p % this.cols, r = (p / this.cols) | 0
      const x = c * this.cellW, y = r * this.cellH
      if (i0 === 0) {
        ctx.fillStyle = this.paper
        ctx.fillRect(x - 1, y - 1, this.cellW + 2, this.cellH + 2)
      } else {
        // 关键：字符一变先擦旧字形，否则残笔层层堆积 → 画面糊成一片
        ctx.fillStyle = this.paper
        ctx.fillRect(x - 1, y - 1, this.cellW + 2, this.cellH + 2)
        ctx.fillStyle = this._colorOf(q[po], q[po + 1], q[po + 2])
        ctx.fillText(this.engine.RAMP[i0], x + this.cellW / 2, y + this.cellH / 2)
      }
      this.prevIdx[p] = i0
      this.prevQ[po] = q[po]
      this.prevQ[po + 1] = q[po + 1]
      this.prevQ[po + 2] = q[po + 2]
    }
  }

  _tick = (now) => {
    if (this.disposed || !this.running) return
    if (!this.visible) { this.raf = 0; return }
    const t = (now - this.t0) / 1000
    // 30fps 节流
    if (!this._lastDraw || now - this._lastDraw >= 33) {
      this._lastDraw = now
      if (this.renderer) {
        const f = this.renderer.render(t, 1 / 30)
        this._drawFrame(f.idx, f.q)
        this.frames++
      }
    }
    this.raf = requestAnimationFrame(this._tick)
  }

  _bindVisibility() {
    this._onVis = () => {
      this.visible = !document.hidden
      if (this.visible && this.running && !this.raf) {
        this._lastDraw = 0
        this.raf = requestAnimationFrame(this._tick)
      } else if (!this.visible && this.raf) {
        cancelAnimationFrame(this.raf)
        this.raf = 0
      }
    }
    document.addEventListener('visibilitychange', this._onVis)
  }

  start() {
    if (this.disposed || this.running) return
    this.running = true
    this.t0 = performance.now()
    if (this.visible && !this.raf) this.raf = requestAnimationFrame(this._tick)
  }

  /** 冻结在当前帧（切粒子层时调用），不再推进引擎。 */
  freeze() {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  state() {
    return {
      cellW: +this.cellW.toFixed(2),
      cellH: +this.cellH.toFixed(2),
      cols: this.cols,
      rows: this.rows,
      frames: this.frames,
      heartDisabled: this.CFG ? this.CFG.T_HEART > 1e5 : true,
      tSpace: this.T_SPACE,
      // 推进阶段视线锁定为 (0,0) → 瞳孔严格居中（验收用）
      gazeLocked: this.renderer
        ? (this.renderer.gaze(this.T_Z0 + 1)[0] === 0 && this.renderer.gaze(this.T_Z0 + 1)[1] === 0)
        : true,
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis)
    this.hexCache.clear()
    this.renderer = null
    this.prevIdx = null
    this.prevQ = null
  }
}
