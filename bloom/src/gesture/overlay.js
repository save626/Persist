/**
 * 手部关键点连线（可选叠加层）。
 *
 * 为什么单独一层 2D canvas：它比把骨架画进 WebGL 便宜得多，而且关掉时零成本
 * （`display:none` 的 canvas 不占合成）。坐标从 MediaPipe 的归一化 0..1 直接映射到视口，
 * 因为视频是 `object-fit: cover` + 镜像，所以这里也要镜像 x。
 */

/** 21 点骨架连线（MediaPipe 官方连接表）。 */
export const HAND_CONNECTIONS = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
])

const TIPS = new Set([4, 8, 12, 16, 20])

export function createOverlay(canvas) {
  const ctx = canvas.getContext('2d')
  let dpr = 1
  let w = 0
  let h = 0

  function resize(width, height, pixelRatio) {
    dpr = pixelRatio
    w = width
    h = height
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function clear() {
    ctx.clearRect(0, 0, w, h)
  }

  /** @param {Array<{x:number,y:number,z:number}>} landmarks 归一化坐标 */
  function draw(landmarks, { mirror = true, alpha = 1 } = {}) {
    clear()
    if (!landmarks || landmarks.length < 21) return

    const px = (p) => (mirror ? (1 - p.x) * w : p.x * w)
    const py = (p) => p.y * h

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // 连线：两道，外发光 + 内实线
    for (const [a, b] of HAND_CONNECTIONS) {
      const ax = px(landmarks[a])
      const ay = py(landmarks[a])
      const bx = px(landmarks[b])
      const by = py(landmarks[b])

      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.strokeStyle = 'rgba(142, 195, 224, 0.22)'
      ctx.lineWidth = 6
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.strokeStyle = 'rgba(214, 238, 252, 0.85)'
      ctx.lineWidth = 1.6
      ctx.stroke()
    }

    // 关节：指尖更大更亮
    for (let i = 0; i < landmarks.length; i++) {
      const x = px(landmarks[i])
      const y = py(landmarks[i])
      const isTip = TIPS.has(i)
      const r = isTip ? 4.6 : 2.6

      ctx.beginPath()
      ctx.arc(x, y, r * 3.2, 0, Math.PI * 2)
      ctx.fillStyle = isTip ? 'rgba(160, 220, 255, 0.18)' : 'rgba(160, 220, 255, 0.1)'
      ctx.fill()

      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = isTip ? 'rgba(240, 250, 255, 0.95)' : 'rgba(190, 226, 245, 0.8)'
      ctx.fill()
    }

    ctx.restore()
  }

  return { resize, draw, clear }
}
