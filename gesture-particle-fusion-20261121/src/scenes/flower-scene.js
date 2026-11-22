/**
 * 场景 0 · 花瓣（来自本项目原有的 bloom 项目）
 *
 * 保留：三层花瓣 + 满屏扩散的 GPU 着色器方案、粒子局部坐标、面积均匀采样、
 *      花心减密与逐层压暗（这些是修「堆叠过曝」的成果）。
 *
 * 两种驱动方式：
 *   1. **手势 / 自动**（独立工程默认）：`update(dt, gestures)` 里按 palm/spread 或 20s 循环算扩散度；
 *   2. **外部手动**（开场动画用）：`setAuto(false)` + `setDisperse(v)` + `setScale(v)`，
 *      由调用方精确控制进度和缩放 —— 开场要"从瞳孔里慢慢长出来"，不能被自动循环抢节奏。
 */
import { createFlower } from './flower/particles.js'
import { clamp01 } from '../core/sprites.js'

/** 与 bloom 一致：花瓣（含散射）需要入画的最大半径。
 *  取 1.45 而不是 1.58 —— 1.58 会多留一圈空白，花在画面里显得比原版小约 9%。 */
const FLOWER_EXTENT = 1.45
const FLOWER_FOV = 40

/** 按宽高比反推相机距离（花必须完整入画） */
export function flowerCameraZ(aspect) {
  const halfFov = (FLOWER_FOV * Math.PI) / 360
  const needH = FLOWER_EXTENT / Math.tan(halfFov)
  const needW = FLOWER_EXTENT / (Math.tan(halfFov) * Math.max(0.2, aspect))
  return Math.max(needH, needW)
}

/**
 * 无手势时的自动循环（秒）。
 *
 * 旧版是匀速三角波（0.055/s，0→1 要 18 秒），所以花**从不停留**，一直在慢慢动；
 * 现在改成关键帧：花停留 7 秒 → 3 秒散开 → 2 秒散着 → 3 秒聚合 → 停留 5 秒。
 * 每个过渡段用 smoothstep 缓入缓出，段与段之间不顿。
 */
const AUTO = {
  period: 20,
  /** [时刻, 扩散度]；首尾同值才能无缝循环 */
  keys: [
    [0, 0],
    [7, 0],
    [10, 1],
    [12, 1],
    [15, 0],
    [20, 0],
  ],
}

function autoDisperse(t) {
  const { period, keys } = AUTO
  const phase = ((t % period) + period) % period
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i]
    const [t1, v1] = keys[i + 1]
    if (phase >= t0 && phase <= t1) {
      const k = (phase - t0) / Math.max(1e-6, t1 - t0)
      const e = k * k * (3 - 2 * k)
      return v0 + (v1 - v0) * e
    }
  }
  return keys[0][1]
}

export function createFlowerScene({ THREE, camera, count = 32000, autoCycle = true } = {}) {
  // 粒子数回到 bloom 的 32000（之前压到 24000，花瓣明显变薄）
  const flower = createFlower({ count })

  let autoT = 0
  let autoOn = autoCycle !== false
  let aspect = camera?.aspect || 1
  /** 外部手动扩散度；null = 交给手势 / 自动循环 */
  let override = null
  /** 外部缩放系数（开场从 0.55 涨到 1） */
  let scaleBias = 1
  let lastDisperse = 0

  /** 相机距离按「花必须完整入画」反推；同时算出散射区覆盖的可见范围 */
  function framing() {
    const halfFov = (FLOWER_FOV * Math.PI) / 360
    const z = flowerCameraZ(aspect)
    const halfHeight = Math.tan(halfFov) * z
    flower.setScatterExtent(halfHeight * aspect * 1.02, halfHeight * 1.02)
    return z
  }

  const initialZ = framing()
  if (camera) {
    camera.fov = FLOWER_FOV
    camera.position.z = initialZ
    camera.updateProjectionMatrix()
  }

  return {
    id: 'flower',
    label: '花瓣',
    group: flower.group,
    frame: { z: initialZ, fov: FLOWER_FOV },
    /** WebGL 清成透明，让下层流星雨/星轨画布透出来 */
    transparentBackground: true,

    /** 关掉自动循环（开场用），之后由 setDisperse 精确驱动 */
    setAuto(on) {
      autoOn = !!on
      if (!autoOn && override === null) override = lastDisperse
    },
    /** 手动设置扩散度（0 = 花，1 = 满屏）；传 null 交回手势/自动 */
    setDisperse(v) {
      override = v === null ? null : clamp01(v)
    },
    /** 手动设置缩放系数（会在扩散的 1.08 倍之上再乘） */
    setScale(v) {
      scaleBias = Math.max(0.2, Math.min(2, v))
    },

    update(dt, g) {
      flower.update(dt)

      let disperse
      if (override !== null) {
        disperse = override
      } else if (g && g.active) {
        // 张手 → 散开；捏合/握拳 → 聚成花。双手拉开进一步加满
        disperse = Math.max(clamp01(g.palm * 1.15 - 0.05), g.spread)
      } else if (autoOn) {
        autoT += dt
        disperse = autoDisperse(autoT)
      } else {
        disperse = lastDisperse
      }
      lastDisperse = disperse

      flower.setDisperse(disperse)
      flower.setScale(scaleBias * (1 + disperse * 0.08))
      if (g) {
        // 手势快照可能没有 pos（验收注入 / 外部驱动），缺省当中心
        flower.setHand({ x: (g.pos?.x ?? 0) * 0.6, y: -(g.pos?.y ?? 0) * 0.6, active: Boolean(g.active) })
      }
    },

    resize(w, h, dpr) {
      aspect = w / h
      flower.resize(w, h, dpr)
      const z = framing()
      // 引擎只在切场景时套 frame；这里在窗口变化时把相机拉回正确距离
      if (camera) {
        camera.fov = FLOWER_FOV
        camera.position.z = z
        camera.updateProjectionMatrix()
      }
    },
    setTint(hex) {
      flower.setTint(hex)
    },
    dispose() {
      flower.dispose()
    },
  }
}
