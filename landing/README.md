# landing/ — 对外入口（星空入场页 + 产品介绍首页）

两个**单文件**页面，零外部请求、零第三方库，`file://` 双击也可打开。2026-11-11 已部署到生产 IP：`/` 为星空落地页，`/home.html` 为产品介绍首页，`/app/` 为桌面 demo / guest 产品。仍没有可用域名、备案号和 443，不得写「已上线」。

```
域名 / IP
  └─ /                 index.html   星空落地页（星轨 + 流星雨 + 「Hello world」手写揭示）
       └─ home.html                 产品介绍首页（9 段，浅色低饱和）
            ├─ 查看演示 → /app/?mode=demo   完整预置数据 + 部署前固化 AI 内容
            └─ 自己体验 → /app/?mode=guest  空白数据 + 全部 AI Mock
产品内返回 → /app/ 的“返回首页 / 首页”回到 home.html
完整产品 → 作者自有移动端 App（USB 安装 build:mobile 包，默认 owner）
```

## 1. 文件与体积（2026-11-11 实测）

| 文件                        | 行数  | 原始        | gzip          | 说明                                          |
| --------------------------- | ----- | ----------- | ------------- | --------------------------------------------- |
| `index.html`                | 688   | 27241 B     | **10411 B**   | 入口页，内联 CSS / JS / SVG，LF 换行、无 BOM  |
| `home.html`                 | 1027  | 43003 B     | **12097 B**   | 介绍首页，纯 CSS/SVG，**零 `<img>`**          |
| `assets/`                   | —     | 5565293 B   | —             | 星空底图 7 档 + LQIP 2 个，共 9 个文件        |
| `preview/05`–`preview/11`   | —     | 6594954 B   | —             | 自测渲染截图，**证据不是营销素材**            |

两页合计 gzip **22.5 KB**，仍远低于「HTML+CSS+JS ≤ 60 KB」的预算线。`preview/01`–`04` 属 2026-11-09 旧原型，已删除；`og/` 卡片实验未被任何页面引用，也未入库。

## 2. `index.html`：入口页实现要点

**画面**：`canvas#sky` 固定满屏，每帧先整体 `clearRect`，再重画背景、星轨、流星。

- **星轨**：不是累积拖影，而是每帧按当前角位置现算一段圆弧 `arc(cx, cy, r, a - len, a)`。每段 `arc` 前必须先 `moveTo` 到弧起点，否则会连出杂乱的直线段。按亮度分 9 档批量 `stroke()`，避免 200 多次单独描边。近极点区按半径收敛，速度分布用 `growT` 平滑，避免「一格一格跳」。参数随视口自适应（星数 90–250、弧长 0.030–0.150 rad、角速度 0.0035–0.0140 rad/s）。
- **流星**：直接移植 `产品/流星雨效果.html` 的引擎——20 条、4 段 `hsla` 渐变、`width*7` 径向辉光、`globalCompositeOperation='lighter'`、`lineCap='round'`；`spawnInterval 0.13 s`，命中数量上限即停。指针按下时朝点击方向补一颗。
- **文案揭示**：移植 `产品/Hello world Sacramento 水平路径.html` 的做法——`#textLine` 路径上跑 `textPath`，`<mask>` 里一条粗描边路径的 `stroke-dashoffset` 沿路径推进，笔尖用 `getPointAtLength` 跟随，4400 ms、`easeInOutCubic`。进度是线性的：`p=0.10 → 10%`、`p=0.30 → 35%`（20 分箱直方图实测）。
- **两个移植时必须改的坑**：
  1. `stroke-dasharray` / `dashoffset` 写在 `<use>` 上**不会可靠传给它的影子副本**，导致遮罩永远整条实心、文字第一帧就全露。遮罩里必须是**真 `<path>`**。
  2. 遮罩描边在这版被放大约 2.8 倍字高（`stroke-width` 525.778 px），若沿用参考文件的 `stroke-linecap:round`，圆头半径 ≈ 262.9 单位、占 `MASK_LEN 1038.8` 的 **25.3%**，等于整段揭示恒定提前四分之一。必须改 `butt`。
