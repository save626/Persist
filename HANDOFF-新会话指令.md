# Persist 新会话交接指令（完整版）

> 生成：2026-11-04（步骤 8b 完成后更新；上一版为步骤 8a 完成版，以本版为准）
> 用法：**把本文件全部内容作为新一轮会话的启动指令整份粘贴**。
> 权威现状：同目录 `HANDOFF.md`（本文件只讲"怎么接手 + 下一步做什么"，不替代它的结论）。
> 一页速览：`docs\项目现状总览.md`；服务器与部署：`docs\部署与服务器现状.md`（公网 IP 已脱敏）。
> 公开仓库，**任何情况下不要把真实公网 IP、root 密码、API Key 写进仓库文件**。

---

## 0. 一句话背景

Persist 是个人自用、本地优先的「计划 → 记录 → 复盘 → AI 分析」工具。当前是一个**可完整点击验收、已通过桌面端 + 移动端视觉验收的前端产品原型 + 已接通的 AI 服务端**：8 个页面、5 项主导航、业务数据全部写入本机浏览器 IndexedDB（刷新 / 关闭标签页 / 重开浏览器不丢，含长期计划）、AI 报告仍是本地 Mock、AI 引导建档在授权 + 服务端可用时经本站代理调用真实 DeepSeek（失败自动回退 Mock 并标注）、JSON 导出导入已是备份 0.2.0（含长期计划）。

**服务端 P3 已完成 8a + 8b**：`server/` 是 Fastify 5 + DeepSeek 代理（`GET /api/health`、SSE `POST /api/chat`、白名单净化、按 IP 限流、超时/取消/有限重试、日志脱敏），单测 41/41 通过；前端 `PlanChatSheet` 已接入 `/api/chat`（`app/src/lib/ai-chat-client.ts`），**已用真实 DeepSeek Key 完成端到端联调**（真实调用暴露模型给过去日期的问题，已通过提示词注入北京日期 + 前端日期兜底修复并复验）。**8c（AI 报告接服务端）未做**，代码**尚未部署**到服务器。没有服务端数据库、没有备份恢复、没有 Android 包。Git 提交链（起于 `bd779eb`，含清理、格式化、步骤 7、8a、8b 提交）**已全部推送**，工作区干净。服务器环境已就绪：阿里云 ECS 2C2G + Node 20.20.2 + Nginx 1.24.0，80 可达默认页；域名 `wpersist.top` 已购买、实名认证已通过、ICP 备案已提交（阿里云初审中），443 未开。

## 1. 开工前必读（按顺序，不要跳）

1. `D:\Persist\docs\项目现状总览.md` —— 一页速览：阶段完成度、验证数字、服务器现状、Top 10 限制、下一步。
2. `D:\Persist\HANDOFF.md` —— **唯一现状权威**。重点读 §0.1–0.4（含步骤 7–10 执行计划）、§2（进度与完成度矩阵）、§3.1（路由）、§4.9（计划闭环）、§5.1–5.4（契约）、§6.6（持久化）、§8.5（导出导入）、§9.1、§10（构建与视觉资产）、§13（路线与完成标准，含 P3-0/P3）、§14（已知问题与债务）、§15、§16（文件索引）、§19/§20。
3. `D:\Persist\docs\部署与服务器现状.md` —— 服务器规格、七条部署硬规则、Nginx 站点草案（含 SPA 深链、gzip、`/api` 反代、SSE `proxy_buffering off`）、命令速查、待执行清单。
4. `D:\Persist\README.md`、`D:\Persist\app\README.md` —— 阶段、命令、页面清单、条件类名约定。
5. `D:\Persist\docs\工程初始化与前端约定.md` —— 技术选型与前端阶段顺序。
6. `D:\Persist\docs\Persist-项目开发规划.md` —— **目标态规划，不是现状**（§4.2 的 16 条路由、§4.3 的分模块页面大多未实现）；与 HANDOFF / 源码冲突时以后者为准。
7. 源码按序：`app\src\App.tsx` → `context\MockDataProvider.tsx` → `lib\persist-state.ts` → `lib\persist-storage.ts` → `types.ts` → `lib\chat-types.ts` → `lib\long-term-plan.ts` → `lib\plan-draft.ts` → `lib\profile-rules.ts` → `lib\mock-data-transfer.ts` → `pages\SettingsPage.tsx` → `pages\PlansPage.tsx`。
8. 视觉对照：`design\home-v3-countdown.html` 与 `design\*.png`。

