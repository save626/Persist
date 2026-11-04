# Persist 新会话交接指令（完整版）

> 生成：2026-11-04（步骤 8c 收尾 + P4 终态设计方案定稿后更新；上一版为步骤 8c 完成版，以本版为准）
> 用法：**把本文件全部内容作为新一轮会话的启动指令整份粘贴**。
> 权威现状：同目录 `HANDOFF.md`（本文件只讲"怎么接手 + 下一步做什么"，不替代它的结论）。
> 一页速览：`docs\项目现状总览.md`；服务器与部署：`docs\部署与服务器现状.md`（公网 IP 已脱敏）。
> 公开仓库，**任何情况下不要把真实公网 IP、root 密码、API Key 写进仓库文件**。

---

## 0. 一句话背景

Persist 是个人自用、本地优先的「计划 → 记录 → 复盘 → AI 分析」工具。当前是一个**可完整点击验收、已通过桌面端 + 移动端视觉验收的前端产品原型 + 已接通的 AI 服务端**：8 个页面、5 项主导航、业务数据全部写入本机浏览器 IndexedDB（刷新 / 关闭标签页 / 重开浏览器不丢，含长期计划）、AI 引导建档与 AI 报告文字在授权 + 服务端可用时经本站代理调用真实 DeepSeek（失败自动回退 Mock 并标注）、JSON 导出导入已是备份 0.2.0（含长期计划）。

**服务端 P3 已完成 8a + 8b + 8c**：`server/` 是 Fastify 5 + DeepSeek 代理（`GET /api/health`、SSE `POST /api/chat`、JSON `POST /api/report`、白名单净化、按 IP 限流、超时/取消/有限重试、日志脱敏），单测 58/58 通过；前端 `PlanChatSheet` 已接入 `/api/chat`、`ReportsPage` 已接入 `/api/report`（`app/src/lib/ai-chat-client.ts` / `app/src/lib/ai-report-client.ts`），**两处都已用真实 DeepSeek Key 完成端到端联调**（真实调用先后暴露「过去日期」与「模型自行推算数字」两类缺陷，均已通过提示词修复并复验）。代码**尚未部署**到服务器。没有服务端数据库、没有备份恢复、没有 Android 包。Git 提交链（起于 `bd779eb`，含清理、格式化、步骤 7、8a、8b、8c、reports 基线重跑提交）**已全部推送**，工作区干净。服务器环境已就绪：阿里云 ECS 2C2G + Node 20.20.2 + Nginx 1.24.0，80 可达默认页；域名 `wpersist.top` 已购买、实名认证已通过、ICP 备案已提交（阿里云初审中），443 未开。

**P4 终态设计已定稿（2026-11-04，仅设计，未写任何代码）**：`docs/P4-数据层与AI综合分析设计方案.md`。方向是**本地优先 + 服务端可检索副本**——IndexedDB 仍是写入权威，增量同步到 Fastify + SQLite，服务端用 SQL 聚合出事实包（`ReportFacts` v2），DeepSeek 只写分析文字；报告可归档/缓存/可选定时，并补设备令牌、备份恢复、导出与删除账号。拆成步骤 11（8d 数据历史化）→ 12（P4a 设备令牌 + 增量同步）→ 13（P4b 服务端聚合 + AI 综合分析）→ 14（P4c 备份/恢复/导出/删除），最后 P5。**关键前提**：现在只有学习记录是真实历史——训练「历史」是 `FitnessPage.tsx` 里的演示常量 `HISTORY`，饮食只有「今天」的 `meals`，饮水无日期、计划项只存当天。所以必须先做 8d，否则 AI 拿到库里也没有几个月的数据可分析。**不得把「计划中的 AI 综合分析」说成现有能力。**

## 1. 开工前必读（按顺序，不要跳）

