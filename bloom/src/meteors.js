/**
 * 背景流星雨层 —— 与花朵**完全独立**的一层粒子。
 *
 * 为什么用独立的 2D canvas，而不是塞进 Three.js 场景：
 *  1. **互不干扰**是需求：独立画布 = 独立合成，永远不会和花朵的叠加混合、深度、
 *     点径预算打架，关掉它也不影响花朵一个字节（`display:none` 时零成本）。
 *  2. 流星是「屏幕空间」效果（长曝光星轨 + 拖尾），用 2D 画比在 3D 里投影更便宜、更可控。
 *  3. 花朵用 WebGL 时，背景层能直接垫在它下面，靠 CSS z-index 排序，不需要共享帧缓冲。
 *
 * 参数沿用落地页第十一轮验收过的那一套：冷蓝 hue 192–216、速度 300–620px/s、
 * 寿命 1.6–3.2s、PC 上限 40 颗 / 移动端 22 颗、生成间隔 0.065s、`lighter` 叠加。
 *
 * 亮度整体压得比落地页更低（`uAlpha` 0.55），因为这里主体是花，背景只负责「填满」。
 */

const TAU = Math.PI * 2

const DEFAULTS = {
  /** PC / 移动端的流星上限 */
  /** 流星上限：40 → 150，铺满整屏（移动端 70） */
  maxMeteors: 150,
  maxMeteorsMobile: 70,
  /** 生成间隔（秒）：0.065 → 0.018，出片频率提高约 3.6 倍 */
  spawnEvery: 0.018,
  /** 寿命区间（秒） */
  lifeMin: 1.6,
  lifeMax: 3.2,
  /** 速度区间（px/s，按 1440×900 基准缩放） */
  speedMin: 300,
  speedMax: 620,
  /** 星轨条数（PC / 移动端）：150 → 460 */
  trails: 460,
  trailsMobile: 200,
  /** 背景静态星点：220 → 650 */
  stars: 650,
  starsMobile: 300,
  /** 整体不透明度：比落地页低，免得抢过花朵 */
  alpha: 0.55,
  /** 冷蓝色相区间 */
  hueMin: 192,
  hueMax: 216,
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const rand = (a, b) => a + Math.random() * (b - a)

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{resize(w:number,h:number,dpr:number):void, update(dt:number):void,
 *            clear():void, setPaused(p:boolean):void, dispose():void, stats:{meteors:number,trails:number}}}
 */
