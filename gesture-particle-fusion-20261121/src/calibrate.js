/**
 * 手势阈值标定页（2026-11-24）。
 *
 * 为什么要有它：`FINGER_RANGES` / `SPREAD_THRESHOLD` / 捏合公式里的那些数字都是
 * 「注入数据上手调出来的」，没有在任何一只真手上核对过。这个页面把同一套
 * `HandTracker` + `Gestures` + `tension` 直接摆出来，让你对着摄像头做三个动作，
 * 把每指 ratio 的实测区间打出来，然后给出「按这只手该填什么值」的建议。
 *
 * 它不引入第二套算法：所有度量都来自 src/core/tension.js 与 src/core/gestures.js，
 * 页面只负责显示与统计。所以这里量的数就是场景里用的数。
 */
import { HandTracker } from './core/hand-tracker.js'
import { GestureState } from './core/gestures.js'
import {
  computeTension,
  fingerOpenness,
  palmSpread,
  palmScale,
  FINGER_RANGES,
  SPREAD_THRESHOLD,
  clamp01,
} from './core/tension.js'

const $ = (id) => document.getElementById(id)

const REC_MS = 2500          // 每次记录 2.5s
const UI_HZ = 12             // 实时面板刷新频率

const tracker = new HandTracker({ numHands: 2 })
const gestures = new GestureState()

const results = {}           // { open: {samples, at}, fist: {...}, pinch: {...} }
let recording = null
let running = false
let lastFrameAt = 0
let fps = 0
let lastUiAt = 0

/* ---------------------------------------------------------------- 采样 */

/** 一帧的原始度量（全部来自 core/tension.js，与场景同源） */
function sample(hands, now) {
  const lm = hands[0]
  if (!lm) return null
  const tens = computeTension(lm)
  const fingers = fingerOpenness(lm)
  const spread = palmSpread(lm)
  const scale = palmScale(lm) || 1
  const pinchD = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) / scale
  return {
    at: now,
    tension: tens.tension,
    parts: tens.parts,
    fingers: fingers.reduce((acc, f) => { acc[f.name] = f.raw; return acc }, {}),
    fingerValues: fingers.reduce((acc, f) => { acc[f.name] = f.value; return acc }, {}),
    spreadRaw: spread ? spread.raw : null,
    pinchD,
    pinch: clamp01((1.1 - pinchD) / 0.8),
    scale,
  }
}

/* ---------------------------------------------------------------- 统计 */

function sortedCopy(arr) { return arr.slice().sort((a, b) => a - b) }

function pct(arr, p) {
  if (!arr.length) return NaN
  const a = sortedCopy(arr)
  const i = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))
  return a[i]
}

function stats(values) {
  const v = values.filter((x) => Number.isFinite(x))
  if (!v.length) return null
  return {
    n: v.length,
    min: Math.min(...v),
    p05: pct(v, 0.05),
    p50: pct(v, 0.5),
    p95: pct(v, 0.95),
    max: Math.max(...v),
  }
}

/** 把一次记录的样本按指标压成统计表 */
function summarize(samples) {
  const per = (pick) => samples.map(pick).filter((x) => x !== null && x !== undefined)
  const fingers = {}
  for (const f of FINGER_RANGES) {
    fingers[f.name] = stats(per((s) => s.fingers[f.name]))
  }
  return {
    count: samples.length,
    durationMs: samples.length ? samples[samples.length - 1].at - samples[0].at : 0,
    tension: stats(per((s) => s.tension)),
    spreadRaw: stats(per((s) => s.spreadRaw)),
    pinchD: stats(per((s) => s.pinchD)),
    pinch: stats(per((s) => s.pinch)),
    fingers,
  }
}

/* ---------------------------------------------------------------- 实时面板 */

const LIVE_ROWS = [
  ['hands', '手数'],
  ['tension', '张力 tension（0..1）'],
  ['verdict', '按当前阈值判定'],
  ['palm', 'palm（EMA 平滑后）'],
  ['spread', 'spread（双手张开）'],
  ['fingersCount', '伸直手指数'],
  ['pinchD', '捏合距离 d（掌宽归一化）'],
  ['pinch', '捏合程度 pinch'],
  ['spreadRaw', '指尖跨度 / 掌宽'],
  ['scale', '掌宽 palmScale'],
]

