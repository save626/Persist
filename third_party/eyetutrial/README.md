# eyeTutrial（上游源码）

本目录是 **[Praise-Peter/EyeTutrial-website](https://github.com/Praise-Peter/EyeTutrial-website)**
的上游原始文件，**逐字未改**，用于记录落地页开场动画的来源与依据。

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `IDK.html` | 上游根目录 | 眼睛绘制教程正文（14 个步骤） |
| `IDK.css` | 上游根目录 | 上游页面样式 |
| `.upstream-commit` | — | 克隆时的 commit sha |

- 克隆方式：`git clone --depth 1 https://github.com/Praise-Peter/EyeTutrial-website.git`
- commit：`f2e49464b03b180acf7bf32db7eae31e53614618`（上游仅此一个提交，仓库体积 4 KB）
- 许可：上游仓库**没有 LICENSE 文件**，也没有声明许可条款。

## 上游仓库的实际内容（重要）

上游仓库**只有 `IDK.html` 和 `IDK.css` 两个文件**：

- 它是一个「怎么画眼睛」的图文教程页，**不是动画库**；
- 正文里引用的 `images/` 目录（`Step 1.png` … `Step 13.mp4`、`Eye tut.png` 等）
  **从未被提交到仓库**——GitHub API 的 tree 只有上述两个 blob，
  网页端的文件列表同样只有这两项。也就是说：那套眼部的美术资源在公开仓库里取不到。

## 落地页是怎么用它的

`landing/intro/` 的开场动画**照搬上游教程的画法与结构**，而不是另起炉灶：

1. **分层顺序**沿用上游 Step 1–13 的顺序：
   圆（眼球）→ 上眼睑 → 虹膜与瞳孔 → 下眼睑 → 双眼皮 → 底色 → 阴影 →
   虹膜明暗（碗状受光）→ 眼白明暗 → 合并 → 收尾 → 高光（闪点）。
   开场动画把这条「描线 → 上色 → 加高光」的流程**加速演了一遍**。
2. **眼型**取上游 Round（圆）眼型，上游正文明确说明自己画的是 Round。
3. **配色**换成落地页的冷灰蓝色系（`landing/index.html` 的 `:root` 令牌），
   上游原色（`rgb(200,209,212)` 灰底 + 棕色文字）不带过来。
4. **高光闪点**对应上游 Step 13「add the highlights … you can add sparkles」。

上游文件本身**没有被改造**，也不参与线上构建；它在这里的作用是留档与对照。
