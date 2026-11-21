/**
 * 粒子花：三层花瓣的几何 + 花瓣局部坐标。
 *
 * 只有两种状态（见 `shaders/flower.js`）：成花（`uDisperse=0`）与满屏散开（`=1`）。
 * 没有"花苞/张开度"这一维。
 *
 * ## 三层怎么做出层级
 *
 * | 层 | 半径系数 | 抬升 z | 方位错角 | 瓣宽系数 | 粒子占比 |
 * | --- | --- | --- | --- | --- | --- |
 * | 外层 | 1.00 | 0.00 | 0 | 1.00 | 46% |
 * | 中层 | 0.74 | 0.10 | 0.5 × (π/P) | 0.82 | 32% |
 * | 内层 | 0.52 | 0.20 | 1.0 × (π/P) | 0.55 | 22% |
 *
 * 内层"更短、更窄、更靠前、方位错开"，外中内三圈的大小差是肉眼能数出来的；
 * 配合着色器里逐层压暗，层次不会被叠加成一团。
 *
 * ## 花瓣轮廓
 *
 *   r(u)     = u^0.92 · L                      沿瓣长的半径
 *   w(u)     = W · (1 - (2u-1)²)^0.62 · pinch  瓣宽（椭圆包络，末端收尖）
 *   cup(u,v) = C · v² · (0.3 + 0.7u) - 0.1u²   截面杯状 + 瓣尖回卷
 *
 * 粒子按**面积均匀**采样（`r(u)·w(u)` 的 CDF 逆变换）。按 `u` 均匀撒会让花心密度是
 * 瓣中的十几倍，渲染成"中心一团白噪点 + 外围稀薄的云"——这就是要修的"粒子堆积"。
 */
import * as THREE from '../../../vendor/three/three.module.js'
import { FLOWER_VERT, FLOWER_FRAG } from './shaders.js'

const TAU = Math.PI * 2
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 三层：半径系数、抬升、方位错角（单位 π/P）、瓣宽系数、粒子占比 */
const LAYERS = Object.freeze([
  { scale: 1.0, lift: 0.0, angle: 0.0, width: 1.0, weight: 0.46 },
  { scale: 0.74, lift: 0.1, angle: 0.5, width: 0.82, weight: 0.32 },
  { scale: 0.52, lift: 0.2, angle: 1.0, width: 0.55, weight: 0.22 },
])

export const FLOWER_DEFAULTS = Object.freeze({
  /** 粒子数。桌面 32000，移动端 14000（花瓣要"实"，粒子数必须上去）。 */
  count: 32000,
  petals: 6,
  /** 花瓣长度。1.4 让花瓣面积比上一版大约 +38%。 */
  petalLength: 1.4,
  /**
   * 最宽处的半宽。这个值和 `petals` 是一对：角向半宽 ≈ atan(W / 0.6L)，
   * 必须 ≤ 瓣间距的一半（60°/2 = 30°），否则同层相邻花瓣互相重叠、接缝叠亮。
   */
  petalWidth: 0.44,
  /** 截面杯状上翘量。 */
  cup: 0.42,
  size: 8.5,
  hazeSize: 52,
  hazeOpacity: 0.1,
  colors: Object.freeze({
    core: '#d8ecfa',
    mid: '#8cc4e4',
    tip: '#33607c',
    hand: '#dff2ff',
  }),
})

/** 花瓣半宽：0 在基部与尖端，最大值落在 u=0.5，两侧是外凸的椭圆弧。 */
function petalHalfWidth(u, width) {
  const t = clamp01(u)
  const env = Math.max(0, 1 - (2 * t - 1) * (2 * t - 1))
  const pinch = 1 - 0.72 * smoothstep01(0.68, 1.0, t)
  return width * Math.pow(env, 0.62) * pinch
}

/** 0..1 的平滑阶跃（GLSL smoothstep 的 JS 版）。 */
function smoothstep01(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6))
  return t * t * (3 - 2 * t)
}

/**
 * 沿瓣长的采样器：**按面积均匀**（CDF 逆变换）。
 * 面积元 ∝ r(u)·w(u)；按 u 均匀撒会让花心密度是瓣中的十几倍。
 */
function makeAreaSampler(widthFn, bins = 256) {
  const cdf = new Float32Array(bins + 1)
  let acc = 0
  for (let i = 0; i < bins; i++) {
    const u = (i + 0.5) / bins
    acc += Math.pow(u, 0.92) * Math.max(0, widthFn(u))
    cdf[i + 1] = acc
  }
  for (let i = 0; i <= bins; i++) cdf[i] /= acc || 1

  return function sampleU() {
    const r = Math.random()
    let lo = 0
    let hi = bins
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cdf[mid + 1] < r) lo = mid + 1
      else hi = mid
    }
    const low = cdf[lo]
    const span = cdf[lo + 1] - low
    const t = span > 1e-9 ? (r - low) / span : 0.5
    return (lo + t) / bins
  }
}

