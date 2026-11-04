# Persist

个人自用、长期记录、本地优先的计划与复盘工具：以「今日」为中心，统一记录健身、饮食饮水与学习，并在之后用跨模块数据生成 AI 分析与建议。

- 产品形态：React + Vite 单页应用（五项固定一级导航）+ Fastify 服务端 AI 代理
- 数据策略：本地优先（浏览器 IndexedDB 是写入权威），服务端只做 AI 代理与未来的可检索副本
- 规模：八页面可完整点击验收，app 单测 172、server 单测 58、E2E 102 次执行、视觉基线 91 张全绿、oxlint 0 错 0 警告

## 当前阶段（2026-11-04，步骤 9 IP 直连部署 + 晨间简报接入真实 AI + lint 清零后）

前端产品原型**已完成并通过双端视觉验收，视觉范围冻结**（唯一例外：经用户批准的今日页晨间简报接入真实 AI，`9f9cc71`）：AI 引导建档 → 长期计划草案确认 → 启用/归档闭环已通；AI 建档对话（`POST /api/chat`）、AI 报告文字与今日页晨间简报文字（`POST /api/report`）在「档案页开启 AI 数据授权 + 服务端健康」时走真实 DeepSeek，失败或未授权时回退本地规则/Mock 并如实标注；**报告的指标数字、依据条目与简报 KPI 始终由前端按本地记录确定性生成，模型只写文字**。业务数据全部写入本机 IndexedDB（刷新/重开不丢，有「清空本机数据」入口，导出导入为 0.2.0 备份格式）。

服务端 P3 已完成（8a `9138175` + 8b `b99d3ad` + 8c `bdd4265`），并**于 2026-11-04 以 IP 直连方式部署到阿里云 ECS（Nginx + systemd + 真实 DeepSeek Key）并通过联调验收——仅内部调试，不得对外宣称「已上线」**；P4 终态架构已定稿、未实施；域名已购、阿里云备案初审已通过、**备案号未下发**（因此不得宣称已上线，也不能用域名对外提供服务）。

下一步：**拿到备案号后的步骤 10（域名 + HTTPS）**；等待期默认推进**步骤 11（8d 数据历史化）**。详细计划见 [`HANDOFF.md`](HANDOFF.md) §0.4 与 §13。

## 文档地图

| 文档 | 作用 | 什么时候读 |
|---|---|---|
| [`HANDOFF.md`](HANDOFF.md) | **唯一现状与计划来源**：一页摘要、产品与功能清单、技术架构、契约、验证数字、路线、风险、变更史、接手顺序 | 接手第一读物；任何冲突以它和代码为准 |
| [`docs/Persist-项目开发规划.md`](docs/Persist-项目开发规划.md) | **项目介绍与长期规划（v2.0）**：愿景与边界、八页功能规划、数据与技术架构、P0–P6 / 步骤 9–15、风险、Backlog、发布验收清单 | 想先弄清「这个项目是什么、要走到哪」时 |
| [`docs/工程约定.md`](docs/工程约定.md) | 技术选型、设计令牌、响应式与可访问性基线、非功能要求、测试门禁、术语 | 改 UI、加测试、定验收口径前 |
| [`docs/部署与服务器现状.md`](docs/部署与服务器现状.md) | 服务器规格、Nginx/防火墙硬规则、部署命令速查、备案进度与合规口径 | 做步骤 9 / 10 前 |
| [`docs/P4-数据层与AI综合分析设计方案.md`](docs/P4-数据层与AI综合分析设计方案.md) | P4 终态设计：SQLite 副本、同步协议、事实包契约、隐私边界、步骤 11–14 拆分 | 做 P4 前；含 7 个待确认项 |
| [`server/README.md`](server/README.md) | API 契约、环境变量、真实 Key 联调注意事项 | 改服务端或联调前 |
| [`app/README.md`](app/README.md) | 前端脚手架说明、脚本与目录 | 改前端前 |

> 历史文档：`docs/项目现状总览.md`、`HANDOFF-新会话指令.md`、`docs/工程初始化与前端约定.md` 已于 2026-11-04 合并删除；`docs/Persist-项目开发规划.md` 保留并重写为 v2.0（同上表）。需要旧文用 `git show fccce42:<path>` 取回。

## 目录

```text
app/      React + Vite Web 客户端（主产物 app/dist）
server/   Fastify + DeepSeek 代理：/api/health、SSE /api/chat、POST /api/report
shared/   跨端共享类型与纯函数（仍为占位；契约类型暂在 server/src/contract.ts）
design/   视觉基线与截图（15 状态 × 6 视口 = 91 张，由 visual:check 生成）
docs/     工程约定、部署现状、P4 设计方案
```

## 快速开始

前端：

```powershell
cd D:\Persist\app
npm install
npm run dev -- --port 4173      # http://127.0.0.1:4173/ ，/api 代理到 127.0.0.1:3000
```

常用检查（提交前必跑，门禁见 `docs/工程约定.md` §7）：

```powershell
npm run lint
npm run typecheck
npm test               # 172 条 / 13 个文件
npx playwright test    # 51 用例 × 2 项目 = 102 次执行，0 跳过
npm run build
npm run visual:check   # 91 张截图 → design/；需先起无 Key 后端，改布局/弹层时跑
```

服务端（详见 [`server/README.md`](server/README.md)）：

```powershell
cd D:\Persist\server
npm install --no-audit --no-fund --cache "D:\Persist\server\.npm-cache"
npm run typecheck && npm test && npm run build
Copy-Item .env.example .env    # 本机联调才填 DEEPSEEK_API_KEY；.env 不入库、用完即删
node dist/index.js             # 默认 127.0.0.1:3000；无 Key 时 /api/chat、/api/report 返回 503
```

> Key 只允许存在于服务端环境变量（生产放 `/etc/persist/server.env`，600）。真实 Key 曾出现在开发对话中，**上线前必须轮换**。

## 视觉与交互基线

`design/home-v3-countdown.html`：灰白 + 低饱和浅蓝，一级导航固定五项（今日 / 健身 / 饮食 / 学习 / AI 报告），重要目标倒计时为两个独立目标。长期计划页 `/plans` **不占主导航**，从档案页「AI 建档」、今日页「长期计划 →」或直链进入。

## 数据保存在哪里

业务数据只保存在**当前浏览器**的 IndexedDB（数据库 `persist-app`，单条记录 `persist-mock-state`）：刷新、关标签页、重开浏览器都不丢；清站点数据、换浏览器、换设备、无痕模式会丢失，且暂无跨设备同步。设置页导出/导入为 0.2.0 备份格式，导入会整体替换本机数据且不可撤销。服务端目前不存储任何用户数据。
