/**
 * 共用的粒子贴图：一张 64×64 的径向渐变光点。
 *
 * 五个原仓库各自生成过一份（canvas 渐变或 PNG），这里合并成一份 texture，
 * 所有场景共用，切换场景时不重复创建。
 */
export function createGlowTexture(THREE, { inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)' } = {}) {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, inner)
  g.addColorStop(0.28, mid)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** 把一个 0..1 的数映射到 [a,b] */
export const lerp = (a, b, t) => a + (b - a) * t
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** 帧率无关的指数趋近 */
export const approach = (cur, target, perFrame, dt) => cur + (target - cur) * (1 - Math.pow(1 - perFrame, dt * 60))
