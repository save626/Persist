# 手势粒子融合 · Gesture Particle Fusion（裁剪版）

只剩两个场景：**花瓣**（最初的张开 / 满屏散开）与 **圣诞树**（ZekangLi-Zico/Christmas-Tree 的移植）。
一套 Three.js 渲染、一套手势管线、一个入口页面。

## 跑起来

```powershell
node serve.mjs            # http://localhost:4190
node serve.mjs 4200       # 换端口
```

- 打开即进入「花瓣」，底部两个按钮切场景；键盘 `1` / `2` 也行。
- 不点「开启手势」也能看：两个场景都有自动动画。
- 点「开启手势」才申请摄像头并懒加载 MediaPipe（本地 wasm + 本地模型，零外部请求）。
- 右下角：颜色选择器、「开启手势」、「全屏」（或按 `F`）。

## 两个场景

| # | 场景 | 手势映射 | 来源 |
| --- | --- | --- | --- |
| 1 | 花瓣 | 张手 / 双手拉开 → 满屏散开；捏合 → 聚成三层花瓣 | 本项目原有 bloom（GPU 着色器） |
| 2 | 圣诞树 | 张手 → 炸散成星云；握拳 → 收回成树；手左右 → 旋转 | `tree.py` 点生成算法移植到 WebGL |

### 花瓣场景的三个改动

- **散开/聚合改成逐粒子推进**：每颗粒子有独立的扩散进度 `aDisperse`，JS 每帧按
  0.055–0.13/帧（逐粒子不同）朝目标推进。以前是"共享阈值 + 瞬间起步"，会一顿一顿；
  现在和圣诞树同一套连续推进，过渡顺滑且带错落感（32000 个 float 的属性上传/帧）。
- **自动循环的节奏**（无手势时，20 秒一圈）：

  | 时段 | 动作 |
  | --- | --- |
  | 0–7s | **花停留**（停留时间从 0 提到 7s） |
  | 7–10s | 散开（从 18s 压到 **3s**） |
  | 10–12s | 散着停留 |
  | 12–15s | 聚合（**3s**） |
  | 15–20s | 再停留 5s |

  旧版是匀速三角波（0.055/s），0→1 要 18 秒、且**从不停留**——花一直在缓慢动。
  新版本每段过渡用 smoothstep 缓入缓出，段与段之间不顿。
- **流星雨 + 星轨回来了**：`src/core/meteors.js`（独立 2D canvas）垫在 WebGL 之下，
  WebGL 在该场景清成透明（`transparentBackground`），所以流星真的在花**背后**；
  其它场景 `clearAlpha=1` + `body.has-meteors` 关闭，看不到也不浪费 CPU。

### 圣诞树的三个改动

- **深度排序绘制**：每 3 帧做一次**索引桶排序**（256 桶，O(n)）——算相机空间 z，
  从远到近写进 geometry 的 index 缓冲，Points 按索引顺序绘制，即 painter's algorithm。
  不重排顶点属性，避免每帧拷贝 50k×3 个 float。
- **螺旋 / 填充拆成两个独立材质**：`spiralMat`（35k 点）与 `fillMat`（15k 点）各自
  `PointsMaterial`，可分别调亮度：
  ```js
  scene.setBrightness(1.0, 0.6)   // (螺旋, 填充)，0–2
  ```
  其它点（地面光环 / 星点 / 爱心 / 细颈）单独用加色材质当"光"层。
- **无手势时满屏散开**：散开目标从"球壳"改成按相机 FOV / 宽高比算出的**视口圆盘**
  （半径盖住四角），并以 16s 周期在"树 ↔ 满屏"之间往复，和花瓣场景同一个观感。

## 颜色选择器

右下角取色器，`input` 事件即时生效：

- 花瓣：着色器里的 `uTint` 乘色（保留内层压暗与逐粒子微扰）；
- 圣诞树：`PointsMaterial.color` 乘顶点色（保留粉色点阵的明暗层次）；
- 选白色（默认）= 不染色；切场景时自动沿用当前颜色。

## 手势延迟

- 手势 EMA 时间常数 **0.04s**（原 0.07s）；
- MediaPipe 检测上限 **30fps**（原 24fps，慢设备仍自动降频）；
- 场景里不再叠第二层平滑，手势直接驱动扩散/缩放。

## 目录

