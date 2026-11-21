# 来源与许可（Attribution）

裁剪后项目**只使用了两个场景**，对应两份来源：

| # | 来源 | 用途 | 许可 |
| --- | --- | --- | --- |
| 1 | 本项目原有的 `bloom` 花瓣项目 | 「花瓣」场景：三层花瓣 + 满屏散开（GPU 着色器） | 本项目自有 |
| 2 | `ZekangLi-Zico/Christmas-Tree` | 「圣诞树」场景：`tree.py` 的点生成算法与配色移植到 WebGL；原程序（pygame）部署在 `sources/06-christmas-tree-zekangli/` | 仓库**未声明许可**，仅作学习参考，商用需先联系作者 |

运行期依赖：

- **three.js r187**：MIT License，见 `vendor/three/LICENSE`。
- **MediaPipe Tasks Vision 1.2.3 + hand_landmarker 模型**：Apache-2.0，
  `Copyright 2023–2026 Google LLC`，见 `vendor/mediapipe/LICENSE`。
  npm 包本身未附 LICENSE/NOTICE，版权声明在此补充；Apache-2.0 不授予商标许可 ——
  不得用 MediaPipe / Google 的名称或标识做背书。

## 未使用但保留在 `sources/` 的仓库

以下仓库在本轮裁剪中已从运行路径移除，原始代码仍留在 `sources/` 仅作溯源参考：

| 仓库 | 原用途 |
| --- | --- |
| `electronicminer/gesture-Christmas_tree-3d_with_photo` | 曾经的第 4 个场景（另一版圣诞树） |
| `collidingScopes/iron-interface` | 曾经的第 7 个场景（环面结粒子） |
| `fengyujun0715/Gesture-Particle-Interaction-Effects` | 曾经的第 8 个场景（多形态） |
| `DerpZhenjun/Web-based-Interactive-Particle-Solar-System` | 曾经的第 6 个场景（太阳系） |
| `zeeshan020dev/Interactive-3D-Particle-System` | 曾经的第 5 个场景（粒子宇宙） |

`index.html` 不会加载 `sources/` 下任何文件。
