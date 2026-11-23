# landing/og/ — 社交分享卡（1200×630，设计源 + 渲染稿 + 本地预览）

> **2026-11-23 按「解法 1」重做。** 上一版（2026-11-19）是「左文右线」，
> 被微信的 1:1 中心裁切切掉大半个标题，且徽标 `本地优先 · 不上传服务器` 对开启同步的用户是假话。
> 现在：品牌 / 徽标 / 眉标 / 标题 / 副标题 / 页脚**全部收进中心 630×630**，
> 徽标改为 `记录先存在你的设备上`，配色换成落地页的产品令牌（`#f4f7f9` / `#467692` / `#6d9fbd`）。
>
> 唯一对外的产物仍是 `landing/assets/og-card.png`（1200×630 / 129 519 B / PNG）。

## 一句话：这张卡是什么

分享卡**不是**要被发出去的图片，也不是一个页面——它是**链接的封面**。
别人分享 `https://wpersist.top/` 时，平台爬虫抓 `<head>` 里的 `og:*` / `twitter:*`，
把「图 + 标题 + 描述 + 域名」拼成一条卡片。**你发的永远是链接，卡片是对方那边生成的。**

## 怎么看（不用等备案）

| 想看什么         | 打开                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| 分享卡长什么样   | 双击 `landing/og/preview.html`（零外部请求，离线可看；含 1:1 取景框演示）                 |
| 卡面原图         | `landing/assets/og-card.png`（1200×630，就是将来对外那一张，非示意图）                     |
| 四个变体         | `landing/og/preview/{a,b}-{light,dark}.png`                                               |
| 四张 1:1 取景稿  | `landing/og/preview/{a,b}-{light,dark}-crop.png`（630×630，微信实际取景）                 |
| 设计源（可交互） | `landing/og/og-card.html?v=a&theme=light`（改文案改这里）                                 |

`landing/og/` 是**设计源目录**，只在本机使用，不随部署上线（部署只取
`index.html` / `home.html` / `assets/` / `app/` 与 `fusion/`）。

## 微信 1:1 裁切（2026-11-23 已按解法 1 解决）

微信把 `og:image` 裁成 **1:1 且取中心区域**，取景框 = 1200×630 图的中间 **630×630**
（x ∈ [285, 915]，纵向整高）。X / Facebook / LinkedIn 全宽显示，不受影响。

当时列过三个解法，**选定解法 1**：把信息全部收进中心 630×630，一张图通吃所有平台。

- 没选「另出一张 1:1 方图」：微信只取 `og:image` 的**第一张**，多图混排时各平台排序规则不一致，等于赌；
- 没选「维持现状」：方图里只剩留白、读不到任何信息。

落地时的一个副作用要接受：整卡左右各 285px 只剩装饰（地平线 / 光晕），
读起来像「一张安静的纸」，这与落地页的基调一致，不是漏排。

**这条约束现在是断言，不是约定**：`scripts/check-og-card.mjs` 量每个信息节点的
`x ≥ 285 && right ≤ 915`（取景稿下量 `0..630`），越界即退出码 1。改版式前先跑它。

## 文件

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `og-card.html` | ~13 KB | 设计源。零外部请求（仅系统字体栈 + 内联 SVG + 内联 style/script） |
| `preview.html` | ~19 KB | **本地预览页**。零外部请求，双击即看 |
| `preview/a-light.png` | 129 519 B | 变体 A（左对齐）× 浅色 —— **已选定为线上版** |
| `preview/a-dark.png` | 141 699 B | 变体 A × 深色（备用） |
| `preview/b-light.png` | 127 018 B | 变体 B（居中）× 浅色（备用） |
| `preview/b-dark.png` | 139 685 B | 变体 B × 深色（备用） |
| `preview/*-crop.png` | 66–76 KB | 四张 630×630 取景稿（`?crop=1` 直接渲染，不是事后裁图） |
| `../assets/og-card.png` | 129 519 B | **对外产物**。由 `preview/a-light.png` 复制而来，供 `og:image` 引用 |

选用 **A × 浅色**：左对齐的阅读节奏比居中更稳，与落地页 hero 的左起一致；
浅色就是产品纸底 `#f4f7f9`，与落地页同色，在白色卡片底上也不脏。

## 文案（与 `landing/home.html` 的 hero 同源）