```
index.html / styles.css      入口与界面（场景按钮 / 颜色 / 全屏 / 手势 / HUD）
serve.mjs                    静态服务（wasm MIME / CSP / 摄像头权限）
src/
├─ main.js                   装配：引擎 + 手势 + 场景注册表 + 循环
├─ stage.js                  **可复用渲染层**：createParticleStage（无 UI/手势/流星，
│                            独立工程与落地页开场共用同一份粒子代码）
├─ core/
│  ├─ engine.js              单渲染器 / 单相机 / 单 RAF / 场景挂载与释放
│  ├─ gestures.js            统一手势状态（palm/fist/pinch/spread/fingers/pos/rot）
│  ├─ tension.js             手掌张开度（含双手掌宽归一化）
│  ├─ hand-tracker.js        MediaPipe HandLandmarker（本地 wasm + 模型）
│  ├─ overlay.js             21 点骨架叠加
│  ├─ meteors.js             流星雨 + 星轨（独立 2D canvas，只在花瓣场景）
│  └─ sprites.js             共用光点贴图 + 缓动工具
├─ scenes/
│  ├─ index.js               场景注册表（只有 flower / lights）
│  ├─ flower-scene.js        花瓣场景包装
│  ├─ flower/                花瓣的粒子与着色器（bloom 原样搬入）
│  └─ lights-tree.js         圣诞树（tree.py 算法移植）
└─ ui/ui.js                  场景按钮 / 颜色 / 全屏 / 手势 / HUD
vendor/three/                r187（MIT）
vendor/mediapipe/            tasks-vision 1.2.3 + hand_landmarker.task（Apache-2.0）
sources/06-christmas-tree-zekangli/   已部署的 pygame 原程序（含 .venv）
scripts/shoot.mjs            渲染验收
preview/                     验收截图 + fusion-report.json
```

## 圣诞树：原程序部署 + Web 端合并

### 已部署的原程序（Python / pygame）

目录：`sources/06-christmas-tree-zekangli/`

| 文件 | 作用 |
| --- | --- |
| `tree.py` | 打过补丁的原程序（上游原文件保留在 `tree.py.upstream`） |
| `.venv/` | 已装好 pygame 2.6.1 的虚拟环境 |
| `requirements.txt` | `pygame>=2.5` |
| `run.cmd` | 用 `.venv` 启动的入口 |
| `capture_preview.py`、`preview.png` | 无头截图脚本与参考渲染图（1600×900） |
| `PATCHES.md` | 两处补丁记录 |
| `SOURCE.md` | 来源、分支、许可、取回方式与时间 |

**补丁**（详见 `PATCHES.md`）：

1. **字体兜底**（必要）：本机 `pygame.font.SysFont` 对所有字体名抛
   `TypeError: expected str, bytes or os.PathLike object, not int`，导致 `main()` 一进入就崩；
   新增 `load_title_font()`，失败时退回 `pygame.font.Font(None, size)`。
2. **副标题可配置**（非必要）：把写死的 `"647"` 改成
   `os.environ.get("CHRISTMAS_SUBTITLE", "647")`。

**运行入口**

```powershell
cd sources/06-christmas-tree-zekangli
.\run.cmd                            # 或：.venv\Scripts\python tree.py
# 自定义副标题：set CHRISTMAS_SUBTITLE=你的名字 && run.cmd
```

### 合并进 Web 项目

浏览器跑不了 pygame，所以把 `tree.py` 的**点生成算法与配色逐行搬进** `src/scenes/lights-tree.js`：

| tree.py | WebGL 移植 |
| --- | --- |
| 70% 螺旋灯带：`h=u^1.6`、`angle=u·9·2π`、`base_r=(1-h)^1.1·3.2` | 同 |
| 树枝层次：`sin((h·5.8+0.15)·2π)` → `1+0.65·wave`，再按波提亮 | 同 + `bandGain` |
| 30% 填充：`h=rand^1.9`、`r=base_r·sqrt(rand)` | 同 |
| 地面 6 圈光环（4.6…11.4，±0.42 抖动） | 同 |
| 空中星点 1200（x/z ±18、y 3–18、冷白偏蓝） | 同 |
| 树顶隐式方程爱心 `(x²+y²−1)³−x²y³≤0` + 细颈 | 同（放大到 1.35 以适配取景） |
| pygame 逐点绘制 + 手写投影 + 深度排序 | `THREE.Points` + 透视相机（俯角 0.12rad） |
| **不透明点、普通混合** | **`NormalBlending`**（叠加混合会把 5 万点烧成白团） |

**验证**

```powershell
node scripts/shoot.mjs               # 两个场景都出图 + 颜色/全屏/手势断言
```
或打开 http://localhost:4190 → 点「圣诞树」：粉色点阵树 + 地面光环 + 空中星点 + 顶部爱心；张手炸散、握拳收树。

## 本次裁剪：删除了什么

| 删除项 | 原因 |
| --- | --- |
| `src/scenes/forms.js`（花瓣/爱心/土星/烟花形态） | 需求改为只保留圣诞树与花瓣两种形态 |
| `src/scenes/tree.js`（electronicminer 圣诞树） | 与保留的圣诞树重复，且算法来自其它仓库 |
| `src/scenes/cosmos.js`（zeeshan020dev 粒子宇宙） | 不在保留范围 |
| `src/scenes/solar.js`（DerpZhenjun 太阳系） | 不在保留范围，且 React 依赖已移除 |
| `src/scenes/iron.js`（collidingScopes 铁界面） | 不在保留范围 |
| `src/scenes/multi.js`（fengyujun0715 多形态） | 不在保留范围 |
| 形态子导航 `#form-nav` + `.form-nav/.form-btn` + `setForms()` + `__fusion.setForm/formId/forms` | 形态场景删除后成为死代码 |
| 场景按钮从 8 个减到 2 个、键盘范围 1–8 → 1–2 | 入口收敛 |

