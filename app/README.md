# Persist App

Persist 的 React Web 客户端。

## 开发命令

```powershell
npm run dev          # 本地开发服务器
npm run lint         # Oxlint
npm run typecheck    # TypeScript 类型检查
npm test             # Vitest 单元测试
npm run test:e2e     # Playwright 端到端测试
npm run format       # Prettier 格式化
npm run build        # 生产构建
```

## 工程约定

- 页面路由与全局壳层放在 `src/`。
- 已验收的 v3 视觉样式位于 `src/styles/home-v3.css`，新增共享样式放在 `src/styles/persist.css`。
- 业务数据写入本机浏览器 IndexedDB（原生实现，无 Dexie）：`src/lib/persist-state.ts` 管记录结构与 `schemaVersion` 迁移，`src/lib/persist-storage.ts` 管 open / load / save 与降级；`MockDataProvider` 首挂载水合、200 ms 防抖落盘、`pagehide` / `visibilitychange` 补写，对外 Context 契约不变。
- AI 引导建档已接服务端（步骤 8b）：`src/lib/ai-chat-client.ts` 的 `createAppChatClient({ consent })` 在「档案页开启 AI 数据授权 + `/api/health` 可用」时走同源 `/api/chat`，否则用本地 Mock；SSE 增量解析，**只在首个内容事件前回退**，回退后本次会话不再重试，界面如实标注来源。AI 报告文字也已接服务端（步骤 8c，见下条）。开发时 `npm run dev` 的 `/api` 代理指向 `PERSIST_API_TARGET`（默认 `http://127.0.0.1:3000`），Playwright 固定指向不可达端口以免 E2E 打到真实后端。
- AI 报告已接服务端（步骤 8c）：`src/lib/ai-report-client.ts` 的 `probeAiReport()` 要求 `/api/health` 返回 `ai:'deepseek'`，`requestAiReport()` POST 同源 `/api/report`；`src/lib/report-types.ts` 镜像服务端契约。**报告只有文字字段来自模型**（`title/status/summary/conclusions/actions/warnings`），指标数字、依据条目、统计区间仍由 `ReportsPage.tsx` 的 `buildDailyReport()` 按本地记录确定性生成；请求只含「已授权 + 设置来源开关打开」的摘要，未授权模块发 `null` 而不是 0/[]。不可用时回退本地 Mock 并显示回退提示、徽标降级；响应不合契约抛 `ReportContractError`、明确报错不伪造报告。**只有「今日简报」走服务端**，`训练建议` / `学习观察` 仍打开本地已有报告；`ReportRecord.origin` 区分 AI / Mock。
- 今日页晨间简报也接服务端（2026-11-04）：摘要构造统一到 `src/lib/report-digest.ts`（报告页与简报共用同一份授权/来源规则），`src/lib/morning-brief.ts` 负责「未授权/无来源不发请求 → `sessionStorage` 按天 + 摘要指纹缓存 → `POST /api/report`（`今日简报` / 7 天）→ `parseReportContent` 校验」；模型只覆盖面板标题与摘要，三个 KPI 与建议节奏仍是本地确定性生成。失败按状态回退并如实标注（「已回退到本机规则，未使用模型输出」），只有拿到合规内容才显示 DeepSeek 来源。
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

主导航固定五项：今日 / 健身 / 饮食 / 学习 / AI 报告。`/plans` 是二级页面，从档案页「AI 建档」、今日页计划区或 `/plans?onboard=1` 深链进入；该页的 AI 对话在授权且服务端可用时调用真实 DeepSeek（标注「DeepSeek 生成 · 经本站服务端代理」），否则使用本地规则式 Mock（标注「本地生成 · Mock 对话」）。`/reports` 的「今日简报」同理：授权 + 服务端可用时经 `/api/report` 生成文字（标注「DeepSeek 生成 · 经本站服务端代理」），否则本地 Mock（标注「本地生成 · Mock 报告」）。今日页「晨间简报」也已接通同一接口：打开面板时按「今日简报 / 7 天」请求，模型写标题与摘要，KPI 与建议节奏仍本地生成，失败/未授权时回退并明确标注。

测试现状（2026-11-04 晨间简报接入真实 AI 后）：`npm test` **168 条**单元测试（12 个文件，含 `src/lib/report-digest.test.ts` 6 条、`src/lib/morning-brief.test.ts` 13 条），`npx playwright test` 51 用例 × 2 项目 = **102 次执行**（0 跳过、53.5 s），`npm run visual:check` 15 状态 × 6 视口 = 90 张 + 快速记录 1 张 = 91 张截图（最近一次重跑未起后端：生成 91 张、`overflow/missing*` 全 0，`reports` 与 `plans-ai` 共 12 条 502 属前置条件未满足；`design/` 仅首页实时日期漂移，已还原未入库）。验证细节与已知问题见仓库根目录 `HANDOFF.md`。

