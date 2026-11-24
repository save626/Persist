/**
 * tension 数学的单测：`node --test bloom/tests/tension.test.mjs`
 *
 * 用合成的手部骨架（21 点归一化坐标）验证三件事：
 *  1. 阈值语义对 —— 握拳在 0.32 以下、张开在 0.66 以上；
 *  2. 单调 —— 开合度越大 tension 越大，不出现反跳；
 *  3. 平滑帧率无关 —— 同一段时间无论切 1 帧还是 60 帧，结果一致。
 *
 * 这里**不**测 MediaPipe 本身（那需要摄像头 + 模型，属于人工验收）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LM,
  computeTension,
  tensionToSpread,
  fingerOpenness,
  palmSpread,
  smoothstep,
  approach,
  TensionTracker,
} from '../src/gesture/tension.js'

/** 21 点骨架：先铺一份中性数据，再按需覆盖。z 一律 0，避免引入深度噪声。 */
function skeleton(overrides) {
  const pts = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  for (const [i, p] of Object.entries(overrides)) pts[Number(i)] = { x: p[0], y: p[1], z: 0 }
  return pts
}

/** 握拳：指尖收在 MCP 附近，拇指压在掌侧。 */
const FIST = skeleton({
  [LM.WRIST]: [0.5, 0.9],
  [LM.THUMB_MCP]: [0.4, 0.8],
  [LM.THUMB_TIP]: [0.46, 0.78],
  [LM.INDEX_MCP]: [0.44, 0.68],
  [LM.INDEX_TIP]: [0.455, 0.7],
  [LM.MIDDLE_MCP]: [0.5, 0.66],
  [LM.MIDDLE_TIP]: [0.505, 0.685],
  [LM.RING_MCP]: [0.56, 0.68],
  [LM.RING_TIP]: [0.555, 0.7],
  [LM.PINKY_MCP]: [0.61, 0.71],
  [LM.PINKY_TIP]: [0.6, 0.725],
  // PIP 也收进来，让 curl 项读数一致
  [LM.INDEX_PIP]: [0.445, 0.69],
  [LM.MIDDLE_PIP]: [0.502, 0.672],
  [LM.RING_PIP]: [0.557, 0.69],
  [LM.PINKY_PIP]: [0.605, 0.717],
})

/** 完全张开：五指朝上散开。 */
const OPEN = skeleton({
  [LM.WRIST]: [0.5, 0.9],
  [LM.THUMB_MCP]: [0.4, 0.8],
  [LM.THUMB_TIP]: [0.25, 0.7],
  [LM.INDEX_MCP]: [0.44, 0.68],
  [LM.INDEX_PIP]: [0.4, 0.55],
  [LM.INDEX_TIP]: [0.34, 0.36],
  [LM.MIDDLE_MCP]: [0.5, 0.66],
  [LM.MIDDLE_PIP]: [0.5, 0.5],
  [LM.MIDDLE_TIP]: [0.5, 0.32],
  [LM.RING_MCP]: [0.56, 0.68],
  [LM.RING_PIP]: [0.58, 0.53],
  [LM.RING_TIP]: [0.61, 0.35],
  [LM.PINKY_MCP]: [0.61, 0.71],
  [LM.PINKY_PIP]: [0.65, 0.57],
  [LM.PINKY_TIP]: [0.7, 0.42],
})

/** 握拳 → 张开之间按比例混合位置（只用几何插值，不代表 ratio 也线性）。 */
function blended(b) {
  return FIST.map((p, i) => ({
    x: p.x + (OPEN[i].x - p.x) * b,
    y: p.y + (OPEN[i].y - p.y) * b,
    z: 0,
  }))
}

function spreadAt(b) {
  return tensionToSpread(computeTension(blended(b)).tension)
}

/**
 * 找「过渡区中点」的姿态。
 *
 * 2026-11-24 起 `FINGER_RANGES` 是按真手标定的窄区间，位置插值 50% 已经不落在中间带了
 * （ratio 在位置空间是非线性的，旧的 1.1→2.35 才恰好在 0.5 处过渡）。
 * 所以这里不写死 blend，而是扫一遍取「spread 最接近 0.5」的那个。
 */
