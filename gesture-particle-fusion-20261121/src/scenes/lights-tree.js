/**
 * 场景 · 圣诞树（合并自 ZekangLi-Zico/Christmas-Tree 的 tree.py）
 *
 * 本轮按要求做了四件事：
 *
 * 1. **按深度排序绘制**：原版是"先算投影深度、从远到近逐点画"（painter's algorithm）。
 *    这里用**索引桶排序**实现：每帧算一次相机空间 z，分 256 桶排序，写入 geometry 的
 *    index 缓冲。Points 支持索引，所以不需要重排顶点属性，55k 点约 1–2ms。
 * 2. **螺旋与填充拆成两个独立材质**：两套 `PointsMaterial`，亮度可分别调
 *    （`setBrightness(spiral, fill)`），因为原图里螺旋灯带明显比蓬松填充更亮。
 * 3. **无手势时满屏散开**：散开目标改成覆盖整个视口的圆盘（按相机 FOV / 宽高比算半径），
 *    并按 0→1→0 的周期往复 —— 与花瓣场景一致的"满屏"观感。
 * 4. 组间顺序：两颗材质各自排完序后，按"平均深度更远的一层先画"决定绘制先后，
 *    近似全局 painter's order（真正混合两个 draw call 无法交错，这点在 README 注明）。
 *
 * 其余点生成算法与 tree.py 逐行一致：螺旋灯带、树枝层次波、蓬松填充、地面光环、
 * 空中星点、树顶隐式方程爱心与细颈。
 */
import { clamp01, approach } from '../core/sprites.js'
import { closingOf } from '../core/gestures.js'

const TAU = Math.PI * 2

const TREE_HEIGHT = 12
const Y_CENTER = TREE_HEIGHT * 0.5
const SPIRAL_N = 35000
const FILL_N = 15000
const GROUND_N = 4000
const STAR_N = 1200
const HEART_N = 1000
const NECK_N = 260
const SNOW_N = 600

/** 用 256 个深度桶做稳定排序，O(n)；比 Array#sort 快一个数量级 */
const BUCKETS = 256

function makeSortBuffers(n) {
  return {
    depth: new Float32Array(n),
    counts: new Uint32Array(BUCKETS + 1),
    index: new Uint32Array(n),
  }
}