1. `D:\Persist\docs\项目现状总览.md` —— 一页速览：阶段完成度、验证数字、服务器现状、Top 10 限制、下一步。
2. `D:\Persist\HANDOFF.md` —— **唯一现状权威**。重点读 §0.1–0.4（含步骤 7–10 执行计划）、§2（进度与完成度矩阵）、§3.1（路由）、§4.9（计划闭环）、§5.1–5.4（契约）、§6.6（持久化）、§8.5（导出导入）、§9.1、§10（构建与视觉资产）、§13（路线与完成标准，含 P3-0/P3）、§14（已知问题与债务）、§15、§16（文件索引）、§19/§20。
3. `D:\Persist\docs\部署与服务器现状.md` —— 服务器规格、七条部署硬规则、Nginx 站点草案（含 SPA 深链、gzip、`/api` 反代、SSE `proxy_buffering off`）、命令速查、待执行清单。
4. `D:\Persist\docs\P4-数据层与AI综合分析设计方案.md` —— **P4 终态设计（唯一）**：目标架构、SQLite 选型与 DDL、8d 数据历史化、设备令牌与增量同步协议、事实包 v2 与 AI 综合分析契约、隐私边界、部署影响、步骤 11–14 拆分与验收、待用户确认清单（§18）。要做 P4 先读它，不要照旧规划 §7 的 Dexie/Drizzle/Docker 设想实施。
5. `D:\Persist\README.md`、`D:\Persist\app\README.md` —— 阶段、命令、页面清单、条件类名约定。
6. `D:\Persist\docs\工程初始化与前端约定.md` —— 技术选型与前端阶段顺序。
7. `D:\Persist\docs\Persist-项目开发规划.md` —— **目标态规划，不是现状**（§4.2 的 16 条路由、§4.3 的分模块页面大多未实现；§7 的服务端/Dexie/Docker 设想已被 P4 方案取代）；与 HANDOFF / P4 方案 / 源码冲突时以后者为准。
8. 源码按序：`app\src\App.tsx` → `context\MockDataProvider.tsx` → `lib\persist-state.ts` → `lib\persist-storage.ts` → `types.ts` → `lib\chat-types.ts` → `lib\report-types.ts` → `lib\ai-chat-client.ts` → `lib\ai-report-client.ts` → `lib\long-term-plan.ts` → `lib\plan-draft.ts` → `lib\profile-rules.ts` → `lib\mock-data-transfer.ts` → `pages\SettingsPage.tsx` → `pages\PlansPage.tsx` → `pages\ReportsPage.tsx`。
9. 视觉对照：`design\home-v3-countdown.html` 与 `design\*.png`。

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
- 全站弹窗统一垂直居中；窄屏保留档案页「AI 建档」入口；视觉基线 15 状态 × 6 视口（1440 / 500 / 430 / 421×926 / 390 / 360）经用户桌面端与移动端验收通过；8c 文案变更后 reports 6 张基线已单独重跑并经用户双端验收（`7625865`），**视觉基线现与代码一致**。
- 收尾：`d4c9696` 清理死代码与历史制品（含删除 `PreviewPages.tsx` 与 173 行 `.preview-*` CSS），`style:` 提交移除 Tailwind Prettier 插件并格式化 19 个文件；构建产物哈希与格式化前逐字节一致。
- 服务端 8a（`9138175`）：`server/` Fastify + DeepSeek 代理骨架，SSE `/api/chat`（严格契约顺序）+ `/api/health` + 白名单净化 + 按 IP 限流 + 25 s 超时/abort/有限重试 + 日志脱敏；无 Key 时 `/api/chat` 503。
- 前端 8b（`b99d3ad`）：`app/src/lib/ai-chat-client.ts` 用 `fetch` 增量解析 SSE，`probeAiChat()` 探 `/api/health`，`createAppChatClient({ consent })` 决定走真实还是 Mock；`PlanChatSheet` 按 `profile.aiConsent` 切换并在标题/副标题/回退提示里如实标注来源；Vite 开发代理 `/api` → `127.0.0.1:3000`，Playwright 用不可达端口隔离真实后端。**真实 DeepSeek Key 端到端联调通过**（发现模型给过去日期 → 提示词注入 Asia/Shanghai 今天 + 前端日期兜底 → 复验为未来日期）。
- 服务端 8c（`bdd4265`）：`POST /api/report`（非流式 JSON，25 s 超时、与 `/api/chat` 共用 IP 限流、客户端断开 499）+ `ai/report.ts` 净化（长度/条数/去重/禁代码块）+ 报告提示词（**禁止任何数值推算**）；前端 `app/src/lib/ai-report-client.ts`（探活 + 错误分类 + 响应再校验）与 `ReportsPage` 改造：授权 + 服务端可用时生成报告文字，**指标数字、依据条目、统计区间仍由前端按本地记录确定性生成**；不可用回退 Mock 并标注，契约错误明确报错不伪造报告；`ReportRecord.origin` 区分 AI / Mock。真实联调：完整摘要 2.7 s、只授权学习时无训练/饮食字样；首轮模型自行算出「再补水 0.5 L」⇒ 提示词改为禁止推算后复验通过。**代码仍未部署。**
- 服务器：环境就绪（见 §6），代码未部署；域名已购买、实名已通过、ICP 备案初审中。