- **底图保真**：源图 3000×2788 / 2.1 MB。输出 WebP `quality=84, method=6, Image.LANCZOS`，宽版 1280/1920/2560/3000、竖版 720/1080/1440，按视口宽与宽高比选档，**断言 `w <= 源宽`，永不上采样**。LQIP 86 B 内联 + 纯色兜底，`.scrim` 只叠一层径向 + 一层线性（早期版本叠了两层导致双重压暗）。放弃 AVIF：同码率下细节保留只有 60.9%。
- **降级**：`prefers-reduced-motion` → 直接出静态终帧、文案立刻可见；`document.hidden` 停 rAF；`resize` 180 ms 节流；`<noscript>` 纯文本兜底；DPR 上限 2。

## 3. `home.html`：介绍首页实现要点

9 个段落（顺序即源码顺序）：首屏 `#top` → 问题 `#problem` → 怎么工作 `#how`（5 步）→ 三个模块 `#product` → AI 报告 `#report` → 长期视角 `#long`（7/30/90 天）→ 隐私 `#privacy` → 适合谁 `#who` → 内测 `#beta` → 页脚。锚点与导航一一对应，无失效锚点。

- **零图片**：所有图形都是 CSS 渐变、`box-shadow`、内联描边 SVG（`stroke` 系图标）。首屏「今日卡片」是纯 CSS 摆出来的示意，不是截图。
- **动效只用 `opacity` / `transform`**：导航 `is-stuck` 在 `scrollY > 12` 切换（rAF 节流）；`.reveal → .in` 由 `IntersectionObserver` 驱动，并有 `delivered` 兜底与首帧强制放行；`prefers-reduced-motion` 下全部直出。
- **仅两个产品入口**：`data-enter="demo"` 与 `data-enter="guest"` 交给同一个事件委托，分别进入 `/app/?mode=demo` 与 `/app/?mode=guest`。页面不存在 `product` / `beta` / `blank` / `owner` 入口；桌面构建不提供真实 AI 入口，完整产品只在作者自有移动端 App。

## 4. 配色与对比度（含对 `docs/工程约定.md` §3 的偏离）

首页走「浅色低饱和、沿用产品整体色调」：页底 `#F4F7F9`、卡片 `#FBFCFD`/`#FFFFFF`、条纹带 `#EDF2F6`、页脚 `#EAEFF3`，强调色仍是 `#6D9FBD` 一脉（与星空页同一蓝）。

| 令牌        | 值        | 用途                 |
| ----------- | --------- | -------------------- |
| `--ink`     | `#202830` | 标题                 |
| `--soft`    | `#4D5965` | 正文                 |
| `--muted`   | `#55616D` | 次要正文             |
| `--faint`   | `#616D79` | 注脚 / 说明          |
| `--accent`  | `#6D9FBD` | 仅非文字装饰         |
| `--accent-ink` | `#3C6883` | 强调色系上的文字     |

**与 §3 的三处有意偏离**（为达标，不是随手改）：

1. `--muted` `#74808C` → `#55616D`、`--faint` `#9AA5AF` → `#616D79`：原值对 `#F4F7F9` 只有 3.75 / ≈2.6，正文读不清。
2. 主按钮由浅蓝改中深蓝 `linear-gradient(180deg,#4A7A96,#44738F 58%,#406E89)`：白字对三档分别为 **4.65 / 5.13 / 5.51**（原 `#6D9FBD` 上仅 2.86）。
3. 新增 `--accent-ink:#3C6883` 专供「浅蓝底上的文字/图标」：5.29（对 `--accent-soft`）、6.00（对白）、5.18（对页脚）。

22 组色对实测全部达标（正文门槛 4.5、图形 3.0），层次单调：ink 13.87 > soft 6.66 > muted 5.88 > faint 4.91。`#6D9FBD` 只留在圆点、细线、光晕、进度条渐变等非文字处，是入口页到首页的视觉桥梁。

## 5. 验证方法（可复现）

无头浏览器容易骗人，判据必须来自**真实渲染后的测量**，不是「看起来对」：

