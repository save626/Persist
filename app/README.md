# Persist App

Persist 的 React Web 客户端。

## 开发命令

```powershell
npm run dev          # web 构建；只允许 demo / guest，默认 guest
npm run dev:mobile   # mobile 构建；默认 owner（移动端验收用）
npm run lint         # Oxlint
npm run typecheck    # TypeScript 类型检查
npm test             # Vitest 单元测试
npm run test:e2e     # Playwright 端到端测试
npm run format       # Prettier 格式化
npm run build        # web 生产构建；禁止 owner
npm run build:mobile # USB 移动端包；输出 dist-mobile，默认 owner
```

## 工程约定

- 页面路由与全局壳层放在 `src/`。
- 已验收的 v3 视觉样式位于 `src/styles/home-v3.css`，新增共享样式放在 `src/styles/persist.css`。
- 业务数据写入本机浏览器 IndexedDB（原生实现，无 Dexie）：`src/lib/persist-state.ts` 管记录结构与 `schemaVersion` 迁移，`src/lib/persist-storage.ts` 管 open / load / save 与降级；`MockDataProvider` 首挂载水合、200 ms 防抖落盘、`pagehide` / `visibilitychange` 补写，对外 Context 契约不变。
- AI 引导建档已接服务端（步骤 8b）：`src/lib/ai-chat-client.ts` 的 `createAppChatClient({ consent })` 在「档案页开启 AI 数据授权 + `/api/health` 可用」时走同源 `/api/chat`，否则用本地 Mock；SSE 增量解析，**只在首个内容事件前回退**，回退后本次会话不再重试，界面如实标注来源。AI 报告文字也已接服务端（步骤 8c，见下条）。运行模式按 Vite mode 隔离：默认 `npm run dev` / `npm run build` 是 web，只允许 demo / guest；`npm run dev:mobile` / `npm run build:mobile` 是移动端，默认 owner，构建输出 `dist-mobile`。开发时 `/api` 代理指向 `PERSIST_API_TARGET`（默认 `http://127.0.0.1:3000`），Playwright 使用 mobile mode 固定测试 owner 基线，并把 API 指向不可达端口以免 E2E 打到真实后端。
- AI 报告已接服务端（步骤 8c）：`src/lib/ai-report-client.ts` 的 `probeAiReport()` 要求 `/api/health` 返回 `ai:'deepseek'`，`requestAiReport()` POST 同源 `/api/report`；`src/lib/report-types.ts` 镜像服务端契约。**报告只有文字字段来自模型**（`title/status/summary/conclusions/actions/warnings`），指标数字、依据条目、统计区间仍由 `ReportsPage.tsx` 的 `buildDailyReport()` 按本地记录确定性生成；请求只含「已授权 + 设置来源开关打开」的摘要，未授权模块发 `null` 而不是 0/[]。不可用时回退本地 Mock 并显示回退提示、徽标降级；响应不合契约抛 `ReportContractError`、明确报错不伪造报告。**`/api/report` 在 owner 移动端由「今日简报」「训练建议」「饮食观察」「学习观察」共用；三张今日观察卡只在 owner + 授权 + 当日有数据时请求，按日缓存、摘要变化提示重新生成、失败回退本地规则；demo / guest 不请求。**`ReportRecord.origin` 区分 AI / Mock。
- 今日页晨间简报也接服务端（2026-11-04）：摘要构造统一到 `src/lib/report-digest.ts`（报告页与简报共用同一份授权/来源规则），`src/lib/morning-brief.ts` 负责「未授权/无来源不发请求 → `sessionStorage` 按天 + 摘要指纹缓存 → `POST /api/report`（`今日简报` / 7 天）→ `parseReportContent` 校验」；模型只覆盖面板标题与摘要，三个 KPI 与建议节奏仍是本地确定性生成。失败按状态回退并如实标注（「已回退到本机规则，未使用模型输出」），只有拿到合规内容才显示 DeepSeek 来源。
- 跨设备同步（步骤 12d/12e）：`src/lib/sync-*.ts` 六个文件——`sync-contract.ts`（转出 `@persist/shared` 契约）、`sync-client.ts`（`/api/v1/*` 请求与退避）、`sync-queue.ts`（outbox 合并/批次）、`sync-store.ts`（`persist-sync` IndexedDB）、`sync-entities.ts`（切片摊平 / diff / pull LWW + 墓碑 + 形状守卫）、`sync-engine.ts`（bootstrap、5 s 防抖、60 s 兜底、`online`/`visibility` 触发）。**默认关闭，关闭时不发任何同步请求**；开关与恢复码在设置页「数据同步」卡片。服务端 `/api/v1/*` 只在同源可用时生效，**服务端 2026-11-06、前端静态包 2026-11-07 均已部署**，但同步默认关闭，默认路径仍是纯本地。
- 服务端账号导出兼容（步骤 14c，2026-11-10）：`GET /api/v1/export` 返回 `mode: "server-export"` 的 0.3.0 同构信封；`src/lib/mock-data-transfer.ts` 的导入校验已允许空 `reports` 数组，因此空账号导出也能被当前客户端重新导入。该改动不改页面或视觉；端点已于 2026-11-10 部署到生产。14d 的服务端删除端点同样未接前端 UI，设置页不改视觉。
- 服务端综合分析（步骤 13）：`src/lib/analysis-contract.ts` 是前端唯一入口（转出 `@persist/shared/contract/analysis` 的类型与常量，**不另抄一份**），`src/lib/analysis-client.ts` 负责 `/api/v1/analysis/*` 与 `/api/v1/reports*` 请求、四态（模型 / 缓存 / 规则降级 / 未请求）与错误分类（`network|timeout|unauthorized|consent-off|insufficient|invalid|rate-limited|server|invalid-response`）。**服务端分析结果只存在于页面状态与服务端归档，不写进本机 `reports` 数组**，`schemaVersion` 仍是 2、备份仍是 0.3.0。设置页「每日简报」卡片（默认关闭、默认 21:00）写的是本机 `settings.dailyBrief`，**必须开启同步并同步设置后服务端 job 才会读到**；时间非法时回退并提示。
- 改 `MockDataProvider` 的状态切片时必须同步维护持久化记录（`schemaVersion` + 迁移），否则老数据会被判为损坏或丢失；未来版本记录只读不覆盖。
- API Key 不得进入 Web 客户端或 Android 包，后续只能通过 `server/` 代理使用。
- 条件类名请使用 `cn()`（`src/lib/cn.ts`）或「完整字符串三元」，不要依赖条件拼接里的手写空格。历史教训：`prettier-plugin-tailwindcss`（已于 2026-11-03 移除）会把它压平成 `plan-itemdone` 这类错误类名，导致状态样式静默失效。
- 批量格式化要单独成提交：`prettier --write` 后必须比对构建产物哈希并逐像素比对 `design/` 截图 —— Prettier 拆行会给 JSX 文本补 `{' '}` 子节点，可能挪动换行位置（`ReportsPage.tsx` 已踩过一次）。

