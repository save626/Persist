# Persist

个人自用、长期记录、本地优先的计划与复盘工具：以「今日」为中心，统一记录健身、饮食饮水与学习，并在之后用跨模块数据生成 AI 分析与建议。

- 产品形态：React + Vite 单页应用（五项固定一级导航）+ Fastify 服务端 AI 代理
- 数据策略：本地优先（浏览器 IndexedDB 是写入权威），服务端只做 AI 代理与可检索的同步副本；服务端综合分析报告只存在服务端归档（365 天），**不回写本机**
- 对外形态：网站设计层（落地页 / 介绍首页 / OG 分享卡）→ `/app/?mode=demo|guest`；完整产品（含真实 AI）只在作者自有移动端

## 当前状态（2026-11-19 实测）

八个页面可完整点击验收，前端视觉范围冻结。服务端 AI 边界已完全闭合：凭据门
（生产 `PERSIST_AI_GATE=enforce`）+ 每日 100 次 / 20 万 token 双配额 + `ai_calls` 审计
（保留 30 天）+ 数据库级 `audit_log`（七类动作留痕）。

**基线**：app 单测 452（35 文件）、server 单测 376（35 文件）、lint 0/0、主包 394 kB
（已分包，无 500 kB 警告）、视觉基线 141 张。

**仍为 IP 直连内部调试**：域名未解析、443 未开、**备案号未下发**、Android 仍是 debug
签名。**不得宣称「已上线」。**

> 当前进度、待办、风险与开工流程以 [`HANDOFF.md`](HANDOFF.md) 为准（每次开工实测刷新）。
> 本 README 只做项目门面，不重复状态数字。

## 文档地图

| 文档                                                                | 作用                                                                             | 什么时候读                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------- |
| [`HANDOFF.md`](HANDOFF.md)                                          | **现状与待办的唯一入口**：实测基线、生产实况、铁律、待办、风险、开工与回滚流程     | **接手第一读物**                 |
| [`docs/网站设计层交接-2026-11-19.md`](docs/网站设计层交接-2026-11-19.md) | 网站设计层（落地页 / 介绍首页 / OG 分享卡）的重新设计交接                         | 做对外入口、分享 pilot 时        |
| [`docs/部署与服务器现状.md`](docs/部署与服务器现状.md)                | 服务器规格、Nginx 规则、部署命令速查、**备案号下发当天的执行顺序**                 | 做部署、申请证书时              |
| [`docs/工程约定.md`](docs/工程约定.md)                                | 技术选型、设计令牌、响应式与可访问性基线、非功能要求、测试门禁、术语               | 改 UI、加测试、定验收口径前      |
| [`docs/Persist-项目开发规划.md`](docs/Persist-项目开发规划.md)        | 项目介绍与长期规划（v2.0）：愿景与边界、八页功能规划、P0–P6 路线、Backlog          | 想弄清「这是什么、要走到哪」时   |
| [`docs/P4-数据层与AI综合分析设计方案.md`](docs/P4-数据层与AI综合分析设计方案.md) | 终态数据模型：SQLite 副本、同步协议、事实包契约、隐私边界、DDL                     | 改数据层或同步协议时            |
| [`docs/P0-AI接口服务端安全门设计方案.md`](docs/P0-AI接口服务端安全门设计方案.md) | AI 安全门设计（凭据、配额、审计、失败语义）                                    | 改 AI 边界时                    |
| [`docs/落地页与入场动画方案.md`](docs/落地页与入场动画方案.md)        | 对外入口为什么这么设计：公开页不做真实 AI、三模式隔离、上线前占位                | 改公开页文案或入口路由时        |
| `server/README.md` / `app/README.md` / `shared/README.md` / `app/android/README.md` | 代码旁的操作手册：API 契约、脚本、工程约定、Android 构建与 USB 安装 | 动对应目录前                    |

## 目录

```text
app/      React + Vite Web 客户端（web 产物 app/dist，生产挂在 /app/；mobile 产物 app/dist-mobile；app/android 为 Capacitor 8.6.0 Android 工程，USB 安装）
landing/  对外落地页、产品介绍首页与 OG 分享卡（/ 与 /home.html）
server/   Fastify 服务端：AI 代理、/api/v1/* 账号与同步、综合分析归档、备份恢复导出删除、每日简报 job
shared/   跨端共享纯 TS 契约（@persist/shared）：同步契约与综合分析契约，前后端同源
design/   视觉基线与截图（141 张，由 visual:check 生成）
docs/     工程约定、部署现状、方案与交接文档
```

## 快速开始

前端：

