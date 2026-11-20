# eyeTutorial 复刻版渲染引擎（vendor）

本目录存放 **落地页入场动画**的渲染引擎：`engine.js`。

## 来源与链路

| 层级 | 仓库 | 说明 |
| --- | --- | --- |
| 原始效果 | [`iremcnar/eyeTutorial`](https://github.com/iremcnar/eyeTutorial) | ASCII 艺术动画：眼睛睁开 → 眨眼 → 视线游移 → 镜头推进瞳孔 → 穿过星场 → 心形星云。**该仓库未声明许可证。** |
| Python 复刻 | 本地工程 `D:/Work/geo-web/eyeTutorial-replica` | 对原效果的逐帧复刻，拆为 `eye_ascii/` 包 + `preview.py` 无界面预览。作者自述「请勿用于商业分发」。 |
| **本文件** | `web/engine.js` | 上述 Python 复刻的 **JavaScript 移植版**：同一套数学（MT19937、程序化贴图、虹膜/星场/星云），输出与 Python 版相同的 `idx`（字符表）与 `q`（量化颜色）两张表。 |

`engine.js` 与源工程 `web/engine.js` **逐字节一致**（未做任何修改），
这样任何时候都能回到源头比对。改造都发生在**调用侧**（落地页的播放器），
而不是引擎内部 —— 引擎保持可替换。

## 许可

- 上游 `iremcnar/eyeTutorial` **未声明许可证**。
- 本地复刻工程 README 明确写道：「本目录作为学习用的复刻实现，请勿用于商业分发；
  如需引用或二次发布，请先征得原作者同意。」
- 本仓库沿用同样的态度：**这是学习性质的复刻**。若该项目要商业化，
  需先与原作者确认授权。

## 引擎对外接口

```js
const engine = window.EyeEngine

// 字符梯度表与颜色量化档数
engine.RAMP   // ' .`^",:;Il!i><~+_-?][}{1)(|\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$'
engine.QL     // 24

// 构造渲染器
const r = new engine.Renderer(cellW, cellH, rows, opts)
//   opts: { smooth, contrast, levels, glyphs, hash, tex }

// 推进一帧（t 为秒，dt 为步长）
const { idx, q } = r.render(t, dt)
//   idx: Uint8Array(nRows*nCols)  每格显示 RAMP 的第几个字符（0 = 空格）
//   q:   Uint8Array(nRows*nCols*3) 每格量化后的 RGB（每通道 0..QL-1）

r.reset()     // 回到初始状态
r.geo         // { nRows, nCols, cw, ch, W, H, ... }
```

## 关键常量（在引擎内部 `CFG`，当前不导出）

```
SS=2        每格 2×2 采样点
ASPECT=1.40 画面宽高比
T_OPEN=0.9  T_OPEN_D=2.4   睁眼
T_BLINK=4.0                眨眼
T_Z0=5.4    T_ZD=28.0      推进（ZEND=14 倍）
T_SPACE=33.4 T_HEART=8.9   纯星空 / 心形星云起点
WO=0.78 HU=0.30 HL=0.20    眼裂与眼睑几何
RI=0.27 RP0=0.098          虹膜半径 / 瞳孔初始半径
RAMP(70 档) QL=24
```

## 落地页怎么用它

落地页的播放器（内联在 `landing/index.html`）只做三件事：

1. **按 Python 原版的字符格建网格** —— 8×17 px / 30 行，**不按视口放大格子**
   （这是「字符过于密集」的根因，见 `landing/README.md`）。
2. **重排时间线** —— 砍掉心形星云阶段（`T_HEART` 起），
   在瞳孔铺满、进入星场后不久就淡出交棒落地页。
3. **改配色** —— 引擎输出的 `q` 是逐格 RGB，播放器在写入画布前做冷灰蓝映射。

引擎本身一行未改。