const MID_BLEND = (() => {
  let bestB = 0.5
  let bestScore = -1
  for (let b = 0.02; b <= 0.98; b += 0.005) {
    const score = 1 - Math.abs(spreadAt(b) - 0.5)
    if (score > bestScore) { bestScore = score; bestB = b }
  }
  return bestB
})()

/** 半开：过渡区中点姿态。 */
const HALF = blended(MID_BLEND)

test('握拳：tension < 0.32，花朵应聚合为花苞', () => {
  const { tension, fingers } = computeTension(FIST)
  assert.ok(tension < 0.32, `tension=${tension.toFixed(3)} 应 < 0.32`)
  assert.equal(tensionToSpread(tension), 0)
  // 五指的 raw ratio 都应该在 closed 附近
  for (const f of fingers) {
    assert.ok(f.value < 0.35, `${f.name} 张开度 ${f.value.toFixed(2)} 应接近 0`)
  }
})

test('张开：tension > 0.66，花朵应完全绽放', () => {
  const { tension, fingers } = computeTension(OPEN)
  assert.ok(tension > 0.66, `tension=${tension.toFixed(3)} 应 > 0.66`)
  assert.equal(tensionToSpread(tension), 1)
  for (const f of fingers) {
    // 拇指的可达范围天生比其余四指窄，允许偏低一档
    const floor = f.name === 'thumb' ? 0.8 : 0.85
    assert.ok(f.value > floor, `${f.name} 张开度 ${f.value.toFixed(2)} 应接近 1`)
  }
})

test('半开：落在中间带，且无毛刺', () => {
  const { tension } = computeTension(HALF)
  assert.ok(tension > 0.15 && tension < 0.85, `tension=${tension.toFixed(3)} 应在中间`)
  const spread = tensionToSpread(tension)
  assert.ok(spread > 0.02 && spread < 0.98, `spread=${spread.toFixed(3)} 应处于过渡区`)
})

test('单调：握拳 < 半开 < 张开', () => {
  const t = [FIST, HALF, OPEN].map((s) => computeTension(s).tension)
  assert.ok(t[0] < t[1], `${t[0].toFixed(3)} 应 < ${t[1].toFixed(3)}`)
  assert.ok(t[1] < t[2], `${t[1].toFixed(3)} 应 < ${t[2].toFixed(3)}`)
})

test('逐指张开度对单指变化有响应', () => {
  // 只把食指伸直，其余仍握拳：食指的 value 应该跳起来，其他指保持低位
  const onlyIndex = FIST.map((p) => ({ ...p }))
  onlyIndex[LM.INDEX_TIP] = { ...OPEN[LM.INDEX_TIP] }
  onlyIndex[LM.INDEX_PIP] = { ...OPEN[LM.INDEX_PIP] }
  const fingers = fingerOpenness(onlyIndex)
  const index = fingers.find((f) => f.name === 'index')
  const middle = fingers.find((f) => f.name === 'middle')
  assert.ok(index.value > 0.85, `食指 ${index.value.toFixed(2)}`)
  assert.ok(middle.value < 0.35, `中指 ${middle.value.toFixed(2)}`)
})

test('缺少关键点必须抛错，不能静默输出 NaN', () => {
  assert.throws(() => computeTension(new Array(20).fill({ x: 0, y: 0, z: 0 })), TypeError)
  assert.throws(() => computeTension(null), TypeError)
})

test('掌宽塌缩时 palmSpread 返回 null 而不是 Infinity', () => {
  const degenerate = FIST.map((p) => ({ ...p }))
  degenerate[LM.PINKY_MCP] = { ...degenerate[LM.INDEX_MCP] }
  assert.equal(palmSpread(degenerate), null)
  // 整体仍然算得出来（该项被剔除后重新归一化权重）
  const { tension } = computeTension(degenerate)
  assert.ok(Number.isFinite(tension))
})