function buildLiveTable() {
  const box = $('live')
  const rows = LIVE_ROWS.map(([k, label]) =>
    `<div class="row"><span class="k">${label}</span><span class="v" data-v="${k}">—</span></div>`).join('')
  const fingerRows = FINGER_RANGES.map((f) =>
    `<div class="row"><span class="k">${f.name} <em>raw</em></span>` +
    `<span class="v" data-v="raw-${f.name}">—</span>` +
    `<span class="bar"><i data-bar="${f.name}"></i></span>` +
    `<span class="lim">${f.closed}→${f.open}</span></div>`).join('')
  box.innerHTML = `<div class="rows">${rows}</div><div class="rows fingers">${fingerRows}</div>`
}

function setV(key, text) {
  const el = document.querySelector(`[data-v="${key}"]`)
  if (el) el.textContent = text
}

function n2(v) { return Number.isFinite(v) ? v.toFixed(2) : '—' }
function n3(v) { return Number.isFinite(v) ? v.toFixed(3) : '—' }

function verdictOf(tension) {
  if (!Number.isFinite(tension)) return '无手'
  if (tension <= SPREAD_THRESHOLD.closed) return `握拳/捏合（≤${SPREAD_THRESHOLD.closed}）`
  if (tension >= SPREAD_THRESHOLD.open) return `张开（≥${SPREAD_THRESHOLD.open}）`
  return '中间态'
}

function renderLive(hands, s) {
  setV('hands', String(hands.length))
  $('hands').textContent = hands.length ? `${hands.length} 只手` : '未检测到手'
  if (!s) {
    for (const [k] of LIVE_ROWS) if (k !== 'hands') setV(k, '—')
    for (const f of FINGER_RANGES) {
      setV(`raw-${f.name}`, '—')
      const bar = document.querySelector(`[data-bar="${f.name}"]`)
      if (bar) bar.style.width = '0%'
    }
    return
  }
  setV('tension', n3(s.tension))
  setV('verdict', verdictOf(s.tension))
  setV('palm', n3(gestures.palm))
  setV('spread', n3(gestures.spread))
  setV('fingersCount', String(gestures.fingers))
  setV('pinchD', n3(s.pinchD))
  setV('pinch', n3(s.pinch))
  setV('spreadRaw', n2(s.spreadRaw))
  setV('scale', n3(s.scale))
  for (const f of FINGER_RANGES) {
    const raw = s.fingers[f.name]
    setV(`raw-${f.name}`, n2(raw))
    const bar = document.querySelector(`[data-bar="${f.name}"]`)
    if (bar) {
      // 以该指的 closed→open 区间为 0–100%，超出就夹住（一眼看出该指贴不贴阈值）
      const k = (raw - f.closed) / (f.open - f.closed)
      bar.style.width = `${Math.round(clamp01(k) * 100)}%`
    }
  }
}

/* ---------------------------------------------------------------- 主循环 */

function frame(now) {
  if (!running) return
  requestAnimationFrame(frame)
  const dt = Math.min(0.05, Math.max(0, (now - (lastFrameAt || now)) / 1000))
  if (dt > 0) fps = fps ? fps * 0.9 + (1 / dt) * 0.1 : 1 / dt
  lastFrameAt = now

  const res = tracker.detect(now)
  const hands = res.hands || []
  gestures.update(hands, dt, now)
  const s = sample(hands, now)

  if (now - lastUiAt > 1000 / UI_HZ) {
    lastUiAt = now
    renderLive(hands, s)
    $('fps').textContent = `${Math.round(fps)} fps`
  }

  if (recording) {
    if (s) recording.samples.push(s)
    const left = Math.max(0, (recording.until - now) / 1000)
    $('recState').textContent = `${recording.label}：采集中… ${left.toFixed(1)}s（已 ${recording.samples.length} 帧）`
    if (now >= recording.until) finishRecording()
  }
}

/* ---------------------------------------------------------------- 记录 */

const ACTIONS = {
  open: '张开手',
  fist: '握拳',
  pinch: '捏合',
}

function startRecording(act) {
  if (!running) {
    flash('先点上面「开始」并允许摄像头')
    return
  }
  recording = {
    act,
    label: ACTIONS[act],
    until: performance.now() + REC_MS,
    samples: [],
  }
}

