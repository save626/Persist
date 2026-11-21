/**
 * 场景注册表 —— 统一入口只认这张表。
 *
 * 现在只有两个场景：
 *   1. 花瓣：最初的"花瓣张开 / 满屏散开"（bloom 的 GPU 着色器方案）
 *   2. 圣诞树：ZekangLi-Zico/Christmas-Tree 的 tree.py 点生成算法移植
 *
 * 每个场景实现同一接口：
 *   { id, label, group, frame:{z,fov}, update(dt, gestures), resize(w,h,dpr),
 *     setTint(hex), dispose() }
 * 引擎负责挂载/卸载、统一相机与循环；场景只管自己的粒子。
 */
import { createFlowerScene } from './flower-scene.js'
import { createLightsTreeScene } from './lights-tree.js'

export const SCENES = [
  {
    id: 'flower',
    label: '花瓣',
    hint: '张手散开 · 捏合聚花',
    create: (env) => createFlowerScene(env),
  },
  {
    id: 'lights',
    label: '圣诞树',
    hint: '张手炸散 · 握拳收树',
    create: (env) => createLightsTreeScene(env),
  },
]
