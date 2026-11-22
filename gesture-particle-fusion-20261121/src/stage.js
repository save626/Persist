/**
 * 粒子舞台（可复用渲染层）
 *
 * 把「引擎 + 场景 + 尺寸 + 颜色」收成一个不含任何 UI 的对象，让同一份渲染代码能被两种宿主复用：
 *
 *   · 独立工程 `src/main.js`：加场景按钮、手势、流星层、HUD；
 *   · 落地页开场 `IntroOverlay.vue`：只要一块画布，自己控制扩散度/缩放/入场遮罩。
 *
 * 这里**不起 RAF**：帧循环由宿主驱动（独立工程用 main.js 的循环，开场用覆盖层自己的循环），
 * 避免两套 rAF 抢帧。
 */
import { createEngine } from './core/engine.js'
import { createGlowTexture } from './core/sprites.js'
import { SCENES } from './scenes/index.js'

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {string} [opts.sceneId='flower'] 初始场景
 * @param {number} [opts.dpr] 覆盖 devicePixelRatio 上限（默认引擎的 2）
 */
export function createParticleStage({ canvas, sceneId = 'flower', dpr } = {}) {
  const engine = createEngine({ canvas })
  if (dpr) engine.renderer.setPixelRatio(Math.min(dpr, 2))
  engine.resize()

  const sprite = createGlowTexture(engine.THREE)
  let current = null
  let currentId = sceneId
  let tint = '#ffffff'

  function loadScene(id) {
    const entry = SCENES.find((s) => s.id === id) || SCENES[0]
    const inst = entry.create({ THREE: engine.THREE, sprite, camera: engine.camera })
    engine.setScene(inst)
    current = inst
    currentId = entry.id
    current.setTint?.(tint)
    return inst
  }

  loadScene(sceneId)

  return {
    engine,
    THREE: engine.THREE,
    get current() {
      return current
    },
    get sceneId() {
      return currentId
    },
    get scenes() {
      return SCENES
    },
    /** 是否需要在下面垫一层流星雨（花瓣场景是透明的） */
    get transparentBackground() {
      return Boolean(current?.transparentBackground)
    },
    loadScene,
    /** 手动驱动扩散度/缩放（仅花瓣场景支持；其它场景是 no-op） */
    setDisperse(v) {
      current?.setDisperse?.(v)
    },
    setScale(v) {
      current?.setScale?.(v)
    },
    setAuto(on) {
      current?.setAuto?.(on)
    },
    setTint(hex) {
      tint = hex || '#ffffff'
      current?.setTint?.(tint)
    },
    update(dt, gestures) {
      engine.update(dt, gestures)
    },
    render() {
      engine.render()
    },
    resize() {
      engine.resize()
    },
    /** 读回像素统计（验收用） */
    measure() {
      engine.render()
      const gl = engine.renderer.getContext()
      const w = gl.drawingBufferWidth
      const h = gl.drawingBufferHeight
      const buf = new Uint8Array(w * h * 4)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      let lit = 0
      let sum = 0
      let minX = w
      let minY = h
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]
          if (lum < 12) continue
          lit++
          sum += lum
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
      const total = w * h
      return {
        width: w,
        height: h,
        litRatio: lit / total,
        meanLum: lit ? sum / lit : 0,
        bbox: total
          ? { minX: minX / w, minY: minY / h, maxX: maxX / w, maxY: maxY / h }
          : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      }
    },
    dispose() {
      current?.dispose?.()
      current = null
      engine.renderer.dispose()
      engine.renderer.forceContextLoss?.()
    },
  }
}