/** 按权重选层 */
function pickLayer() {
  const r = Math.random()
  let acc = 0
  for (let i = 0; i < LAYERS.length; i++) {
    acc += LAYERS[i].weight
    if (r <= acc) return i
  }
  return LAYERS.length - 1
}

export function buildFlowerGeometry(cfg) {
  const { count, petals } = cfg
  const position = new Float32Array(count * 3)
  const aLocal = new Float32Array(count * 3)
  const aMeta = new Float32Array(count * 4)
  const aPetal = new Float32Array(count)
  const aLayer = new Float32Array(count)
  const aSeed = new Float32Array(count)

  const sampleU = makeAreaSampler((u) => petalHalfWidth(u, 1))

  /** 花蕊：中心小穹顶（比例压到 2%，避免花心过曝） */
  const CORE_FRACTION = 0.02
  const CORE_RADIUS = 0.2

  for (let i = 0; i < count; i++) {
    const rand = Math.random()
    const seed = Math.random()

    if (Math.random() < CORE_FRACTION) {
      const a = Math.random() * TAU
      const rad = CORE_RADIUS * Math.sqrt(Math.random())
      const cx = rad * Math.cos(a)
      const cy = rad * Math.sin(a) * 0.92
      const cz = 0.12 + 0.1 * (1 - rad / CORE_RADIUS)
      position[i * 3] = cx
      position[i * 3 + 1] = cy
      position[i * 3 + 2] = cz
      aLocal[i * 3] = cx
      aLocal[i * 3 + 1] = cy
      aLocal[i * 3 + 2] = cz
      aMeta[i * 4] = 0.01
      aMeta[i * 4 + 1] = rad / CORE_RADIUS
      aMeta[i * 4 + 2] = rand
      aMeta[i * 4 + 3] = -1 // 片段着色器用它识别花蕊
      aPetal[i] = 0
      aLayer[i] = -1
      aSeed[i] = seed
      continue
    }

    const layer = pickLayer()
    const L = LAYERS[layer]
    const petal = Math.floor(Math.random() * petals)
    const u = sampleU()
    const v = Math.random() * 2 - 1
    const phi = (petal / petals) * TAU + L.angle * (Math.PI / petals)

    const r = Math.pow(u, 0.92) * cfg.petalLength * L.scale
    const halfW = petalHalfWidth(u, cfg.petalWidth * L.scale * L.width)
    let lat = v * halfW
    let cup = cfg.cup * v * v * (0.3 + 0.7 * u) * L.scale - 0.1 * u * u
    const petalTilt = Math.sin(petal * 12.9898 + layer * 3.7) * 0.5 * 0.2
    cup += petalTilt * u + L.lift

    const twist = 0.18 * u * (layer % 2 === 0 ? 1 : -1) * (1 + 0.25 * rand)
    const latR = lat * Math.cos(twist) - cup * Math.sin(twist)
    const cupR = lat * Math.sin(twist) + cup * Math.cos(twist)
    lat = latR

    position[i * 3] = r * Math.cos(phi) - lat * Math.sin(phi)
    position[i * 3 + 1] = r * Math.sin(phi) + lat * Math.cos(phi)
    position[i * 3 + 2] = cupR

    aLocal[i * 3] = r
    aLocal[i * 3 + 1] = lat
    aLocal[i * 3 + 2] = cupR
    aMeta[i * 4] = u
    aMeta[i * 4 + 1] = v
    aMeta[i * 4 + 2] = rand
    aMeta[i * 4 + 3] = halfW / Math.max(1e-6, cfg.petalWidth * L.scale * L.width)
    aPetal[i] = petal
    aLayer[i] = layer
    aSeed[i] = seed
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geo.setAttribute('aLocal', new THREE.BufferAttribute(aLocal, 3))
  geo.setAttribute('aMeta', new THREE.BufferAttribute(aMeta, 4))
  geo.setAttribute('aPetal', new THREE.BufferAttribute(aPetal, 1))
  geo.setAttribute('aLayer', new THREE.BufferAttribute(aLayer, 1))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1))
  // 逐粒子扩散进度：由 createFlower 每帧平滑推进，着色器只负责读
  geo.setAttribute('aDisperse', new THREE.BufferAttribute(new Float32Array(count), 1))
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 6)

  return geo
}