**验证数字（最近一次全绿）**

| 检查 | 命令 | 结果 |
|---|---|---|
| 格式 | `npx prettier --check .` | All matched（`app/` 作用域；根目录 `HANDOFF*.md`、`docs/*.md` 不在 Prettier 范围） |
| 类型 | `npm run typecheck`（`tsc -b`） | 0 错误 |
| Lint | `npm run lint`（oxlint） | 0 错误 / 3 条既有 `react(set-state-in-effect)` 警告（`StudyPage.tsx`、`DietPage.tsx`、`FitnessPage.tsx`，行号会漂，按规则名找） |
| 单测 | `npm test` | **149 / 149**（10 文件：`complete-mock-data` 5、`chat-extract` 24、`countdown` 4、`long-term-plan` 23、`mock-data-transfer` 26、`plan-draft` 22、`profile-rules` 11、`persist-state` 11、`ai-chat-client` 13、`ai-report-client` 10） |
| E2E | `npx playwright test` | **102 次执行**（51 用例 × 2 项目），0 跳过 0 失败（59.5 s） |
| 构建 | `npm run build` | `dist/index.html` 611 B、`assets/index-CrJgYfMj.css` 137,705 B（gzip 23.83 kB）、`assets/index-DmnjkjkL.js` 564,705 B（gzip 168.01 kB） |
| 视觉 | `npm run visual:check`（**先起无 Key 后端**，否则 `/api` 502 判失败） | 15 状态 × 6 视口 = 90 张 + 快速记录 1 张，`overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`（2026-11-04 步骤 8b 后全量重跑，exit 0，77 张 png 更新并经用户验收）。**8c 后 reports 相关基线已单独重跑：6 张 png 更新，各项 0、exit 0，经用户双端验收，随 `7625865` 入库** |
| 服务端类型 | `npm run typecheck`（`server/`） | 0 错误 |
| 服务端单测 | `npm test`（`server/`） | **58 / 58**（8 文件：config 4 / contract 9 / rate-limit 3 / extract 8 / deepseek 7 / chat 7 / prompts 3 / report 17） |
| 服务端冒烟 | `PORT=3001 node dist/index.js` | `GET /api/health` 200（无 Key 时 `ai: "disabled"`）；非法请求 400；无 Key `/api/chat`、`/api/report` 503；真实 Key 时 `ai: "deepseek"`、`/api/report` 200 + 中文简报（2.7 s） |

看到 `index-CrJgYfMj.css` / `index-DmnjkjkL.js` 这两个哈希，说明代码停在步骤 8c（`bdd4265`）之后没漂移；若 JS 是 `index-CsKy1ArK.js`（560,361 B）则停在步骤 8b，`index-BBQQW4ug.js`（554,382 B）则停在步骤 7，`index-D5Nq3TbM.js`（552,612 B）则停在步骤 6。换哈希就先查 `git log` 与 `HANDOFF.md` §10.3 的产物演进说明再下结论。

**未完成 / 已知边界**