`sources/` 下其它仓库的原始代码**保留**（只读、不参与运行），仅用于溯源；`ATTRIBUTION.md` 已同步。

## 验收

```powershell
node scripts/shoot.mjs
```

最近一次（1440×900，headless Chromium + SwiftShader）：

| 场景 | 亮像素 | 平均亮度 |
| --- | --- | --- |
| flower | 31.95% | 60.7 |
| lights | 6.77% | 122.1 |

- 花瓣聚拢态包围盒 **0.605 × 0.859**（与 bloom 原版 0.586 × 0.833 一致）
- 场景列表 = `flower, lights`（数量与顺序都对）
- 颜色选择器：绿−红 `-9.2 → 112.9`（生效）
- 全屏按钮、颜色输入框存在；`#form-nav` 已不存在
- 双手张合（花瓣）：张开 95.9% vs 捏合 30.6%
- 流星雨层：1.76% 亮像素 / 1440×900，且 `body.has-meteors` 只在花瓣场景为真
- 圣诞树自动循环：横向包围盒 70.1% → 99.9%（能满屏散开再收回）
- 已删除的场景文件不存在（脚本会检查）
- 零运行报错

> 诊断脚本：`node scripts/shot-flower-still.mjs` —— 抓一张"花瓣完全聚拢"的静帧
> （`preview/flower-gathered.png`），用来和 bloom 原版截图对比尺寸。

## 手势阈值标定页（2026-11-24）

`FINGER_RANGES` / `SPREAD_THRESHOLD` / 捏合公式里的数字全部是**在注入快照上手调出来的**，
从来没在一只真手上核对过。`calibrate.html` 就是为了补这一步：

```powershell
cd gesture-particle-fusion-20261121
node serve.mjs 4190
# 浏览器开 http://localhost:4190/calibrate.html（localhost 是安全上下文，摄像头可用）
```

1. 点「开始」授权摄像头（页面左上显示「N 只手 / 未检测到手」和实时 fps）；
2. 依次点三个按钮，各**保持动作 2.5 秒**：张开手 → 握拳 → 捏合；
3. 报告区会给出每指 `raw` 的 p5/p50/p95、张力、捏合距离，并算出建议值：
   `closed = 握拳 p95`、`open = 张开 p5`（两者必须有间隙，否则会标 ⚠/✗）；
4. 末尾有一段可直接粘贴的 `FINGER_RANGES` 片段与 `SPREAD_THRESHOLD` 建议，点「复制报告」拿走。

它**复用** `src/core/hand-tracker.js` + `gestures.js` + `tension.js`（与场景同一套代码），
页面只做显示与统计，所以这里量到的数就是场景里用的数。
控制台还有 `window.__calibrate.selftest()`：用合成样本把「统计 → 建议 → 报告」跑一遍，
用来验证页面逻辑本身（不需要真手）。

## 仍需处理

1. **真手已标定（2026-11-24），但只对这一只手最优**：`FINGER_RANGES` / `palmSpread`
   按实测重填，`thumb.weight=0`（拇指 ratio 在握拳时反而更大，没有区分度）。
   换手、换摄像头、换分辨率后要重跑上一节的标定页。
2. **树的"全局"深度顺序是近似的**：螺旋与填充是两个 draw call，无法真正交错绘制；
   现在各自桶排序 + 按两层平均深度决定先后。若要像素级还原 painter's order，
   需要合并成一个材质（但那样就违背"亮度分别控制"的要求）或用多趟按深度区间切分绘制。
3. **软件渲染下帧率低**：headless + SwiftShader 只有 6–8 fps（每帧 50k 点排序 +
   65k 位置写回 + 24k 花瓣进度推进）。真实 GPU 上应远高于此，但未在真机测过。
4. **移动端未分场景降配**：目前只有全局 DPR 限制，树场景在低端机上可能需要减少排序频率或点数。
5. **pygame 程序的退出**：上游没有 ESC 退出，只能点窗口关闭按钮（`PATCHES.md` 已记录）。

## 被落地页开场复用

渲染层 src/stage.js 不含 UI：`createParticleStage({ canvas, sceneId })` 返回
`update(dt, gestures) / render() / loadScene() / setDisperse() / setScale() / setAuto() / setTint() / measure() / dispose()`。
落地页开场（`landing-app/src/components/IntroOverlay.vue`）就是这么用的：

- `setAuto(false)` 关自动循环；
- `setDisperse(0)` 保持完整六瓣（只要开到 0.2，粒子就会朝屏幕随机目标点漂移，瓣形立刻糊掉）；
- `setScale(0.4 → 1)` 做"从瞳孔里长出来"的缩放；
- 遮罩/透明度由开场自己的 CSS 过渡负责，粒子层本身 `pointer-events:none`。

花瓣场景为此加了 `setAuto/setDisperse/setScale` 三个手动接口（手势模式下行为不变）。