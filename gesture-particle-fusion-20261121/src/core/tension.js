/**
 * 手掌张开度 tension —— 纯数学，不碰 DOM、不碰 Three.js、不碰 MediaPipe。
 *
 * 这样它可以被 `node --test` 直接单测（见 `bloom/tests/tension.test.mjs`），
 * 也能在没装 MediaPipe 时用鼠标模拟器喂合成数据。
 *
 * ## 核心公式（指令原文）
 *
 *   ratio_f = |tip_f - wrist| / |mcp_f - wrist|
 *   t_f     = clamp((ratio_f - closed_f) / (open_f - closed_f), 0, 1)
 *   tension = Σ(w_f · t_f) / Σ(w_f)
 *
 * 除以 `mcp→wrist` 这一步是关键：分子分母都随手掌大小缩放，所以**天生尺度无关**，
 * 手离摄像头远近不影响结果（不需要额外按掌宽归一化）。
 *
 * 在这个主公式之外，另外混入两个小项（都可关掉，见 `opts`）：
 *   - `spreadTerm`：指尖张开度 `|tip8 - tip20| / |mcp5 - mcp17|`（尺度无关的掌宽归一化），
 *     握拳 ~0.6、张开 ~1.6。它对「手指并拢但伸直」这种 ratio 偏高的情况有纠偏作用。
 *   - `curlTerm`：PIP 弯曲角，只在检测到手背/侧向视角时起兜底作用。
 *
 * ## 为什么用固定区间而不是自适应标定
 *
 * 自适应（学习本手的最小/最大值）看起来更聪明，但**会漂**：用户若只展示张开手，
 * 学习出的 min 就一直偏高，之后握拳也到不了 0。默认走固定区间，标定做成可选模式
 * （`?calib=1`，HUD 里会打印每指的实测 ratio），由人决定要不要写进常量。
 */

/** MediaPipe Hands 的 21 点索引（写全，方便对照官方文档）。 */
export const LM = Object.freeze({
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
})

/**
 * 每根手指的参考区间。
 *
 * `closed` / `open` 是 ratio = |tip-wrist| / |mcp-wrist| 在该指握拳/张开时的典型值。
 * 这些数字是**可调常量**，不是物理定律：不同人的指长比例差得很远。
 * 调参入口：打开 `?hud=1`，看每指实测 `raw`，把稳定态的最小/最大值填进来。
 */
export const FINGER_RANGES = Object.freeze([
  // 拇指：MCP 用 2 号点（真正贴着腕根的是 CMC 1 号，分母太小会把噪声放大）
  { name: 'thumb', mcp: LM.THUMB_MCP, tip: LM.THUMB_TIP, closed: 1.45, open: 2.35, weight: 0.5 },
  { name: 'index', mcp: LM.INDEX_MCP, tip: LM.INDEX_TIP, closed: 1.10, open: 2.35, weight: 1.0 },
  { name: 'middle', mcp: LM.MIDDLE_MCP, tip: LM.MIDDLE_TIP, closed: 1.15, open: 2.40, weight: 1.0 },
  { name: 'ring', mcp: LM.RING_MCP, tip: LM.RING_TIP, closed: 1.10, open: 2.25, weight: 0.9 },
  { name: 'pinky', mcp: LM.PINKY_MCP, tip: LM.PINKY_TIP, closed: 1.05, open: 2.00, weight: 0.7 },
])

/** 指令给的阈值：< 0.32 花苞，> 0.66 绽放，中间平滑。 */
export const SPREAD_THRESHOLD = Object.freeze({ closed: 0.32, open: 0.66 })