1. **AI 报告只有「今日简报」走服务端（8c，`bdd4265`）**：报告文字可来自真实 DeepSeek，但指标数字、依据条目、统计区间仍由前端按本地记录生成；`训练建议` / `学习观察` 两类仍打开本地已有报告。服务端无账号鉴权（只有按 IP 限流）、无额度/费用监控；开发期间暴露过的真实 Key **上线前必须轮换**。
2. **服务端没有任何历史数据，AI 也就无法做「检索全部历史的综合分析」**：P3 是无状态代理，报告依据是前端当场拼的单窗口摘要。P4 方案已定稿（`docs/P4-数据层与AI综合分析设计方案.md`）但**未实施**——要等步骤 13（P4b）才真正具备该能力，且前置是步骤 11（8d）补齐按日历史。无 P4 级备份恢复（JSON 导入不算可回滚恢复）、无 Android 包。
3. **历史数据本身不完整**：只有 `StudyRecord` 带真实 `date`；健身「历史」是 `FitnessPage.tsx` 的演示常量 `HISTORY`；`meals` 只覆盖今天；饮水日志无日期字段；计划项只存当天。任何「分析几个月趋势」的说法在 8d 之前都不成立。
4. 持久化边界：只在本机当前浏览器有效（清站点数据 / 换浏览器 / 换设备 / 无痕即丢）、无跨标签页同步、读盘失败只在控制台告警、导入整体替换且不可撤销。已有「清空本机数据」入口（步骤 7）：删除本机 IndexedDB 记录并恢复初始示例数据，中文二次确认，**不影响其它设备 / 浏览器**。
5. 技术债：3 条 lint 警告、主 JS 564.70 kB 超过 Vite 500 kB 提示线（`/plans` 可懒加载拆包）、大量页面目前只有 E2E 覆盖没有单测、`shared/` 契约迁移未做（P4 方案 §17 建议在步骤 12 前完成）。
6. 窄屏仍隐藏今日页「编辑计划」与健身页「训练模板」顶部按钮（均有页内入口），如需显示改 `home-v3.css` 的 `:not()` 列表。
7. `design/` 94 个文件（93 PNG + `home-v3-countdown.html`，约 18.7 MB），其中 91 张是现行基线且与代码一致（8c 后 reports 6 张已重跑，`7625865`）；`_snapshot-before-fixes/` 与 v1/v2 原型已从工作区删除但仍在 Git 历史里（`.git` 体积不变）。
8. 服务器：root 密码登录可用、3389 默认开着、443 未开；域名备案初审中；机器上**无项目代码**（`server/` 只在仓库与本地）；Node 20 装不了内置 `node:sqlite`（P4 前必须定驱动）。

## 4. 不可回退的铁律

1. 主导航 **5 项**，不许加第 6 项；`/plans` 是二级页（档案页「AI 建档」/ 今日页「长期计划 →」/ `/plans?onboard=1` 深链进入）。
2. AI 报告必须保留 4 个入口，不能退回"只能从学习页进"。
3. 来源必须诚实标注：真实调用标「DeepSeek 生成 · 经本站服务端代理」，Mock 标「本地生成 · Mock 对话 / Mock 报告」，回退时另行说明；**报告文字可来自 DeepSeek，但指标与依据由前端生成、且只有「今日简报」走服务端，不得宣称「报告全部由 AI 生成」**。
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

**服务端（P3，8a + 8b + 8c 已实现，契约以 `server/src/contract.ts` + `server/README.md` 为准）**：前端只请求**相对** `/api/*`（同源，备案后换域名零改动）；**请求/响应类型暂放 `server/src/contract.ts`（镜像 `app/src/lib/chat-types.ts` 与 `app/src/lib/report-types.ts`），`shared/` 仍为占位、迁移推迟**——改 `ChatEvent` 或报告契约必须同时改这些位置；前端客户端在 `app/src/lib/ai-chat-client.ts`（`createAppChatClient({ consent })`、`probe()`、`label`、`status()`；**只允许在首个内容事件前回退**，回退后本次会话不再重试，abort 不回退）与 `app/src/lib/ai-report-client.ts`（`probeAiReport()` 要求 `ai:'deepseek'`、`requestAiReport()`、`ReportUnavailableError` / `ReportContractError` 分流、`parseReportContent()` 再校验；服务不可用回退 Mock、契约错误报错不伪造）；`/api/report` 请求体 `{ type, rangeDays, digest }`，`digest` 只含已授权来源、未授权为 `null`（不是 0），**模型只写文字**（title/status/summary/conclusions/actions/warnings），指标与依据由前端生成；Mock 是"未授权 / 无 Key / 服务不可用"的降级路径，降级时必须如实标注来源；API Key 只放服务器 `/etc/persist/server.env`（权限 600），仓库只提交 `.env.example`；SSE 走 Nginx 时必须 `proxy_buffering off`，`/api/report` 是普通长请求需 `proxy_read_timeout ≥60s`；`/api/chat` 与 `/api/report` 共用同一个 IP 限流器（20 次 / 5 分钟）；服务端监听 `127.0.0.1:3000`，不得直接暴露公网。开发代理用 `PERSIST_API_TARGET`（默认 `http://127.0.0.1:3000`），E2E 固定指向不可达端口以免触真实后端。

## 6. 服务器与部署现状（2026-11-04）