> **`visual:check` 的前置条件**：脚本只连接已在运行的 4173，**自己不启动后端**。步骤 8b 之后 `/plans` 会先探测 `/api/health`，步骤 8c 之后 `/reports` 同样探测，所以跑之前要另开终端起本机后端 `cd ../server; node dist/index.js`（无 Key 也会返回 200 `ai:"disabled"`，页面显示 Mock，与基线一致）。后端不在时 Vite 代理返回 502，浏览器把每个 `/plans`、`/reports` 状态记控制台错误 ⇒ 脚本按 `consoleErrors > 0` 判失败（exit 1，截图像素本身没问题）。

## 待办（按顺序）

1. 步骤 9 ✅ 已完成（2026-11-04）：IP 直连部署（本地 build 上传 `app/dist` + Nginx 深链/反代/gzip + systemd + 真实 Key 只存服务器），8 页深链、SSE、`/api/report` 与限流均实测通过；晨间简报接入后已重新部署。下一步是拿到备案号后的步骤 10（域名 + HTTPS）；等待期默认推进步骤 11（8d 数据历史化）。备案进度：阿里云初审 ✅ 2026-11-04，2026-11-05 提交管局。完整计划见 `HANDOFF.md` §0.4 / §13 P3，服务器与部署约束见 `docs/部署与服务器现状.md`。
2. 步骤 11–14（P4）：先做 8d 数据历史化（训练真实历史、饮食/饮水/计划按日台账、`schemaVersion` 1→2、备份 0.3.0），再做设备令牌 + 增量同步、服务端聚合 + AI 综合分析、备份/恢复/导出/删除；前端侧改动集中在 `types.ts`、`persist-state.ts` 迁移、`FitnessPage`/`DietPage`/`HomePage` 历史读取与设置页同步区块。设计见 `docs/P4-数据层与AI综合分析设计方案.md` §6–§7。

已完成（2026-11-04）：

- 今日页晨间简报接入真实 AI（`9f9cc71`）：新增 `src/lib/report-digest.ts`（摘要唯一入口，报告页同步改用它）+ `src/lib/morning-brief.ts`（授权校验、按天/摘要指纹缓存、失败分流、诚实文案）与 19 条单测；`MorningBriefSheet` 打开时请求 `/api/report`，模型只写标题与摘要，KPI 与建议节奏仍本地生成；未改样式类、未改 IndexedDB/备份格式、未改服务端。
- 步骤 8c AI 报告接服务端：新增 `src/lib/ai-report-client.ts` + `src/lib/report-types.ts`（探活、POST `/api/report`、`ReportUnavailableError` / `ReportContractError` 分流、响应再校验）与 10 条单测；`ReportsPage.tsx` 只在 AI 可用时用模型文字覆盖报告散文、指标与依据仍本地生成，回退/报错/来源标注齐全，删除「模拟失败」按钮；`types.ts` 加 `ReportRecord.origin`；`reports.css` 一行回退提示颜色；E2E 补 Mock 徽标与详情说明断言。同日以真实 DeepSeek Key 完成端到端联调（200 / 2.7 s），并修复模型擅自做数值推算的问题（提示词禁止任何算术）。
- 步骤 8b 前端接入 AI 对话：新增 `src/lib/ai-chat-client.ts`（SSE 增量解析、健康探测、真实/Mock 组合与回退语义）与 13 条单测；`PlanChatSheet` 按授权切换客户端并如实标注来源；`PlansPage` 文案同步；`vite.config.ts` 加 `/api` 开发代理；`playwright.config.ts` 用不可达端口隔离真实后端并新增回退 E2E。同日以真实 DeepSeek Key 完成端到端联调（200 / 3.5 s / 127 个 SSE 事件），并修复模型返回过去日期的问题（提示词注入当天日期 + 前端日期兜底）。
- 步骤 7 清空本机数据：设置页危险区第二张卡片 + 中文二次确认 + toast，`clearLocalData()` 停写回 → 掐防抖 → 删记录 → 重置内存态与快照 → 恢复写回。

- 步骤 6 本机持久化：新增 `src/lib/persist-state.ts`、`src/lib/persist-storage.ts`，`MockDataProvider` 水合 + 防抖落盘，`mock-data-transfer.ts` 抽出 `parseMockBackupValue()` 共用校验；`e2e/persistence.spec.ts` 与 `persist-state.test.ts` 覆盖刷新恢复、版本迁移与损坏降级。文案同步改为「已保存在本机浏览器（IndexedDB）」。
- Git 提交链已全部推送（`github.com/save626/Persist`，公开仓库）：起于 `bd779eb`（262 文件 37.39 MB），后续为步骤 5/6 功能与文档提交、`d4c9696` 清理、`style:` 格式化及若干 `docs:` 同步；提交前删除了仓库根目录 `$null` 与 `app/$null` 两个误建文件。
- `SettingsPage.exportMockData()` 已改调 `serializeMockBackup()`，导出 0.2.0 且含 `longTermPlans`，导入 toast 报记录数与计划数；round-trip 单测与导出/导入 E2E 已覆盖。
- `scripts/visual-check.mjs` 已纳入 `/plans` 五个状态，视口扩到 6 个（新增 421×926 真机参考），并新增「档案页必须可见 AI 建档」断言。
- 全站弹窗统一垂直居中；窄屏保留档案页「AI 建档」入口（`.profile-onboard-action`）。