test('smoothstep 边界与中点精确', () => {
  assert.equal(smoothstep(0.32, 0.66, 0.32), 0)
  assert.equal(smoothstep(0.32, 0.66, 0.66), 1)
  assert.equal(smoothstep(0.32, 0.66, 0.1), 0)
  assert.equal(smoothstep(0.32, 0.66, 0.9), 1)
  assert.ok(Math.abs(smoothstep(0.32, 0.66, 0.49) - 0.5) < 1e-9, '中点应精确为 0.5')
  // 退化的 0 宽区间不应除零
  assert.equal(smoothstep(0.5, 0.5, 0.4), 0)
  assert.equal(smoothstep(0.5, 0.5, 0.6), 1)
})

test('tensionToSpread 在指令阈值上严格对齐', () => {
  assert.equal(tensionToSpread(0), 0)
  assert.equal(tensionToSpread(0.31), 0)
  assert.equal(tensionToSpread(0.32), 0)
  assert.equal(tensionToSpread(0.66), 1)
  assert.equal(tensionToSpread(1), 1)
})

test('帧率无关：dt=1 一步 ≈ 60 步 dt=1/60', () => {
  const oneStep = approach(0, 1, 0.1, 1)
  let sixty = 0
  for (let i = 0; i < 60; i++) sixty = approach(sixty, 1, 0.1, 1 / 60)
  assert.ok(Math.abs(oneStep - sixty) < 1e-9, `一步 ${oneStep} vs 六十步 ${sixty}`)
  // 60fps 下单帧正好是 0.1 的增益
  assert.ok(Math.abs(approach(0, 1, 0.1, 1 / 60) - 0.1) < 1e-9)
})

test('TensionTracker：平滑收敛且不受帧率影响', () => {
  const mk = () => new TensionTracker({ tau: 0.08 })

  const a = mk()
  for (let i = 0; i < 120; i++) a.update(OPEN, 1 / 60, i * 16.67)

  const b = mk()
  // 同样的时间窗（2 秒）但只喂 2 帧
  b.update(OPEN, 1, 0)
  b.update(OPEN, 1, 1000)

  const target = computeTension(OPEN).tension
  assert.ok(Math.abs(a.tension - target) < 0.01, `120 帧后 ${a.tension.toFixed(4)} ≈ ${target.toFixed(4)}`)
  assert.ok(Math.abs(a.tension - b.tension) < 0.02, `帧率无关性：${a.tension.toFixed(4)} vs ${b.tension.toFixed(4)}`)
})

test('TensionTracker：丢手 450ms 内保持，之后 active=false', () => {
  const tracker = new TensionTracker({ holdMs: 450, tau: 0.05 })
  tracker.update(OPEN, 1 / 60, 0)
  const held = tracker.update(null, 1 / 60, 300)
  assert.equal(held.active, true, '300ms 属于抖动，应保持')
  const lost = tracker.update(null, 1 / 60, 500)
  assert.equal(lost.active, false, '500ms 超过 holdMs，应判定失效')
  // 失效后 target 仍基于最后一次平滑值，调用方可用它做回落
  assert.ok(Number.isFinite(lost.target))
})

test('TensionTracker：噪声被压住（平滑后的抖动幅度明显小于原始输入）', () => {
  const tracker = new TensionTracker({ tau: 0.12 })
  let now = 0
  const smoothed = []
  const raw = []
  // 在「过渡区中点」附近以 30Hz 抖动 ±0.03：模拟 MediaPipe 关键点的常态抖动。
  // 中心值由 MID_BLEND 给出（阈值是标定过的，不能写死 0.49）。
  for (let i = 0; i < 180; i++) {
    const blend = MID_BLEND + Math.sin(i * 0.55) * 0.03
    const pose = blended(Math.max(0, Math.min(1, blend)))
    now += 16.67
    raw.push(tensionToSpread(computeTension(pose).tension))
    smoothed.push(tracker.update(pose, 1 / 60, now).target)
  }
  // 丢掉前 40 帧的收敛瞬态，只量稳定段的抖动
  const steady = (arr) => arr.slice(40)
  const jump = (arr) => Math.max(...arr.slice(1).map((v, i) => Math.abs(v - arr[i])))
  const rawJump = jump(steady(raw))
  const smoothJump = jump(steady(smoothed))
  assert.ok(rawJump > 0, '构造的输入必须有抖动，否则这个测试没有意义')
  assert.ok(
    smoothJump < rawJump * 0.4,
    `平滑后跳变 ${smoothJump.toFixed(4)} 应小于原始 ${rawJump.toFixed(4)} 的 40%`,
  )
})