| 项目 | 现状 |
|---|---|
| 机器 | 阿里云 ECS，华东1（杭州），2 vCPU / 2 GiB / 40 GiB ESSD，到期 2027-11-03 |
| 系统 | Alibaba Cloud Linux 3.2104 LTS 64 位 —— 包管理器 **`dnf`**，不是 `apt` |
| 已装 | Node.js v20.20.2、npm 10.8.2（NodeSource）、Nginx 1.24.0（已启动并 enable，配置 `/etc/nginx/nginx.conf`，webroot `/usr/share/nginx/html/`） |
| 安全组 | 22 全开 / 80 全开 / 3389 默认开着（冗余，应关）/ **443 未开** |
| 代码 | **未部署**，只有 Nginx 默认页；`server/` P3（8a `9138175` + 8b `b99d3ad` + 8c `bdd4265`）已在仓库，部署按步骤 9 |
| 域名 | `wpersist.top`（14 元/年，**已付款**）；实名认证**已通过**；**ICP 备案已提交、阿里云初审中（1–2 周）**；无解析 |
| 计费 | 3 Mbps 峰值按流量 0.8 元/GB → 必须开 gzip 与长缓存 |
| 目标架构 | Nginx(80/443) → `/` 静态 `app/dist`、`/api/*` 反代 Fastify `127.0.0.1:3000` → P4 用 **SQLite 单文件库** `/var/lib/persist/persist.sqlite` + 备份目录（不装 MySQL/MariaDB，不用 ORM；驱动 Node22 `node:sqlite` 或 Node20 `better-sqlite3`，二选一待拍板，见 P4 方案 §4） |

部署硬规则（细节与可直接替换的站点配置见 `docs\部署与服务器现状.md` §5.1 / §8）：**不在服务器构建前端**（2 GiB 易 OOM，本地 `npm run build` 后上传 `app/dist`）、**SPA 深链 `try_files $uri $uri/ /index.html;` 且 `/api/` location 写在其前**、**gzip + hashed 资源 `immutable` 1 年 / `index.html` `no-cache`**、**前端只写相对 `/api`**、**密钥只在 `/etc/persist/server.env`(600) + `persist-server.service`**、**P3 不落库**、**命令用 `dnf`**。P4 部署侧另有：`/var/lib/persist`(0700 属主 `persist`)、env 加 `DB_PATH`/`DB_BACKUP_DIR`/`DEVICE_TOKEN_PEPPER`、systemd `ProtectSystem=strict` + `ReadWritePaths`、每日 `VACUUM INTO` 备份，见 P4 方案 §11。

## 7. 下一步执行清单（严格按顺序，一次只做一步）

