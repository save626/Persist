/**
 * 统一渲染引擎：**一个 WebGLRenderer、一个 Scene、一个相机、一个 RAF 循环**。
 *
 * 六个题材都只是挂进同一个场景的 Group。切换场景时旧场景的 `dispose()` 会被调用，
 * 它的几何/材质/texture 全部释放，避免多套渲染循环和显存泄漏（原五个仓库各有一个
 * 自己的 renderer + requestAnimationFrame，这是融合时要先干掉的东西）。
 */
import * as THREE from '../../vendor/three/three.module.js'

export function createEngine({ canvas }) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    // alpha:true 是为了让「花瓣」场景的背景透出下层的流星雨/星轨画布；
    // 其它场景在 setScene 里把 clearAlpha 设回 1，行为和不透明时一致。
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x05080d, 1)

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x05080d, 0.012)

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)
  camera.position.set(0, 0, 14)
  camera.lookAt(0, 0, 0)

  let current = null
  let width = 1
  let height = 1

  function applyFraming(inst) {
    const f = inst && inst.frame
    camera.fov = f?.fov ?? 55
    camera.position.set(0, f?.y ?? 0, f?.z ?? 14)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }

  function resize() {
    width = window.innerWidth
    height = window.innerHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    if (current && current.resize) current.resize(width, height, renderer.getPixelRatio())
  }
  window.addEventListener('resize', resize)

  return {
    THREE,
    renderer,
    scene,
    camera,
    get size() {
      return { width, height }
    },
    resize,
    setScene(inst) {
      if (current) {
        scene.remove(current.group)
        current.dispose?.()
      }
      current = inst
      if (inst) {
        // 需要透出背景层（流星雨）的场景才清成透明
        renderer.setClearColor(0x05080d, inst.transparentBackground ? 0 : 1)
        scene.add(inst.group)
        applyFraming(inst)
        inst.resize?.(width, height, renderer.getPixelRatio())
      }
    },
    update(dt, gi) {
      if (current && current.update) current.update(dt, gi)
      // 轻微相机漂移，让画面不做成死图
      camera.position.x = Math.sin(performance.now() * 0.00006) * 0.35
      camera.lookAt(0, 0, 0)
    },
    render() {
      renderer.render(scene, camera)
    },
  }
}