// —— 双手张距（这一版的主控量）——
test('handGap：随两手距离单调增大，且是掌宽的倍数', async () => {
  const { handCenter, palmScale, handGap } = await import('../src/gesture/tension.js')
  const shift = (lm, dx) => lm.map((p) => ({ ...p, x: p.x + dx }))
  const near = handGap([OPEN, shift(OPEN, 0.15)])
  const mid = handGap([OPEN, shift(OPEN, 0.4)])
  const far = handGap([OPEN, shift(OPEN, 1.0)])
  assert.ok(near !== null && mid !== null && far !== null)
  // 严格单调：手越远，gap（单位=掌宽）越大
  assert.ok(near < mid && mid < far, `应单调：${near.toFixed(2)} / ${mid.toFixed(2)} / ${far.toFixed(2)}`)
  // 数量级检查：0.4 的位移大约等于 1.5 个掌宽（掌宽约 0.24）
  assert.ok(mid > 1 && mid < 3, `0.4 位移的 gap 应在 1–3 个掌宽：${mid.toFixed(2)}`)
  assert.ok(handCenter(OPEN).x > 0)
  assert.ok(palmScale(OPEN) > 0)
})

test('twoHandApartness：捏合 → 0，拉开 → 1，单手 → null', async () => {
  const { twoHandApartness } = await import('../src/gesture/tension.js')
  const close = OPEN.map((p) => ({ ...p, x: p.x + 0.06 }))
  const pinched = twoHandApartness([OPEN, close])
  const apartFar = OPEN.map((p) => ({ ...p, x: p.x + 1.4 }))
  const wide = twoHandApartness([OPEN, apartFar])
  assert.equal(pinched.apartness, 0)
  assert.equal(wide.apartness, 1)
  assert.equal(twoHandApartness([OPEN]), null)
  assert.equal(twoHandApartness([]), null)
})

// —— 手势方向（这次修的核心）——
test('handsOpenness：张手 → 接近 1，握拳 → 接近 0；双手取平均', async () => {
  const { handsOpenness } = await import('../src/gesture/tension.js')
  const open = handsOpenness([OPEN])
  const fist = handsOpenness([FIST])
  assert.ok(open > 0.66, `张手的张开度应 > 0.66，实际 ${open.toFixed(3)}`)
  assert.ok(fist < 0.32, `握拳的张开度应 < 0.32，实际 ${fist.toFixed(3)}`)
  // 方向：张开 → 散开（disperse = openness）。这条断言就是防"方向又反了"
  assert.ok(open > fist, '张手必须比握拳更散')
  // 双手：一开一握 → 平均值
  const mixed = handsOpenness([OPEN, FIST])
  assert.ok(Math.abs(mixed - (open + fist) / 2) < 1e-6, `双手应取平均：${mixed.toFixed(3)}`)
  assert.equal(handsOpenness([]), null)
  assert.equal(handsOpenness(null), null)
})

test('两指捏合（其余三指伸开）：张开度必须压下去，不能只认握拳', async () => {
  const { handsOpenness, computeTension: ct } = await import('../src/gesture/tension.js')
  // 2026-11-24 真机反馈的姿势：拇指尖贴到食指尖，中/无名/小指照常伸开。
  // 这种姿势下 tension 仍有 ~0.7（四指平均），只看 tension 花就不收。
  const pinch = OPEN.map((p) => ({ ...p }))
  pinch[LM.THUMB_TIP] = { x: OPEN[LM.INDEX_TIP].x, y: OPEN[LM.INDEX_TIP].y, z: 0 }
  const o = handsOpenness([pinch])
  const tens = ct(pinch).tension
  assert.ok(o !== null && o < 0.25, `两指捏合的张开度应 < 0.25，实际 ${o.toFixed(3)}`)
  assert.ok(
    tens > o + 0.2,
    `tension=${tens.toFixed(3)} 应明显高于收拢后的张开度 ${o.toFixed(3)}（说明 pinch 参与了判定）`,
  )
})