| 步骤 | 任务 | 主要文件 | 验收标准 |
|---|---|---|---|
| ~~3~~ ✅ | 导出导入升 0.2.0 | `pages\SettingsPage.tsx` | 已达成（2026-11-03） |
| ~~4~~ ✅ | 全页面视觉复核 | `scripts\visual-check.mjs` | 已达成：91 张 + 用户双端验收 |
| ~~5~~ ✅ | 首个 Git 提交并推送 | — | 已达成：`main` / `bd779eb`（262 文件 37.39 MB） |
| ~~6~~ ✅ | 本机 IndexedDB 持久化 | `lib\persist-state.ts`、`lib\persist-storage.ts`、`MockDataProvider.tsx` | 已达成：刷新/重开不丢；单测 123 / E2E 98 全绿 |
| ~~7~~ ✅ | P3-0：设置页「清空本机数据」入口 | `pages\SettingsPage.tsx` + `context\MockDataProvider.tsx` + `e2e\persistence.spec.ts` | 已达成（`a544a38`）：`clearLocalData()` 按「停写回 → 掐防抖 → 删记录 → 重置内存态与 snapshot → 恢复写回」执行，`hydrated` 保持；设置页第二张危险区卡片 + 二次确认 + toast；E2E 100 次全绿 |
| **8** ✅ 8a + 8b + 8c 完成（待部署验收） | **P3：Fastify + DeepSeek 服务端代理** | 8a `server/`（Fastify，`127.0.0.1:3000`，`9138175`）；8b `app/src/lib/ai-chat-client.ts` + `PlanChatSheet.tsx` + `vite.config.ts` + `playwright.config.ts`（`b99d3ad`）；8c `server/src/routes/report.ts` + `ai/report.ts` + `app/src/lib/ai-report-client.ts` + `ReportsPage.tsx`（`bdd4265`）；`shared/` 迁移推迟 | 已达成：server typecheck 0 错、单测 58/58、`/api/health` 200、非法请求 400、无 Key 503、`/api/report` 真实 Key 200（2.7 s）；app 单测 149/149、E2E 102 全绿、构建通过；`/reports` 视觉基线已重跑并验收（`7625865`）。**仍差步骤 9 部署验收**；完成标准见 `HANDOFF.md` §13 P3 |
| **9** | IP 直连首次部署（无域名） | 本地 build → 上传 `app/dist` 到 `/var/www/persist`；Nginx 站点（深链 + `/api` 反代 + gzip + 长缓存）；Fastify systemd + `/etc/persist/server.env`(600) | `http://<IP>/` 可打开、`/reports` 等深链刷新 200、`/api/health` 200；命令与配置见 `docs\部署与服务器现状.md`。**无前置条件，随时可做** |
| **10**（备案通过后） | 域名 `wpersist.top` + HTTPS + 安全加固 | DNS 解析、开 443、certbot、HTTP→HTTPS；SSH 密钥登录、禁 root 密码、关 3389、fail2ban | `https://wpersist.top` 可访问、证书有效、HTTP 自动跳转 |
| **11**（8d） | **数据历史化**：训练真实历史、饮食/饮水/计划按日台账、`schemaVersion` 1→2 迁移、备份 0.3.0 | `app/src/types.ts`、`lib/persist-state.ts`、`pages/FitnessPage.tsx`（去掉 `HISTORY` 常量）、`pages/DietPage.tsx`、`pages/HomePage.tsx`、`lib/mock-data-transfer.ts` | P4 前置。验收见 P4 方案 §6.3：跨日数据不丢、v1 记录可迁移、备份 0.3.0 round-trip、单测/E2E/视觉基线更新并经用户验收 |
| **12**（P4a） | **设备令牌 + 增量同步**：`/api/v1/devices|restore|revoke`、`/sync/bootstrap|push|pull`、outbox、LWW、墓碑、`opId` 幂等 | 新建 `server/src/db/*`、`server/src/routes/sync*.ts`；`app/src/lib/sync-*.ts`、设置页同步区块 | 验收见 P4 方案 §7.4：离线可写、重连补齐、断网不丢、幂等重放、跨设备一致 |
| **13**（P4b） | **服务端聚合 + AI 综合分析**：SQL 事实包 v2 → `ANALYSIS_SYSTEM_PROMPT` → `/api/v1/analysis/*`，报告归档/缓存 | `server/src/db/aggregate.ts`、`server/src/ai/analysis.ts`、`routes/analysis.ts`；前端报告页接新契约 | 验收见 P4 方案 §8.5：数字全部来自 SQL、未授权来源不可见、不可用时回退规则引擎并标注 |
| **14**（P4c） | **备份/恢复/导出/删除**：`VACUUM INTO` 每日备份、恢复、全量导出、删除账号（PIPL） | `server/src/db/backup.ts`、`routes/account.ts`、设置页数据区块 | 验收见 P4 方案 §12 |
| P5 | Capacitor Android 打包与真机验证 | 见 `HANDOFF.md` §13 | 见 §13 完成标准 |

