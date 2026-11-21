/**
 * 统一 UI：场景切换、全屏、手势开关、状态与 HUD。
 * 只碰 DOM，不碰 WebGL —— 换场景不会重建任何界面节点。
 */

export function createUI({ scenes, onSelect, onToggleHands, onFullscreen, onColor }) {
  const nav = document.querySelector('#scene-nav')
  const colorInput = document.querySelector('#color')
  const btnHands = document.querySelector('#btn-hands')
  const btnFull = document.querySelector('#btn-fullscreen')
  const statusEl = document.querySelector('#status')
  const hudEl = document.querySelector('#hud')
  const toastEl = document.querySelector('#toast')
  const titleEl = document.querySelector('#scene-title')
  const hintEl = document.querySelector('#scene-hint')

  // —— 场景按钮 ——
  const buttons = new Map()
  scenes.forEach((s, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'scene-btn'
    b.dataset.scene = s.id
    b.innerHTML = `<span class="scene-idx">${i + 1}</span><span class="scene-name">${s.label}</span>`
    b.title = s.hint
    b.addEventListener('click', () => onSelect(s.id))
    nav.append(b)
    buttons.set(s.id, b)
  })

  btnHands.addEventListener('click', onToggleHands)
  btnFull.addEventListener('click', onFullscreen)

  // 颜色选择器：input 事件即时生效（拖动取色器时也在变）
  if (colorInput && onColor) {
    colorInput.addEventListener('input', () => onColor(colorInput.value))
  }

  let toastTimer = 0
  function toast(title, hint) {
    toastEl.innerHTML = ''
    const h = document.createElement('strong')
    h.textContent = title
    toastEl.append(h)
    if (hint) {
      const p = document.createElement('span')
      p.textContent = hint
      toastEl.append(p)
    }
    toastEl.classList.add('is-open')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toastEl.classList.remove('is-open'), 12000)
  }
  toastEl.addEventListener('click', () => toastEl.classList.remove('is-open'))

  function status(text, tone = '') {
    statusEl.textContent = text
    statusEl.dataset.tone = tone
  }

  function setActive(s) {
    for (const [id, b] of buttons) b.classList.toggle('is-active', id === s.id)
    titleEl.textContent = s.label
    hintEl.textContent = s.hint
  }

  function setHandsState(state) {
    const label = { idle: '开启手势', loading: '启动中…', on: '关闭手势', error: '重试手势' }[state] || '开启手势'
    btnHands.textContent = label
    btnHands.disabled = state === 'loading'
    btnHands.dataset.state = state
  }

  function setFullscreen(isFull) {
    btnFull.textContent = isFull ? '退出全屏' : '全屏'
    btnFull.setAttribute('aria-pressed', String(isFull))
  }

  let hudAt = 0
  function hud({ fps, scene, gestures, label }) {
    const now = performance.now()
    if (now - hudAt < 200) return
    hudAt = now
    const hint = label ? ` · ${label}` : ''
    hudEl.textContent =
      `${scene.label}${hint}  ·  ${fps} fps  ·  ` +
      `手 ${gestures.hands} / 张 ${gestures.palm.toFixed(2)} / 捏 ${gestures.pinch.toFixed(2)} / 距 ${gestures.spread.toFixed(2)} / 指 ${gestures.fingers}`
  }

  setHandsState('idle')
  setFullscreen(Boolean(document.fullscreenElement))

  return { setActive, setHandsState, setFullscreen, status, toast, hud }
}