function finishRecording() {
  const rec = recording
  recording = null
  if (!rec) return
  if (!rec.samples.length) {
    $('recState').textContent = `${rec.label}：一帧都没采到（没检测到手？）`
    return
  }
  results[rec.act] = { summary: summarize(rec.samples), at: Date.now() }
  $('recState').textContent = `${rec.label}：采到 ${rec.samples.length} 帧，已记入报告`
  renderReport()
}

function flash(msg) {
  $('recState').textContent = msg
}

/* ---------------------------------------------------------------- 报告 */

function fmtStat(st, digits, suffix = '') {
  if (!st) return '—'
  return `p5 ${st.p05.toFixed(digits)} · p50 ${st.p50.toFixed(digits)} · p95 ${st.p95.toFixed(digits)}${suffix}`
}

/** 按实测区间给出建议：握拳取 p95、张开取 p5，两者必须有间隙 */
function suggestions() {
  const fist = results.fist && results.fist.summary
  const open = results.open && results.open.summary
  const pinch = results.pinch && results.pinch.summary
  const lines = []
  const ranges = []

  if (fist && open) {
    for (const f of FINGER_RANGES) {
      const a = fist.fingers[f.name]
      const b = open.fingers[f.name]
      if (!a || !b) continue
      const closed = a.p95
      const opened = b.p05
      const gap = opened - closed
      const row = {
        name: f.name,
        current: [f.closed, f.open],
        suggest: [Number(closed.toFixed(2)), Number(opened.toFixed(2))],
        gap,
      }
      ranges.push(row)
      lines.push(
        `${f.name.padEnd(7)} 握拳 p95 ${closed.toFixed(2)} · 张开 p5 ${opened.toFixed(2)}` +
        ` → 建议 closed ${closed.toFixed(2)} / open ${opened.toFixed(2)}` +
        (gap < 0.25 ? `  ⚠ 间距只有 ${gap.toFixed(2)}，判定会抖（换姿势或调 mix）` : '') +
        (gap <= 0 ? '  ✗ 区间重叠，这两个动作分不开' : ''),
      )
    }
    const tA = fist.tension, tB = open.tension
    if (tA && tB) {
      lines.push(
        `tension  握拳 p95 ${tA.p95.toFixed(2)} · 张开 p5 ${tB.p05.toFixed(2)}` +
        ` → 建议 SPREAD_THRESHOLD { closed: ${tA.p95.toFixed(2)}, open: ${tB.p05.toFixed(2)} }` +
        `（当前 ${SPREAD_THRESHOLD.closed}→${SPREAD_THRESHOLD.open}）`,
      )
    }
  } else {
    lines.push('（还需要「张开手」与「握拳」两条记录才能给出建议）')
  }

  if (pinch && open) {
    const dPinch = pinch.pinchD ? pinch.pinchD.p95 : NaN
    const dOpen = open.pinchD ? open.pinchD.p05 : NaN
    if (Number.isFinite(dPinch) && Number.isFinite(dOpen)) {
      lines.push(
        `捏合 d   捏合 p95 ${dPinch.toFixed(2)} · 张开 p5 ${dOpen.toFixed(2)}` +
        ` → 判定「捏住」可用 d ≤ ${dPinch.toFixed(2)}（当前公式 1.1 处算全张开）` +
        (dPinch >= dOpen ? '  ✗ 重叠：捏合没比张开更近' : ''),
      )
    }
  }

  return { lines, ranges }
}