## 当前页面（2026-11-04 复核）

```text
/          今日          /fitness  健身
/diet      饮食          /study    学习
/plans     长期计划      /profile  个人档案
/reports   AI 报告       /settings 设置
```

主导航固定五项：今日 / 健身 / 饮食 / 学习 / AI 报告。`/plans` 是二级页面，从档案页「AI 建档」、今日页计划区或 `/plans?onboard=1` 深链进入；该页的 AI 对话在授权且服务端可用时调用真实 DeepSeek（标注「DeepSeek 生成 · 经本站服务端代理」），否则使用本地规则式 Mock（标注「本地生成 · Mock 对话」）。`/reports` 的「今日简报」同理：授权 + 服务端可用时经 `/api/report` 生成文字（标注「DeepSeek 生成 · 经本站服务端代理」），否则本地 Mock（标注「本地生成 · Mock 报告」）。今日页「晨间简报」也已接通同一接口：打开面板时按「今日简报 / 7 天」请求，模型写标题与摘要，KPI 与建议节奏仍本地生成，失败/未授权时回退并明确标注。**步骤 13 起 `/reports` 末尾新增「服务端综合分析」块**：选中 7 / 30 / 90 天窗口后点「生成综合分析」→ `POST /api/v1/analysis/reports`，展示模型文字 + 指标卡 + 来源与缓存标记，下方列出服务端归档（`GET /api/v1/reports`）；此项依赖跨设备同步（需要 `syncToken`）且服务端已部署，未就绪时只显示说明、不发请求。设置页新增「每日简报」卡片（默认关闭、默认 21:00）。

测试现状（2026-11-11 owner 三张观察卡接入真实 AI 后复跑）：`npm test` **356 条**单元测试（28 个文件；新增观察卡请求 / 缓存 / 回退、共享报告契约与报告类型提示词相关覆盖），`npx playwright test` 64 用例 × 2 项目 = **128 次执行**（11 个文件、1.2 m；新增 `ai-observations.spec.ts` 1 条 × 2，验证三张卡只发送对应来源摘要），`npm run lint` **0 错 0 警告**、`npm run typecheck` 通过，`npm run build` web JS `index-4QYRMEYg.js` 656116 B（gzip 194.49 kB）、`npm run build:mobile` JS `index-D3qP8Eox.js` 656112 B（gzip 194.49 kB），CSS 均为 `index-BGlBBerF.css` 145428 B（gzip 24.90 kB）。`npm run visual:check` 生成 15 状态 × 6 视口 = 90 张 + 快速记录 1 张 = 91 张；`overflow / missingElements / missingDialogs / failures` 全 0。demo / guest 已于 2026-11-11 双端验收；owner 观察卡文案待真机验收，截图未提交。构建产物过 500 kB 的 Vite 警告仍在，`/plans` 尚未拆分懒加载。验证细节见仓库根目录 `HANDOFF.md`。