**跳过**：`node_modules`、`dist`、`test-results`、`playwright-report`、`.chrome-headless-*`、`design\.edge-profile*`、`Water intake record\`（368 MB 旧 Electron 工具，仅作饮水行为参照，已在 `.gitignore`）。

## 2. 技术栈与工程结构

- React 19.3.1 + TypeScript ~6.0.3 + Vite ^8.3.4（rolldown 内核）+ React Router ^7.18.4。
- Tailwind CSS ^4.3.3 在依赖里，但**已验收样式是手写 CSS**：`app\src\styles\home-v3.css` 为主，新增放 `persist.css` / 模块 css（如 `plans.css`）。不要用 Tailwind 类名改既有视觉。
- 测试：Vitest ^5.0.5（单元）、Playwright ^1.64.1（`desktop-chrome` + `mobile-chrome` 两个 project，`channel: 'chrome'`，baseURL 4173）。
- 质量：Oxlint ^1.88.0、Prettier ^3.9.10（`prettier-plugin-tailwindcss` 已于 2026-11-03 移除，`npx prettier --check .` 在 `app` 内全绿）。
- 本机 Node v22.19.0 / npm 10.9.3。**服务器是 Node v20.20.2**，写 `server/` 代码时按 20 兼容（`engines >=20.19`，别用 `node:sqlite`）。
- Provider 树：`main.tsx` → `App.tsx`（`BrowserRouter` > `UIProvider` > `MockDataProvider` > `AppShell`）。单棵 Provider，业务状态全在 `MockDataProvider`，13 个状态切片，状态变化后 200 ms 防抖写 IndexedDB 一条记录。

路由（只有这 8 个，未知路径回 `/`）：

```text
/ 今日   /fitness 健身   /diet 饮食   /study 学习
/reports AI 报告   /profile 档案   /plans 长期计划   /settings 设置
```

主导航固定 **5 项**：今日 / 健身 / 饮食 / 学习 / AI 报告（`components\AppShell.tsx` 的 `NAV_ITEMS`；移动端列数在 `home-v3.css` 硬编码）。

## 3. 现状快照

**已完成（2026-11-04）**

- 8 页面可访问 + 跨模块联动；AI 报告 4 个入口（桌面侧栏、移动底栏、今日页头部、学习页"查看分析依据"）；健身支持自由动作 / 自由运动输入；完整演示数据。
- AI 引导建档 → 草案 → 确认启用 → 归档/重启闭环（`/plans`，含手工新建计划）。
- 设置页 JSON 导出导入：备份 `0.2.0`（含 `longTermPlans`，兼容 `0.1.0`），文件名带日期，导入 toast 报记录数 + 计划数。
- 本机 IndexedDB 持久化：13 个切片 + 快照写单条记录，记录带 `schemaVersion: 1`，未来版本只读不覆盖，`MockDataProvider` Context 契约不变。
- 「清空本机数据」（步骤 7，`a544a38`）：设置页第二张危险区卡片 + 中文二次确认 + toast，删除本机记录并恢复首次启动基线（含清空快照与长期计划），刷新不复现旧数据；原有「清空设置」只重置设置项，两张卡片文案已区分。
- 全站弹窗统一垂直居中；窄屏保留档案页「AI 建档」入口；视觉基线 15 状态 × 6 视口（1440 / 500 / 430 / 421×926 / 390 / 360）经用户桌面端与移动端验收通过。
- 收尾：`d4c9696` 清理死代码与历史制品（含删除 `PreviewPages.tsx` 与 173 行 `.preview-*` CSS），`style:` 提交移除 Tailwind Prettier 插件并格式化 19 个文件；构建产物哈希与格式化前逐字节一致。
- 服务端 8a（`9138175`）：`server/` Fastify + DeepSeek 代理骨架，SSE `/api/chat`（严格契约顺序）+ `/api/health` + 白名单净化 + 按 IP 限流 + 25 s 超时/abort/有限重试 + 日志脱敏；无 Key 时 `/api/chat` 503。
- 前端 8b（`b99d3ad`）：`app/src/lib/ai-chat-client.ts` 用 `fetch` 增量解析 SSE，`probeAiChat()` 探 `/api/health`，`createAppChatClient({ consent })` 决定走真实还是 Mock；`PlanChatSheet` 按 `profile.aiConsent` 切换并在标题/副标题/回退提示里如实标注来源；Vite 开发代理 `/api` → `127.0.0.1:3000`，Playwright 用不可达端口隔离真实后端。**真实 DeepSeek Key 端到端联调通过**（发现模型给过去日期 → 提示词注入 Asia/Shanghai 今天 + 前端日期兜底 → 复验为未来日期）。**AI 报告仍为 Mock（8c 未做），代码未部署。**
- 服务器：环境就绪（见 §6），代码未部署；域名已购买、实名已通过、ICP 备案初审中。

**验证数字（最近一次全绿）**

| 检查 | 命令 | 结果 |
|---|---|---|
| 格式 | `npx prettier --check .` | All matched（`app/` 作用域；根目录 `HANDOFF*.md`、`docs/*.md` 不在 Prettier 范围） |
| 类型 | `npm run typecheck`（`tsc -b`） | 0 错误 |
| Lint | `npm run lint`（oxlint） | 0 错误 / 3 条既有 `react(set-state-in-effect)` 警告（`StudyPage.tsx`、`DietPage.tsx`、`FitnessPage.tsx`，行号会漂，按规则名找） |
| 单测 | `npm test` | **139 / 139**（9 文件：`complete-mock-data` 5、`chat-extract` 24、`countdown` 4、`long-term-plan` 23、`mock-data-transfer` 26、`plan-draft` 22、`profile-rules` 11、`persist-state` 11、`ai-chat-client` 13） |
| E2E | `npx playwright test` | **102 次执行**（51 用例 × 2 项目），0 跳过 0 失败（52.8 s） |
| 构建 | `npm run build` | `dist/index.html` 611 B、`assets/index-C9ZcsQCi.css` 137,643 B（gzip 23.81 kB）、`assets/index-CsKy1ArK.js` 560,361 B（gzip 166.13 kB） |
| 视觉 | `npm run visual:check` | 15 状态 × 6 视口 = 90 张 + 快速记录 1 张，`overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`（步骤 7 新增设置页卡片后**待重新验收**；该脚本会覆盖 `design/` 基线，需用户确认后再跑） |
| 服务端类型 | `npm run typecheck`（`server/`） | 0 错误 |
| 服务端单测 | `npm test`（`server/`） | **41 / 41**（7 文件：config 4 / contract 9 / rate-limit 3 / extract 8 / deepseek 7 / chat 7 / prompts 3） |
| 服务端冒烟 | `PORT=3101 node dist/index.js` | `GET /api/health` 200（无 Key 时 `ai: "disabled"`）；非法 `/api/chat` 400；无 Key `/api/chat` 503；真实 Key（`PORT=3102`）时 `ai: "deepseek"` 且 `/api/chat` 200 流式返回 |

看到 `index-C9ZcsQCi.css` / `index-CsKy1ArK.js` 这两个哈希，说明代码停在步骤 8b（`b99d3ad`）之后没漂移；若 JS 仍是 `index-BBQQW4ug.js`（554,382 B）则代码停在步骤 7，`index-D5Nq3TbM.js`（552,612 B）则停在步骤 6。换哈希就先查 `git log` 与 `HANDOFF.md` §10.3 的产物演进说明再下结论。

**未完成 / 已知边界**

1. **AI 报告仍是 Mock（8c 未做）**：报告页文案与结论由前端 Mock + 本地模板生成。AI 引导建档已接真实 DeepSeek（8b），但服务端无账号鉴权（只有按 IP 限流）、无额度/费用监控；开发期间暴露过的真实 Key **上线前必须轮换**。
2. 无 P4 级备份恢复（JSON 导入不算可回滚恢复）、无 Android 包。
3. 持久化边界：只在本机当前浏览器有效（清站点数据 / 换浏览器 / 换设备 / 无痕即丢）、无跨标签页同步、读盘失败只在控制台告警、导入整体替换且不可撤销。已有「清空本机数据」入口（步骤 7）：删除本机 IndexedDB 记录并恢复初始示例数据，中文二次确认，**不影响其它设备 / 浏览器**。
4. 技术债：3 条 lint 警告、主 JS 560.36 kB 超过 Vite 500 kB 提示线（`/plans` 可懒加载拆包）、大量页面目前只有 E2E 覆盖没有单测。
5. 窄屏仍隐藏今日页「编辑计划」与健身页「训练模板」顶部按钮（均有页内入口），如需显示改 `home-v3.css` 的 `:not()` 列表。
6. `design/` 94 个文件（93 PNG + `home-v3-countdown.html`，约 18.7 MB），其中 91 张是现行基线；`_snapshot-before-fixes/` 与 v1/v2 原型已从工作区删除但仍在 Git 历史里（`.git` 体积不变）。
7. 服务器：root 密码登录可用、3389 默认开着、443 未开；域名备案初审中；机器上**无项目代码**（`server/` 只在仓库与本地）。

## 4. 不可回退的铁律

1. 主导航 **5 项**，不许加第 6 项；`/plans` 是二级页（档案页「AI 建档」/ 今日页「长期计划 →」/ `/plans?onboard=1` 深链进入）。
2. AI 报告必须保留 4 个入口，不能退回"只能从学习页进"。
3. 来源必须诚实标注：真实调用标「DeepSeek 生成 · 经本站服务端代理」，Mock 标「本地生成 · Mock 对话」，回退时另行说明；**AI 报告仍是 Mock，不得暗示报告已接 DeepSeek**。
4. 前端不得出现 API Key；真实 AI 只能走 `server/` 代理（同源相对 `/api`）。
5. 用户确认前不得写档案或计划；档案写回必须经 `sanitizeProfilePatch()`，丢弃字段用一条 `' · '` 拼接的中文 toast 提示，不抛错。
6. 条件类名用 `cn()`（`lib\cn.ts`）或**完整字符串三元**（`item.done ? 'plan-item done' : 'plan-item'`）。历史上 `prettier-plugin-tailwindcss` 会把 `` `plan-item${x ? ' done' : ''}` `` 压平成 `plan-itemdone`，导致 14 处状态样式静默失效。
7. 批量格式化必须单独成 `style:` 提交，提交前比对构建产物哈希；Prettier 拆行会给 JSX 文本补 `{' '}` 子节点、可能挪动换行（`ReportsPage.tsx` 已踩过）。
8. 删除需批准：`Water intake record/`（368 MB）2026-11-03 决定保留；`design/_snapshot-before-fixes/`、旧 v1/v2 制品、`PreviewPages.tsx`、`design/.edge-profile*/` 已批准删除。
9. **禁止** `git reset` / `git clean` / `git push --force` / 删除项目目录；破坏性命令先说明再执行。回滚用 `git checkout -- <file>` / `git revert`。
10. 每完成一步就停下汇报，等用户确认再做下一步，不要连做多步。

## 5. 关键契约（改代码前必须知道）

**ChatEvent 顺序**（`lib\chat-types.ts`）：

```text
stage('collect') → delta* → questions? → profilePatch?（一轮最多一次、非空才发）
→ stage('propose') → proposal? → warnings? → done
```

- `proposal.profilePatch` **只用于展示**；唯一写回来源是 `profilePatch` 事件，且只在用户确认后应用。
- `ChatPlanProposal.startDate/endDate` 可选：缺省 = 今天起、到最后一个里程碑止，草案页可编辑。

**长期计划生命周期**（`lib\long-term-plan.ts`）：`draft` →（确认）`active` →（归档）`archived` →（重新启用）`active`；同一时刻只有一个 `active`。确认顺序：`addLongTermPlan()`（标题/目标不完整返回 `null` 即中止）→ `activatePlan()`（内部 `activateLongTermPlan` 归档其它 active）→ 写档案。Provider 暴露 `addLongTermPlan` / `updateLongTermPlan` / `archiveLongTermPlan` / `activatePlan`，状态在 `longTermPlans`。

**备份格式**（`lib\mock-data-transfer.ts`）：`PERSIST_BACKUP_VERSION='0.2.0'`、`LEGACY_BACKUP_VERSION='0.1.0'`、`serializeMockBackup`、`parseMockBackupJson`、`countMockRecords`、`requireLongTermPlans`。0.2.0 才含 `longTermPlans`，导入必须兼容 0.1.0；`SettingsPage` 导出 / 导入两侧都已接通。

**本机持久化**（`lib\persist-state.ts` / `lib\persist-storage.ts`）：数据库 `persist-app`（版本 1）、对象仓 `mock-state`、唯一记录 `id='persist-mock-state'`，结构 `{ id, schemaVersion: 1, savedAt, backup, snapshot }`，`backup` 复用上面的 0.2.0 格式。`MockDataProvider` 首挂载水合（完成前 `return null`）、状态变化 200 ms 防抖写整条记录、`pagehide` / `visibilitychange` 补写、`hydrated` 之前不写盘。读盘状态 `loaded / empty / unavailable / corrupt / unsupported-version`：不可用与损坏退回纯内存且不清数据；**未来版本记录只读不覆盖**。改状态切片必须同步维护 `persist-state.ts` 的 `schemaVersion` 与迁移。

**档案校验**（`lib\profile-rules.ts`）：`updateProfile` 本身不做校验，所有 UI 写入前必须 `sanitizeProfilePatch(...)`（年龄 14–100，越界丢弃并提示，绝不 throw）。

**服务端（P3，8a + 8b 已实现，契约以 `server/src/contract.ts` + `server/README.md` 为准）**：前端只请求**相对** `/api/*`（同源，备案后换域名零改动）；**请求/响应类型暂放 `server/src/contract.ts`（镜像 `app/src/lib/chat-types.ts`），`shared/` 仍为占位、迁移推迟**——改 `ChatEvent` 契约必须同时改这两处；前端客户端在 `app/src/lib/ai-chat-client.ts`（`createAppChatClient({ consent })`、`probe()`、`label`、`status()`；**只允许在首个内容事件前回退**，回退后本次会话不再重试，abort 不回退）；Mock 是"未授权 / 无 Key / 服务不可用"的降级路径，降级时必须如实标注来源；API Key 只放服务器 `/etc/persist/server.env`（权限 600），仓库只提交 `.env.example`；SSE 走 Nginx 时必须 `proxy_buffering off`；服务端监听 `127.0.0.1:3000`，不得直接暴露公网。开发代理用 `PERSIST_API_TARGET`（默认 `http://127.0.0.1:3000`），E2E 固定指向不可达端口以免触真实后端。

## 6. 服务器与部署现状（2026-11-04）

| 项目 | 现状 |
|---|---|
| 机器 | 阿里云 ECS，华东1（杭州），2 vCPU / 2 GiB / 40 GiB ESSD，到期 2027-11-03 |
| 系统 | Alibaba Cloud Linux 3.2104 LTS 64 位 —— 包管理器 **`dnf`**，不是 `apt` |
| 已装 | Node.js v20.20.2、npm 10.8.2（NodeSource）、Nginx 1.24.0（已启动并 enable，配置 `/etc/nginx/nginx.conf`，webroot `/usr/share/nginx/html/`） |
| 安全组 | 22 全开 / 80 全开 / 3389 默认开着（冗余，应关）/ **443 未开** |
| 代码 | **未部署**，只有 Nginx 默认页；`server/` P3（8a `9138175` + 8b `b99d3ad`）已在仓库，部署按步骤 9 |
| 域名 | `wpersist.top`（14 元/年，**已付款**）；实名认证**已通过**；**ICP 备案已提交、阿里云初审中（1–2 周）**；无解析 |
| 计费 | 3 Mbps 峰值按流量 0.8 元/GB → 必须开 gzip 与长缓存 |
| 目标架构 | Nginx(80/443) → `/` 静态 `app/dist`、`/api/*` 反代 Fastify `127.0.0.1:3000` → P4 用 **SQLite 单文件库**（不装 MySQL/MariaDB） |

部署硬规则（细节与可直接替换的站点配置见 `docs\部署与服务器现状.md` §5.1 / §8）：**不在服务器构建前端**（2 GiB 易 OOM，本地 `npm run build` 后上传 `app/dist`）、**SPA 深链 `try_files $uri $uri/ /index.html;` 且 `/api/` location 写在其前**、**gzip + hashed 资源 `immutable` 1 年 / `index.html` `no-cache`**、**前端只写相对 `/api`**、**密钥只在 `/etc/persist/server.env`(600) + `persist-server.service`**、**P3 不落库**、**命令用 `dnf`**。

## 7. 下一步执行清单（严格按顺序，一次只做一步）

| 步骤 | 任务 | 主要文件 | 验收标准 |
|---|---|---|---|
| ~~3~~ ✅ | 导出导入升 0.2.0 | `pages\SettingsPage.tsx` | 已达成（2026-11-03） |
| ~~4~~ ✅ | 全页面视觉复核 | `scripts\visual-check.mjs` | 已达成：91 张 + 用户双端验收 |
| ~~5~~ ✅ | 首个 Git 提交并推送 | — | 已达成：`main` / `bd779eb`（262 文件 37.39 MB） |
| ~~6~~ ✅ | 本机 IndexedDB 持久化 | `lib\persist-state.ts`、`lib\persist-storage.ts`、`MockDataProvider.tsx` | 已达成：刷新/重开不丢；单测 123 / E2E 98 全绿 |
| ~~7~~ ✅ | P3-0：设置页「清空本机数据」入口 | `pages\SettingsPage.tsx` + `context\MockDataProvider.tsx` + `e2e\persistence.spec.ts` | 已达成（`a544a38`）：`clearLocalData()` 按「停写回 → 掐防抖 → 删记录 → 重置内存态与 snapshot → 恢复写回」执行，`hydrated` 保持；设置页第二张危险区卡片 + 二次确认 + toast；E2E 100 次全绿 |
| **8**（8a ✅ 8b ✅ / 8c 待做） | **P3：Fastify + DeepSeek 服务端代理** | 8a `server/`（Fastify，`127.0.0.1:3000`，`9138175`）；8b `app/src/lib/ai-chat-client.ts` + `PlanChatSheet.tsx` + `vite.config.ts` + `playwright.config.ts`（`b99d3ad`）；8c 报告接服务端（`ReportsPage` / `data/reports.ts`）；`shared/` 迁移推迟 | 8a/8b 已达成：server typecheck 0 错、单测 41/41、`/api/health` 200、非法请求 400、无 Key 503；app 单测 139/139、E2E 102 全绿、构建通过；真实 Key 联调 200 且日期为未来。**仍差 8c（AI 报告接服务端）与部署验收**；完成标准见 `HANDOFF.md` §13 P3 |
| **9** | IP 直连首次部署（无域名） | 本地 build → 上传 `app/dist` 到 `/var/www/persist`；Nginx 站点（深链 + `/api` 反代 + gzip + 长缓存）；Fastify systemd + `/etc/persist/server.env`(600) | `http://<IP>/` 可打开、`/reports` 等深链刷新 200、`/api/health` 200；命令与配置见 `docs\部署与服务器现状.md` |
| **10**（备案通过后） | 域名 `wpersist.top` + HTTPS + 安全加固 | DNS 解析、开 443、certbot、HTTP→HTTPS；SSH 密钥登录、禁 root 密码、关 3389、fail2ban | `https://wpersist.top` 可访问、证书有效、HTTP 自动跳转 |
| P4 | 真实备份与恢复（含快照语义）、SQLite 选型 | 见 `HANDOFF.md` §13 | 见 §13 完成标准 |
| P5 | Capacitor Android 打包与真机验证 | 见 `HANDOFF.md` §13 | 见 §13 完成标准 |

> 前置提醒：域名备案初审中（1–2 周）⇒ 步骤 10 只能等；在此之前用公网 IP 直连做内部验收，**不得对外宣称域名可用**。IP 从本机 `docs\部署与服务器现状.local.md` 取，不要写进任何提交。

## 8. 命令与沙箱坑（实测）

```powershell
cd D:\Persist\app
npm run dev -- --port 4173        # http://127.0.0.1:4173/（与 E2E / 视觉脚本同端口）
npm run typecheck                 # tsc -b（受限沙箱可跑）
npm run lint                      # oxlint（受限沙箱可跑）
npx prettier --check .            # 在 app 内全仓检查
npm test                          # vitest run
npx playwright test               # webServer 自动拉起 4173
npm run build                     # tsc -b && vite build
npm run visual:check              # 截图到 design/（需 4173 已有服务）
```

服务端（`server/`，P3 8a + 8b）：

```powershell
cd D:\Persist\server
npm install --no-audit --no-fund --cache "D:\Persist\server\.npm-cache"  # 默认缓存路径 EPERM，必须带本地缓存
npm run typecheck                 # tsc -p tsconfig.test.json
npm test                          # vitest run，41 条（受限沙箱需提权）
npm run build                     # tsc → dist/
npm run format:check              # prettier
$env:PORT='3101'; node dist/index.js   # 冒烟：GET /api/health / POST /api/chat（无 Key 时 chat 503）
```

> 真实 Key 联调只能在临时进程里用环境变量传入（`$env:DEEPSEEK_API_KEY=...`），**不要写进任何文件**，结束后：杀进程、清环境变量、删临时请求/响应用例文件。联调时前端可用 `PERSIST_API_TARGET` 指到该临时端口。

- `npm test`、`npm run build`、`npx playwright test`、`npm run visual:check`、`git push` / `git ls-remote` 在受限文件沙箱下会失败（原生模块加载、Vite `windowsSafeRealPathSync`、Chromium `spawn EPERM`；git 启动 `ssh.exe` 报 `couldn't create signal pipe, Win32 error 5`）→ 需要一次性提权到完整访问权限再执行；`tsc -b` / `oxlint` / `prettier` / 本地 `git add|commit|status|log` 不需要。
- Playwright 的 `webServer` 会自己拉起 4173，**不要**手动先启动；`visual:check` 需要 4173 已有服务（可用 `PERSIST_URL` 覆盖）。
- 手机真机验收需 `--host 0.0.0.0` 且 Windows 防火墙放行 4173（需管理员）；放行不了就退回 Chrome DevTools 设备模拟（421×926 / DPR 3）。
- 写文件必须 3 参数：`[IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))`；2 参数重载会写出 24 字节垃圾 —— 本仓库已因此丢失过一次 `PlansPage.tsx`。
- `node -e` 内联 JS 会被 PowerShell 破坏，需要脚本就写临时 `.cjs`。
- `git push` 会向 stderr 打印进度 ⇒ 在 PowerShell 里表现为 `NativeCommandError` / `[exit code: 1]`，**以 `old..new main -> main` 行与哈希核对为准**，不要误判失败。
- 中文控制台输出可能乱码：把命令输出写入 UTF-8 文件再读。
- 视觉截图不逐字节稳定（首页有 1 s 倒计时，像素差 ≤0.07%）：判定回归要**逐像素比对**，不要提交噪声 PNG，跑完 `git checkout HEAD -- design` 还原。
- 当前模型无图像输入能力：**不要假装看过截图**，视觉结论必须由用户给出。

## 9. Git 现状与推流

```powershell
cd D:\Persist
git status -sb                 # ## main...origin/main（干净）
git remote -v                  # origin git@github.com:save626/Persist.git（SSH，公开仓库）
git rev-parse HEAD             # 与下面的远端哈希一致
git ls-remote origin refs/heads/main
```

- 远端 `git@github.com:save626/Persist.git`（**公开**）；分支 `main`（由 `master` 改名）；身份 `save626 / 2137153161@qq.com`。
- 提交链按主题：`bd779eb`（`chore: initial commit`，262 文件 37.39 MB）→ 步骤 5/6 功能与文档提交（`da787c4` / `128d6a2` / `e3e9730`）→ `d4c9696`（清理死代码与历史制品）→ `style:`（移除 Tailwind 插件并格式化 19 个文件）→ 步骤 7 `feat:`（`a544a38`）→ 步骤 8a `feat:`（`9138175`，服务端骨架）→ 步骤 8b `feat:`（`b99d3ad`，前端接 AI 对话 + 真实 Key 联调）→ 若干 `docs:` 同步。**不记提交个数**——写死数字下次提交就过期。
- 每次推送后核对：`git rev-parse HEAD` == `git ls-remote origin refs/heads/main`，且 `git status -sb` 无 ahead/behind。
- 认证已就绪（`ssh -T git@github.com` 返回 `Hi save626!`），**不需要**用户提供 Token / 密码 / 私钥。
- 推送前审计：`git diff --cached --name-only` 过滤 `node_modules/|^app/dist/|test-results|playwright-report|coverage|Water intake record|\.log$|\.tsbuildinfo$|\.local\.md$`。
- 每个阶段结束提交一次（8c、9、10、P4、P5；8a 已于 `9138175`、8b 已于 `b99d3ad` 提交），禁止 `git push --force`，禁止重写历史。

## 10. 每步汇报格式（固定 8 段，中文）

1. 本次完成内容；2. 修改文件列表；3. ChatEvent / profilePatch 契约是否变化；4. 长期计划生命周期与导出导入方案；5. 实际执行的测试及结果（命令 + 数字）；6. 已知限制与未完成事项；7. 建议的下一阶段；8. 是否需要用户重新视觉验收。

## 11. 禁止事项

- 不要为"看起来完成"而伪造验证结果；没跑就写没跑（包括"我没看过截图"）。
- 不要绕过 `sanitizeProfilePatch`，不要在未确认时写档案 / 计划。
- 不要新增第 6 个导航项，不要把 AI 报告降级为学习页附属。
- 不要把批量格式化混进功能提交；不要用 2 参数 `WriteAllText`；不要 `git reset/clean/--force`。
- 不要把 Mock 能力包装成真实能力，不要在前端引入密钥，不要把真实 IP / root 密码 / API Key 写进任何受版本控制的文件。
- 不要用文件修改时间或旧聊天记录推断进度 —— 以 `HANDOFF.md` 的实测数据与当前代码为准。
- 不要"顺手"重构已验收的视觉与交互（视觉范围已冻结到下次用户验收）。

## 12. 待用户决策（未批准前不要动）

1. 今日页「编辑计划」、健身页「训练模板」的窄屏头部按钮是否恢复 —— 建议不做，等真机反馈。
2. 是否补 Windows 防火墙入站规则放行 4173 供手机同 Wi-Fi 访问 —— 暂缓到真机验收或 P5。
3. 备案通过后的证书方案（certbot 自动续期 vs 手动上传）与是否同时上 CDN —— 到步骤 10 再定。
4. P4 的 SQLite 选型（`better-sqlite3` native 编译 vs 升级服务器 Node 到 22+ 用 `node:sqlite`）—— 到 P4 再定，不要在 P3 引入数据库。**已定死的部分**：用 SQLite 单文件库、**不装 MySQL/MariaDB**。
5. 视觉基线版本化策略（`gitignore design/_current/` + 里程碑提交 `design/baseline-<phase>/`）—— 建议 P3 之后再做。
6. 是否补 `.gitignore` 的更多条目（当前已含 `app/dist/`、`test-results/`、`playwright-report/`、`*.local`、`*.local.md`、`*.tmp`、`desktop.ini` 等）。
7. 视觉基线是否重新生成：步骤 7 新增设置页卡片、8b 改了 `/plans` 对话文案，`npm run visual:check` 会覆盖 `design/` 现有 91 张基线，**未获批准前不要跑**。
8. 仓库里仍跟踪着两个写入测试留下的垃圾文件 `app/src/pages/_write-test*.txt`（步骤 8b 之前发现），删除需用户批准。

## 13. 需要主动披露的历史

- `PlansPage.tsx` 曾因 2 参数 `WriteAllText` 被截断丢失（当时无 Git 备份），现版本从 `dist` 产物反解后**等价重写**，已通过类型检查、构建与全量 E2E，但不是原始源码；该版本包含在首个提交 `bd779eb` 中，此后有历史可比对。
- `AppShell`、`TodayPage`、饮食 / 健身 / 学习页曾因条件类名被 Prettier 压平导致状态样式失效（14 处），已用 `cn()` 与完整字符串三元修复；再动这些文件的类名要回归。
- 视觉基线为 2026-11-03 版（91 张），经用户桌面端与移动端验收通过；更早已作废。首页截图因实时倒计时永不逐字节稳定，勿当回归证据。
- 持久化交付的是**浏览器本机持久化**，不是"数据安全"：清站点数据、换浏览器、换设备、无痕模式都会丢；已有「清空本机数据」入口（步骤 7），但它只清当前浏览器的这一条记录、不是"恢复出厂设置"更不是跨设备操作。不要对外说成服务端存储或云同步。
- 持久化没有引入 Dexie（原计划写的是 Dexie），原因是沙箱内 `npm install` 受缓存路径 EPERM 限制且当前只有单用户单记录场景；这是主动偏离，记录在 `HANDOFF.md` §13 P2 / §6.6。
- 文档曾出现"提交个数"与"构建体积"写死后自相矛盾的问题（每次提交 / 清理都会让数字失效）；现行规则是：提交只按主题叙述、体积只指向 `HANDOFF.md` §10.3 的实测值。
- 服务器交接信息由用户口头提供并脱敏入库：公网 IP 只在 `.local.md`，root 密码**从未写入任何文件**，需要 SSH 操作时向用户索取或让用户执行。
- 步骤 8b 已用真实 DeepSeek Key 完成端到端联调（`b99d3ad`）：`/api/chat` 200、3.5 s、127 个 SSE 事件；首轮暴露模型给出 2025 年过去日期，修复提示词（注入 Asia/Shanghai 今天）与前端日期兜底后复验为未来日期。**该 Key 已出现在开发对话历史里，上线前必须轮换**；真实 Key 不得写入任何受版本控制的文件。AI 报告仍是 Mock，不要因为「建档对话能调 DeepSeek」就说「报告已接入」；并发/限流/Nginx 下 SSE 需部署后复验。
- 原计划把 P3 请求/响应契约放 `shared/`，实际偏离为 `server/src/contract.ts` 镜像 `app/src/lib/chat-types.ts`（前端冻结，迁 `shared/` 要改 app 构建/tsconfig）；迁移保留到 P3 收尾或 P4。