function renderReport() {
  const acts = Object.keys(results)
  if (!acts.length) {
    $('report').textContent = '还没有记录。点上面三个按钮，各保持 2.5 秒。'
    return
  }
  const out = []
  out.push(`# Persist 手势标定 · ${new Date().toLocaleString('zh-CN')}`)
  out.push(`浏览器：${navigator.userAgent}`)
  out.push(`分辨率：${window.innerWidth}×${window.innerHeight} · DPR ${window.devicePixelRatio}`)
  out.push('')

  for (const act of ['open', 'fist', 'pinch']) {
    const r = results[act]
    if (!r) continue
    const s = r.summary
    out.push(`## ${ACTIONS[act]}（${s.count} 帧 / ${(s.durationMs / 1000).toFixed(1)}s）`)
    out.push(`tension  ${fmtStat(s.tension, 3)}`)
    out.push(`pinch d  ${fmtStat(s.pinchD, 3)} · pinch ${fmtStat(s.pinch, 3)}`)
    out.push(`指尖跨度 ${fmtStat(s.spreadRaw, 2)}`)
    for (const f of FINGER_RANGES) {
      out.push(`${f.name.padEnd(7)} ${fmtStat(s.fingers[f.name], 2)}  （当前 ${f.closed}→${f.open}）`)
    }
    out.push('')
  }

  const sug = suggestions()
  out.push('## 建议')
  for (const line of sug.lines) out.push(line)
  out.push('')
  out.push('## 直接可粘贴的 FINGER_RANGES')
  if (sug.ranges.length) {
    for (const r of sug.ranges) {
      const f = FINGER_RANGES.find((x) => x.name === r.name)
      out.push(`  { name: '${f.name}', mcp: LM.${f.name.toUpperCase()}_MCP, tip: LM.${f.name.toUpperCase()}_TIP, closed: ${r.suggest[0]}, open: ${r.suggest[1]}, weight: ${f.weight} },`)
    }
  } else {
    out.push('  （先采满「张开手」和「握拳」）')
  }

  $('report').textContent = out.join('\n')
}

/* ---------------------------------------------------------------- 启动 */

async function start() {
  const btn = $('startBtn')
  btn.disabled = true
  btn.textContent = '正在加载模型…'
  try {
    await tracker.start($('cam'))
    running = true
    lastFrameAt = 0
    fps = 0
    $('camHint').hidden = true
    btn.textContent = '已就绪'
    btn.classList.add('ok')
    requestAnimationFrame(frame)
  } catch (err) {
    btn.disabled = false
    btn.textContent = '开始（授权摄像头）'
    $('camHint').hidden = false
    $('camHint').textContent = `启动失败：${err && err.message ? err.message : err}`
  }
}

function wire() {
  buildLiveTable()
  renderReport()
  $('startBtn').addEventListener('click', start)
  for (const btn of document.querySelectorAll('[data-act]')) {
    btn.addEventListener('click', () => startRecording(btn.dataset.act))
  }
  $('copyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('report').textContent || '')
      $('copyBtn').textContent = '已复制'
      setTimeout(() => { $('copyBtn').textContent = '复制报告' }, 1500)
    } catch {
      $('copyBtn').textContent = '复制失败（手动选中）'
    }
  })
}

wire()

/* ---------------------------------------------------------------- 自检钩子 */

/**
 * 控制台自检（`window.__calibrate.selftest()`）：
 * 用合成样本把「统计 → 建议 → 报告」整条链路跑一遍，验证页面逻辑本身没问题，
 * 不必等真手。它不会写回任何阈值，只是把结果渲染进报告区。
 */
function synthSamples(fingerRaw, tension, pinchD, n = 40) {
  const out = []
  for (let i = 0; i < n; i++) {
    const j = () => (Math.random() - 0.5) * 0.02
    out.push({
      at: i * 16,
      tension: tension + j(),
      parts: {},
      fingers: Object.fromEntries(Object.entries(fingerRaw).map(([k, v]) => [k, v + j()])),
      fingerValues: {},
      spreadRaw: 1.0 + j(),
      pinchD: pinchD + j(),
      pinch: clamp01((1.1 - pinchD) / 0.8),
      scale: 0.1,
    })
  }
  return out
}

window.__calibrate = {
  selftest() {
    results.fist = { summary: summarize(synthSamples({ thumb: 1.55, index: 1.18, middle: 1.22, ring: 1.18, pinky: 1.12 }, 0.12, 0.85)), at: Date.now() }
    results.open = { summary: summarize(synthSamples({ thumb: 2.30, index: 2.42, middle: 2.46, ring: 2.31, pinky: 2.05 }, 0.72, 0.25)), at: Date.now() }
    results.pinch = { summary: summarize(synthSamples({ thumb: 1.40, index: 1.15, middle: 2.40, ring: 2.30, pinky: 2.00 }, 0.30, 0.18)), at: Date.now() }
    renderReport()
    return $('report').textContent
  },
  reset() {
    for (const k of Object.keys(results)) delete results[k]
    renderReport()
  },
}