export function createFlower(options = {}) {
  const cfg = { ...FLOWER_DEFAULTS, ...options, colors: { ...FLOWER_DEFAULTS.colors, ...(options.colors || {}) } }
  const geo = buildFlowerGeometry(cfg)

  const time = { value: 0 }
  const scale = { value: 1 }

  // —— 逐粒子扩散进度（参考圣诞树的做法：每颗粒子各自平滑，而不是统一阈值）——
  const dispAttr = geo.getAttribute('aDisperse')
  const dispArr = dispAttr.array
  let dispTarget = 0
  /** 每颗粒子的推进速度：0.055–0.13 / 帧，差异制造"一层层散开"的错落感 */
  const dispRate = new Float32Array(cfg.count)
  for (let i = 0; i < cfg.count; i++) dispRate[i] = 0.055 + Math.random() * 0.075

  const makeMaterial = (size, opacity) =>
    new THREE.ShaderMaterial({
      vertexShader: FLOWER_VERT,
      fragmentShader: FLOWER_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uScale: scale,
        uTime: time,
        uSize: { value: size },
        uDpr: { value: 1 },
        uOpacity: { value: opacity },
        uPetals: { value: cfg.petals },
        uScatterExtent: { value: new THREE.Vector2(4, 2.4) },
        uHand: { value: new THREE.Vector2(0, 0) },
        uHandActive: { value: 0 },
        uHandRadius: { value: 0.34 },
        uColCore: { value: new THREE.Color(cfg.colors.core) },
        uColMid: { value: new THREE.Color(cfg.colors.mid) },
        uColTip: { value: new THREE.Color(cfg.colors.tip) },
        uHandColor: { value: new THREE.Color(cfg.colors.hand) },
        uTint: { value: new THREE.Color(0xffffff) },
      },
    })

  const mainMat = makeMaterial(cfg.size, 0.95)
  const hazeMat = makeMaterial(cfg.hazeSize, cfg.hazeOpacity)

  const points = new THREE.Points(geo, mainMat)
  const haze = new THREE.Points(geo, hazeMat)
  points.frustumCulled = false
  haze.frustumCulled = false
  points.renderOrder = 2
  haze.renderOrder = 1

  const group = new THREE.Group()
  group.add(haze, points)

  let hand = { x: 0, y: 0, active: false }

  return {
    group,
    points,
    haze,
    stats: { particles: cfg.count, drawCalls: 2, layers: LAYERS.length },
    setDisperse(v) {
      dispTarget = clamp01(v)
      // 柔光雾层既是成花的光晕，也是散开态的主要亮度来源（收掉它 meanLum 会从 36 掉到
      // 16）。所以散开时只轻微收一档，留一点对比度，但别把整体亮度收没。
      const k = 1 - 0.15 * dispTarget
      hazeMat.uniforms.uOpacity.value = cfg.hazeOpacity * k
    },
    setScale(v) {
      scale.value = Math.max(0.2, Math.min(2, v))
    },
    setScatterExtent(x, y) {
      for (const m of [mainMat, hazeMat]) m.uniforms.uScatterExtent.value.set(x, y)
    },
    /** 颜色选择器：整体乘色 */
    setTint(hex) {
      for (const m of [mainMat, hazeMat]) m.uniforms.uTint.value.set(hex || 0xffffff)
    },
    setHand(h) {
      hand = { x: h.x, y: h.y, active: !!h.active }
      for (const m of [mainMat, hazeMat]) {
        m.uniforms.uHand.value.set(hand.x, hand.y)
        m.uniforms.uHandActive.value = hand.active ? 1 : 0
      }
    },
    update(dt) {
      time.value += dt
      const t = time.value

      // —— 逐粒子推进扩散进度 ——
      // 与圣诞树同一套：每帧朝目标推进，速度逐粒子不同（0.055–0.13/帧）。
      // 这样散开/聚合是连续加速的，不会出现"等阈值 → 突然起步"的一顿一顿。
      const n = cfg.count
      const target = dispTarget
      for (let i = 0; i < n; i++) {
        const per = 1 - Math.pow(1 - dispRate[i], dt * 60)
        const cur = dispArr[i]
        dispArr[i] = cur + (target - cur) * per
      }
      dispAttr.needsUpdate = true

      // 极轻微摆动（不是旋转）
      group.rotation.z = Math.sin(t * 0.13) * 0.03
      group.rotation.x = Math.sin(t * 0.11 + 1.1) * 0.05
      group.rotation.y = Math.sin(t * 0.09 + 0.4) * 0.05
    },
    resize(_w, _h, dpr) {
      for (const m of [mainMat, hazeMat]) m.uniforms.uDpr.value = dpr
    },
    dispose() {
      geo.dispose()
      mainMat.dispose()
      hazeMat.dispose()
    },
  }
}