```powershell
cd D:\Persist\app
npm install
npm run dev:mobile -- --port 4173  # owner 完整模式；/api 代理到 127.0.0.1:3000
npm run dev -- --port 4174         # web 入口；只允许 demo / guest
npm run build                      # web 产物使用 /app/ base；部署到 /var/www/persist/app
npm run preview                    # 本地预览 /app/
npm run build:mobile               # mobile 构建；输出 dist-mobile，默认 owner
npm run android:check              # 检查 API origin、JDK 21+、adb 与单台授权设备
npm run android:sync               # build:mobile + cap sync android
npm run android:usb                # 构建、同步并通过 USB 安装 debug APK
```

常用检查（提交前必跑，门禁见 `docs/工程约定.md` §7）：

```powershell
npm run lint
npm run typecheck
npm test
npx playwright test
npm run build
npm run visual:check   # → design/；需先起无 Key 后端，改布局/弹层时跑
```

> `app/` 与 `server/` 的 `predev` / `prebuild` / `pretypecheck` / `pretest` 等钩子会自动执行
> `npm run shared:build`（编译 `shared/src` → `shared/dist`），一般不需要手动跑。

服务端（详见 [`server/README.md`](server/README.md)；**步骤 12 起要求 Node ≥ 22.5**，
内置 `node:sqlite`，本机数据落 `server/data/persist.sqlite`，可用 `DB_PATH` 覆盖）：

```powershell
cd D:\Persist\server
npm install --no-audit --no-fund --cache "D:\Persist\server\.npm-cache"
npm run typecheck && npm test && npm run build
Copy-Item .env.example .env    # 本机联调才填 DEEPSEEK_API_KEY；.env 不入库、用完即删
node --env-file=.env dist/index.js   # 默认 127.0.0.1:3000；带 Key 必须加 --env-file，否则 /api/chat、/api/report 返回 503
```

> Key 只允许存在于服务端环境变量（生产放 `/etc/persist/server.env`，600）。真实 Key 曾出现在
> 开发对话中，**上线前必须轮换**。
>
> P0 变量：`PERSIST_AI_GATE`（`off`/`warn`/`enforce`，默认 `off`）、`PERSIST_AI_KEYS`
> （`k1:<sha256hex>`，空 = fail-closed）、`PERSIST_AI_DAILY_LIMIT`（默认 100 次/天，
> `0` 关闭）、`PERSIST_AI_DAILY_TOKENS`（默认 200000 token/天，`0` 关闭）、
> `PERSIST_AI_AUDIT_KEEP_DAYS`（默认 30 天，`0` = **不清理**，与配额的 `0` 语义相反）。
> 客户端侧对应 `VITE_PERSIST_AI_KEY`，**只允许写在 `app/.env.mobile.local`**，
> 写进 `.env` / `.env.local` / `.env.production*` 会被 web 构建硬拦截。
>
> 分析与简报变量：`ANALYSIS_RATE_LIMIT_MAX`（默认 6 次/5 分钟，独立于 chat/report 限流器）、
> `ANALYSIS_TIMEOUT_MS`（45000）、`ANALYSIS_MAX_TOKENS`（2600）、`DAILY_BRIEF_ENABLED`（false）、
> `DAILY_BRIEF_AT`（21:00）。默认值与注释见 [`server/.env.example`](server/.env.example)。

## 视觉与交互基线

`design/home-v3-countdown.html`：灰白 + 低饱和浅蓝，一级导航固定五项（今日 / 健身 / 饮食 /
学习 / AI 报告），重要目标倒计时为两个独立目标。长期计划页 `/plans` **不占主导航**，从档案页
「AI 建档」、今日页「长期计划 →」或直链进入。

## 数据保存在哪里

业务数据保存在**当前浏览器**的 IndexedDB（数据库 `persist-app`，单条记录
`persist-mock-state`）：刷新、关标签页、重开浏览器都不丢；清站点数据、换浏览器、换设备、
无痕模式会丢失。设置页导出/导入为 0.3.0 备份格式（兼容旧版），导入会整体替换本机数据且不可撤销。

跨设备同步（服务端 SQLite 副本 + 设备令牌 + 增量同步 + 设置页开关）**默认关闭**，不开开关
服务端不会收到任何业务数据；开启后本机数据副本才会分批上传到自己的服务器，
且**同步副本不是备份**。

服务端综合分析报告同样**只存在服务端归档**（`analysis_reports`，保留 365 天），不进本机
IndexedDB、不进 0.3.0 导出包；归档里只存模型文字与指标快照。墓碑与 `sync_ops`、`ai_calls`、
`audit_log` 均为 30 天保留（每日 04:00 后跑一次清理 job）。`audit_log` 只记写动作，删账号时
该账号的历史行只置空 `user_id` 不删行。