export function createMeteors(canvas, options = {}) {
  const cfg = { ...DEFAULTS, ...options }
  const ctx = canvas.getContext('2d', { alpha: true })

  const isMobile =
    (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) ||
    (typeof window !== 'undefined' && window.innerWidth < 720)

  const maxMeteors = isMobile ? cfg.maxMeteorsMobile : cfg.maxMeteors
  const trailCount = isMobile ? cfg.trailsMobile : cfg.trails
  const starCount = isMobile ? cfg.starsMobile : cfg.stars

  let w = 0
  let h = 0
  let dpr = 1
  let time = 0
  let paused = false
  let spawnAcc = 0

  /** 星轨：极轴在画面上方之外，绕它公转 */
  const trails = []
  /** 背景静态星点 */
  const stars = []
  /** 活跃流星 */
  const meteors = []

  function seed() {
    trails.length = 0
    for (let i = 0; i < trailCount; i++) {
      trails.push({
        // 半径铺满画面：0.10–1.9 倍最长边，能覆盖到四角
        radius: rand(0.1, 1.9) * Math.max(w, h),
        // 起始角覆盖整圈，但主要落在上半部，读作「绕极轴的长曝光」
        angle: rand(0, TAU),
        speed: rand(0.004, 0.011) * (Math.random() > 0.5 ? 1 : -1),
        width: rand(0.6, 1.8),
        // 4 档亮度 × 3 段渐弱：长曝光里亮星拖出的轨迹更实
        alpha: rand(0.04, 0.16),
        span: rand(0.35, 1.1),
      })
    }

    stars.length = 0
    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        r: rand(0.3, 1.1),
        alpha: rand(0.08, 0.4),
        twinkle: rand(0.3, 1.4),
        phase: rand(0, TAU),
      })
    }
  }

  function spawnMeteor() {
    if (meteors.length >= maxMeteors) return
    // 从画面上缘偏上的位置斜着落下，方向统一朝左下（和落地页一致）
    const scale = Math.max(w, h) / 1440
    const speed = rand(cfg.speedMin, cfg.speedMax) * clamp(scale, 0.7, 1.6)
    const angle = rand(0.58, 0.86) // 弧度，约 33°–49°
    const hue = rand(cfg.hueMin, cfg.hueMax)
    meteors.push({
      // 出生点铺满画面（含下半屏），否则密集了也只在上半部打转
      x: rand(-0.25, 1.25) * w,
      y: rand(-0.35, 0.85) * h,
      vx: -Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: rand(cfg.lifeMin, cfg.lifeMax),
      age: 0,
      hue,
      // 拖尾长度：寿命越长、速度越快，尾巴越长
      tail: speed * rand(0.16, 0.3),
      width: rand(0.9, 2.2),
      bright: rand(0.5, 1),
    })
  }

  function resize(width, height, pixelRatio) {
    w = width
    h = height
    dpr = pixelRatio
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    seed()
  }

  function clear() {
    ctx.clearRect(0, 0, w, h)
  }

  function drawStars() {
    for (const s of stars) {
      const tw = 0.65 + 0.35 * Math.sin(time * s.twinkle + s.phase)
      ctx.globalAlpha = s.alpha * tw * cfg.alpha
      ctx.fillStyle = '#cfe4f2'
      ctx.beginPath()
      ctx.arc(s.x * w, s.y * h, s.r, 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function drawTrails() {
    // 极轴放在画面上方之外：所有弧线朝同一个方向弯，形成「长曝光绕极轴」的观感
    const poleX = w * 0.5
    const poleY = -h * 0.35
    for (const t of trails) {
      const a0 = t.angle + time * t.speed
      const a1 = a0 + t.span * 0.35
      ctx.beginPath()
      ctx.arc(poleX, poleY, t.radius, a0, a1)
      ctx.strokeStyle = 'rgba(199, 226, 244, ' + (t.alpha * cfg.alpha).toFixed(3) + ')'
      ctx.lineWidth = t.width
      ctx.stroke()
    }
  }

  function drawMeteors(dt) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i]
      m.age += dt
      if (m.age >= m.life) {
        meteors.splice(i, 1)
        continue
      }
      m.x += m.vx * dt
      m.y += m.vy * dt

      // 出场淡入、退场淡出
      const lifeT = m.age / m.life
      const fade = Math.min(1, lifeT / 0.18) * Math.min(1, (1 - lifeT) / 0.35)
      const a = fade * m.bright * cfg.alpha

      const len = Math.hypot(m.vx, m.vy) || 1
      const ux = m.vx / len
      const uy = m.vy / len

      // 拖尾用 3 段递减的实心描边代替线性渐变：
      // 每帧给每颗流星创建 CanvasGradient 太贵（软件渲染下直接把帧率拖到个位数）
      for (let seg = 0; seg < 3; seg++) {
        const t0 = seg / 3
        const t1 = (seg + 1) / 3
        const x0 = m.x - ux * m.tail * t0
        const y0 = m.y - uy * m.tail * t0
        const x1 = m.x - ux * m.tail * t1
        const y1 = m.y - uy * m.tail * t1
        const segAlpha = a * (1 - t0) * (seg === 0 ? 0.95 : 0.5)
        ctx.globalAlpha = Math.max(0, segAlpha)
        ctx.strokeStyle = `hsl(${m.hue + seg * 3}, 86%, ${82 - seg * 10}%)`
        ctx.lineWidth = m.width * (1 - t0 * 0.55)
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
        ctx.stroke()
      }

      // 头部光点（实心圆 + 低透明度外圈，代替径向渐变）
      ctx.globalAlpha = Math.max(0, a * 0.95)
      ctx.fillStyle = `hsl(${m.hue}, 95%, 92%)`
      ctx.beginPath()
      ctx.arc(m.x, m.y, m.width * 1.15, 0, TAU)
      ctx.fill()

      ctx.globalAlpha = Math.max(0, a * 0.18)
      ctx.beginPath()
      ctx.arc(m.x, m.y, m.width * 4, 0, TAU)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  function update(dt) {
    if (paused || w === 0) return
    time += dt

    // 生成节奏：按累积时间出，帧率变化时密度基本恒定
    spawnAcc += dt
    while (spawnAcc >= cfg.spawnEvery) {
      spawnAcc -= cfg.spawnEvery
      spawnMeteor()
    }

    clear()
    drawStars()
    drawTrails()
    drawMeteors(dt)
  }

  seed()

  return {
    resize,
    update,
    clear,
    setPaused(p) {
      paused = p
    },
    dispose() {
      trails.length = 0
      stars.length = 0
      meteors.length = 0
      clear()
    },
    stats: { meteors: 0, trails: trailCount, stars: starCount },
  }
}