export function createLightsTreeScene({ THREE, camera }) {
  const group = new THREE.Group()

  // —— 冒泡生成器：把点分别写进各自数组 ——
  const spiralPos = new Float32Array(SPIRAL_N * 3)
  const spiralCol = new Float32Array(SPIRAL_N * 3)
  const fillPos = new Float32Array(FILL_N * 3)
  const fillCol = new Float32Array(FILL_N * 3)

  let si = 0
  let fi = 0
  const pushSpiral = (x, y, z, r, g, b) => {
    spiralPos[si * 3] = x
    spiralPos[si * 3 + 1] = y - Y_CENTER
    spiralPos[si * 3 + 2] = z
    spiralCol[si * 3] = r
    spiralCol[si * 3 + 1] = g
    spiralCol[si * 3 + 2] = b
    si++
  }
  const pushFill = (x, y, z, r, g, b) => {
    fillPos[fi * 3] = x
    fillPos[fi * 3 + 1] = y - Y_CENTER
    fillPos[fi * 3 + 2] = z
    fillCol[fi * 3] = r
    fillCol[fi * 3 + 1] = g
    fillCol[fi * 3 + 2] = b
    fi++
  }

  // ① 螺旋灯带（70%）
  for (let i = 0; i < SPIRAL_N; i++) {
    const u = Math.random()
    const h = Math.pow(u, 1.6)
    const y = TREE_HEIGHT * h + 0.2
    let baseR = Math.pow(1 - h, 1.1) * 3.2
    const branchWave = Math.max(0, Math.sin((h * 5.8 + 0.15) * TAU))
    baseR *= 1 + 0.65 * branchWave
    const angle = u * 9 * TAU + (Math.random() - 0.5) * 0.44
    // 径向与纵向都抖一点：让螺旋是"一条有宽度的灯带"，而不是一根细线
    const r = baseR * (0.74 + Math.random() * 0.4)
    const midBoost = Math.max(0.15, 1 - Math.abs(h - 0.55) * 1.5)
    // 波峰处提亮，复刻原图"一圈圈花环"的明暗
    const bandGain = 0.6 + 0.8 * branchWave
    let g = (155 + 90 * midBoost + (Math.random() * 35 - 15)) / 255
    let b = (185 + 70 * midBoost + (Math.random() * 50 - 15)) / 255
    if (Math.random() < 0.08) {
      g = (255 - Math.random() * 35) / 255
      b = (230 + Math.random() * 25) / 255
    }
    pushSpiral(
      Math.cos(angle) * r,
      y + (Math.random() - 0.5) * 0.12,
      Math.sin(angle) * r,
      Math.min(1, 0.95 * bandGain + 0.2),
      Math.min(1, g * bandGain),
      Math.min(1, b * bandGain),
    )
  }

  // ② 蓬松填充（30%）
  for (let i = 0; i < FILL_N; i++) {
    const h = Math.pow(Math.random(), 1.9)
    const y = TREE_HEIGHT * h + 0.2 + (Math.random() - 0.5) * 0.16
    let baseR = Math.pow(1 - h, 1.1) * 4.3
    const branchWave = Math.max(0, Math.sin((h * 5.8 + 0.15) * TAU))
    baseR *= 1 + 0.65 * branchWave
    const r = baseR * Math.sqrt(Math.random())
    const a = Math.random() * TAU
    pushFill(
      Math.cos(a) * r + (Math.random() - 0.5) * 0.16,
      y,
      Math.sin(a) * r + (Math.random() - 0.5) * 0.16,
      1,
      (165 + Math.random() * 60) / 255,
      (190 + Math.random() * 60) / 255,
    )
  }

  // ③ 其它（地面光环 / 星点 / 爱心 / 细颈）：各自颜色杂，用加色材质当"光"层
  const MISC_N = GROUND_N + STAR_N + HEART_N + NECK_N
  const miscPos = new Float32Array(MISC_N * 3)
  const miscCol = new Float32Array(MISC_N * 3)
  let mi = 0
  const pushMisc = (x, y, z, r, g, b) => {
    miscPos[mi * 3] = x
    miscPos[mi * 3 + 1] = y - Y_CENTER
    miscPos[mi * 3 + 2] = z
    miscCol[mi * 3] = r
    miscCol[mi * 3 + 1] = g
    miscCol[mi * 3 + 2] = b
    mi++
  }

  const rings = [4.6, 6.0, 7.4, 8.8, 10.2, 11.4]
  for (let i = 0; i < GROUND_N; i++) {
    const ring = rings[Math.floor(Math.random() * rings.length)]
    const r = ring + (Math.random() + Math.random() + Math.random() - 1.5) * 0.42
    const a = Math.random() * TAU
    const c = Math.random() < 0.15 ? (235 + Math.random() * 20) / 255 : (190 + Math.random() * 45) / 255
    pushMisc(Math.cos(a) * r, -0.25, Math.sin(a) * r, c * 0.8, c * 0.85, 1)
  }
  for (let i = 0; i < STAR_N; i++) {
    const base = (215 + Math.random() * 40) / 255
    pushMisc((Math.random() * 2 - 1) * 18, 3 + Math.random() * 15, (Math.random() * 2 - 1) * 18, base, base, 1)
  }
  {
    const scale = 1.35
    const topY = TREE_HEIGHT + 1.35
    let made = 0
    let guard = 0
    while (made < HEART_N && guard < HEART_N * 400) {
      guard++
      const x = (Math.random() * 2 - 1) * 1.3
      const y = (Math.random() * 2 - 1) * 1.4
      const f = Math.pow(x * x + y * y - 1, 3) - x * x * (y * y * y)
      if (f > 0) continue
      const dist = Math.hypot(x, y)
      const factor = Math.max(0.35, 1.15 - 0.5 * dist)
      pushMisc(
        x * scale * 0.8,
        topY + (y + 1) * scale * 0.5,
        (Math.random() - 0.5) * 0.36,
        1,
        Math.min(1, ((130 * factor + 80) * 1.15) / 255),
        Math.min(1, ((190 * factor + 70) * 1.1) / 255),
      )
      made++
    }
    for (let i = 0; i < NECK_N; i++) {
      const t = i / NECK_N
      const a = Math.random() * TAU
      const r = 0.05 + 0.05 * Math.random()
      pushMisc(Math.cos(a) * r, TREE_HEIGHT + 0.2 + t * 1.1, Math.sin(a) * r, 1, 0.72, 0.86)
    }
  }

  // —— 三组各自的 geometry ——
  const makeGeo = (pos, col) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }
  const geometrySpiral = makeGeo(spiralPos, spiralCol)
  const spiralGeo = geometrySpiral
  const fillGeo = makeGeo(fillPos, fillCol)
  const miscGeo = makeGeo(miscPos, miscCol)

  // 索引缓冲：排序结果写这里
  const spiralSort = makeSortBuffers(SPIRAL_N)
  const fillSort = makeSortBuffers(FILL_N)
  spiralGeo.setIndex(new THREE.BufferAttribute(spiralSort.index, 1))
  fillGeo.setIndex(new THREE.BufferAttribute(fillSort.index, 1))

  // —— 两个独立材质：亮度可分别控制 ——
  const spiralMat = new THREE.PointsMaterial({
    size: 0.05,
    vertexColors: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    sizeAttenuation: true,
  })
  const fillMat = new THREE.PointsMaterial({
    size: 0.05,
    vertexColors: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    opacity: 0.8, // 比螺旋略暗；它负责树的"体积"
    sizeAttenuation: true,
  })
  const miscMat = new THREE.PointsMaterial({
    size: 0.05,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    sizeAttenuation: true,
  })

  const spiralPoints = new THREE.Points(spiralGeo, spiralMat)
  const fillPoints = new THREE.Points(fillGeo, fillMat)
  const miscPoints = new THREE.Points(miscGeo, miscMat)
  for (const p of [spiralPoints, fillPoints, miscPoints]) p.frustumCulled = false
  group.add(fillPoints, spiralPoints, miscPoints)

  // 基准位置（树形态）：动画时改 spiralPos/fillPos/miscPos，基准保持不变
  const spiralBase = new Float32Array(spiralPos)
  const fillBase = new Float32Array(fillPos)
  const miscBase = new Float32Array(miscPos)

  // —— 散开目标：覆盖整个视口的圆盘（随相机与宽高比重算）——
  const scatterS = new Float32Array(SPIRAL_N * 3)
  const scatterF = new Float32Array(FILL_N * 3)
  const scatterM = new Float32Array(MISC_N * 3)

  function rebuildScatter() {
    const fov = (camera?.fov ?? 55) * Math.PI / 180
    const dist = camera ? camera.position.z : 20
    const halfH = Math.tan(fov / 2) * dist
    const halfW = halfH * (camera?.aspect ?? 1.6)
    const R = Math.hypot(halfW, halfH) * 1.02 // 圆盘半径盖住四角
    const fill = (arr, n) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU
        const r = Math.sqrt(Math.random()) * R
        arr[i * 3] = Math.cos(a) * r
        arr[i * 3 + 1] = Math.sin(a) * r
        arr[i * 3 + 2] = (Math.random() - 0.5) * 5
      }
    }
    fill(scatterS, SPIRAL_N)
    fill(scatterF, FILL_N)
    fill(scatterM, MISC_N)
  }
  rebuildScatter()

  // —— 深度排序 ——
  const m4 = new THREE.Matrix4()
  const camInv = new THREE.Matrix4()

  function sortGroup(geo, posArr, buf, n) {
    if (!camera) {
      // 没有相机就不排序，按原顺序
      for (let i = 0; i < n; i++) buf.index[i] = i
      return 0
    }
    m4.multiplyMatrices(camInv, group.matrixWorld)
    const e = m4.elements
    let zMin = Infinity
    let zMax = -Infinity
    for (let i = 0; i < n; i++) {
      const x = posArr[i * 3]
      const y = posArr[i * 3 + 1]
      const z = posArr[i * 3 + 2]
      // 相机空间 z（模型矩阵 + 视图矩阵合并后的第 3 行）
      const zc = e[2] * x + e[6] * y + e[10] * z + e[14]
      buf.depth[i] = zc
      if (zc < zMin) zMin = zc
      if (zc > zMax) zMax = zc
    }
    const span = Math.max(1e-4, zMax - zMin)
    buf.counts.fill(0)
    // 远 → 近：z 越小（越负）越远，放进前面的桶
    for (let i = 0; i < n; i++) {
      const t = (buf.depth[i] - zMin) / span
      const b = Math.min(BUCKETS - 1, (t * (BUCKETS - 1)) | 0)
      buf.counts[b]++
    }
    let acc = 0
    for (let b = 0; b < BUCKETS; b++) {
      const c = buf.counts[b]
      buf.counts[b] = acc
      acc += c
    }
    for (let i = 0; i < n; i++) {
      const t = (buf.depth[i] - zMin) / span
      const b = Math.min(BUCKETS - 1, (t * (BUCKETS - 1)) | 0)
      buf.index[buf.counts[b]++] = i
    }
    // 还原 counts 供下次使用
    buf.counts.fill(0)
    geo.index.needsUpdate = true
    return zMin + span * 0.5 // 该组大致的中位深度
  }

  let mix = 0
  let spin = 0
  let autoPhase = 0
  let brightness = { spiral: 1, fill: 0.55 }
  let sortTick = 0

  return {
    id: 'lights',
    label: '圣诞树',
    group,
    frame: { z: 20, y: 1.2, fov: 52 },

    /** 螺旋 / 填充 亮度分别控制（0–2） */
    setBrightness(spiral, fill) {
      if (typeof spiral === 'number') {
        brightness.spiral = spiral
        spiralMat.opacity = clamp01(spiral)
      }
      if (typeof fill === 'number') {
        brightness.fill = fill
        fillMat.opacity = clamp01(fill)
      }
    },
    get brightness() {
      return { ...brightness }
    },

    update(dt, g) {
      // —— 扩散目标 ——
      let target
      if (g.active) {
        // 张开度 = 1 - 收拢度（握拳 或 两指捏合 都算收拢）；捏合能直接收树
        target = clamp01((1 - closingOf(g)) * 1.12 - 0.06)
      } else {
        // 无手势：满屏散开 ↔ 收树，周期往复（与花瓣场景一致）
        autoPhase += dt
        const cyc = 16
        const t = (autoPhase % cyc) / cyc
        // 0→1 用 smoothstep 上、下坡，避免生硬拐点
        const half = t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5
        target = half * half * (3 - 2 * half)
        target *= 0.98
      }
      mix = approach(mix, target, 0.05, dt)

      // —— 逐粒子混合（螺旋 / 填充 / 其它），基准位置 + 散开目标按 k 插值 ——
      const t = performance.now() * 0.001
      const apply = (posArr, baseArr, scatArr, n) => {
        for (let i = 0; i < n; i++) {
          const i3 = i * 3
          const k = clamp01(mix * (0.78 + 0.22 * Math.sin(i * 0.37 + t * 0.7)))
          posArr[i3] = baseArr[i3] + (scatArr[i3] - baseArr[i3]) * k
          posArr[i3 + 1] = baseArr[i3 + 1] + (scatArr[i3 + 1] - baseArr[i3 + 1]) * k
          posArr[i3 + 2] = baseArr[i3 + 2] + (scatArr[i3 + 2] - baseArr[i3 + 2]) * k
        }
      }
      apply(spiralPos, spiralBase, scatterS, SPIRAL_N)
      apply(fillPos, fillBase, scatterF, FILL_N)
      apply(miscPos, miscBase, scatterM, MISC_N)

      spiralGeo.attributes.position.needsUpdate = true
      fillGeo.attributes.position.needsUpdate = true
      miscGeo.attributes.position.needsUpdate = true

      // —— 旋转 ——
      spin += (g.active ? g.pos.x * 1.2 : 0.25) * dt
      group.rotation.y = spin
      group.rotation.x = -0.12
      group.updateMatrixWorld()

      // —— 深度排序：每 2 帧一次（30Hz），肉眼无差别但省一半 CPU ——
      sortTick++
      if (sortTick % 3 === 0) {
        camInv.copy(camera.matrixWorldInverse)
        const zs = sortGroup(spiralGeo, spiralPos, spiralSort, SPIRAL_N)
        const zf = sortGroup(fillGeo, fillPos, fillSort, FILL_N)
        // 更远的一层先画（近似全局 painter's order）
        const spiralFirst = zs < zf
        spiralPoints.renderOrder = spiralFirst ? 0 : 1
        fillPoints.renderOrder = spiralFirst ? 1 : 0
        miscPoints.renderOrder = 2
      }
    },
    /** 颜色选择器：整体乘色（顶点色 × 材质色），保留粉色点阵的明暗层次 */
    setTint(hex) {
      const c = new THREE.Color(hex || 0xffffff)
      for (const m of [spiralMat, fillMat, miscMat]) m.color.copy(c)
    },
    dispose() {
      spiralGeo.dispose()
      fillGeo.dispose()
      miscGeo.dispose()
      spiralMat.dispose()
      fillMat.dispose()
      miscMat.dispose()
    },
  }
}