- 工具：`app/node_modules` 里的 Playwright（`chromium.launch({ channel: 'chrome' })`），直接开 `file://`，可 `evaluate`、`fullPage` 截图、`emulateMedia`、`javaScriptEnabled:false`。
- 入口页判据：6–8 个视口下文案居中（`offX/offY = 0`）、`fontSize` 145.7–146.4 px 稳定、流星数达上限、星轨段数在区间内、提示语出现；`prefers-reduced-motion` 下出终帧；视口宽高比正确选到宽版/竖版底图且无上采样。
- 首页判据：6 视口（1920/1440/1280/768/390/844 横）无横向滚动、恰好 9 个 section、58 个 `.reveal` 全部进入且不透明、4 个 toast 都真的出现、降级路径（减动效 / 关 JS）内容完整、无控制台报错。
- 三处已知坑：① `--dump-dom` + `--virtual-time-budget` **不会**冲刷异步回调，`setTimeout` / rAF 里写的 DOM 永远看不到，只有加载期同步写入才算数；② `--screenshot` 在超高窗口（如 1920×8000）会挂死；③ 探针 HTML 页面里用字符串拼接构造结果文本（如 `'SYN-'+'OK'`），否则正则可能匹配到 `<script>` 源码里的字面量而误判。

## 6. 验收状态

- 入口页：用户已确认两轮缺陷（流星偏少、文案不是从 `H` 开始）修复后**「满意，可以进入产品介绍首页了」**。
- 首页：文案按「可参考、不必照抄」授权自行设计；结构与对比度为自测结论。
- **本 Agent 无图像输入能力**：以上全部是基于渲染的测量结论，观感必须由人眼最终确认（截图见 `preview/`）。
- 2026-11-11 生产功能验收：真实 Chrome 经 SSH 隧道打开 `/` → `/home.html` → `/app/?mode=demo` / `/app/?mode=guest` 全链路通过；demo 计划徽标 `3 / 7`、guest `0 / 0`，两种模式捕获到的 `/api/*` 请求均为 `[]`；390 px 视口首页 `scrollWidth = 390`，无横向溢出。新增入口文案后的最终双端人工观感验收仍待用户确认。

## 7. 部署结果与上线前边界

2026-11-11 已按以下结构部署到生产 IP：

```text
/var/www/persist/
├─ index.html                落地页（27241 B）
├─ home.html                 产品介绍首页（43003 B）
├─ assets/starfield-*        星空底图
└─ app/
   ├─ index.html             React web 入口（623 B）
   └─ assets/index-CFCYNhZY.js 663401 B + index-J1EyySLN.css 153579 B
```

生产核验：`/`、`/home.html`、`/app/?mode=demo`、`/app/?mode=guest`、`/app/fitness`、`/app/reports` 均 `200`；JS / CSS / 星空图分别以正确 MIME 返回。入口路由切换时 Nginx 已 reload；2026-11-11 返回首页静态包替换未重启后端、未 reload Nginx。web demo / guest 的“返回首页 / 首页”均回到 `/home.html`，用户已完成双端验收。

仍未完成：

1. 备案号下发后替换页脚占位，并接域名、443、证书与 HTTPS 跳转。备案号下发前不得写「已上线」或「域名可用」。
2. 首页仍是 CSS/SVG 示意，真实截图与 OG 分享图由落地页负责方决定是否补。
3. 服务端 `/api/chat`、`/api/report` 仍需 token 门、来源限制、配额与审计；网页页面没有真实 AI 入口不等于服务端接口已经安全。
4. 桌面第一期只提供 demo / guest。不得新增 owner 入口；完整产品只通过作者自有移动端 USB 包使用。

## 8. 维护约定

- 不得引入外链资源：无 CDN、无第三方字体、无图标包、无统计脚本、无第三方动效库。
- **公开页不得触发真实模型调用**：`/api/chat`、`/api/report` 目前只有 IP 限流，页面必须是纯静态，示例 AI 内容只能是写死的文本并标明「依据当时的记录」。
- 改完必须重跑四项：22 组对比度、6 视口布局与滚动、`prefers-reduced-motion`、关闭 JS。
- 图片来源 `picture/` 不入库；`assets/` 里的派生 WebP 与 LQIP 入库。
- 本文与 `docs/落地页与入场动画方案.md` 的分工：那份文档管「跳转参数 + 跳过去之后的运行模式」，视觉与实现以本文为准。该文档 §3/§6 中「记录，同一天」闸门、995 行原型、5 屏结构等描述对应 2026-11-09 旧原型，已被本文的星空入口页取代。
