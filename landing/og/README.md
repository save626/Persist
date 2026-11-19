# landing/og/ — 社交分享卡（1200×630，设计源 + 渲染稿）

用途：生成 `og:image` / `twitter:image` 用的 1200×630 静态图。

**当前状态（2026-11-19）：文案已定稿（变体 A × 浅色），已接入 `landing/index.html` 与
`landing/home.html` 的 `<head>`，已入库。卡面**不含备案号**（尚未下发，绝不编造）。**

## 文件

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `og-card.html` | ~11 KB | 设计源。零外部请求（仅系统字体栈 + 内联 SVG + 内联 style/script） |
| `preview/a-light.png` | 44 KB | 变体 A（左文右线）× 浅色 —— **已选定为线上版** |
| `preview/a-dark.png` | 44 KB | 变体 A × 深色（备用，未启用） |
| `preview/b-light.png` | 42 KB | 变体 B（居中构图）× 浅色（备用，未启用） |
| `preview/b-dark.png` | 42 KB | 变体 B × 深色（备用，未启用） |
| `../assets/og-card.png` | 44 KB | **对外产物**。由 `preview/a-light.png` 复制而来，供 `og:image` 引用 |

线上版选择 **变体 A × 浅色**：A 的左文右线构图比 B 的居中构图更平衡（B 的 h1 字号过大、
副标题在 22ch 宽度内换行难看）；浅色在微信 / Twitter / Facebook 的默认卡片底色上更自然。

## 文案

与 `landing/home.html` 的 hero 同源，避免两处口径不一致：

- eyebrow：`个人记录与 AI 复盘`
- 主标题：`同一天，` / `看清自己。`
- 副标题：`健身、饮食、学习记在一处，晚上让 AI 把数字写成一段人话。`
- 徽标：`本地优先 · 不上传服务器`
- 页脚左：`Persist ・ 记录，同一天`
- 页脚右：`wpersist.top`

## 两个参数

- `?v=a|b`：`a` = 左文右线（左 620px 文本列 + 右侧 430×300「一条线」母题），`b` = 居中构图（760×46 底部一条线）
- `?theme=light|dark`：浅色跟随落地页 `#ffffff`/`#0071e3`，深色 `#000000`/`#2997ff`

## 渲染命令

用仓库内的 Playwright 渲染脚本（**2026-11-19 起**）：

```bash
node scripts/render-og-card.mjs              # 渲染全部 4 个变体到 landing/og/preview/
node scripts/render-og-card.mjs --variant a  # 只渲染变体 A
```

**为什么不再用 Edge headless**（旧命令已废弃）：
Edge 的无头模式是多进程 + 命名管道 IPC，在受沙箱限制的 shell 里会**静默失败** ——
命令返回 0 但截图不落盘，很容易误以为渲染成功。Playwright 是单进程可控的，且脚本会在
渲染后校验产物确实落盘，失败立刻退出码 1。

脚本用 `file://` + query 参数驱动设计源自带的 `location.search` 解析，无需起服务。

## 两条客观校验（不依赖肉眼）

1. **几何自检**：`?selfcheck=1` 会把版式量值写进 DOM，用 `--dump-dom` 读回。
   验收线：舞台 1200×630、`documentElement.scrollWidth/Height` 不超 1200/630、无元素 `overflowX > 0`、母题不压页脚分隔线（页脚顶边 `y=517`）。
2. **像素校验**：量尺寸、底色（浅 `#ffffff` / 深 `#000000`）、强调色像素数、墨迹包围盒。
   验收线：尺寸正好 1200×630；内容距四边 ≥ 60px（实际 80/80/77/64）；强调色像素 ≥ 20（实际 1656–1824）。

2026-11-19 实测：线上版尺寸 1200×630、44 459 B、`Content-Type: image/png`、HTTP 200。

## `<head>` 接入（已完成）

两个页面各接入一组 `og:*` / `twitter:*` / `canonical`，均指向**域名绝对 URL**：

```
<link rel="canonical" href="https://wpersist.top/">
<meta property="og:image" content="https://wpersist.top/assets/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
```

`index.html` 的 `og:url` 是 `https://wpersist.top/`，
`home.html` 的 `og:url` 是 `https://wpersist.top/home.html`。

## 硬约束

- 只用落地页配色（`app/` 的设计令牌不参与）
- 零外部请求：不引 webfont、外链图片、CDN、二维码
- **卡面不放备案号**——尚未下发，绝不编造。备案号只在页面页脚出现
  （由 `deploy/scripts/render-site-info.mjs` 从 `deploy/site-info.json` 注入）
- **卡面放域名是安全的**，2026-11-19 复核确认：`og:image` 的 URL 本身就是
  `https://wpersist.top/assets/og-card.png`，域名未解析前任何爬虫都**物理上抓不到这张卡**。
  卡面内容与域名上线是同一道闸门，不存在提前露出。域名一旦上线，卡面立即正确
- 文案改了就重跑渲染脚本，并把新图复制到 `landing/assets/og-card.png`