/** 默认混合权重（只对启用的辅助项生效，最后会重新归一化）。 */
const DEFAULT_MIX = Object.freeze({ ratio: 0.72, spread: 0.20, curl: 0.08 })

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** GLSL 同名函数的 JS 版本，两边的阈值语义必须完全一致。 */
export function smoothstep(edge0, edge1, x) {
  if (edge1 === edge0) return x < edge0 ? 0 : 1
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** 帧率无关的指数趋近：60fps 下 perFrame=0.1 等价于本函数。 */
export function approach(current, target, perFrame, dt) {
  const alpha = 1 - Math.pow(1 - perFrame, dt * 60)
  return current + (target - current) * alpha
}

/** 三维距离；MediaPipe 的 z 是相对深度、和 x/y 同量级但噪声更大，故降权。 */
export function dist(a, b, zWeight = 0.5) {
  const dz = (a.z - b.z) * zWeight
  return Math.hypot(a.x - b.x, a.y - b.y, dz)
}

/**
 * 逐指 ratio → 0..1。
 * @returns {{name:string, raw:number, value:number, weight:number}[]}
 */
export function fingerOpenness(landmarks, ranges = FINGER_RANGES) {
  const wrist = landmarks[LM.WRIST]
  return ranges.map((f) => {
    const mcp = landmarks[f.mcp]
    const tip = landmarks[f.tip]
    const denom = dist(wrist, mcp)
    // 分母塌到 0（关键时刻的手部检测抖动）时直接给 0，不让 Infinity 污染平均数
    const raw = denom > 1e-6 ? dist(wrist, tip) / denom : 0
    const value = clamp01((raw - f.closed) / (f.open - f.closed))
    return { name: f.name, raw, value, weight: f.weight }
  })
}

/** 指尖张开度：掌宽归一化，握拳 ~0.6 / 张开 ~1.6。 */
export function palmSpread(landmarks) {
  const palmWidth = dist(landmarks[LM.INDEX_MCP], landmarks[LM.PINKY_MCP])
  if (palmWidth < 1e-6) return null
  const tipSpan = dist(landmarks[LM.INDEX_TIP], landmarks[LM.PINKY_TIP])
  const raw = tipSpan / palmWidth
  return { raw, value: clamp01((raw - 0.75) / (1.55 - 0.75)) }
}

/**
 * PIP 弯曲角（0 = 完全伸直，1 = 折到底）。
 * 用「掌根→PIP」与「PIP→指尖」两段的夹角，纯角度、不受尺度影响。
 */
export function curlOpenness(landmarks) {
  const triples = [
    [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_TIP],
    [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_TIP],
    [LM.RING_MCP, LM.RING_PIP, LM.RING_TIP],
    [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_TIP],
  ]
  let sum = 0
  for (const [a, b, c] of triples) {
    const va = { x: landmarks[a].x - landmarks[b].x, y: landmarks[a].y - landmarks[b].y, z: (landmarks[a].z - landmarks[b].z) * 0.5 }
    const vb = { x: landmarks[c].x - landmarks[b].x, y: landmarks[c].y - landmarks[b].y, z: (landmarks[c].z - landmarks[b].z) * 0.5 }
    const na = Math.hypot(va.x, va.y, va.z)
    const nb = Math.hypot(vb.x, vb.y, vb.z)
    if (na < 1e-6 || nb < 1e-6) continue
    const cos = Math.max(-1, Math.min(1, (va.x * vb.x + va.y * vb.y + va.z * vb.z) / (na * nb)))
    const angle = Math.acos(cos) // 0 = 折到底, π = 伸直
    sum += clamp01(angle / (Math.PI * 0.85))
  }
  return { value: sum / triples.length }
}

/**
 * 总入口：21 点 → tension(0..1)。
 *
 * @param {Array<{x:number,y:number,z:number}>} landmarks 长度必须 ≥ 21
 * @param {{mix?:{ratio?:number,spread?:number,curl?:number}, ranges?:typeof FINGER_RANGES}} opts
 * @returns {{tension:number, parts:{ratio:number, spread:number|null, curl:number},
 *            fingers:Array<{name:string,raw:number,value:number,weight:number}>}}
 */
export function computeTension(landmarks, opts = {}) {
  if (!landmarks || landmarks.length < 21) {
    throw new TypeError('computeTension 需要至少 21 个关键点')
  }
  const mix = { ...DEFAULT_MIX, ...(opts.mix || {}) }
  const fingers = fingerOpenness(landmarks, opts.ranges || FINGER_RANGES)

  let wSum = 0
  let weighted = 0
  for (const f of fingers) {
    weighted += f.value * f.weight
    wSum += f.weight
  }
  const ratio = wSum > 0 ? weighted / wSum : 0
  const spread = palmSpread(landmarks)
  const curl = curlOpenness(landmarks)

  // 只对实际可用的项重新归一化权重，避免某一项缺失时整体被压低
  const terms = [[ratio, mix.ratio]]
  if (spread) terms.push([spread.value, mix.spread])
  terms.push([curl.value, mix.curl])
  const totalW = terms.reduce((s, [, w]) => s + w, 0)
  const tension = totalW > 0 ? clamp01(terms.reduce((s, [v, w]) => s + v * w, 0) / totalW) : 0

  return {
    tension,
    parts: { ratio, spread: spread ? spread.value : null, curl: curl.value },
    fingers,
  }
}

/**
 * tension → 目标绽放度。指令要求：< 0.32 聚合、> 0.66 绽放、中间平滑过渡。
 * 用 smoothstep（而不是线性 clamp）是为了两端的「吸附感」：花苞和满开都稳得住。
 */
export function tensionToSpread(tension, threshold = SPREAD_THRESHOLD) {
  return smoothstep(threshold.closed, threshold.open, clamp01(tension))
}

/**
 * 单手/双手的「张开—捏合」度量。
 *
 * 这一版的主控量是**双手之间的距离**：双手拉开 → 粒子铺满整屏；双手捏合 →
 * 粒子聚成一朵完整的花。单只手时退回「手掌张开度」（握拳=聚合，张手=散开）。
 *
 * 为什么要用掌宽归一化：手指张开时掌宽基本不变，而手离摄像头越近整个画面里的手越大，
 * 直接量像素距离会把"靠近摄像头"误判成"拉开双手"。除以掌宽后才是真正的手间张距。
 */

/** 手掌中心：手腕与中指根的中点，比单点稳。 */
export function handCenter(lm) {
  const a = lm[LM.WRIST]
  const b = lm[LM.MIDDLE_MCP]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z ?? 0) + (b.z ?? 0)) / 2 }
}