> **`visual:check` 的前置条件**：owner 视觉基线必须先用 `npm run dev:mobile -- --port 4173` 启动 mobile 开发服务；web 默认 guest，不能用于 owner 截图。脚本只连接已在运行的 4173，**自己不启动后端**。步骤 8b 之后 `/plans` 会先探测 `/api/health`，步骤 8c 之后 `/reports` 同样探测，所以跑之前要另开终端起本机后端 `cd ../server; node dist/index.js`（无 Key 也会返回 200 `ai:"disabled"`，页面显示 Mock，与基线一致）。后端不在时 Vite 代理返回 502，浏览器把每个 `/plans`、`/reports` 状态记控制台错误 ⇒ 脚本按 `consoleErrors > 0` 判失败（exit 1，截图像素本身没问题）。

## 待办（按顺序）

1. 步骤 9 ✅ 已完成（2026-11-04）：IP 直连部署（本地 build 上传 `app/dist` + Nginx 深链/反代/gzip + systemd + 真实 Key 只存服务器），8 页深链、SSE、`/api/report` 与限流均实测通过；晨间简报接入后已重新部署。**步骤 10 当前状态（2026-11-09）**：Node 22、步骤 12/13 部署与前端产物上传均已完成（未走 3100 端口预演）；剩余 SSH 仅密钥 + `fail2ban`、删安全组 3389（后者需用户在阿里云控制台操作）。**只有域名解析 / 443 / 证书 / 页脚备案号等备案号**。备案进度：阿里云初审 ✅ 2026-11-04，管局审核中（实际状态以阿里云控制台为准）。完整计划见 `HANDOFF.md` §0.4 / §13.3，服务器与部署约束见 `docs/部署与服务器现状.md` §6。
2. **步骤 11（8d）数据历史化** —— ✅ 已完成（2026-11-04）：`schemaVersion` 2、训练真实历史、饮食/饮水/计划按日台账、备份 0.3.0。
3. **步骤 12（P4a）账号 + 增量同步** —— ✅ 本机完成并验收（2026-11-05，12a–12f）：客户端同步层 + 设置页「数据同步」卡片；**已推送；服务端 2026-11-06 已部署、前端「数据同步」卡片 2026-11-07 已上传**（服务器已升 Node v22.19.0）。
4. **步骤 13（P4b）服务端聚合 + AI 综合分析** —— ✅ 本机完成并验证（2026-11-05，**已推送（`41ed92f` / `82ed773` / `40d2bf4` / `7f13727` / `18d5f77` / `5ba4f7e`）、服务端 2026-11-06 + 前端产物 2026-11-07 均已部署**）：服务端 SQL 聚合事实包 + 四个 `/api/v1` 接口 + 每日简报 job；前端 `/reports`「服务端综合分析」块（7/30/90 天、四态、归档列表）与设置页「每日简报」卡片（默认关闭、21:00）。**已随 2026-11-06 切换部署**（步骤 10 A 段升 Node v22.19.0）。
5. 步骤 14（备份 / 恢复 / 导出 / 删除账号）：14a 每日备份已在生产启用；14b 恢复、14c 导出、14d 删除账号与备份列表 / 手动创建端点均已在本机实现并验证，并于 2026-11-10 部署到生产。14d 的「先删服务端、成功后清本机」入口已在本机接线，待双端验收；本机「清空本机数据」仍是独立入口。设计见 `docs/P4-数据层与AI综合分析设计方案.md` §12。

已完成（2026-11-05）：

- 步骤 13 前端（13b/13c，`82ed773` / `40d2bf4` 已推送；服务端 2026-11-06 + 前端块 2026-11-07 均已部署）：新增 `src/lib/analysis-contract.ts`（唯一入口）与 `src/lib/analysis-client.ts`（请求 / 四态 / 9 类错误分类）；`ReportsPage` 末尾「服务端综合分析」块（窗口切换、生成、指标卡、来源与 `cached` 标记、归档列表与详情），服务端结果**不写入本机报告数组**；`SettingsPage` 新增「每日简报」卡片（默认关闭、`DAILY_BRIEF_AT` 默认 21:00，非法时间回退并提示，文案说明需先开启同步）；`MockDataProvider` 对外暴露 `syncToken`；**未改 `schemaVersion`（仍 2）与备份格式（仍 0.3.0）**。E2E 新增 `e2e/reports-analysis.spec.ts` 4 条用例（mock `/api/v1/**`）。