- 眉标：`个人记录与 AI 复盘`
- 主标题：`把每天的碎片写下来，` / `晚上看懂自己`（后半句 `em`，用 `--deep` 上色）`。`
- 副标题：`健身、饮食、学习记在一处，晚上让 AI 把数字写成一段人话。`
- 徽标：`记录先存在你的设备上`（替换旧版 `本地优先 · 不上传服务器`）
  —— 写入先落本机 IndexedDB，服务端只是可检索副本；旧说法对开启同步的用户是假话。
- 页脚左：`Persist · 计划 · 记录 · 复盘`
- 页脚右：`wpersist.top`

**口径**：卡面 slogan 与落地页定稿一致；落地页 `<head>` 的 `og:title` 目前是
`Persist · 记录 · 复盘 · 变化`（关键词式，不重复 slogan），这是有意的分工，不是漏改。

## 参数

- `?v=a|b`：`a` = 左对齐（默认，线上版）；`b` = 居中构图
- `?theme=light|dark`：浅色取落地页纸底 `#f4f7f9`，深色 `#0b1419`
- `?crop=1`：只渲染中心 630×630（微信取景），用于出取景稿
- `?selfcheck=1`：把几何量值写进 DOM 的 `#selfcheck`，供校验脚本读回

## 渲染

```bash
node scripts/render-og-card.mjs              # 四个变体 → landing/og/preview/
node scripts/render-og-card.mjs --crop       # 追加四张 630×630 取景稿
node scripts/render-og-card.mjs --variant a  # 只渲染变体 A
```

**为什么不用 Edge headless**（2026-11-19 的旧命令已废弃）：Edge 无头模式是多进程 +
命名管道 IPC，在受沙箱限制的 shell 里会**静默失败**——命令返回 0 但截图不落盘。
Playwright 是单进程可控的，且脚本渲染完会校验产物确实落盘，失败立刻退出码 1。

> 沙箱里跑会报 `spawn EPERM`（Chromium 子进程被拦），一次性放宽权限即可，不是脚本问题。

## 校验（改版式后必跑）

```bash
node scripts/check-og-card.mjs    # 版式 + 微信 1:1 安全区（几何断言，不靠肉眼）
node scripts/check-og-meta.mjs    # 两页 head 的 og/twitter 标签 + 卡面尺寸
```

`check-og-card.mjs` 断言：舞台 1200×630、零滚动、字体已加载、标题不横向溢出、
所有信息节点落在安全区（整卡 285..915 / 取景稿 0..630）、八张渲染稿都已落盘且不是空图。

`check-og-meta.mjs` 断言：`og:*` / `twitter:*` / `canonical` 全存在、`og:image` 与
`twitter:image` 同图、绝对 URL、`1200×630` 且与实际 PNG 一致、`twitter:card=summary_large_image`、
`<head>` 内不得出现任何备案编号。线上核对：

```bash
node scripts/check-og-meta.mjs --url https://wpersist.top/
node scripts/check-og-meta.mjs --url http://<IP>/ --image-url http://<IP>/assets/og-card.png
```

## 硬约束

- 只用落地页配色（`app/` 的设计令牌不参与）；小字用 `--accent-ink #3c6a86`
  （`#467692` 在 `#f4f7f9` 上只有 4.46:1，正文要 4.5 才达标——与 landing.css 的
  `--muted/--faint` 加深同一做法）
- 零外部请求：不引 webfont、外链图片、CDN、二维码
- **所有信息落在中心 630×630**，装饰才允许伸出（由 `check-og-card.mjs` 断言）
- **卡面不放备案号**——尚未下发，绝不编造。备案号只在页面页脚出现
  （由 `deploy/scripts/render-site-info.mjs` 从 `deploy/site-info.json` 注入）
- **卡面放域名是安全的**：`og:image` 的 URL 本身就是 `https://wpersist.top/assets/og-card.png`，
  域名未解析前任何爬虫都**物理上抓不到这张卡**。卡面内容与域名上线是同一道闸门
- 微信会缓存抓取结果，改图后验证要换 URL 参数（如 `?v=2`），否则看到的还是旧卡

## 改文案 / 改版式的工作流

```bash
node scripts/render-og-card.mjs --crop                         # ① 渲染
node scripts/check-og-card.mjs                                 # ② 安全区与几何
copy landing/og/preview/a-light.png landing/assets/og-card.png # ③ 同步对外产物
node scripts/check-og-meta.mjs                                 # ④ head 与尺寸
```

少任何一步都可能「静默变成白卡」：图没落盘、尺寸不对、`og:image` 指向 404，
页面上都看不出来，只会在真正分享时才发现。