/** 掌宽尺度：腕→中指根的距离，用于把所有距离归一化成"几个手掌"。 */
export function palmScale(lm) {
  const d = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP])
  return d > 1e-6 ? d : null
}

/** 两手掌心的距离，单位 = 平均掌宽（尺度无关）。 */
export function handGap(hands) {
  if (!Array.isArray(hands) || hands.length < 2) return null
  const c0 = handCenter(hands[0])
  const c1 = handCenter(hands[1])
  const s0 = palmScale(hands[0])
  const s1 = palmScale(hands[1])
  if (!s0 || !s1) return null
  const d = Math.hypot(c1.x - c0.x, c1.y - c0.y)
  return d / ((s0 + s1) / 2)
}

/**
 * 双手张距 → 扩散度 0..1。
 * 标定：< 1.6 个掌宽 = 捏合（0），> 4.2 个掌宽 = 完全张开（1）。
 * 这两个常数是可选调项：`?debug=1` 的 HUD 会显示实测 gap，按自己手型改。
 */
export const HAND_GAP_RANGE = Object.freeze({ closed: 1.6, open: 4.2 })

export function twoHandApartness(hands, range = HAND_GAP_RANGE) {
  const gap = handGap(hands)
  if (gap === null) return null
  return { gap, apartness: clamp01((gap - range.closed) / (range.open - range.closed)) }
}

/**
 * 多只手的平均张开度 0..1（0 = 都握着，1 = 都张开）。
 *
 * 这是当前的主控量：**手掌张开 → 粒子散开，捏合 → 聚成花**。
 * 双手时取平均，让"两只手都张开"才散得最开；只有一只手时就是该手。
 *
 * @param {Array<Array<{x:number,y:number,z:number}>>} hands
 * @returns {number|null} 没有可用的手时返回 null（调用方回落到自动循环）
 */
export function handsOpenness(hands) {
  if (!Array.isArray(hands) || hands.length === 0) return null
  let sum = 0
  let n = 0
  for (const lm of hands) {
    if (!lm || lm.length < 21) continue
    sum += computeTension(lm).tension
    n++
  }
  return n > 0 ? sum / n : null
}

/**
 * 带平滑与「手丢失」计时的跟踪器。每帧 `update(landmarks|null, dt)`。
 *
 * 手丢失不要立刻松手：检测抖动丢一两帧是常态，0.45s 内保持上一次的开合度，
 * 超过 `holdMs` 才判定手势失效（`active=false`，调用方回落到自动模式）。
 */
export class TensionTracker {
  constructor({ tau = 0.06, holdMs = 450, mix, ranges, threshold } = {}) {
    this.tau = tau
    this.holdMs = holdMs
    this.mix = mix
    this.ranges = ranges
    this.threshold = threshold || SPREAD_THRESHOLD
    this.tension = 0
    this.active = false
    this.lastSeen = -Infinity
    this.lastMetrics = null
    this.samples = 0
  }

  /** @param {number|null} nowMs 显式传入时钟（单测可确定性驱动） */
  update(landmarks, dt, nowMs = Date.now()) {
    const metrics = landmarks && landmarks.length >= 21 ? computeTension(landmarks, { mix: this.mix, ranges: this.ranges }) : null

    if (metrics) {
      this.lastSeen = nowMs
      this.lastMetrics = metrics
      this.samples++
      // 时间常数式 EMA：dt 变大时自动收敛更多，不受帧率影响
      const alpha = this.tau > 0 ? 1 - Math.exp(-Math.max(dt, 0) / this.tau) : 1
      this.tension += (metrics.tension - this.tension) * alpha
      this.active = true
    } else if (nowMs - this.lastSeen > this.holdMs) {
      this.active = false
    }

    return {
      tension: this.tension,
      target: tensionToSpread(this.tension, this.threshold),
      active: this.active,
      metrics,
    }
  }

  reset() {
    this.tension = 0
    this.active = false
    this.lastSeen = -Infinity
    this.lastMetrics = null
    this.samples = 0
  }
}