- 步骤 12 客户端同步层（12d，`9abd8bb`）：新增 `src/lib/sync-{contract,client,queue,store,entities,engine}.ts` 与 62 条单测；outbox 合并、bootstrap/增量、LWW + 墓碑合并、形状守卫；设置页「数据同步」卡片（12e，`f09c3da`）含开关、恢复码、绑定已有账号、吊销本机，E2E 加 2 条 mock `/api/v1/**` 用例。
- 步骤 11（8d，2026-11-04）：`schemaVersion` 2 迁移、训练真实历史（删演示常量）、饮食/饮水/计划按日台账、备份 0.3.0、报告按近 7/30/90 天窗口汇总。

已完成（2026-11-04）：

- lint 清理（`f5a57f5`）：新增 `src/lib/use-new-record-param.ts`（`?new=1` 深链直接从地址栏派生弹层展开状态，`clear()` 以 `replace` 去掉参数）+ 4 条单测；`FitnessPage` / `DietPage` / `StudyPage` 改为 `本地状态 || active` 并把关闭、遮罩、保存、删除统一走 `closeXxx()`，消除 3 条 `react(set-state-in-effect)` 警告；E2E 深链用例扩到断言「关闭后 URL 回 `/study`、再点按钮可重开」；同时删除误提交的 3 个 `src/pages/_write-test*.txt`。零样式改动、未改 IndexedDB/备份格式、未改服务端。
- 今日页晨间简报接入真实 AI（`9f9cc71`）：新增 `src/lib/report-digest.ts`（摘要唯一入口，报告页同步改用它）+ `src/lib/morning-brief.ts`（授权校验、按天/摘要指纹缓存、失败分流、诚实文案）与 19 条单测；`MorningBriefSheet` 打开时请求 `/api/report`，模型只写标题与摘要，KPI 与建议节奏仍本地生成；未改样式类、未改 IndexedDB/备份格式、未改服务端。
- 步骤 8c AI 报告接服务端：新增 `src/lib/ai-report-client.ts` + `src/lib/report-types.ts`（探活、POST `/api/report`、`ReportUnavailableError` / `ReportContractError` 分流、响应再校验）与 10 条单测；`ReportsPage.tsx` 只在 AI 可用时用模型文字覆盖报告散文、指标与依据仍本地生成，回退/报错/来源标注齐全，删除「模拟失败」按钮；`types.ts` 加 `ReportRecord.origin`；`reports.css` 一行回退提示颜色；E2E 补 Mock 徽标与详情说明断言。同日以真实 DeepSeek Key 完成端到端联调（200 / 2.7 s），并修复模型擅自做数值推算的问题（提示词禁止任何算术）。
- 步骤 8b 前端接入 AI 对话：新增 `src/lib/ai-chat-client.ts`（SSE 增量解析、健康探测、真实/Mock 组合与回退语义）与 13 条单测；`PlanChatSheet` 按授权切换客户端并如实标注来源；`PlansPage` 文案同步；`vite.config.ts` 加 `/api` 开发代理；`playwright.config.ts` 用不可达端口隔离真实后端并新增回退 E2E。同日以真实 DeepSeek Key 完成端到端联调（200 / 3.5 s / 127 个 SSE 事件），并修复模型返回过去日期的问题（提示词注入当天日期 + 前端日期兜底）。
- 步骤 7 清空本机数据：设置页危险区第二张卡片 + 中文二次确认 + toast，`clearLocalData()` 停写回 → 掐防抖 → 删记录 → 重置内存态与快照 → 恢复写回。

- 步骤 6 本机持久化：新增 `src/lib/persist-state.ts`、`src/lib/persist-storage.ts`，`MockDataProvider` 水合 + 防抖落盘，`mock-data-transfer.ts` 抽出 `parseMockBackupValue()` 共用校验；`e2e/persistence.spec.ts` 与 `persist-state.test.ts` 覆盖刷新恢复、版本迁移与损坏降级。文案同步改为「已保存在本机浏览器（IndexedDB）」。
- Git 提交链已全部推送（`github.com/save626/Persist`，公开仓库）：起于 `bd779eb`（262 文件 37.39 MB），后续为步骤 5/6 功能与文档提交、`d4c9696` 清理、`style:` 格式化及若干 `docs:` 同步；提交前删除了仓库根目录 `$null` 与 `app/$null` 两个误建文件。
- `SettingsPage.exportMockData()` 已改调 `serializeMockBackup()`，导出 0.2.0 且含 `longTermPlans`，导入 toast 报记录数与计划数；round-trip 单测与导出/导入 E2E 已覆盖。
- `scripts/visual-check.mjs` 已纳入 `/plans` 五个状态，视口扩到 6 个（新增 421×926 真机参考），并新增「档案页必须可见 AI 建档」断言。
- 全站弹窗统一垂直居中；窄屏保留档案页「AI 建档」入口（`.profile-onboard-action`）。