> 步骤 9 与 11 都无前置：备案等待期可以先做步骤 11（前端改动，不依赖服务器），但**一次只做一步，做完停下等确认**。P4 总体设计与验收口径唯一来源是 `docs\P4-数据层与AI综合分析设计方案.md`，不要照 `docs\Persist-项目开发规划.md` §7 的旧设想（Dexie/Drizzle/Docker）实施。

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
npm run visual:check              # 截图到 design/（需 4173 已有服务 + 同源 /api 可达，见下）
```

服务端（`server/`，P3 8a + 8b + 8c）：

```powershell
cd D:\Persist\server
npm install --no-audit --no-fund --cache "D:\Persist\server\.npm-cache"  # 默认缓存路径 EPERM，必须带本地缓存
npm run typecheck                 # tsc -p tsconfig.test.json
npm test                          # vitest run，58 条（受限沙箱需提权）
npm run build                     # tsc → dist/
npm run format:check              # prettier
$env:PORT='3001'; node dist/index.js   # 冒烟：GET /api/health / POST /api/chat / POST /api/report（无 Key 时后两者 503）
```

> 真实 Key 联调只能在临时进程里用环境变量传入（`$env:DEEPSEEK_API_KEY=...`），**不要写进任何文件**，结束后：杀进程、清环境变量、删临时请求/响应用例文件。联调时前端可用 `PERSIST_API_TARGET` 指到该临时端口。

- `npm test`、`npm run build`、`npx playwright test`、`npm run visual:check`、`git push` / `git ls-remote` 在受限文件沙箱下会失败（原生模块加载、Vite `windowsSafeRealPathSync`、Chromium `spawn EPERM`；git 启动 `ssh.exe` 报 `couldn't create signal pipe, Win32 error 5`）→ 需要一次性提权到完整访问权限再执行；`tsc -b` / `oxlint` / `prettier` / 本地 `git add|commit|status|log` 不需要。
- Playwright 的 `webServer` 会自己拉起 4173，**不要**手动先启动；`visual:check` 需要 4173 已有服务（可用 `PERSIST_URL` 覆盖）。
- **`visual:check` 还必须让同源 `/api` 可达**（2026-11-04 实测踩坑）：8b 之后 `/plans` 打开对话框会探测 `/api/health`，后端不在时 Vite 代理返回 502，浏览器记控制台错误 ⇒ 脚本按 `consoleErrors > 0` 判 **exit 1**（截图像素本身没问题）。跑之前先在另一个终端 `cd server; node dist/index.js`（无 Key 也返回 200 `ai:"disabled"`，UI 显示 Mock，与基线一致），跑完再杀进程。
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
- 提交链按主题：`bd779eb`（`chore: initial commit`，262 文件 37.39 MB）→ 步骤 5/6 功能与文档提交（`da787c4` / `128d6a2` / `e3e9730`）→ `d4c9696`（清理死代码与历史制品）→ `style:`（移除 Tailwind 插件并格式化 19 个文件）→ 步骤 7 `feat:`（`a544a38`）→ 步骤 8a `feat:`（`9138175`，服务端骨架）→ 步骤 8b `feat:`（`b99d3ad`，前端接 AI 对话 + 真实 Key 联调）→ 步骤 8c `feat:`（`bdd4265`，AI 报告接服务端 + 真实 Key 联调）→ `docs:` 同步 → `7625865`（`chore:` 重跑 `/reports` 视觉基线）→ 本版 `docs:`（定稿 P4 终态方案并同步相关文档）。**不记提交个数**——写死数字下次提交就过期。
- 每次推送后核对：`git rev-parse HEAD` == `git ls-remote origin refs/heads/main`，且 `git status -sb` 无 ahead/behind。
- 认证已就绪（`ssh -T git@github.com` 返回 `Hi save626!`），**不需要**用户提供 Token / 密码 / 私钥。
- 推送前审计：`git diff --cached --name-only` 过滤 `node_modules/|^app/dist/|test-results|playwright-report|coverage|Water intake record|\.log$|\.tsbuildinfo$|\.local\.md$`。
- 每个阶段结束提交一次（9、10、P4、P5；8a 已于 `9138175`、8b 已于 `b99d3ad`、8c 已于 `bdd4265` 提交），禁止 `git push --force`，禁止重写历史。

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
4. P4 的 SQLite 驱动（`better-sqlite3` native 编译 vs 升级服务器 Node 到 22+ 用 `node:sqlite`）——**终态设计已定稿**（`docs\P4-数据层与AI综合分析设计方案.md` §4，推荐升级 Node 22 用内置 `node:sqlite`），但**驱动选型与是否升级 Node 仍需用户确认**（该文档 §18-1），未确认前不要在 P3 引入数据库。**已定死的部分**：SQLite 单文件库、**不装 MySQL/MariaDB**、不用 ORM、写代码前先做步骤 11（8d 数据历史化）。
5. P4 其余待确认项（P4 方案 §18）：同步默认开/关（建议首次提示一次、可关）、是否接受因真实历史导致的 UI/视觉基线变更、是否要每日 21:00 定时报告（建议默认关）、保留期 365/30/30 天、恢复码格式（32 位 hex vs 分组）、是否接受「未授权的模块对 AI 完全不可见」这条硬规则。
6. 视觉基线版本化策略（`gitignore design/_current/` + 里程碑提交 `design/baseline-<phase>/`）—— 建议 P3 之后再做。
7. 是否补 `.gitignore` 的更多条目（当前已含 `app/dist/`、`test-results/`、`playwright-report/`、`*.local`、`*.local.md`、`*.tmp`、`desktop.ini` 等）。
8. 视觉基线：**已于 2026-11-04 重跑并经用户双端验收通过**（91 张全绿）。步骤 8c 改动 `/reports` 后，该页 6 张基线已单独重跑（各项 0、exit 0）并经用户验收，随 `7625865` 入库，**基线现与代码一致**。后续任何视觉改动仍须重复「先起无 Key 后端 → 跑 `visual:check` → 用户验收 → 单独提交基线」流程。
9. 仓库里仍跟踪着两个写入测试留下的垃圾文件 `app/src/pages/_write-test*.txt`（步骤 8b 之前发现），删除需用户批准。

