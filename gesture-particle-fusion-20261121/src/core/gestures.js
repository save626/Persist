/**
 * 统一手势状态 —— 六个场景共用这一份。
 *
 * 从 21 点关键点算出**跨场景通用**的量，场景只做"怎么用"的映射：
 *
 *   palm    0..1  手掌张开度（多手取平均）      0=握拳/捏合，1=完全张开
 *   fist    0..1  1 - palm
 *   pinch   0..1  拇指尖↔食指尖的捏合程度        1=捏住
 *   spread  0..1  双手间距（单位=掌宽）          0=并拢/单手，1=拉开
 *   fingers 0..5  张开的手指数（多手取最大）
 *   pos     {x,y} 指尖中心（镜像后的屏幕归一化坐标）
 *   rot     弧度  手掌滚转角（腕→中指根）
 *   active        是否有手
 *
 * 每个量都做了 EMA 平滑，并带"丢手保持"（450ms 内沿用上一次的值），
 * 因为 MediaPipe 偶尔掉一两帧，直接清零会让画面抖。
 */
import { computeTension, handGap, handCenter, palmScale, clamp01 } from './tension.js'

const HOLD_MS = 450

function fingerExtended(lm, tip, pip) {
  // 指尖比 PIP 离腕更远 → 视为伸直（尺度无关，不需要额外归一化）
  const w = lm[0]
  const d = (i) => Math.hypot(lm[i].x - w.x, lm[i].y - w.y)
  return d(tip) > d(pip) * 1.12
}

export class GestureState {
  constructor() {
    this.active = false
    this.hands = 0
    this.palm = 0
    this.fist = 1
    this.pinch = 0
    this.spread = 0
    this.fingers = 0
    this.pos = { x: 0, y: 0 }
    this.rot = 0
    this.lastSeen = -Infinity
    // 平滑后的私有值
    this._palm = 0
    this._pinch = 0
    this._spread = 0
    this._pos = { x: 0, y: 0 }
    this._rot = 0
    this.twoHands = false
  }

  /**
   * @param {Array<Array<{x:number,y:number,z:number}>>} hands
   * @param {number} dt 秒
   * @param {number} nowMs
   */
  update(hands, dt, nowMs = performance.now()) {
    const list = (hands || []).filter((h) => h && h.length >= 21)
    const alpha = 1 - Math.exp(-Math.max(dt, 0) / 0.04)

    if (list.length > 0) {
      this.lastSeen = nowMs
      this.active = true
      this.hands = list.length
      this.twoHands = list.length >= 2

      // 手掌张开度：多手取平均
      let palm = 0
      let pinch = 0
      let fingers = 0
      for (const lm of list) {
        palm += computeTension(lm).tension
        const s = palmScale(lm) || 1
        const d = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / s
        // 指间距 ≈0.3 掌宽时算捏住，≈1.1 掌宽时算张开
        pinch += clamp01((1.1 - d) / 0.8)
        let f = 0
        if (fingerExtended(lm, 8, 6)) f++
        if (fingerExtended(lm, 12, 10)) f++
        if (fingerExtended(lm, 16, 14)) f++
        if (fingerExtended(lm, 20, 18)) f++
        if (Math.hypot(lm[4].x - lm[5].x, lm[4].y - lm[5].y) > s * 0.9) f++
        fingers = Math.max(fingers, f)
      }
      palm /= list.length
      pinch /= list.length

      // 双手间距（掌宽归一化）
      let spread = 0
      const gap = handGap(list)
      if (gap !== null) spread = clamp01((gap - 1.6) / (4.2 - 1.6))

      // 指尖中心 → -1..1（x 镜像，和摄像头画面一致）
      const c = handCenter(list[0])
      const tipX = (list[0][8].x + list[0][12].x) / 2
      const tipY = (list[0][8].y + list[0][12].y) / 2
      // 滚转：腕 → 中指根的方向
      const rot = Math.atan2(list[0][9].y - c.y, list[0][9].x - c.x) + Math.PI / 2

      this._palm += (palm - this._palm) * alpha
      this._pinch += (pinch - this._pinch) * alpha
      this._spread += (spread - this._spread) * alpha
      this._pos.x += ((0.5 - tipX) * 2 - this._pos.x) * alpha
      this._pos.y += ((0.5 - tipY) * 2 - this._pos.y) * alpha
      this._rot += (rot - this._rot) * alpha
      this.fingers = fingers
    } else if (nowMs - this.lastSeen > HOLD_MS) {
      this.active = false
      this.hands = 0
      this.twoHands = false
      this.fingers = 0
      // 慢慢回落到"无手"的中性状态
      this._palm += (0 - this._palm) * alpha * 0.5
      this._pinch += (0 - this._pinch) * alpha * 0.5
      this._spread += (0 - this._spread) * alpha * 0.5
    }

    this.palm = clamp01(this._palm)
    this.fist = 1 - this.palm
    this.pinch = clamp01(this._pinch)
    this.spread = clamp01(this._spread)
    this.pos.x = this._pos.x
    this.pos.y = this._pos.y
    this.rot = this._rot
    return this
  }
}