## 13. 需要主动披露的历史

- `PlansPage.tsx` 曾因 2 参数 `WriteAllText` 被截断丢失（当时无 Git 备份），现版本从 `dist` 产物反解后**等价重写**，已通过类型检查、构建与全量 E2E，但不是原始源码；该版本包含在首个提交 `bd779eb` 中，此后有历史可比对。
- `AppShell`、`TodayPage`、饮食 / 健身 / 学习页曾因条件类名被 Prettier 压平导致状态样式失效（14 处），已用 `cn()` 与完整字符串三元修复；再动这些文件的类名要回归。
- 视觉基线为 2026-11-03 版全量（91 张，经用户桌面端与移动端验收通过）+ 2026-11-04 的 reports 局部重跑（`7625865`），更早已作废。首页截图因实时倒计时永不逐字节稳定，勿当回归证据。
- 持久化交付的是**浏览器本机持久化**，不是"数据安全"：清站点数据、换浏览器、换设备、无痕模式都会丢；已有「清空本机数据」入口（步骤 7），但它只清当前浏览器的这一条记录、不是"恢复出厂设置"更不是跨设备操作。不要对外说成服务端存储或云同步。
- 持久化没有引入 Dexie（原计划写的是 Dexie），原因是沙箱内 `npm install` 受缓存路径 EPERM 限制且当前只有单用户单记录场景；这是主动偏离，记录在 `HANDOFF.md` §13 P2 / §6.6。
- 文档曾出现"提交个数"与"构建体积"写死后自相矛盾的问题（每次提交 / 清理都会让数字失效）；现行规则是：提交只按主题叙述、体积只指向 `HANDOFF.md` §10.3 的实测值。
- 服务器交接信息由用户口头提供并脱敏入库：公网 IP 只在 `.local.md`，root 密码**从未写入任何文件**，需要 SSH 操作时向用户索取或让用户执行。
- 步骤 8b 已用真实 DeepSeek Key 完成端到端联调（`b99d3ad`）：`/api/chat` 200、3.5 s、127 个 SSE 事件；首轮暴露模型给出 2025 年过去日期，修复提示词（注入 Asia/Shanghai 今天）与前端日期兜底后复验为未来日期。步骤 8c 同样用真实 Key 联调（`bdd4265`）：`/api/report` 200、2.7 s；首轮暴露模型**自行做减法**（摘要只有 1.5 L 与 1.0 L，它写出「再补水约 0.5 L」），已把提示词改为「禁止任何数值推算」并复验。**该 Key 已出现在开发对话历史里，上线前必须轮换**；真实 Key 不得写入任何受版本控制的文件。报告的文字可来自 DeepSeek，但指标/依据由前端生成、只有「今日简报」走服务端，不要因此说「报告全部由 AI 生成」；并发/限流/Nginx 下 SSE 与 `/api/report` 长请求需部署后复验。
- 原计划把 P3 请求/响应契约放 `shared/`，实际偏离为 `server/src/contract.ts` 镜像 `app/src/lib/chat-types.ts`（前端冻结，迁 `shared/` 要改 app 构建/tsconfig）；迁移保留到 P3 收尾或 P4（P4 方案 §17 已把「步骤 12 前迁移」记为推荐做法，但仍是技术债，尚未做）。
- P4 终态方案（`docs\P4-数据层与AI综合分析设计方案.md`）是**设计定稿，不是已实现能力**：SQLite 表结构、同步协议、事实包 v2、AI 综合分析契约、备份导出删除、隐私边界都只有文档。在步骤 12–14 落地前，不要对外说「AI 会检索全部历史做综合分析」；当前能做的只有单次窗口的今日简报 + 前端本地指标。
- 方案定稿时确认了一个此前没写进文档的事实：**历史数据本身几乎不存在**（训练历史是页面内演示常量 `HISTORY`、饮食只有今天、饮水无日期、计划项只存当天），所以 P4 的第一步必须是步骤 11（8d 数据历史化）。这也是为什么 P4 从「备份恢复」变成了「数据层 + AI 综合分析」四步拆分。
