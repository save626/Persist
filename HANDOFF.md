# Persist 项目完整交接文档

> 文档日期：2026-11-04（P4 终态设计方案定稿 + 步骤 8c 收尾后更新：步骤 3–8c 已完成并经用户验收；`bd779eb`/`da787c4`/`e3e9730`/`128d6a2`/`d4c9696`/`style:`/`a544a38`/`9138175`/`b99d3ad`/`bdd4265`/`7625865` 均已推送到 `github.com/save626/Persist`；步骤 8b 与 8c 均用真实 DeepSeek Key 完成端到端联调；`/reports` 视觉基线已按 8c 变更重跑并验收）  
> 工作区：`D:\Persist`  
> 应用目录：`D:\Persist\app`  
> 当前阶段：**八个页面（含 `/plans` 长期计划页）与既有 Mock 交互已完成；AI 引导建档 → 长期计划草案 → 确认启用 → 归档/重启的页面闭环已打通；设置页 JSON 导出导入已切到备份 0.2.0（含 `longTermPlans`，兼容 0.1.0 旧备份）；全页面视觉复核已完成 15 个状态 × 6 个视口（含 20:9 真机视口 421×926），全站弹窗统一居中且档案页「AI 建档」在窄屏可见；业务数据已写入本机浏览器 IndexedDB（刷新 / 关标签页 / 重开浏览器不丢，含长期计划，§6.6），并已提供设置页「清空本机数据」入口（删记录 → 重置内存态 → 清快照，二次确认）；服务端 P3 已完成 8a（Fastify + SSE `/api/chat`，`9138175`）、8b（前端接入 + Mock 诚实回退 + 真实 Key 联调，`b99d3ad`）与 8c（`POST /api/report` + 报告页真实生成 + 真实 Key 联调，`bdd4265`），前端对话与报告文字在「开启 AI 数据授权 + 服务端可用」时经本站代理调用 DeepSeek、不可用时如实回退；单元 149 条（app）+ 58 条（server）、E2E 102 次执行全部通过；Git 提交链已全部推送到 GitHub，仓库具备回滚基线。**P4 方向已由用户拍板为「本地优先 + 服务端可检索副本」的终态架构，设计方案已定稿在 `docs/P4-数据层与AI综合分析设计方案.md`**：先做 8d 数据历史化（步骤 11），再做同步与账号（步骤 12 / P4a）、服务端聚合 + AI 综合分析（步骤 13 / P4b）、备份恢复与导出删除（步骤 14 / P4c），最后才是 Android（P5）。下一步顺序见 §0.4：步骤 9 部署（`/reports` 基线已重跑并验收，无前置）→ 步骤 10 备案后域名 + HTTPS，8d/P4 可在备案等待期并行开发。服务端数据库、真实备份恢复和 Android 发布尚未开始（数据库设计见 P4 方案文档）。**  
> 本地验收地址：`http://127.0.0.1:4173/`（`cd app` 后 `npm run dev -- --port 4173`；需要手机访问时加 `--host 0.0.0.0`，见第 11 节）  
> 当前技术形态：React SPA + 浏览器本机 IndexedDB 持久化（原生实现，未用 Dexie）+ Fastify 服务端 DeepSeek 代理（AI 建档对话与 AI 报告文字已接真实模型，报告指标/依据与本地兜底规则仍为前端生成）  
> 本文档地位：当前代码实现优先于旧版规划文档；如文档与代码冲突，以 `D:\Persist\app` 中的实现为准。

---

## 0. 一页交接摘要

### 0.1 现在是什么状态

Persist 目前已经是一个可完整点击验收的前端高保真应用，AI 建档对话与 AI 报告都已接真实 DeepSeek（不可用时回退本地 Mock 并如实标注，见下）：

- 八个页面均可访问：今日、健身、饮食、学习、个人档案、AI 报告、设置、长期计划（`/plans`）。
- 主导航已按要求调整为五项：**今日 / 健身 / 饮食 / 学习 / AI 报告**；长期计划从档案页「AI 建档」入口与今日页的计划区进入。
- AI 报告可从桌面主导航、移动底部导航、今日页头部和学习页分析依据入口进入，不再依赖学习板块作为唯一入口。
- 健身动作名称可以自由输入，也可记录跑步、跳绳、骑行、足球、爬山等非专业训练、非力量运动。
- 今日、健身、饮食、学习、档案、AI 报告、设置和长期计划之间存在跨页面数据联动，且这些数据会一起持久化到本机。
- 已提供一份完整演示数据，可覆盖主要 Mock 交互和跨模块分析流程。
- AI 引导建档闭环已可用：中文自由描述 → 规则提取档案字段 → 最多两次追问 → 计划草案（周目标 / 里程碑 / 假设 / 冲突警告）→ 用户确认 → 写回档案并启用长期计划，旧计划自动归档。
- 已接入本机持久化（步骤 6，2026-11-03）：饮水、学习记录、餐食、训练会话、档案、设置、授权、复盘、报告、快照与长期计划都会写入浏览器 IndexedDB，刷新、关闭标签页、重开浏览器后不再丢失。实现为原生 IndexedDB 封装（`lib/persist-storage.ts`）＋带 `schemaVersion` 迁移的纯函数记录层（`lib/persist-state.ts`），**没有引入 Dexie 运行时依赖**；`MockDataProvider` 的 Context 契约与 13 个状态切片完全不变。
- 自动化验证已通过（2026-11-04 步骤 8c 后复跑）：类型检查 0 错、**149 个单元测试**（10 文件）、51 条 Playwright 用例 × 2 个项目 = **102 次执行全部通过（0 跳过）**、生产构建（`index-DmnjkjkL.js` 564.70 kB / gzip 168.01 kB，`index-CrJgYfMj.css` 137.71 kB / gzip 23.82 kB）。视觉检查最近一次全量重跑是 **2026-11-04 步骤 8b 后**（15 状态 × 6 视口 = 90 张 + 快速记录 1 张，各项 0，exit 0；77 张基线 png 更新），用户桌面端与移动端已验收通过；**8c 改了 `/reports` 的徽标、服务卡片与生成面板文案后，reports 相关基线已单独重跑（6 张 png 更新，各项 0、exit 0）并经用户双端验收通过，随 `7625865` 提交推送**（见 §10.5）。**注意运行前提**：8b 之后 `/plans` 会探测 `/api/health`，`visual:check` 不自己启动后端，必须先让同源 `/api` 可达（起一个无 Key 的本机后端即可），否则 Vite 代理的 502 会让脚本按控制台错误判失败，详见 §10.5。完整基线见 `docs/项目现状总览.md` §3。
- 步骤 8b 已接入真实 AI 对话（2026-11-04，`b99d3ad`）：新增 `app/src/lib/ai-chat-client.ts`（浏览器 fetch 流式解析 SSE、`probe()` 健康探测、首个内容事件前允许回退、回退后不重试），`PlanChatSheet` 按 `profile.aiConsent` 选择「DeepSeek 经本站代理」或「本地 Mock」，副标题与回退提示如实标注来源；Vite 开发服务器代理 `/api` → `127.0.0.1:3000`，Playwright 把 `PERSIST_API_TARGET` 指向不可达端口以保证 E2E 不触真实后端。**已用真实 DeepSeek Key 完成端到端联调**（本机临时进程，Key 只经进程环境变量传入，未写入任何文件/构建产物）。
- 步骤 8c 已把 AI 报告接到服务端（2026-11-04，`bdd4265`）：服务端新增 `POST /api/report`（非流式 JSON，25 s 超时、与 `/api/chat` 共用限流、客户端断开 499）与报告净化 `ai/report.ts`；前端新增 `app/src/lib/ai-report-client.ts`，`/reports` 打开时先探 `/api/health`，可用才经服务端生成文字结论，**指标数字、依据条目、统计区间仍由前端按本地记录确定性生成**；不可用/失败/契约错误分别走「回退本地 Mock 并如实标注」「明确报错、不伪造报告」。发送内容只含「已授权 + 设置里来源开关打开」的摘要，未授权模块在 `digest` 中为 `null`。**已用真实 Key 验证**：完整摘要 2.7 s 返回中文简报；只授权学习时报告完全不出现训练/饮食；真实调用曾出现「按 1.5−1.0 推算出再补水 0.5 L」这类未授权数字，已把提示词改为**禁止任何数值推算**并复验通过。
- 已通过用户桌面端与移动端视觉验收（2026-11-03）：八个页面与全部弹窗在 1440 / 500 / 430 / 421 / 390 / 360 六个视口下无横向溢出、弹窗统一居中，基线截图见 `design/`（15 状态 × 6 视口 + 快速记录浮层 = 91 张）。
- Git 提交链已**全部推送**（2026-11-04）：分支 `main`，远端 `git@github.com:save626/Persist.git`（**公开仓库**）。链上按主题为：`bd779eb`（`chore: initial commit`，262 文件 37.39 MB）→ 步骤 5/6 的文档与功能提交（`da787c4` / `128d6a2` / `e3e9730`）→ `d4c9696`（清理死代码与历史制品）→ `style:`（移除 `prettier-plugin-tailwindcss` 并格式化）→ `a544a38`（步骤 7 清空入口）→ `9138175`（步骤 8a 服务端骨架）→ `b99d3ad`（步骤 8b 前端接入与真实 Key 联调）→ `bdd4265`（步骤 8c AI 报告接服务端）→ 其后多次 `docs:` 同步。每次推送后都核对远端 `refs/heads/main` 与本地 HEAD 一致，当前工作区干净（`## main...origin/main`）。仓库根目录误建的 `$null` 与 `app/$null` 两个垃圾文件已在首次提交前删除。
- **服务器已就绪，但代码尚未部署**（2026-11-04）：阿里云 ECS 2 核 2 GiB（华东1 杭州，Alibaba Cloud Linux 3.2104，包管理器 `dnf`），已装 Node.js v20.20.2 + npm 10.8.2 + Nginx 1.24.0，安全组已开放 22/80，`http://<IP>` 可访问 Nginx 默认页；443 未开、域名 `wpersist.top` 已购买且实名认证通过（**ICP 备案：阿里云初审已于 2026-11-04 通过，计划 2026-11-05 提交省通信管理局审核，尚未下发备案号 ⇒ 仍属备案中，域名不能对外服务**）、机器上没有任何项目代码（`server/` P3 代码只在仓库与本地）。部署架构、规格约束（2 GiB 不在服务器构建前端、3 Mbps 流量计费需 gzip+长缓存、SPA 深链回退、`/api` 反代 127.0.0.1:3000）、Nginx 草案与命令速查见 **`docs/部署与服务器现状.md`**（公开仓库，公网 IP 已脱敏，真实值在本机 `docs/部署与服务器现状.local.md`，由 `.gitignore` 的 `*.local.md` 排除）。

### 0.2 现在不是什么状态

以下内容尚未实现，不能误认为已经具备生产能力：

- 数据只保存在**当前浏览器**的 IndexedDB：清除站点数据、换浏览器 / 换设备、无痕模式都会丢；没有账号与跨设备同步。
- 没有服务端数据库，也没有 SQLite。P3 的 DeepSeek 代理是无状态转发（`server/`，2026-11-04 完成 8a/8b/8c）；P4 终态设计已定稿在 `docs/P4-数据层与AI综合分析设计方案.md`（本地优先 + 服务端可检索副本），但**尚未实施**：驱动选型待定（服务器 Node 20 没有内置 `node:sqlite`，需升级 Node 或 native 编译 `better-sqlite3`，见该文档 §4 与 §18）。
- **历史数据本身还不完整**：目前只有学习记录带 `date` 是真实历史；健身「历史」是 `FitnessPage.tsx` 的演示常量，饮食只有「今天」的 `meals`，饮水没有日期，计划项只存当天。因此 P4 的第一步是 8d 数据历史化（步骤 11），不是先接数据库——详见 P4 设计方案 §1/§6。
- 没有登录、账号、同步、多设备或冲突处理；同一浏览器的两个标签页同时编辑以最后写入为准，没有跨标签页广播。
- AI 报告已有真实路径：授权 + 服务端可用时经 `/api/report` 让 DeepSeek 写文字结论，指标与依据仍由前端按本地记录生成；服务端不可用时回退本地 Mock 并在报告页明确标注（步骤 8c，见 §9.1）。
- 前端已接入服务端 API（步骤 8b/8c）：AI 建档对话在「档案页开启 AI 数据授权 + 服务端 `/api/health` 可用」时经本站 `/api/chat` 调用 DeepSeek；AI 报告在同样前提下经 `/api/report` 生成；否则自动使用本地 Mock 并在界面明确标注「本地生成 · Mock 对话 / Mock 报告」。服务端只有按 IP 限流，没有账号鉴权；Key 管理、缓存与部署尚未落生产。
- 没有真实快照恢复；当前“快照”仅记录生成时间和记录数量，但它会随持久化一起保存。
- 没有 Capacitor Android 工程，也没有 APK 或真机测试。
- 提醒只在界面中配置，不会触发系统通知。
- 饮食照片只保存文件名 Mock，不上传、不识别（文件名列表随本机数据保存）。
- 健身“最近训练历史”仍是力量训练专用结构，自由运动联动覆盖当前会话、今日页和报告，历史详情尚未全面通用化。
- 长期计划已随本机数据持久化；JSON 备份仍只能手动导出 / 导入文件（含长期计划），不会自动备份，也没有“从备份恢复”按钮；导入会整体替换本机数据且没有撤销。
- 已提供“清空本机数据”入口（步骤 7，2026-11-03）：设置页第二张危险区卡片可一键删除本机 IndexedDB 记录并把内存态还原到首次启动基线（含快照、长期计划），带中文二次确认与 toast；顺序为先停写回并掐掉 200 ms 防抖定时器、再删记录、重置内存态、最后恢复写回。设置页原有的“清空设置”仍只重置设置项，两者文案已明确区分。
- AI 建档在本地规则引擎（Mock）之外已有真实路径：开启授权且服务端可用时走 DeepSeek（8b，`b99d3ad`），不可用时回退本地规则引擎并如实标注；AI 报告同样在 8c 接了真实路径（`bdd4265`），失败时回退本地 Mock 并标注。

### 0.3 优先事项摘要（详细执行计划见 §0.4）

1. **步骤 8（代码完成，待部署验收）**：P3 服务端 AI 代理——8a 服务端骨架（`9138175`）、8b 前端接入 + 真实 Key 联调（`b99d3ad`）、8c AI 报告接服务端（`bdd4265`）均已完成，app 149 条单测 / server 58 条单测 / 102 次 E2E 全绿；**下一步是步骤 9 部署**（备案通过前只做 IP 直连，不做域名/证书）。
2. **步骤 9**：IP 直连首次部署（本地构建上传 + Nginx 深链回退/反代/gzip + systemd）。
3. **步骤 10**：备案号下发后域名 + HTTPS + 服务器安全加固（当前备案进度：阿里云初审已通过 2026-11-04，计划 2026-11-05 提交管局审核）。
4. **步骤 11（8d）数据历史化**：把训练 / 饮食 / 饮水 / 计划从「只有今天」升级为按日台账 + 真实训练历史（`schemaVersion` 1→2、备份 0.3.0），这是 P4 综合分析的前置条件；设计与验收标准见 `docs/P4-数据层与AI综合分析设计方案.md` §6。
5. **步骤 12–14（P4a/P4b/P4c）终态数据层与 AI 综合分析**：SQLite 副本 + 设备令牌增量同步 → 服务端聚合 + AI 综合分析（7/30/90 天、缓存、规则降级）→ 备份 / 恢复 / 导出 / 删除账号；终态方案见同一份 P4 设计方案文档（明确不装 MySQL/MariaDB）。
6. 之后：Capacitor Android 打包与真机验证（P5）。
7. 贯穿性技术债：清理 3 条 lint 警告、按路由拆包（`/plans` 懒加载）、补足纯业务单元测试、把 `sync`/`analysis` 契约迁到 `shared/`。

### 0.4 下一步执行计划（2026-11-04 更新，按此顺序做）

| 步骤 | 目标 | 主要改动 | 验收标准 |
|---|---|---|---|
| **步骤 3** ✅ 已完成（2026-11-03） | JSON 导出导入升到备份 0.2.0 | `SettingsPage.exportMockData()` 已改调 `serializeMockBackup()`；文件名带日期；导入 toast 显示计划数；`mock-data-transfer.test.ts` 加 round-trip；`mock-data-flows.spec.ts` 覆盖导出/导入 | 导出 JSON `version: '0.2.0'` 且含 `longTermPlans`；0.1.0 与 0.2.0 备份都能导入；单测 112 条 + E2E 92 次执行全绿 |
| **步骤 4** ✅ 已完成（2026-11-03） | 全页面视觉复核 | `scripts/visual-check.mjs` 已纳入 `/plans` 空态 / 进行中 / 草案 / AI 对话 / 确认弹窗；视口 1440/500/430/421/390/360；全站弹窗统一居中；窄屏保留档案页「AI 建档」入口 | 已产出 91 张截图并由用户桌面端 + 移动端明确通过 |
| **步骤 5** ✅ 已完成（2026-11-03） | 建立首个 Git 提交 | 提交前删除了根目录 `$null` 与 `app/$null` 垃圾文件；`core.quotepath=false` 便于中文路径处理；`.gitignore` 已排除 `node_modules/`、`app/dist/`、`Water intake record/`、日志与 tsbuildinfo | `main` 分支提交 `bd779eb`（262 文件 / 37.39 MB），已推送到 `github.com/save626/Persist`，远端 HEAD 与本地一致，仓库具备回滚基线 |
| **步骤 6** ✅ 已完成（2026-11-03） | P2 本机持久化（原生 IndexedDB 封装，未引入 Dexie） | 新增 `lib/persist-state.ts`（记录结构 / `schemaVersion` / 迁移 / 校验）与 `lib/persist-storage.ts`（open / load / save / 降级）；`MockDataProvider` 首挂载水合、200 ms 防抖落盘、`pagehide` / `visibilitychange` 补写，Context 契约不变；`mock-data-transfer.ts` 抽出 `parseMockBackupValue()` 复用导入校验 | 刷新与重开页面后数据不丢（含长期计划、设置、复盘、快照）；单测 123/123、E2E 98 次执行全绿；未来版本数据不被覆盖；无 IndexedDB 时退回纯内存 |
| **步骤 7** ✅ 已完成（2026-11-03） | P3-0：设置页「清空本机数据」入口 | `MockDataContextValue` 新增 `clearLocalData()`；`MockDataProvider` 内 `createInitialMockData()` 复用首开基线，`saveTimerRef` 跟踪防抖定时器；清空顺序 = 停写回 → 掐定时器 → 删 IndexedDB 记录 → `replaceMockData`（含 `snapshot=null`）→ 同步刷新 `latestStateRef` → 恢复写回，`hydrated` 保持 true；设置页第二张危险区卡片 + 二次确认 `alertdialog` + toast；`persistence.spec.ts` 新增 1 条 E2E | 清空后界面立刻回到初始 Mock、刷新不复现旧数据（含饮水 1.5→1.2 与提醒开关回正）；E2E 100 次执行全绿 |
| **步骤 8** ✅ 8a + 8b + 8c 完成（2026-11-04，待部署验收） | P3：Fastify + DeepSeek 服务端代理 | 8a（`9138175`）：Fastify 5（`127.0.0.1:3000`，Node 20 兼容）、`POST /api/chat` SSE、`GET /api/health`、DeepSeek 流式回复 + JSON 抽取两次调用、`sanitizeExtraction()` 白名单净化、按 IP 限流、超时/取消/有限重试、日志脱敏、`.env.example`。8b（`b99d3ad`）：`app/src/lib/ai-chat-client.ts` 流式 fetch 客户端 + `probe()` + 诚实回退，`PlanChatSheet` 按授权切换来源并标注，Vite `/api` 代理，E2E 用不可达端口隔离真实后端；服务端提示词注入北京日期、前端 `plan-draft` 加日期兜底。8c（`bdd4265`）：`POST /api/report` 非流式 JSON + `ai/report.ts` 净化 + 报告提示词，前端 `app/src/lib/ai-report-client.ts` + `ReportsPage` 探活/真实生成/回退与错误分流，报告数字与依据仍由前端确定性生成 | 已过：app `typecheck` 0 错、单测 149/149（10 文件）、E2E 102 全绿、lint 0 错 3 既有警告、`prettier` 通过、构建通过（`index-DmnjkjkL.js`）；server `typecheck` 0 错、单测 58/58（8 文件）、`build`/`format:check` 通过；真实 Key：`/api/chat` 200 且日期为未来，`/api/report` 2.7 s 返回中文简报、只授权学习时不出现训练/饮食字样、提示词已禁止数值推算并复验。**剩余：仅步骤 9 部署验收**（`/reports` 视觉基线已按 8c 文案重跑、6 张 png 更新并经用户双端验收，随 `7625865` 推送）；P3 完成标准中的「部署验收」待步骤 9 |
| **步骤 9** | 首次部署（IP 直连，无域名） | 本地 `npm run build` → 上传 `app/dist` 到 `/var/www/persist`；Nginx 站点（`try_files` 深链回退 + `/api` 反代 + gzip + 长缓存）；Fastify 走 systemd `persist-server.service`，密钥放 `/etc/persist/server.env`(600) | `http://<IP>/` 可打开、`/reports` 直接刷新 200、`/api/health` 200、刷新回访命中缓存；详见 `docs/部署与服务器现状.md` §6 |
| **步骤 10**（备案号下发后） | 域名 + HTTPS | 域名解析到 ECS；安全组开放 443；certbot 签 Let's Encrypt 证书；Nginx 443 + HTTP→HTTPS 跳转；安全加固（SSH 密钥登录、禁 root 密码、删 3389、fail2ban） | `https://wpersist.top` 可访问且证书有效、HTTP 自动跳转 HTTPS（前置：阿里云初审 ✅ 2026-11-04 → 2026-11-05 提交管局 → 管局审核 → 备案号下发） |
| **步骤 11**（8d，可与备案等待并行） | 数据历史化（P4 前置） | 训练历史落库（删 `FitnessPage` 的 `HISTORY` 演示常量）、饮食/饮水/计划按日台账、`schemaVersion` 1→2 迁移、备份格式 0.3.0（兼容 0.1.0/0.2.0） | 见 `docs/P4-数据层与AI综合分析设计方案.md` §6.3；完成后重跑视觉基线并请用户双端验收 |
| **步骤 12**（P4a） | 设备令牌 + 增量同步（SQLite 数据层） | `server/src/db/*`（驱动/repo/migrate）、`/api/v1/devices*`、`/api/v1/sync/{bootstrap,push,pull}`、客户端 `app/src/lib/sync-*`、设置页同步区块 | 见同文档 §7.4；开工前先定 Node/驱动（§18-1），断网/多设备/冲突/幂等全部验过 |
| **步骤 13**（P4b） | 服务端聚合 + AI 综合分析 | facts builder（服务端 SQL 算数字）、`ANALYSIS_SYSTEM_PROMPT`、`/api/v1/analysis/{facts,reports}`、`/api/v1/reports*`、报告缓存与可选定时简报、报告页改造 | 见同文档 §8.5；真实 Key 人工核对报告无「自行推算的数字」，缓存命中不重复调模型 |
| **步骤 14**（P4c） | 备份 / 恢复 / 导出 / 删除账号 | `/api/v1/backups*`、`/api/v1/export`、`DELETE /api/v1/account`、定时备份与保留策略、隐私与数据区块文案 | 见同文档 §12；恢复前自动备份当前库、删除后无残留 |
| **步骤 15**（P5） | Capacitor Android | 见 §13 P5 | 见 §13 P5 完成标准 |

步骤 3、4、5、6、7 均已于 2026-11-03 完成，步骤 8a/8b/8c 已于 2026-11-04 完成：步骤 3 让导出导入升级到备份 0.2.0，步骤 4 完成全页面视觉复核并由用户桌面端 + 移动端验收通过，步骤 5 建立了 Git 回滚基线（`bd779eb` + `da787c4`），步骤 6 把内存 Mock 升级为本机 IndexedDB 持久化且保持 `MockDataProvider` 对外契约不变，步骤 7 补上「清空本机数据」入口（`a544a38`），步骤 8a 完成服务端 Fastify + DeepSeek 代理骨架（`9138175`），步骤 8b 把 AI 建档对话接到 `/api/chat`、实现诚实回退并用真实 Key 完成联调（`b99d3ad`），步骤 8c 把 AI 报告接到 `/api/report`、报告文字由模型生成而数字与依据仍由前端确定性生成（`bdd4265`）。**下一步是步骤 9：IP 直连首次部署**（本地构建上传 `app/dist` + Nginx 深链回退/反代/gzip + systemd），备案号下发后再做步骤 10（域名 + HTTPS）。服务器规格与部署约束见 `docs/部署与服务器现状.md`。

**P4 终态方向（2026-11-04 用户拍板）**：不做「前端把摘要塞给模型」的路线 1 终态，改为**本地优先 + 服务端可检索副本**——IndexedDB 仍是写入权威，增量同步到 Fastify + SQLite，服务端 SQL 聚合出事实包，DeepSeek 只写分析文字；报告可归档、缓存、定时生成，并补账号令牌、备份恢复、导出与删除。完整设计（目标架构、SQLite DDL、同步协议、事实包契约、隐私边界、部署影响、四步拆分与验收）见 **`docs/P4-数据层与AI综合分析设计方案.md`**。该方案明确了一条容易被忽略的前提：**当前只有学习记录是真实历史**（训练历史是 `FitnessPage` 演示常量、饮食只有今天、饮水无日期），所以先做步骤 11（8d）数据历史化，再谈 AI 综合分析。步骤 11–14 可在备案等待期本地开发（SQLite 用本地文件、单测用 `:memory:`），不需要等服务器部署。

Git 提交流程备忘（本环境已验证）：`git push` / `git ls-remote` 在沙箱下会因 git 启动的 `ssh.exe` 无法创建管道而失败（`couldn't create signal pipe, Win32 error 5`），需要一次性提权到完整访问权限；提交前用 `git diff --cached --name-only` 审计一遍，确认没有 `node_modules/`、`app/dist/`、`test-results/`、`Water intake record/` 等路径。

给全新会话的启动指令见 `D:\Persist\HANDOFF-新会话指令.md`（可整份复制粘贴）。

---

## 1. 产品定位与目标

### 1.1 产品定位

Persist 是一款个人自用、长期记录、本地优先的计划与复盘工具，统一承载：

- 今日计划、重要目标倒计时、时间线和晚间复盘。
- 健身训练与自由运动记录。
- 饮食、营养和饮水记录。
- 英语与高数学习记录。
- 个人档案、偏好和 AI 授权。
- 基于跨模块数据的 AI 分析报告。

核心闭环：

```text
建立个人档案
→ 制定今日计划
→ 记录健身、饮食饮水和学习
→ 晚间复盘
→ 生成 AI 分析报告
→ 查看趋势
→ 调整计划和个人档案
```

### 1.2 产品原则

- **记录优先**：AI 或服务端不可用时，记录能力必须仍然可用。
- **低摩擦**：饮水、学习、训练等高频操作应尽量在 1～3 次点击内完成。
- **长期主义**：重视趋势、阶段平均和上下文，不使用惩罚式连续打卡。
- **用户掌控**：AI 只能建议，不能静默修改计划、目标或档案。
- **隐私最小化**：只向 AI 发送生成报告所需的摘要数据，API Key 不进入客户端。
- **可解释**：报告应说明依据的数据源、时间范围、记录数量和不确定性。
- **渐进扩展**：先稳定日常闭环，再增加照片识别、复杂训练计划和同步。

### 1.3 第一版成功标准与当前状态

| 成功标准 | 当前状态 | 说明 |
|---|---|---|
| AI 引导式建档并可修改 | 已完成（本地 Mock 规则引擎） | 档案页「AI 建档」→ `/plans?onboard=1` 打开对话；确认后才写回档案并启用计划 |
| 今日计划可创建、调整、完成 | 前端 Mock 已完成 | 记录写入本机 IndexedDB，刷新不重置 |
| 健身/饮食/饮水/学习可记录 | 前端 Mock 已完成 | 可跨页联动并持久化到本机 |
| 关闭并重新打开后数据仍存在 | 已完成（本机浏览器级） | IndexedDB 持久化；换浏览器 / 清站点数据会丢，无跨设备同步 |
| 晚间状态与 AI 复盘 | 前端 Mock 已完成 | 报告内容不是真实 AI 生成 |
| 近 7 天和月度统计 | 前端 Mock 已完成一部分 | 趋势与报告周期可验证；完整统计口径待后端确认 |
| 完整导出并在空环境恢复 | 前端 JSON 导入导出已完成 Mock | 无服务端备份和真实空库恢复 |
| Android APK 可安装 | 未开始 | 尚未接 Capacitor |
| DeepSeek 不可用时可降级 | 前端有 Mock 失败态 | 无真实服务端错误处理 |

### 1.4 第一版明确不做

- 不抓取“不背单词”“百词斩”等外部 App 的非公开数据。
- 不在第一版实现单词书自动拆解和艾宾浩斯排程。
- 不做饮食照片自动识别或食物数据库搜索。
- 不提供医学诊断、疾病治疗或极端减脂建议。
- 不做社交、排行榜、连续打卡惩罚、积分和勋章。
- 不做多用户、家庭共享或公开主页。
- 不在首版追求多设备实时双向同步。
- 不接入智能手表、体脂秤或 Health Connect。
- 不做开放式复杂聊天机器人；允许结构化、可确认的 AI 引导问答。

---

## 2. 当前进度总览

### 2.1 阶段判断

| 阶段 | 内容 | 状态 |
|---|---|---|
| Phase 0 | 产品边界、视觉方向、工程脚手架 | 已完成 |
| Phase 1 | 八页面（含 `/plans`）、响应式应用壳、视觉体系 | ✅ 已完成并通过用户验收（2026-11-03，15 状态 × 6 视口） |
| Phase 2 | 今日页 Mock 交互 | 已完成 |
| Phase 3 | 健身页 Mock 交互与自由运动 | 已完成 |
| Phase 4 | 饮食、营养与饮水 Mock 交互 | 已完成 |
| Phase 5 | 学习页 Mock 交互 | 已完成 |
| Phase 6 | 个人档案与 AI 报告前端 Mock | 已完成 |
| Phase 7 | JSON/CSV、演示数据、快照 UI | 已完成前端 Mock |
| 当前增量 | AI 引导建档、长期计划页面、草案确认、归档/重启、周进度 | 页面闭环、单元测试与 E2E 已完成（P1 全部完成） |
| 下一阶段 A | P1 收尾：JSON 导出导入迁移到 0.2.0 + 全页面视觉复核 | ✅ 已完成（2026-11-03，用户桌面端 + 移动端验收通过） |
| 下一阶段 A2 | 首个 Git 提交（建立可回滚基线） | ✅ 已完成（2026-11-03，`main` / `bd779eb`，已推送 GitHub） |
| 下一阶段 B | 本机 IndexedDB 持久化（步骤 6） | ✅ 已完成（2026-11-03；原生 IDB 封装 + 记录版本迁移，未引入 Dexie，Context 契约不变） |
| 收尾 | 死代码/历史制品清理 + 全仓格式化（移除 Tailwind Prettier 插件） | ✅ 已完成（2026-11-03，两个独立提交，验证全绿） |
| 服务器 | 阿里云 ECS 环境准备（Node 20 + Nginx + 安全组 80） | ✅ 环境就绪（2026-11-03，**项目代码未部署**，见 `docs/部署与服务器现状.md`） |
| 步骤 7 | P3-0：设置页「清空本机数据」入口 | ✅ 已完成（2026-11-03，`a544a38`，E2E 100 次全绿） |
| 下一阶段 C | Fastify + DeepSeek 服务端代理（步骤 8） | ✅ 代码完成：8a 服务端骨架（`9138175`）、8b 前端接入 + 真实 Key 联调（`b99d3ad`）、8c AI 报告接服务端（`bdd4265`）；app 单测 149/149、server 58/58、E2E 102 全绿；**部署验收待步骤 9** |
| 部署 | 步骤 9 IP 直连部署 → 步骤 10 备案后域名 + HTTPS | 未开始（DNS/443 等**管局审核通过并下发备案号**；阿里云初审已于 2026-11-04 通过，2026-11-05 提交管局） |
| 下一阶段 D | 服务端备份、校验与恢复 | 未开始 |
| 下一阶段 E | Capacitor / Android 发布 | 未开始 |
| 后续 | 高级统计、同步、照片识别、外部数据接入 | 未开始 |

### 2.2 完成度矩阵

| 模块 | 页面 | Mock 交互 | 跨模块联动 | 持久化 | 自动化验证 |
|---|---|---|---|---|---|
| 今日 | 已完成 | 已完成 | 已完成 | 已完成（本机 IndexedDB） | 已覆盖（含刷新恢复） |
| 健身 | 已完成 | 已完成 | 已完成 | 已完成（本机 IndexedDB） | 已覆盖 |
| 饮食 | 已完成 | 已完成 | 已完成 | 已完成（本机 IndexedDB） | 已覆盖（含刷新恢复） |
| 学习 | 已完成 | 已完成 | 已完成 | 已完成（本机 IndexedDB） | 已覆盖 |
| 个人档案 | 已完成 | 已完成 | 已完成 | 已完成（本机 IndexedDB） | 已覆盖 |
| AI 报告 | 已完成 | 已完成（8c 起可走真实 DeepSeek，指标与依据仍由前端生成） | 已完成 | 已完成（本机 IndexedDB） | 已覆盖（含探活、回退、契约错误分流） |
| 设置 | 已完成 | Mock 已完成 | 已完成 | 已完成（本机 IndexedDB） | 已覆盖（含刷新恢复） |
| 长期计划 | 已完成（`/plans`） | 已完成（含 AI 建档对话；8b 起可走真实 DeepSeek，失败回退 Mock） | 已完成 | 已完成（本机 IndexedDB） | 已覆盖（含刷新恢复、回退用例） |
| 服务端 | 仅 API（`/api/health`、SSE `/api/chat`、JSON `/api/report`），无页面 | 8a/8b/8c 已完成（Fastify + DeepSeek 代理骨架 + 前端接入 + 报告生成） | 已接入（`/api/chat` 供 AI 建档；`/api/report` 供报告） | 无（P3 无状态；P4 用 SQLite 单文件） | 服务端单测 58/58；E2E 用不可达端口验证回退 |
| 部署 / 服务器 | ECS 2C2G 已装 Node 20 + Nginx，仅默认页 | 无（代码未部署） | 无 | 无（无服务端存储） | 无（部署验收清单待步骤 9 执行） |
| Android | 未开始 | 无 | 无 | 无 | 无 |

说明：持久化是**整库单记录**方案——13 个状态切片合成一条 `persist-mock-state` 记录，不按模块拆分 store；任一模块改动都会重写整条记录（写入量约 100–300 KB/次，200 ms 防抖）。

---

## 3. 信息架构、路由与导航

### 3.1 当前路由

| 路由 | 页面 | 是否主导航 | 说明 |
|---|---|---|---|
| `/` | 今日 | 是 | 首页 |
| `/fitness` | 健身 | 是 | 训练与自由运动 |
| `/diet` | 饮食 | 是 | 餐次、营养、饮水 |
| `/study` | 学习 | 是 | 英语与高数 |
| `/reports` | AI 报告 | 是 | 报告生成、历史和依据 |
| `/profile` | 个人档案 | 否 | 侧栏头像、移动顶栏进入；含「AI 建档」入口 |
| `/plans` | 长期计划 | 否 | 档案页「AI 建档」、今日页计划区进入；`?onboard=1` 自动打开建档对话 |
| `/settings` | 设置 | 否 | 侧栏、移动顶栏进入 |
| 未知路径 | — | — | 重定向到 `/` |

当前页面内的新增、编辑、证据和历史详情主要通过弹层或抽屉完成，没有为每个二级操作建立独立路由。唯一被使用的查询参数是 `/plans?onboard=1`（打开 AI 建档对话），属于可深链的入口参数。下列旧规划中的子路由目前**不是现状**：

```text
/today
/fitness/plans/:id
/fitness/sessions/:id
/diet/meals/:id
/diet/water
/study/sessions/:id
/profile/onboarding
/ai/reports
/ai/reports/:id
/settings/data
/settings/reminders
```

### 3.2 主导航

桌面侧栏与移动底部导航共用 `NAV_ITEMS`：

```text
今日 / 健身 / 饮食 / 学习 / AI 报告
```

关键文件：

- `D:\Persist\app\src\components\AppShell.tsx`
- `D:\Persist\app\src\App.tsx`

### 3.3 AI 报告入口

当前有四个入口：

1. 桌面侧栏“AI 报告”。
2. 移动底部导航“AI 报告”。
3. 今日页头部“AI 报告”按钮。
4. 学习页“查看分析依据 → 前往 AI 报告”。

这是一项已确认的用户需求，交接时不得回退为“只能从学习页进入”。

### 3.4 全局交互

- 桌面侧栏提供个人档案和设置入口。
- 移动顶栏提供设置和个人档案入口。
- 移动端有悬浮快速记录按钮。
- 快速记录可打开饮水、健身、饮食、学习对应 Mock 表单。
- 页面切换会更新浏览器标题。
- 全局 Toast 用于保存、导入和状态反馈。
- 移动底部导航当前为五列。

---

## 4. 功能模块清单

## 4.1 今日页

关键文件：

- `D:\Persist\app\src\pages\TodayPage.tsx`

已完成 Mock 能力：

- 两个重要目标倒计时。
- 目标启用/停用、标题、日期和时间编辑。
- 今日计划新增、编辑、删除、完成状态切换。
- 四项今日指标。
- 今日时间线。
- AI 晨间简报。
- 晚间复盘填写与保存。
- 训练摘要接入今日时间线和指标。
- 饮食热量、饮水和学习数据接入今日上下文。
- 今日页头部 AI 报告入口。

验收要点：

- 计划编辑在 SPA 内立即保持，刷新后也不会丢失（写本机 IndexedDB）。
- 训练记录变化会反映在今日时间线/摘要。
- 饮水与学习变化会反映在晨间简报指标。
- 晚间复盘离开页面再返回仍保留。

## 4.2 健身页

关键文件：

- `D:\Persist\app\src\pages\FitnessPage.tsx`
- `D:\Persist\app\src\lib\fitness.ts`
- `D:\Persist\app\src\styles\fitness.css`

已完成 Mock 能力：

- 训练模板展示与选择。
- 添加训练动作。
- 动作名称自由输入，不依赖固定动作库。
- 历史动作名称辅助提示。
- 力量、时长、距离三种运动类型。
- 跑步、跳绳、骑行、足球、爬山等快捷填入，仅作为辅助。
- 训练套组新增、标记完成、计时和 RPE。
- 自由运动记录保存。
- 同日同名动作复用并追加记录。
- 新动作名称自动成为自定义动作。
- 训练会话计时、进行中/已完成状态。
- 完成训练。
- 最近训练历史详情。
- 训练证据抽屉。
- 力量容量、完成组数、运动时长、累计距离统计。
- 训练数据联动今日页和 AI 报告分析依据。

运动类型语义：

| 类型 | 主要字段 | 典型场景 |
|---|---|---|
| `strength` | 重量、次数、RPE | 卧推、深蹲、哑铃训练 |
| `duration` | 时长、RPE | 跳绳、足球、爬山、平板支撑 |
| `distance` | 距离、可选时长、RPE | 跑步、骑行、游泳、徒步 |

重要实现边界：

- 当前自由运动已经进入 `FitnessSessionState`。
- 今日页和 AI 报告通过统一 `summarizeFitness()` 读取。
- `FitnessPage.tsx` 内的 `HistoryExercise` 仍是力量专用结构（`weight` / `reps`）。当前历史 Mock 均为力量训练，因此不影响新功能验收；若要求历史详情完整展示自由跑步/骑行，需要将其升级为通用 `WorkoutSet`。

## 4.3 饮食页

关键文件：

- `D:\Persist\app\src\pages\DietPage.tsx`

已完成 Mock 能力：

- 早餐、午餐、晚餐、加餐四个餐次。
- 食物条目新增、编辑、删除。
- 热量、蛋白质、碳水、脂肪录入。
- 餐次备注和时间编辑。
- 照片文件名附件 Mock。
- 外部 AI 营养文本粘贴解析。
- 解析结果预览、确认后登记。
- 饮水快捷增加。
- 自定义饮水量。
- 撤销最近一次饮水。
- 饮水进度。
- 热量、宏量营养和餐次统计。
- 饮食证据/分析依据抽屉。
- 饮食与饮水联动今日页和 AI 报告。

边界：

- 照片只保存文件名元数据，不上传、不识别（文件名随餐次记录一起持久化到本机）。
- 外部 AI 营养文本解析发生在浏览器本地，不是调用 DeepSeek。
- 饮水总量由 `1200 ml` 初始基线和 `waterLog` 增量组成；`1200 ml` 是初始演示常量，不会随持久化重复叠加（写入的是 `waterLog` 增量与其它状态，不含基线本身）。

## 4.4 学习页

关键文件：

- `D:\Persist\app\src\pages\StudyPage.tsx`

已完成 Mock 能力：

- 英语 / 高数分类。
- 新增、编辑、删除学习记录。
- 日期、开始时间、时长、来源和备注。
- 英语字段：新词、复习词、正确率、听力。
- 高数字段：章节、题量、错题。
- 近 7 天趋势。
- 学习来源统计。
- 英语/高数投入占比。
- AI 观察依据。
- “前往 AI 报告”入口。
- 学习记录联动今日页和报告数据源。

## 4.5 个人档案

关键文件：

- `D:\Persist\app\src\pages\ProfilePage.tsx`
- `D:\Persist\app\src\data\profile.ts`

已完成 Mock 能力：

- 分步编辑档案。
- 年龄、身高、体重、目标体重。
- 健身目标、经验、频率和器械。
- 饮食偏好、过敏信息。
- 作息、睡眠时长、压力状态。
- 档案完整度计算。
- BMI 计算。
- 训练、饮食与 AI 授权展示。
- AI 授权在设置页和档案页同步。
- 档案 JSON 导出。

## 4.6 AI 报告

关键文件：

- `D:\Persist\app\src\pages\ReportsPage.tsx`
- `D:\Persist\app\src\data\reports.ts`
- `D:\Persist\app\src\lib\fitness.ts`

已完成 Mock 能力：

- 生成今日简报。
- 生成中、成功、失败 Mock 状态。
- 报告类型卡片。
- 报告周期切换。
- 分析依据查看/收起。
- 数据源开关：健身、饮食、学习、档案。
- 跨模块摘要与证据展示。
- 历史报告保存和查看。
- 应用报告建议到今日计划。
- Mock 报告导出。
- 服务端代理预留说明。
- 明确标识“前端 Mock · 未调用 DeepSeek”。

尚未实现：

- DeepSeek API 请求。
- Token 统计和费用控制。
- 服务端限流、缓存、超时、重试和降级。
- 报告结果 schema 校验。
- 敏感日志脱敏。
- 真实持久化和跨设备访问。

## 4.7 设置页

关键文件：

- `D:\Persist\app\src\pages\SettingsPage.tsx`

已完成 Mock 能力：

- 三类提醒配置：饮水、训练、复盘。
- AI 授权开关。
- AI 数据源开关。
- Mock 服务连接测试。
- JSON 全量备份导出。
- JSON 备份导入恢复。
- CSV 学习记录导入追加。
- 加载完整演示数据。
- 生成当前内存快照元信息。
- 清空本地 Mock 设置。
- 隐私和服务端自托管说明弹层。

重要边界：

- “清空本地 Mock 设置”只重置提醒、AI 授权和数据源选择，不删除业务示例数据。
- “生成快照”不创建可恢复磁盘副本，只记录时间和当前记录数量。
- Mock 连接测试不是实际网络请求。
- 设置（含提醒开关、时间、AI 授权、数据源）修改后写入本机 IndexedDB，刷新与重开浏览器都保持；只有清除站点数据才回到初始值。

## 4.8 应用壳与快速记录

关键文件：

- `D:\Persist\app\src\components\AppShell.tsx`
- `D:\Persist\app\src\components\QuickRecordSheet.tsx`
- `D:\Persist\app\src\context\UIProvider.tsx`

已完成：

- 桌面侧栏与移动底部导航。
- 响应式页面壳。
- 移动顶部栏。
- 全局悬浮记录按钮。
- 快速记录入口和表单跳转。
- Toast 状态提示。
- 图标 Sprite 和品牌标识。
- 页面标题同步。

---

## 4.9 AI 引导建档与长期计划（页面闭环已完成）

这是 2026-10-30 起设计、2026-11-02 打通页面闭环的功能：

```text
用户自由描述目标与现状
→ 本地规则提取档案字段
→ 只追问缺失的关键信息（最多两个问题）
→ 生成长期计划草案（周目标 / 阶段里程碑 / 假设 / 冲突警告）
→ 用户确认后才写入档案并启用长期计划
→ 原 active 计划自动归档，可随时重新启用
```

入口（三个）：

1. 档案页头部「AI 建档」→ `/plans?onboard=1`，进入即打开建档对话（≤700px 时该按钮按设计隐藏，需从 `/plans` 空状态进入）。
2. `/plans` 空状态「开始 AI 建档」。
3. 今日页计划区底部「长期计划 →」。`/plans` 不在主导航内，主导航仍固定五项。

关键文件：

- `D:\Persist\app\src\pages\PlansPage.tsx`
- `D:\Persist\app\src\components\PlanChatSheet.tsx`
- `D:\Persist\app\src\components\PlanDraftSheet.tsx`
- `D:\Persist\app\src\styles\plans.css`
- `D:\Persist\app\src\lib\chat-types.ts`
- `D:\Persist\app\src\lib\ai-chat-client.ts`（步骤 8b 新增：HTTP 流式客户端 + 健康探测 + 诚实回退）
- `D:\Persist\app\src\lib\chat-extract.ts`
- `D:\Persist\app\src\lib\mock-chat-client.ts`
- `D:\Persist\app\src\lib\long-term-plan.ts`
- `D:\Persist\app\src\lib\plan-draft.ts`
- `D:\Persist\app\src\lib\profile-rules.ts`
- 测试：`chat-extract.test.ts`(24)、`long-term-plan.test.ts`(23)、`plan-draft.test.ts`(22)、`profile-rules.test.ts`(11)、`ai-chat-client.test.ts`(13)、`e2e\plans.spec.ts`(5)

已完成的能力：

- 从中文自由描述中提取年龄、身高、体重、目标体重、健身目标、训练经验、频率、器械、饮食偏好、过敏、睡眠、压力等档案字段；不凭空补全未提到的字段。
- 对越界数值进行过滤（`profile-rules.ts` 统一规则：年龄 14–100 等），越界字段丢弃并通过一条非阻塞 toast 提示，从不抛错、不中断对话。
- 缺失关键信息时最多追问两个问题，支持已问字段去重。
- 识别目标与体重、训练频率与睡眠等冲突并给出警告。
- 根据目标和频率生成周目标、阶段里程碑、假设和高亮摘要。
- 定义并实现 `ChatClient` / `ChatEvent` 流式契约（`stage → delta* → questions? → profilePatch? → stage('propose') → proposal? → warnings? → done`）。
- 提供本地 Mock 对话客户端，标签明确为「本地生成 · Mock 对话」，不联网、前端无 API Key。
- 步骤 8b（2026-11-04，`b99d3ad`）：`PlanChatSheet` 改用 `createAppChatClient({ consent: profile.aiConsent })`——开启 AI 授权且 `/api/health` 探测通过时走同源 `/api/chat`（DeepSeek 流式），标题标「DeepSeek 生成 · 经本站服务端代理」；未授权、服务不可用或首事件前失败时回退本地 Mock，并在对话底部与副标题如实标注「真实模型暂时不可用，本次已回退到本地 Mock」。**首个内容事件之后不再回退**（避免吞掉半截真实回答），AbortError 也不回退。
- 模板/草案的日期兜底（`plan-draft.ts`）：模型偶尔给出已过去的日期，`resolveProposalDates` 会把早于今天的开始日期钳到今天、丢弃过期里程碑；建议里程碑过期时不再给出结束日期。配合服务端提示词注入「今天（Asia/Shanghai）」，真实调用已复验为未来日期。
- 长期计划领域模型：`draft / active / archived`、周期计划与周计划、周目标带单位（次/分钟/公里/千卡/篇）、里程碑与起止日期。
- 以周一为一周起点计算周范围、周进度与整体进度；从学习记录与当前健身会话估算完成量并标注「估算」。
- `MockDataProvider` 提供 `longTermPlans` 状态与新增、归档、启用方法；`replaceMockData()` 可恢复长期计划。
- 页面闭环：`/plans` 展示进行中计划、草案列表与归档列表，支持手工新建、AI 建档、修改草案、确认启用、归档与重新启用。
- 确认流程：先 `addLongTermPlan()`；若标题或每周目标不完整则返回 `null`，此时只给提示并中止，现有计划不受影响。成功后才 `activatePlan()`（内部 `activateLongTermPlan` 把其它 `active` 归档），最后写回档案。
- 确认时把该轮累积的 `profilePatch` 经 `sanitizeProfilePatch` 过滤后写回档案，丢弃字段以 toast 汇总提示。
- 契约已定：`ChatPlanProposal.profilePatch` 仅用于展示，唯一写回来源是 `profilePatch` 事件；未确认前不修改档案或计划。
- `ChatPlanProposal.startDate / endDate` 为可选字段，缺省时开始日期取草案创建当天、结束日期取最后一个里程碑，草案页可编辑。
- 备份层已支持 0.2.0：`serializeMockBackup` 输出 `longTermPlans`，解析支持 0.1.0 兼容（缺字段视为零个计划），`countMockRecords()` 已统计计划数。

- 设置页 JSON 导出已切换到 `serializeMockBackup()`：输出 `version: '0.2.0'`、含 `longTermPlans`、文件名带日期、失败走 try/catch toast；导入走 `parseMockBackupJson()` 版本分流，成功 toast 同时报学习记录数与长期计划数（步骤 3，2026-11-03 完成）。
- 已持久化：长期计划（含草案确认后的启用/归档结果）与档案修改都会写入本机 IndexedDB，刷新、关闭标签页、重开浏览器后仍在（步骤 6，2026-11-03 完成）。
- 饮食周进度目前固定为 0；健身只按当前单个会话估算，不能当成真实周期统计。
- 步骤 8b 后 Mock 与 DeepSeek 两条路径共用同一 `ChatEvent` 契约；Mock 仍是默认/降级路径，真实调用只在授权 + 服务可用时发生。步骤 8c 后 AI 报告同理：文字可来自 `/api/report`，指标与依据由前端生成，「训练建议 / 学习观察」仍打开本地已有报告。

重要产品边界：

- 这是“结构化引导对话”，不是开放式聊天机器人。
- 草案必须先展示再确认，不能自动修改档案或计划。
- 长期计划不进入主导航（导航固定五项），只能从档案页、今日页与 `/plans` 进入。
- 页面必须始终诚实标注来源：走真实模型时标「DeepSeek 生成 · 经本站服务端代理」，Mock 时标「本地生成 · Mock 对话」，回退时额外说明「已回退到本地 Mock」；AI 报告在 8c 接入前不得宣称已使用 DeepSeek。

---
## 5. 技术架构

### 5.1 技术栈

| 类别 | 技术 |
|---|---|
| UI | React 19 |
| 语言 | TypeScript 6 |
| 构建 | Vite 8 |
| 路由 | React Router 7 |
| 样式 | Tailwind CSS v4 + 分模块原生 CSS |
| 单元测试 | Vitest + Testing Library |
| 端到端测试 | Playwright |
| Lint | Oxlint |
| 格式化 | Prettier（`prettier-plugin-tailwindcss` 已于 2026-11-03 移除） |
| 当前数据层 | React Context 内存状态（已由 IndexedDB 持久化，§6.6） |
| 当前后端 | Fastify 5（P3 8a+8b+8c 已实现，`server/`，监听 `127.0.0.1:3000`；本机 `npm test` 58/58，前端 AI 建档与报告都已接入并完成真实 Key 联调，**未部署**） |
| 部署/托管 | Nginx 1.24（阿里云 ECS / Alibaba Cloud Linux 3 / Node.js v20.20.2），前端纯静态托管 + `/api` 反代 `127.0.0.1:3000`，详见 `docs/部署与服务器现状.md` |
| AI 供应商 | DeepSeek（`deepseek-chat`；Key 只在服务端 `/etc/persist/server.env`。前端 AI 建档走 `/api/chat`，报告文字走 `/api/report`） |
| 计划中的数据库 | SQLite **单文件库**（P4 引入，`/var/lib/persist/persist.sqlite`；P3 阶段不落库；驱动二选一：Node 22 内置 `node:sqlite` 或 Node 20 + `better-sqlite3`，见 `docs/P4-数据层与AI综合分析设计方案.md` §4；**明确不装 MySQL/MariaDB**） |
| 当前共享层 | 仍为占位；请求/响应类型与校验暂放 `server/src/contract.ts`（镜像 `app/src/lib/chat-types.ts` 与 `app/src/lib/report-types.ts`），迁 `shared/` 推迟到 P3 收尾或 P4 |

开发环境实测：

```text
Node.js v22.19.0
npm 10.9.3
```

### 5.2 目录结构

```text
D:\Persist
├─ app/                   React + Vite 客户端
│  ├─ e2e/                Playwright 测试
│  ├─ scripts/            视觉检查脚本
│  └─ src/
│     ├─ components/      应用壳、弹层、导航等
│     ├─ context/         Mock 数据与 UI 状态
│     ├─ data/            初始与完整 Mock 数据
│     ├─ lib/             健身统计、导入导出、对话解析、长期计划、本机持久化
│     │                   （persist-state.ts 记录与迁移 / persist-storage.ts IndexedDB）
│     ├─ pages/           八个业务页面（含 plans）
│     ├─ styles/          分模块样式
│     └─ test/            测试初始化
├─ design/                视觉原型与截图
├─ docs/                  产品规划与工程文档
├─ server/                Fastify + DeepSeek 代理（P3 8a+8b+8c）
│  ├─ src/                app / config / contract / rate-limit / routes（chat、report）/ ai（deepseek、prompts、extract、report）
│  └─ test/               Vitest 8 文件 58 条
└─ shared/                共享层占位，目前只有 README（类型暂在 server/src/contract.ts）
```

### 5.3 应用入口与页面组成

`App.tsx` 的组合顺序：

```text
BrowserRouter
→ UIProvider
→ MockDataProvider
→ AppShell
→ 当前页面
```

- `BrowserRouter` 管理 SPA 路由，八个路由：`/`、`/fitness`、`/diet`、`/study`、`/plans`、`/profile`、`/reports`、`/settings`，`*` 重定向到 `/`。
- `UIProvider` 管理快速记录、Toast 等界面状态。
- `MockDataProvider` 管理全部业务 Mock 状态，并在首次挂载时先从 IndexedDB 水合（水合完成前返回 `null`，避免闪一帧演示数据），之后按 200 ms 防抖把状态写回；页面组件不需要感知持久化。
- `AppShell` 管理导航、页面标题和全局弹层。

### 5.4 类型定义

核心类型集中在：

```text
D:\Persist\app\src\types.ts
```

包括：

- `Goal`
- `PlanItem`
- `StudyRecord`
- `Meal` / `FoodEntry`
- `ExerciseKind` / `WorkoutSet` / `Exercise`
- `FitnessSessionState`
- `ProfileData`
- `MockSettings`
- `WaterLogEntry`
- `EveningReviewPayload`
- `ReportRecord`
- `MockSnapshot`
- `ImportableMockData`
- `LongTermPlan` / `LongTermPlanTarget` / `LongTermPlanStatus` / `PlanCadence`
- 对话契约类型在 `D:\Persist\app\src\lib\chat-types.ts`（`ChatEvent`、`ChatPlanProposal`、`ChatQuestion`、`ChatClient`）

推荐后续把可跨服务端和移动端复用的纯类型、校验和计算逐步迁移到 `shared/`，但不要在视觉冻结前大范围重构。

---

## 6. Mock 数据与跨模块交互

### 6.1 单一状态源

关键文件：

```text
D:\Persist\app\src\context\MockDataProvider.tsx
```

`MockDataProvider` 当前管理：

```text
goals
planItems
waterLog
studyRecords
meals
fitnessSession
profile
settings
aiConsent
eveningReview
reports
snapshot
longTermPlans
```

主要方法：

- 更新目标。
- 增加/撤销饮水。
- 设置 AI 授权。
- 更新档案（`updateProfile` 不做校验，调用方必须传 `sanitizeProfilePatch(...).patch`）。
- 更新/重置设置。
- 追加学习记录。
- 全量替换 Mock 数据（含 `longTermPlans`）。
- 生成内存快照元信息。
- 长期计划：`addLongTermPlan` / `updateLongTermPlan` / `archiveLongTermPlan` / `activatePlan`（`activatePlan` 内部调用 `activateLongTermPlan`，会先归档其它 `active` 计划）。

持久化（步骤 6）不改变上述方法签名，只在水合完成后把状态写回 IndexedDB；细节见 §6.6。

### 6.2 目前数据是否能够相互交互分析

**可以，但仅在当前浏览器 SPA 会话和当前前端 Mock 范围内。**

已经真实存在的联动：

| 数据变化 | 受影响位置 |
|---|---|
| 新增学习记录 | 学习统计、今日上下文、AI 报告依据 |
| 新增食物 | 饮食统计、今日热量、AI 报告依据 |
| 增加饮水 | 饮食进度、今日晨间简报、AI 报告依据 |
| 完成健身套组 | 健身统计、今日时间线、AI 报告训练摘要 |
| 记录自由运动 | 健身列表/统计、今日训练摘要、AI 报告分析依据 |
| 修改档案 | 完整度、报告档案依据、设置 AI 授权同步 |
| 修改 AI 数据源 | 报告证据范围和内容 |
| 应用报告建议 | 今日计划新增/调整并跳回今日 |
| 修改设置提醒 | 设置界面和当前会话状态 |

必须明确的限制：

1. 上述联动是 React 内存状态和本地统计函数，不是数据库查询或真实 AI 推理。
2. 全页刷新**不再丢失**已持久化的记录（步骤 6 已实现）；刷新后从 IndexedDB 水合，联动结果按持久化数据重建。仍未持久化的只有纯 UI 状态（弹层开合、Toast、对话中的未确认草案）。
3. 使用 `page.goto()` 重新打开页面会重建应用上下文；验证动态跨页数据应使用页面内导航。
4. AI 报告只读取当前实现允许的数据源，并生成 Mock 文本，不会发送网络请求。

### 6.3 初始数据与完整演示数据

初始数据入口：

- `D:\Persist\app\src\data\diet.ts`
- `D:\Persist\app\src\data\profile.ts`
- `D:\Persist\app\src\data\reports.ts`
- `D:\Persist\app\src\data\settings.ts`
- `D:\Persist\app\src\data\study.ts`
- `D:\Persist\app\src\context\MockDataProvider.tsx`

完整演示数据：

```text
D:\Persist\app\src\data\complete-mock-data.ts
```

完整演示数据覆盖：

- 2 个重要目标。
- 7 项今日计划。
- 4 个餐次。
- 多条食物条目。
- 3 条饮水增量事件。
- 12 条跨 7 天学习记录。
- 6 个健身动作、16 个套组，混合力量、时长和距离。
- 完整个人档案。
- 三类提醒和全部 AI 数据源。
- 晚间复盘。
- 4 份历史/示例报告。
- AI 授权开启。

加载方式：

```text
设置 → 加载完整演示数据
```

该操作会替换所有可变 Mock 数据切片，适合作为视觉和交互验收的统一起点。

### 6.4 饮水基线

当前实现：

```text
总饮水量 = 初始基线 1200 ml + waterLog 增量
```

- `waterLog` 初始为空数组。
- 完整演示数据额外提供 3 条饮水事件。
- `undoWater()` 只撤销 `waterLog` 最后一条，不会撤销 1200 ml 基线。

持久化前需要明确：1200 ml 究竟是“当天历史已饮水”，还是“演示用预置值”。真实数据层不能每次启动都无条件叠加该基线。

### 6.5 快照语义

当前快照：

```ts
interface MockSnapshot {
  id: string
  createdAt: string
  recordCount: number
}
```

它只是界面状态和记录计数，不具备恢复能力，也不是备份文件。不得在交接或产品说明中将其描述为真实备份。快照会随持久化一起保存（刷新后保留最近一次快照元信息）。

### 6.6 本机持久化（步骤 6 已实现）

关键文件：

```text
D:\Persist\app\src\lib\persist-state.ts     纯函数：记录结构、schemaVersion、迁移、校验
D:\Persist\app\src\lib\persist-storage.ts   原生 IndexedDB 封装：open / load / save / 降级
D:\Persist\app\src\context\MockDataProvider.tsx  水合 + 防抖写回
```

存储位置与结构：

```text
数据库  persist-app（版本 1）
对象仓  mock-state（keyPath: id）
唯一记录 id = 'persist-mock-state'
{
  id: 'persist-mock-state',
  schemaVersion: 1,             // 记录格式版本，不是备份文件版本
  savedAt: '2026-11-03T…Z',
  backup: { version: '0.2.0', exportedAt, data: { …13 个切片… } },  // 复用备份校验
  snapshot: { id, createdAt, recordCount } | null
}
```

写入与读回规则：

1. **首挂载水合**：`MockDataProvider` 在 `useEffect` 里 `loadPersistedState()`，成功则用记录里的 13 个切片替换初始 Mock，然后才渲染子树；水合完成前该 Provider 返回 `null`，避免演示数据闪一帧后被覆盖。此时也不会写盘（`hydrated` 之前跳过保存）。
2. **防抖写盘**：状态变化后 200 ms 防抖写入整条记录；`pagehide` 与 `visibilitychange → hidden` 时用 ref 取最新状态立即补写一次，避免关标签页丢最后一次编辑。
3. **迁移**：`persist-state.ts` 的 `MIGRATIONS` 按 `schemaVersion` 逐级升级。当前只有 v0 → v1（早期无版本号记录，补 `schemaVersion` 与 `savedAt`）。版本高于当前应用的记录会被判定为 `unsupported-version`，**只读不覆盖**，控制台告警，等在更新版本的应用里打开——这样用户从新版退回旧版时不会把数据降级写坏。
4. **降级与容错**：IndexedDB 不可用（隐私模式、被禁用、`open` 超时 2 s、被其它标签页阻塞）时返回 `unavailable`，应用照常以纯内存运行；记录损坏（JSON 结构不合法、备份校验失败）返回 `corrupt`，同样退回初始 Mock 而不是崩溃。所有失败都不会清空用户数据。
5. **契约不变**：`MockDataProvider` 对外暴露的 13 个状态切片、setter 与业务回调完全不变，页面与测试无需感知持久化。

6. **清空本机数据（步骤 7，`clearLocalData()`）**：设置页入口 → 二次确认后按固定顺序执行：把 `persistEnabledRef` 置 false 停止写回 → `clearTimeout(saveTimerRef.current)` 掐掉已排队的防抖写入 → `clearPersistedState()` 删除记录 → `replaceMockData(createInitialMockData())` 还原 12 个切片并把 `snapshot` 置 null → 同步刷新 `latestStateRef`（防「清空后立刻关页面」走 `pagehide` 补写旧数据）→ `persistEnabledRef` 恢复 true。`hydrated` 保持 true，不重新水合，避免再次读到刚删掉的记录；恢复写回后 200 ms 会把「初始基线」作为新记录落盘（`loadStatus` 仍是 `loaded`，不是 `empty`）。此操作也会解除未来版本数据的只读锁——用户主动清空即由本版本接管。

当前未做（属 P4 范围）：没有跨标签页同步、没有备份自动保存、没有容量上限提示。

---

## 7. 健身自由运动设计

### 7.1 类型与统一统计

核心类型：

```ts
type ExerciseKind = 'strength' | 'duration' | 'distance'
```

`WorkoutSet` 支持：

- `weight`
- `reps`
- `durationMinutes`
- `distanceKm`
- `rpe`
- `done`

统一统计：

```text
D:\Persist\app\src\lib\fitness.ts
```

`summarizeFitness()` 汇总：

- 总组数。
- 完成组数。
- 力量容量 `weight × reps`。
- 累计运动时长。
- 累计距离。
- 平均 RPE。
- 完成进度。

展示工具：

- `describeWorkoutSet()`：按类型展示重量/次数、时长或距离。
- `formatRecordedWorkout()`：生成记录成功提示。
- `formatTrainingSummary()`：生成今日/报告通用训练摘要。
- `inferExerciseKind()` / `getExerciseKind()`：兼容旧数据。

### 7.2 用户需求确认

已实现的核心需求：

1. 动作名称可以完全自由填写。
2. 不要求必须是专业健身动作。
3. 可记录跑步、跳绳、骑行、足球、爬山等运动。
4. 不同运动使用正确字段，不错误显示 `kg` 或“次数”。
5. 数据进入今日页、健身统计和 AI 报告依据。
6. JSON 导入兼容旧力量数据。
7. 非法 RPE、时长、距离和套组数据会被拒绝。

### 7.3 后续技术债

`HistoryExercise` 仍是：

```ts
sets: Array<{ weight: number; reps: number; rpe?: number }>
```

建议在持久化阶段一并升级为通用 `Exercise` / `WorkoutSet`，并复用 `describeWorkoutSet()`，避免维护两套历史展示逻辑。

---

## 8. 导入、导出与数据校验

### 8.1 关键文件

```text
D:\Persist\app\src\lib\mock-data-transfer.ts
```

### 8.2 JSON 备份

- 支持全量导出当前 Mock 数据。
- 导出文件名：`persist-mock-backup.json`。
- 导入为全量替换，不是合并。
- 导入前进行结构校验。
- 非法数据不会覆盖现有数据。
- 兼容缺少 `kind` 的旧力量训练格式。
- 兼容旧版字段并校验 RPE、时长、距离、套组和计时数据。

### 8.3 CSV 学习记录

- 只用于追加学习记录，不做全量替换。
- 要求 UTF-8 CSV。
- 必填逻辑列：日期、类型、学习来源、开始时间、学习时长。
- 支持中英文表头别名。
- 支持英语/高数类型别名。
- 校验日期、时间、时长和可选数值字段。
- Excel 文件不能直接导入，需要先另存为 UTF-8 CSV。

### 8.4 校验边界

当前 JSON 校验覆盖主要字段和运动数据，但未来接入真实数据库时仍应：

- 将校验逻辑迁移为可共享 schema。
- 增加版本号和数据迁移。
- 校验引用完整性。
- 校验日期边界和重复 ID。
- 增加导入预览、差异确认和回滚。

---

### 8.5 长期计划的导入导出现状与剩余缺口

备份层（`mock-data-transfer.ts`）已按 0.2.0 完成：

- `PERSIST_BACKUP_VERSION = '0.2.0'`，`LEGACY_BACKUP_VERSION = '0.1.0'`。
- `serializeMockBackup()` 输出 `version: '0.2.0'`，`longTermPlans` 追加在 `data` 末尾，缺失时显式写 `[]`。
- `parseMockBackupJson()` 用 `normalizeBackupVersion()` 分流：0.2.0 校验 `longTermPlans` 结构，0.1.0 缺字段时按「零个长期计划」兼容。
- `countMockRecords()` 已把 `longTermPlans` 计入记录数。

页面层（步骤 3，2026-11-03 完成）：

- `SettingsPage.exportMockData()` 已改为调用 `serializeMockBackup()`：导出 `version: '0.2.0'`、包含 `longTermPlans`、文件名带日期，序列化/下载异常走 try/catch 并给中文 toast。
- 导入侧走 `parseMockBackupJson()` 的版本分流（可读 0.2.0 与 0.1.0）；成功 toast 同时展示学习记录数与长期计划数，失败给可读原因且不覆盖现有数据。
- `mock-data-transfer.test.ts` 有 round-trip 用例；`mock-data-flows.spec.ts` 覆盖导出触发下载与导入后长期计划仍在。

与持久化的关系（步骤 6，2026-11-03 完成）：

- 导入成功后调用的是同一个 `replaceMockData()`，因此导入结果会立刻被 200 ms 防抖写进本机 IndexedDB，刷新后仍是导入的数据。
- 持久化记录内部复用备份层做校验（`parseMockBackupValue()` 由 `parseMockBackupJson()` 抽出，导入与读盘共用同一套字段校验），版本落在记录外层 `schemaVersion`，不会与备份文件版本混淆。
- 导入是「整体替换」，没有撤销；要回到初始演示数据，目前只能清除站点数据（见 §6.6「当前未做」）。

已记录的剩余缺口（P4 再做）：导入预览、差异确认与回滚；真实快照恢复与空安装恢复；导入前自动备份当前本机数据。

---
## 9. AI 能力现状与目标边界

### 9.1 当前真实情况

**已接真实模型（步骤 8b，2026-11-04，`b99d3ad`）**

- AI 引导建档对话：档案页开启 AI 数据授权 + 服务端 `/api/health` 可用时，浏览器同源 `POST /api/chat` → 本地 Fastify → DeepSeek（`deepseek-chat`）。流式为真实 SSE（`delta` 逐字到达），结构化结果由服务端二次调用抽取并经白名单净化。
- 已用真实 DeepSeek Key 完成端到端联调（本机临时服务进程，Key 仅经进程环境变量传入）：`POST /api/chat` 返回 200、中文流式回复 + `proposal` + `done` 齐全。第一次真实调用暴露「模型给出 2025 年过去日期」，服务端提示词注入「今天（Asia/Shanghai）」后复验 `startDate=2026-11-03`（当天），前端另有日期兜底。
- 失败诚实降级：未授权（`aiConsent === false`）时完全不发网络请求、直接用 Mock；服务不可用/503/超时/流首事件前失败时回退 Mock，并在副标题与对话底部标注「真实模型暂时不可用，本次已回退到本地 Mock（规则匹配）」；**已有内容后失败只报错，不回退**。
- 真实 AI 的 token/费用/延迟数据只在本机联调时观察（约 3.5 s 返回、单轮两次模型调用），生产尚未部署也没有额度上限与费用统计。

**AI 报告也已接真实模型（步骤 8c，2026-11-04，`bdd4265`）**

- 报告页打开时先 `GET /api/health` 探测，只有 `ai === 'deepseek'` 才显示「DeepSeek 生成 · 经本站服务端代理」；否则显示「本地生成 · Mock 报告」。
- 生成时浏览器同源 `POST /api/report`，请求体只有 `{ type, rangeDays, digest }`；`digest` 里只有「授权已开启 + 设置里来源开关打开」的模块，其余是 `null`（不是 `0`），所以模型不会把未授权误读成「没有记录」。
- **模型只写文字**：`title / status / summary / conclusions / actions / warnings`；指标数字、依据条目、统计区间仍由前端按本地记录确定性生成——模型无法改数字。
- 失败分流：服务不可用（网络/503/429/504）→ 回退本地 Mock，并在生成面板显示「真实模型暂时不可用，本次已回退到本地 Mock（规则生成）」且徽标同步变回 Mock；响应不合契约 / 净化不通过 → **明确报错（`ReportContractError`），不伪造报告**，记录本身不受影响，可直接重试。
- 客户端断开（关页面/切页）→ 服务端 `AbortController` 中止上游，返回 499，不浪费额度。
- 真实 Key 验证（本机临时进程，Key 仅经进程环境变量传入，未写入任何文件）：完整摘要 **2.7 s** 返回 200 + 中文简报；只授权学习时，生成的报告**完全不出现训练/饮食字样**；首版提示词允许「推算」，模型算出了「再补水约 0.5 L」这种摘要里没有的数字，已改为**禁止任何数值推算**并复验通过。
- 仍有 Mock 的部分：`训练建议` / `学习观察` 两类报告目前仍打开本地已有报告，只有「今日简报」是真实生成；服务端 `type` 已支持三种类型，后续接上即可。

**服务端当前边界（8c 后仍成立）**

- 服务端只有按 IP 限流（`/api/chat` 与 `/api/report` 共用 20 次 / 5 分钟），**没有账号鉴权**；Key 只在服务端环境变量，前端/构建产物已扫描确认无 Key。
- 真实 AI 的 token/费用/延迟数据只在本机联调时观察（chat 约 3.5 s、report 约 2.7 s），生产尚未部署也没有额度上限与费用统计。
- 部署后需要复验：Nginx 反代下的 SSE（`proxy_buffering off`）与 `/api/report` 长请求（`proxy_read_timeout ≥60s`）、按 IP 限流真实命中。

### 9.2 后续目标架构

建议链路：

```text
客户端收集当前授权数据摘要
→ 服务端校验请求和用户授权
→ 最小化字段并脱敏
→ 调用 DeepSeek
→ 校验结构化响应
→ 缓存/记录必要元信息
→ 客户端展示报告和依据
→ 用户确认后才写入计划
```

服务端最低要求：

- Fastify 代理。
- DeepSeek Key 仅存在服务端环境变量。
- 鉴权或本地访问限制。
- 请求 schema 校验。
- 数据源授权检查。
- 限流和并发控制。
- 超时、重试上限和失败降级。
- 响应 schema 校验。
- 日志脱敏。
- 缓存与重复请求防护。
- 成本上限和 Token 记录。
- 不允许客户端直接携带服务端密钥。

### 9.3 数据最小化

发送给 AI 前应只选择报告所需摘要，例如：

- 日期范围。
- 计划完成情况。
- 训练动作类型、完成组数、时长、距离、平均 RPE。
- 饮食热量和宏量营养汇总。
- 饮水总量。
- 学习投入、分类、正确率和错题汇总。
- 用户明确授权的档案字段。

默认不应发送：

- 食物照片原图。
- 完整历史原始日志。
- 与服务当前报告无关的备注。
- 未授权的敏感健康信息。
- API Key、设备凭据或内部调试信息。

---

## 10. 自动化验证与质量结果

### 10.1 最近已验证结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | 通过，0 错误（2026-11-04 步骤 8c 后复跑） |
| 单元测试 | `npm test` | **149/149 通过，10 个测试文件**（2026-11-04 步骤 8c 后复跑） |
| 端到端测试 | `npx playwright test` | **102 通过 / 0 跳过 / 0 失败**，51 个用例 × 2 个项目 = 102 次执行，59.5 s（2026-11-04 步骤 8c 后复跑） |
| Lint | `npm run lint` | 0 错误，3 条既有 `react(set-state-in-effect)` 警告（`StudyPage.tsx` / `DietPage.tsx` / `FitnessPage.tsx`，2026-11-04 步骤 8c 后复跑） |
| 格式检查 | `npx prettier --check .`（在 `app` 内执行） | 通过：`All matched files use Prettier code style!`（2026-11-04 步骤 8c 后复跑，含 vite/playwright 配置） |
| 生产构建 | `npm run build` | 通过（`index-DmnjkjkL.js` 564.70 kB / gzip 168.01 kB，`index-CrJgYfMj.css` 137.71 kB / gzip 23.82 kB，2026-11-04 步骤 8c 后复跑；8c 改了 `reports.css` 一处颜色，CSS 哈希随之变化） |
| 视觉检查 | `npm run visual:check`（**前提：同源 `/api` 可达**，先起无 Key 后端，否则 502 会判 `consoleErrors > 0`） | 最近一次全量重跑为 2026-11-04 步骤 8b 后全绿：15 个状态 × 6 个视口 = 90 张 + 快速记录 1 张 = 91 张，`overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`（exit 0），77 张 png 更新并经用户双端验收通过后入库。**8c 改动 `/reports` 后，reports 相关基线已单独重跑（6 张 png 更新，各项 0、exit 0）并经用户双端验收通过，随 `7625865` 提交推送** |
| 服务端类型/单测 | `npm run typecheck` + `npm test`（`server/`） | 0 错；**58/58**（8 个文件：config / contract / rate-limit / extract / deepseek / chat / prompts / report），Node 20 兼容，`format:check` 通过（2026-11-04 步骤 8c 后复跑） |
| 服务端冒烟 | `node dist/index.js` + HTTP 调用 | 无 Key：`/api/health` 200（`ai: "disabled"`）、`/api/chat` 503、`/api/report` 503；真实 Key（本机临时进程，PORT=3001）：`/api/health` 200（`ai: "deepseek"`）、`POST /api/report` 200 + 中文简报（2.7 s）、只授权学习时无训练/饮食字样 |

Playwright 配置为两个项目：

- `desktop-chrome`
- `mobile-chrome`（Pixel 7，`isMobile: true`）

共 51 个用例 × 2 个项目 = 102 次执行，**0 跳过 0 失败**。原先 `plans.spec.ts` 中「档案页 AI 建档入口」在移动端被 `test.skip(isMobile)` 跳过，原因是该按钮在 ≤900px 被全局隐藏规则一并向隐藏；现已给按钮加 `profile-onboard-action` 并从隐藏规则豁免，移动端同样真实点击验证，测试不再跳过。

步骤 6 新增 `e2e/persistence.spec.ts` 3 条（饮水记录 / 长期计划 / 提醒设置）在桌面与移动两个项目都真实刷新页面验证，覆盖「刷新后仍在」与「重复刷新不累加」。步骤 7 在同一文件补第 4 条「清空本机数据后刷新回到初始示例数据」：先造出与基线不同的状态（饮水 1.2 L → 1.5 L、关掉饮水提醒）→ 进入设置页二次确认清空 → 断言界面立刻回到基线（提醒开关重新勾选、快照区显示「尚未生成快照」）→ 刷新后仍为基线（断言 1.2 L 且不含 1.5 L、提醒开关已勾选），用来抓「200 ms 防抖把旧数据写回」这类顺序错误。

### 10.2 测试文件与覆盖主题

| 文件 | 用例数 | 覆盖内容 |
|---|---:|---|
| `app\e2e\smoke.spec.ts` | 21 | 导航、今日、健身、饮食、学习、档案、设置、报告、移动溢出 |
| `app\e2e\mock-flows.spec.ts` | 8 | 学习/餐食/健身/档案/授权/复盘跨页保持，报告数据源联动 |
| `app\e2e\mock-data-flows.spec.ts` | 8 | 简报历史、周期、饮水 KPI、快照、JSON 导出/导入、CSV、非法导入 |
| `app\e2e\plans.spec.ts` | 5 | 档案页 AI 建档入口深链（桌面 + 移动）、AI 建档对话→确认启用→写回档案、手工新建→归档→重新启用、360px 无横向溢出、**真实模型不可用时回退本地 Mock 并明确标注** |
| `app\e2e\complete-mock-data.spec.ts` | 3 | 完整演示数据覆盖全部主模块、报告数据源和建议应用 |
| `app\e2e\fitness-freeform.spec.ts` | 2 | 自由距离/时长运动跨页联动，旧 JSON 兼容与非法数据拒绝 |
| `app\e2e\persistence.spec.ts` | 4 | 步骤 6：饮水记录刷新后仍在且不累加、长期计划与「进行中」状态刷新后仍在、提醒开关与时间刷新后仍在；步骤 7：清空本机数据后界面与刷新均回到初始示例数据 |
| `app\src\lib\mock-data-transfer.test.ts` | 26 | 0.2.0 序列化、round-trip、0.1.0 兼容、longTermPlans 校验、计数、CSV |
| `app\src\lib\chat-extract.test.ts` | 24 | 中文档案字段提取、追问、冲突、计划草案、Mock 流式事件和中断 |
| `app\src\lib\long-term-plan.test.ts` | 23 | 长期计划校验、周范围、周进度、整体进度和估算完成量 |
| `app\src\lib\plan-draft.test.ts` | 22 | 草案 ↔ 计划互转、标题/日期/周目标校验文案、档案补丁展示、过去日期回退与过期里程碑过滤 |
| `app\src\lib\profile-rules.test.ts` | 11 | 年龄等越界字段过滤、空补丁、丢弃字段提示 |
| `app\src\lib\persist-state.test.ts` | 11 | 步骤 6：记录 round-trip、schemaVersion 与保存时间、v0 迁移、未来版本拒绝、损坏记录返回 null、非法快照降级、备份结构等价 |
| `app\src\data\complete-mock-data.test.ts` | 5 | 完整演示数据结构和跨模块引用 |
| `app\src\lib\ai-chat-client.test.ts` | 13 | 步骤 8b：SSE 增量解析（含跨块/CRLF）、健康探测、授权关闭不联网、首事件前失败回退、已有内容后失败不回退、abort 不误回退、标签与状态 |
| `app\src\lib\ai-report-client.test.ts` | 10 | 步骤 8c：`/api/health` 探活（含 404/网络失败）、报告请求体与 JSON 头、503/429/网络失败的错误文案与 `status`、400/坏 JSON/坏形状 → `ReportContractError`、abort 透传、`parseReportContent` 未知字段与缺字段、来源标签常量 |
| `server\test\*.test.ts` | 58 | 服务端：config 4、contract 9、rate-limit 3、extract 8、deepseek 7、chat 7、prompts 3、report 17（报告请求校验 7 / 内容净化 4 / 路由 6） |
| `app\src\lib\countdown.test.ts` | 4 | 倒计时边界和格式化 |

### 10.3 最新构建产物

```text
dist/index.html                  0.61 kB（611 B）
dist/favicon.svg                9,522 B
dist/icons.svg                  5,031 B
dist/assets/index-CrJgYfMj.css  137,705 B（137.70 kB，gzip 23.83 kB）
dist/assets/index-DmnjkjkL.js   564,705 B（564.70 kB，gzip 168.01 kB）
```

产物演进（便于识别“哈希变了是否正常”）：

1. 步骤 6 完成时：`index-DqZtxRhx.js` 552.61 kB（持久化层让主 JS 从 549.09 kB 涨 3.52 kB）、`index-DBVxLcSp.css` 139.92 kB。
2. `chore:` 清理后：删除 `persist.css` 中 173 行 `.preview-*` 样式，CSS 降至 137.64 kB，JS 不变（`PreviewPages` 本来未被引用，早已 tree-shaken）。
3. `style:` 格式化后：输出**逐字节相同**（格式化未改变语义），直至 2026-11-03 现状整理时复跑 `npm run build` 仍为 `index-C9ZcsQCi.css` / `index-D5Nq3TbM.js`——因此看到这两个哈希说明代码停在步骤 6。
4. 步骤 7（`a544a38`）后：主 JS 从 552.61 kB 涨到 554.38 kB（`index-BBQQW4ug.js`，+1.77 kB：清空逻辑、基线构造函数与 Context 契约），**CSS 哈希完全未变**（`index-C9ZcsQCi.css` 137.64 kB）——因为新卡片复用了既有 `.settings-danger-card` / `.settings-danger-button` 样式，没有新增 CSS。看到 `index-BBQQW4ug.js` 即代表代码停在步骤 7 之后。
5. 步骤 8b（`b99d3ad`）后：主 JS 从 554.38 kB 涨到 **560.36 kB**（`index-CsKy1ArK.js`，+5.98 kB：SSE 客户端、健康探测、回退逻辑、动态来源文案与日期兜底），**CSS 哈希与体积仍未变**（`index-C9ZcsQCi.css` 137.64 kB）——8b 只复用既有 `plan-chat-*` 样式并新增了一个复用基类的提示段落。看到 `index-CsKy1ArK.js` 即代表代码停在步骤 8b 之后。
6. 步骤 8c（`bdd4265`）后：主 JS 涨到 **564.70 kB**（`index-DmnjkjkL.js`，+4.34 kB：报告客户端、探活与错误分流、报告页引用与文案），CSS 哈希变为 `index-CrJgYfMj.css`（137.70 kB，+0.06 kB：只新增了回退提示的一行颜色规则）。看到 `index-DmnjkjkL.js` + `index-CrJgYfMj.css` 即代表代码停在步骤 8c 之后。

> 更正：§18 第 42 条把清理后的 CSS 体积记成了「134.42 kB」，实测应为 137.64 kB（本次复核已确认，见 §18 第 44 条）。

2026-11-03 构建仍提示主 JS 超过 Vite 默认 500 kB 提示线。当前不影响验收，后续建议按路由懒加载拆包（`/plans` 是天然的懒加载候选）。

### 10.4 Lint 警告

3 条均为既有 `react(set-state-in-effect)` 警告，模式一致（`?new=1` 深链参数在 effect 中同步 setState 打开面板）：

```text
app\src\pages\StudyPage.tsx:339
app\src\pages\DietPage.tsx:520
app\src\pages\FitnessPage.tsx:1373
```

注意：行号会随格式化/编辑漂移，判断依据是 `react(set-state-in-effect)` 与 `searchParams.get('new')` 这一对特征，不要只认行号。

处理建议：

- 不在视觉验收前大范围改写。
- 修复时分别验证查询参数打开弹窗、页面数据同步和饮食记录状态。
- 每次修复后重跑对应 E2E、全量 E2E 和构建。

### 10.5 视觉检查细节

> **运行前提（2026-11-04 踩过的坑，必须遵守）**：步骤 8b 之后 `/plans` 打开 AI 对话框时会先探测 `/api/health`。`visual:check` 只连接已有 dev server、**自己不启动后端**，所以跑之前必须让同源 `/api` 可达，二选一：
> 1. 先起本机服务端（无 Key 即可）：`cd server; node dist/index.js` → 探针返回 200 `ai:"disabled"`，对话如实显示「本地生成 · Mock 对话」，与基线一致；
> 2. 或用 `PERSIST_API_TARGET` 把 dev server 的 `/api` 代理指到任意返回 200 的服务。
>
> 若 `/api` 无人应答，Vite 代理会回 `502 Bad Gateway`，浏览器把每个受影响的 `/plans` 状态记成 2 条控制台错误 ⇒ `consoleErrors > 0`，脚本以 **exit code 1** 判失败（截图像素其实是对的，但脚本按「控制台零错误」的标准判不通过）。这不是 UI 回归，看到 `502` 请先起后端再跑。

脚本：

```text
D:\Persist\app\scripts\visual-check.mjs
```

检查页面与状态（共 15 档）：

```text
今日 / 健身 / 饮食 / 学习 / 档案 / 报告 / 设置
健身新增弹窗 / 饮食新增弹窗 / 学习新增弹窗
长期计划：空状态 / 进行中计划 / 草案列表 / AI 建档对话 / 草案确认表
```

`/plans` 的五个状态已纳入脚本（2026-11-03）。其中「待确认草案列表」在现有代码里没有可进入的入口，脚本里的 `plans-draft` 是通过直接注入草案状态得到的，报告时不得声称页面能自然走到该状态。

脚本对 `档案` 状态额外做「必需元素」断言：六个视口下「AI 建档」按钮都必须可见（`missingElements` 指标），防止窄屏隐藏规则再次把主入口吃掉。

检查宽度（6 个视口）：

```text
1440 / 500 / 430 / 421×926（6.78 英寸 20:9 真机参考，1264×2780 @3x） / 390 / 360
```

输出：

```text
D:\Persist\design\
```

15 个状态 × 6 个视口 = 90 张主截图，另加一张 `desktop-1440-quick-record.png` 供快速记录浮层人工检查，共 91 张。弹窗类状态只截视口尺寸（不整页），否则居中弹窗在长图里会显得偏上。

最后一次完整视觉检查时间为 **2026-11-04 10:0x**（步骤 7 卡片与 8b 对话文案之后，先按上文前提起了无 Key 后端）：`states 15 / screenshots 90 / overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / quickRecordReady true / failures 0`（另加快速记录 1 张，共 91 张，exit 0）。`design/` 中 **77 张 png 更新（14.4 MB）**，已在用户桌面端与移动端验收通过后作为 `chore:` 提交入库；未变的 16 张里 `/profile`、`/reports` 六视口像素级一致（8b 未碰这两页），其余是历史遗留图。变化构成：今日页倒计时与饮食/健身/学习页的「今天」类内容随日期自然漂移（每次重跑都会变，不是回归）+ 步骤 7 设置页危险区卡片 + 8b `/plans` 对话副标题与侧栏徽标。上一次完整检查为 **2026-11-03 14:00**（步骤 6 后，指标同为全零，视觉基线未因持久化改变）。全站弹窗已统一居中（`surface.css` + `home-v3.css` 的 `.backdrop` / `.sheet` 改为 `align-items: center`，窄屏 sheet 用 `width: min(100%, 580px)` + `max-height: calc(100dvh - 36px)` + 内部滚动）。

> **8c 之后的视觉基线状态（2026-11-04，已闭环）**：8c 改了 `/reports` 的可见文案与控件——徽标从「本地生成 · Mock 报告」变为按探测结果显示「DeepSeek 生成 · 经本站服务端代理」或 Mock 文本（无后端时即 Mock），删掉了「模拟失败」按钮，生成面板与服务卡片文案改为服务端代理口径，报告详情底部说明按 `origin` 分三种。随后已按同一前提（先起无 Key 后端，探针 200 `ai:"disabled"` ⇒ 页面稳定显示 Mock 徽标）单独重跑 `visual:check`：`design/` 中 6 张 reports 相关 png 更新，`overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`（exit 0），经用户桌面端 + 移动端验收通过后随 `7625865`（`chore:`）提交推送。**reports 基线现与 8c 代码一致，不再是待办。**

---

## 11. 本地运行与检查命令

### 11.1 启动开发服务

```powershell
cd D:\Persist\app
npm install
npm run dev -- --port 4173
```

打开（验收用 4173 与 E2E / 视觉脚本同端口，避免两套数据不同步）：

```text
http://127.0.0.1:4173/
```

需要手机在同一个 Wi-Fi 下访问时，绑到全部网卡：

```powershell
npm run dev -- --host 0.0.0.0 --port 4173
```

然后在手机浏览器打开 `http://<本机局域网 IP>:4173/`（用 `cmd /c ipconfig` 查 IPv4）。注意：Windows 防火墙默认可能拦截入站 4173，需管理员放行，否则手机只会超时——这种情况优先用 Chrome DevTools 设备模拟（Device Toolbar 设自定义 421×926 / DPR 3）替代。

2026-11-03 验收时开发服务一直在 4173 运行，用户在桌面端与该设备模拟下完成验收。现在数据会写入本机 IndexedDB：同一浏览器里刷新与重开都不会丢；只有清除站点数据才会回到初始 Mock。若反复点「加载完整演示数据」，请注意那会覆盖当前本机数据。

### 11.2 常用检查

```powershell
cd D:\Persist\app
npm run typecheck
npm test
npx playwright test
npm run lint
npm run build
```

### 11.3 视觉检查

Playwright 默认使用 4173 端口并由配置自动启动开发服务：

```powershell
cd D:\Persist\app
npx playwright test
```

视觉脚本默认目标也是 4173：

```powershell
cd D:\Persist\app
npm run visual:check
```

> **前置条件（2026-11-04 起）**：8b 之后 `/plans` 会探测 `/api/health`，所以跑之前先让同源 `/api` 可达——最省事的做法是另开一个终端起本机后端：`cd D:\Persist\server; node dist/index.js`（无 Key 也会返回 200 `ai:"disabled"`，UI 显示 Mock，与基线一致）。后端不在时 Vite 代理回 502，脚本会因控制台错误判失败（exit 1），详见 §10.5。

如果只启动了 5173，可指定：

```powershell
$env:PERSIST_URL = 'http://127.0.0.1:5173'
npm run visual:check
```

### 11.4 测试注意事项

- 验证动态记录是否保留**可以**用刷新（步骤 6 后持久化已生效），但刷新前要等 200 ms 防抖写盘完成（`e2e/persistence.spec.ts` 的 `waitForPersistFlush()` 留了 450 ms 余量），否则可能读到上一版数据而误判失败。
- 持久化用例之间记得互不污染：同一 Playwright context 内刷新会保留数据，跨用例需要新 context（Playwright 默认每个 test 新 context，通常无需手动清理）。
- 验证跨模块数据时使用应用内导航，不要中途 `page.goto()`。
- 视觉验收前可先加载完整演示数据。
- 需要等待 toast 的用例请直接断言 `.toast` 的文本（`cn('toast', toast && 'show')` 已修复，不再出现 `toastshow`）。
- 窄屏下 `.head-actions` 里的次要按钮多数按设计隐藏（今日「编辑计划」、健身「训练模板」），但 `today-report-action`（AI 报告）与 `profile-onboard-action`（档案页「AI 建档」）是例外，窄屏必须可见，`plans.spec.ts` 与视觉脚本都会断言这一点。
- `plans.spec.ts` 依赖「我今年 28 岁……帮我生成计划」这句话触发一次成稿：句子含「生成」才会命中 `PROPOSAL_TRIGGERS`，从而跳过追问；改动触发词会影响该用例。
- Playwright 使用本机 Chrome `channel: 'chrome'`。
- 运行 E2E、视觉脚本和构建会产生文件写入，需要注意权限。

---

## 12. 用户视觉验收清单

建议先打开设置，点击“加载完整演示数据”，再按以下清单检查。

### 12.1 全局

- [ ] 桌面侧栏五项主导航显示正确。
- [ ] 移动底部五项导航显示正确且文字不挤压。
- [ ] 当前导航高亮正确。
- [ ] 今日页头部有 AI 报告按钮。
- [ ] 移动顶栏设置、档案入口可用。
- [ ] 快速记录悬浮按钮可用。
- [ ] Toast 不遮挡关键操作。
- [ ] 页面切换无横向滚动。
- [ ] 浏览器控制台无错误。

### 12.2 今日

- [ ] 两个目标倒计时显示正常。
- [ ] 目标编辑、启停正常。
- [ ] 计划新增、编辑、删除、完成正常。
- [ ] 四项指标与数据一致。
- [ ] 时间线内容完整。
- [ ] 晨间简报可打开并反映饮水变化。
- [ ] 晚间复盘可填写、保存、重新进入后保留。
- [ ] 今日 AI 报告按钮和主导航按钮均能进入报告页。

### 12.3 健身

- [ ] 模板、动作和套组展示正常。
- [ ] 点击“记录运动”可以自由输入任意动作名。
- [ ] 选择距离运动时只要求合理字段，不出现错误 `kg` 文案。
- [ ] 跑步 3.2 km / 18 分钟可保存。
- [ ] 跳绳、足球等时长运动可保存。
- [ ] 新动作会加入当前训练列表。
- [ ] 套组完成状态和训练统计同步。
- [ ] 完成训练会改变会话状态。
- [ ] 今日时间线出现训练摘要。
- [ ] AI 报告分析依据包含统一训练摘要。
- [ ] 移动端训练弹层可操作且无溢出。

### 12.4 饮食与饮水

- [ ] 四个餐次可展开。
- [ ] 食物可新增、编辑、删除。
- [ ] 营养汇总随食物变化。
- [ ] 照片附件 Mock 可展示。
- [ ] 外部 AI 营养文本可解析、预览和确认登记。
- [ ] 饮水快捷记录、自定义和撤销正常。
- [ ] 今日晨间简报饮水指标同步。
- [ ] AI 报告饮食依据同步。

### 12.5 学习

- [ ] 英语和高数记录可新增、编辑、删除。
- [ ] 对应字段显示正确。
- [ ] 7 天趋势和来源统计正常。
- [ ] AI 观察依据可查看。
- [ ] 前往 AI 报告入口可用。
- [ ] 今日学习上下文同步。

### 12.6 档案与设置

- [ ] 档案分步编辑正常。
- [ ] 完整度和 BMI 正确更新。
- [ ] 档案 AI 授权与设置同步。
- [ ] 档案 JSON 可导出。
- [ ] 提醒、AI 数据源可切换。
- [ ] Mock 连接测试有明确 Mock 提示。
- [ ] JSON 导出后可重新导入。
- [ ] CSV 导入会追加学习记录。
- [ ] 非法 CSV/JSON 不覆盖现有数据。
- [ ] 快照显示生成时间和记录数。
- [ ] 「清空设置」只重置设置项、不误导为删除全部业务数据；「清空本机数据」删除全部本机记录并回到初始示例数据（步骤 7 新增，中文二次确认 + toast）。

### 12.7 长期计划（`/plans`）

- [ ] 档案页「AI 建档」可打开对话（窄屏同样可见，见 12.10）。
- [ ] 对话流式文本、追问选项、停止生成正常。
- [ ] 草案表可修改标题、目标、起止日期、每周目标；非法值给中文提示而不是崩溃。
- [ ] 未确认前档案与长期计划都不发生变化。
- [ ] 确认后 toast 提示「已启用长期计划」，`/plans` 显示「进行中」。
- [ ] 写回档案的字段与对话内容一致；越界字段有丢弃提示。
- [ ] 手工新建 → 归档 → 重新启用全流程可用。
- [ ] 同一时间只有一个「进行中」计划，旧计划出现在归档列表。
- [ ] 页面明确标注对话来源：「DeepSeek 生成 · 经本站服务端代理」或「本地生成 · Mock 对话」；未授权时不发网络请求，回退时有明确提示。
- [ ] 360px 下草案行与操作按钮不溢出，操作区换行后左对齐。
- [ ] 刷新后计划与「进行中」状态仍在（步骤 6 后由本机 IndexedDB 恢复；清站点数据才会回到初始 Mock）。

### 12.8 报告

- [ ] 报告类型、周期和历史可查看。
- [ ] 生成中、成功、失败 Mock 状态完整。
- [ ] 数据源开关影响分析依据。
- [ ] 训练、饮食、学习、档案依据可查看。
- [ ] “应用建议”会更新今日计划并跳转。
- [ ] 明确显示未调用 DeepSeek。
- [ ] 移动端报告页无溢出。

### 12.9 响应式

- [ ] 1440px 桌面布局正常。
- [ ] 500px 平板/窄桌面布局正常。
- [ ] 430px 手机布局正常。
- [ ] 421×926（6.78 英寸 20:9 真机参考）布局正常，档案页「AI 建档」与「AI 报告」入口可见。
- [ ] 390px 手机布局正常。
- [ ] 360px 手机布局正常。
- [ ] 弹层打开时仍无横向滚动，弹窗垂直居中而非贴顶。
- [ ] 长弹窗在小屏内可内部滚动，底部按钮不被裁掉。
- [ ] 底部导航不遮挡主要内容和操作按钮。

### 12.10 窄屏头部按钮例外（2026-11-03 调整）

≤900px 时 `.head-actions` 会隐藏次要按钮以省空间，但以下两个是主入口，**窄屏也必须可见**：

- 今日页「AI 报告」（`.today-report-action`）
- 档案页「AI 建档」（`.profile-onboard-action`）

仍按设计隐藏的是今日页「编辑计划」与健身页「训练模板」，二者在页面内有其它入口（今日计划区、健身模板区），不算功能缺失。`plans.spec.ts`、`visual-check.mjs` 的 `mustShow` 断言与本清单都必须与此一致；如需恢复这两个按钮，只改 `home-v3.css` 的 `:not()` 列表即可。

---

## 13. 下一阶段路线与优先级

### P0：用户视觉验收与前端冻结（✅ 已完成，2026-11-03）

目标：

- 收集用户对八个页面（含 `/plans`）和关键弹层的视觉反馈。
- 重点复核本轮修复的 toast、导航高亮、各页状态样式（此前类名未命中，视觉上一直缺失）。
- 确认五项主导航、今日 AI 入口、自由运动输入体验、长期计划入口位置。
- 冻结页面结构和主要交互，避免持久化改造期间反复返工。

完成标准：

- 用户明确视觉验收通过，或形成一份具体问题清单。
- 问题修复后重跑对应 E2E、全量 E2E、视觉检查和构建。
- 不再在验收期间扩大功能范围。

### P1：完成 AI 引导建档与长期计划闭环（✅ 已全部完成，2026-11-03）
目标：

- 将已有的规则解析、Mock 流式对话和长期计划模型接入真实页面。
- 形成一个从自由描述到确认写入的完整闭环。
- 仍然明确标识本地 Mock，不冒充真实 DeepSeek。

已完成（2026-11-02）：

1. ✅ 档案页「AI 建档」入口 + `/plans?onboard=1` 深链，今日页「长期计划 →」入口。
2. ✅ 用 `createMockChatClient()` 驱动流式文本、追问选项、草案和警告展示。
3. ✅ 支持停止生成、重新生成、修改补充信息；确认应用草案。
4. ✅ 确认后 `profilePatch` 经 `sanitizeProfilePatch` 写回档案，并创建/启用长期计划，旧计划归档。
5. ✅ 长期计划列表、详情、启用、归档、周进度展示（`/plans`）。
6. ✅ 估算字段显式标注；饮食未接入处不伪造进度。
7. ✅ `longTermPlans` 已进入备份层 0.2.0 序列化/解析/计数。
8. ✅ 设置页已切换到 `serializeMockBackup()` / `parseMockBackupJson()`，导出含 `longTermPlans`，导出/导入 E2E 已覆盖。
9. ✅ E2E：描述目标 → 草案 → 确认 → 档案与计划更新、手工新建 → 归档 → 重新启用、360px 无溢出；档案页 AI 建档入口桌面与移动均验证。
10. ✅ 视觉检查已重跑（15 状态 × 6 视口），并经用户桌面端 + 移动端验收通过。

P1（AI 引导建档 + 导出导入 0.2.0 + 全页面视觉复核）**已全部完成并冻结**，不再有收尾项；Git 提交链从 `bd779eb` 起已全部推送（含 P2 的 `128d6a2`、清理 `d4c9696` 与 `style:` 格式化）。P2 本机持久化（§0.4 步骤 6）也已完成（2026-11-03），详情见 §13 P2 与 §6.6；P3-0「清空本机数据」入口（步骤 7）同样已完成（`a544a38`，见本节 P3-0）。**P3 服务端 AI 代理已完成 8a（`9138175`）与 8b（`b99d3ad`），下一步是 8c AI 报告接服务端**（服务器环境已就绪，见 §0.4 步骤 8–10 与 `docs/部署与服务器现状.md`）。

完成标准：

- 用户可以通过自然语言完成一版可执行计划草案。
- 未确认前不会修改档案或计划。
- 确认后档案与长期计划正确更新。
- 页面明确显示对话来源（真实代理或本地 Mock），回退时另有说明。
- 长期计划能通过 JSON 导出导入，旧 0.1.0 备份可兼容导入。
- 新流程有 E2E、单元测试和移动端视觉验证。

### P2：本地持久化 ✅ 已完成（步骤 6，2026-11-03）

实现选择说明：原计划写「Dexie / IndexedDB」，实际**没有引入 Dexie 运行时依赖**，改用原生 IndexedDB（`lib/persist-storage.ts`）＋纯函数记录层（`lib/persist-state.ts`）。原因有两条：一是本环境 `npm install` 受沙箱与 `G:\Vue\node\node_cache` 缓存路径限制（EPERM），加新依赖的验证成本高；二是当前只有「单用户单记录」场景，Dexie 的查询/仓储能力用不上，原生 API 约 200 行即可覆盖，且没有版本升级时的第三方行为黑盒。如后续拆成多 store / 多表查询，再评估引入 Dexie。

实际完成：

1. **记录结构**：一条记录 `id = 'persist-mock-state'`，内含 `schemaVersion`、`savedAt`、`backup`（复用备份层 0.2.0 格式，含 13 个切片）和可选 `snapshot`；数据库 `persist-app` 版本 1，对象仓 `mock-state`。
2. **迁移机制**：`MIGRATIONS` 按 `schemaVersion` 逐级升级（当前 v0 → v1 处理无版本号的早期记录）；未来版本记录返回 `unsupported-version`，只读不覆盖。
3. **Provider 改造**：`MockDataProvider` 首挂载水合（完成前返回 `null`）、200 ms 防抖写整条记录、`pagehide` / `visibilitychange` 补写；13 个状态切片与全部回调签名不变，页面零改动。
4. **异常处理**：IndexedDB 不可用 / 打开超时 2 s / 被其它标签页 block → `unavailable`，退回纯内存；记录损坏 → `corrupt`，退回初始 Mock 且不清空用户数据。
5. **导入后恢复**：导入备份走同一个 `replaceMockData()`，随即被写盘，刷新后保持导入结果；校验函数 `parseMockBackupValue()` 由导入与读盘共用。
6. **测试**：`persist-state.test.ts` 11 条单测（round-trip、迁移、版本拒绝、损坏降级、快照容错）；`persistence.spec.ts` 3 条 E2E × 2 项目，真实 `page.reload()` 验证饮水、长期计划、提醒设置都能恢复且不累加。

完成标准核对：

- ✅ 创建记录后刷新仍存在（E2E `persistence.spec.ts` 三条用例，桌面 + 移动）。
- ✅ 关闭浏览器后重新打开仍存在（IndexedDB 持久化语义；未做真实重启浏览器的自动化，属已知验证边界）。
- ✅ 旧 Mock JSON 能迁移为持久化数据（v0 迁移单测 + 0.1.0 / 0.2.0 导入均可写盘）。
- ✅ 数据库异常不静默丢数据（`unavailable` / `corrupt` 降级路径有单测；无“回滚提示”Toast，只在控制台告警——这是与原始完成标准的一处差异，见 §14.2）。
- ⚠️ 跨日期流程未做自动化：数据不按日期分区，`waterLog` 等按日期字段自然累积，跨日切换规则仍属未验证项。
- ✅ 「加载完整演示数据」仍是显式操作（设置页按钮），不会自动写盘污染数据。

未做（留给 P4 / 后续）：跨标签页同步、导入前自动备份、容量上限提示、按日分区与跨日 E2E。原「清空本机数据 UI 入口」缺口已在步骤 7 补齐（见下节 P3-0）。

### P3-0：清空本机数据入口 ✅ 已完成（步骤 7，2026-11-03，`a544a38`）

目标：设置页提供「清空本机数据」，让用户和测试都能在不手动清站点数据的情况下回到初始 Mock 状态。

实际实现：

1. **Context 契约**：`MockDataContextValue` 新增 `clearLocalData(): Promise<void>`，`MockDataProvider` 暴露并在依赖数组登记；其余 13 个切片与回调不变。
2. **基线复用**：新增模块级 `createInitialMockData()`，与 `useState` 初值一一对应（`waterLog: []`、`fitnessSession: null`、`snapshot: null`、`longTermPlans: []`，水量基线仍由 `INITIAL_WATER_MILLILITERS = 1_200` 显示 1.2 L），保证清空结果与首次打开完全一致。
3. **顺序（不能换）**：`persistEnabledRef = false` 停写回 → `clearTimeout(saveTimerRef.current)` 掐掉已排队的 200 ms 防抖写入 → `clearPersistedState()` 删除 IndexedDB 记录 → `replaceMockData(createInitialMockData())` 重置内存态（含 `snapshot = null`）→ 同步刷新 `latestStateRef`（防清空后立刻关页面时 `pagehide` 补写旧数据）→ `persistEnabledRef = true` 恢复写回。`hydrated` 保持 true，不重新水合，避免再次读到刚删掉的记录。
4. **UI**：`SettingsPage` 第二张危险区卡片（`settings-danger-card`，kicker `RESET · LOCAL DATA`）+ 中文二次确认 `ConfirmDialog`（`alertdialog`，标题「清空本机数据？」，确认按钮「确认清空」，`danger`）+ toast「本机数据已清空 · 已恢复初始示例数据」/「清空失败：…」。原有「清空设置」按钮改名 `clearMockSettings` 并保持只重置设置项，两张卡片文案已明确区分。
5. **测试**：`persistence.spec.ts` 新增第 4 条（清空 → 刷新 → 断言初始态），桌面与移动两个项目都真实刷新验证。

完成标准核对：

- ✅ 清空后界面立刻回到初始 Mock（E2E 断言提醒开关回勾、快照区「尚未生成快照」）。
- ✅ 刷新不再复现旧数据（E2E 断言 1.2 L 且不含 1.5 L；若防抖把旧数据写回，此断言会失败）。
- ✅ 未破坏持久化主路径：原 3 条刷新用例不变且全绿，E2E 总数 100 次执行 0 跳过 0 失败。
- ✅ 视觉基线已于 2026-11-04 重跑（步骤 7 卡片 + 8b 文案之后）：91 张全绿、77 张 png 更新，用户双端验收通过（当时错过的这条在 8b 收尾时补齐，详见 §10.5）。

### P3：服务端 AI 代理

前置：步骤 7（P3-0）已完成（`a544a38`）；服务器环境已就绪（见 `docs/部署与服务器现状.md`），P3 代码先在本地跑通，部署属步骤 9。

#### 8a 服务端骨架 ✅ 已完成（2026-11-03，`9138175`）

实际实现（`server/`，Fastify 5.7.4 + TypeScript，Node 20 兼容）：

1. `config.ts`：环境变量解析与钳制（host/port/trustProxy/日志级别/Key/baseUrl/model/超时/重试/限流/最大轮数）；`describeConfig()` 只回显非敏感项。
2. `contract.ts`：`parseChatRequest()` 严格校验（turns 1..20、单条 ≤2000 字、总量 ≤12000 字、最后一条必须是 user、档案 5 个数字 + 8 个文本 + `aiConsent` 布尔、`askedFields` ≤30×40）；错误体统一 `{ error: { code, message } }`。
3. `ai/deepseek.ts`：流式 SSE 客户端（解析 `data:`、忽略 `[DONE]`）+ 非流式 JSON 客户端；每次尝试 25 s 超时、调用方 abort 直通上游、只对 429/5xx/网络错误重试（默认 1 次），**流式已出内容后不再重试**（否则同一段话出现两次）。
4. `ai/prompts.ts`：中文 system prompt（不编造、医疗问题引导就医、不复述隐私、≤150 字）+ 档案摘要 + 最近 12 轮上下文；抽取用独立 JSON prompt。
5. `ai/extract.ts`：`sanitizeProfilePatch`（丢 aiConsent/越界数字/空值/未变化字段/超长文本）、`sanitizeQuestions`（字段白名单、去重、≤4）、`sanitizeTargets`（单位白名单、perWeek 1–999、≤4）、`sanitizeMilestones`（真实 ISO 日期、≤6）、`sanitizeProposal`（无合法周目标则整份作废）。
6. `routes/chat.ts`：`reply.hijack()` + SSE headers（含 `X-Accel-Buffering: no`）、15 s `: ping` 心跳、`res.on('close')` → abort；事件顺序严格按前端契约；失败发 `{ type: 'error' }` 且不发 `done`。
7. `rate-limit.ts`：按 IP 滑动窗口（默认 20 次/5 分钟），超限 429 + `Retry-After`。
8. `app.ts` / `index.ts`：依赖注入（ai/fetch/now）便于测试；错误与 404 统一 JSON；SIGINT/SIGTERM 优雅关闭；未配 Key 时启动告警。
9. `.env.example`、`server/.prettierrc`、`server/.prettierignore`、`server/README.md`；`.gitignore` 增加 `server/dist/`、`server/.npm-cache/`。

验证（2026-11-03，本机）：

- `npm run typecheck` 0 错；`npm run build` 通过（dist 10 个 js，`dist/index.js` 1,034 B）；`npm run format:check` All matched。
- `npm test` **38/38**（6 文件：config 4、contract 9、rate-limit 3、extract 8、deepseek 7、chat 7）；覆盖契约、限流、净化、SSE 解析、429 重试、4xx 不重试、超时、取消、无 Key、错误断流、429 限流、404。
- 冒烟：`node dist/index.js`（PORT=3101）→ `GET /api/health` 200 且 `ai: "disabled"`、`POST /api/chat` 空 turns 400 `invalid_request`。

未做 / 差异（诚实记录）：

- **8a 当时没有真实 DeepSeek Key**：上游返回格式、真实延迟与输出质量当时全部用注入的 fake 客户端 / `fetchImpl` 测试；8b 已用真实 Key 补上联调（见下）。
- **8a 时前端尚未接入**：`PlanChatSheet` 当时仍用 `createMockChatClient()`；8b 已改为可切换真实/ Mock。
- **共享层偏离原计划**：类型暂放 `server/src/contract.ts` 而非 `shared/`，理由与迁移计划见 `server/README.md`。
- 服务端只有按 IP 限流，**没有用户鉴权**（P3 无账号体系）；Fastify 只监听回环，由 Nginx 反代暴露。

#### 8b 前端接入与真实 Key 联调 ✅ 已完成（2026-11-04，`b99d3ad`）

实际实现：

1. 新增 `app/src/lib/ai-chat-client.ts`：浏览器 `fetch` 读 `text/event-stream`，增量解析 SSE（容忍分块切在 JSON 中间、CRLF/空行、`data:` 多行），每个事件立即 yield；`ChatUnavailableError` 区分「服务端明确报错」与普通网络失败。
2. `probeAiChat()` / `createAppChatClient({ consent })`：先 `GET /api/health`，`ai==='deepseek'` 且探活成功才说「AI」；`consent === false` 时直接 Mock，一个网络请求都不发；`status()` 暴露当前来源，`label` 随来源变化。
3. 回退规则（关键语义）：只在**首个非 `stage`/`done` 事件之前**允许回退，一旦收到真实内容就只报错、不切换（避免吞掉半截回答）；`AbortError` 不触发回退；回退后本次会话不再重试真实接口。
4. `PlanChatSheet.tsx`：`useMemo` 按 `profile.aiConsent` 构造客户端；初始副标题按授权显示「正在检测服务端…」或「本地 Mock 对话」，探测/结束后用 `chatClient.status()` 定稿；回退时在对话内渲染 `role="status"` 提示「真实模型暂时不可用，本次已回退到本地 Mock（规则匹配）」。
5. `PlansPage.tsx`：侧栏说明与页面徽标按授权显示「AI 对话 · Mock 兜底」/「本地生成 · Mock 对话」。
6. 开发/测试链路隔离：`vite.config.ts` 的 `server.proxy['/api']` 目标为 `PERSIST_API_TARGET ?? http://127.0.0.1:3000`；`playwright.config.ts` 的 `webServer.env` 把 `PERSIST_API_TARGET` 指到 `http://127.0.0.1:9`，E2E 永不触真实后端，回退用例通过 stub 503 稳定验证。
7. 服务端提示词修复（真实调用发现）：`prompts.ts` 新增 `todayInShanghai()`（`Asia/Shanghai`、`en-CA` 格式），system prompt 与抽取 prompt 都注入「今天是 YYYY-MM-DD，不得给出已经过去的日期」。前端 `plan-draft.ts` 增加兜底：开始日期早于今天则钳到今天、过滤过期里程碑、过期结束日期改用最后一个未来里程碑。
8. 测试：新增 `ai-chat-client.test.ts`(13) 与 `server/test/prompts.test.ts`(3)；`plan-draft.test.ts` 19 → 22；`e2e/plans.spec.ts` 4 → 5（stub `/api/health` 200 + `/api/chat` 503，断言 AI 标签、回退提示与「本地 Mock 对话」）。

验证：

- app：`typecheck` 0 错、`npm test` **139/139**（9 文件）、`playwright test` **102 次执行全绿**、`oxlint` 0 错 3 既有警告、`prettier --check` 通过、`npm run build` 通过（560.36 kB / gzip 166.13 kB）。
- server：`typecheck` 0 错、`npm test` **41/41**（7 文件）、`npm run build` 通过。
- 真实 Key 联调（本机临时进程，仅进程环境变量传 Key，未写入任何文件）：`/api/health` 返回 `ai: "deepseek"`；`POST /api/chat` HTTP 200、3.5 s、流式中文回复 + `proposal` + `done`；首轮曾返回 2025 年日期 → 修复提示词后复验 `startDate=2026-11-03`、`endDate=2026-12-28`、里程碑均为未来日期。

未做 / 已知差异：

- AI 报告仍是前端 Mock（8c）；服务端没有账号鉴权与额度上限；真实 Key 曾出现在对话里，**上线前应轮换**（仓库与构建产物已扫描确认不含 Key）。
- 模型质量仍有波动（追问条数、周目标数量可能与用户描述不完全一致），属提示词调优空间，不阻塞验收。
- 真实调用只在单机单 Key 下验证；并发、限流真实表现与 Nginx 反代下的 SSE 需步骤 9 部署后复验。

#### 8c AI 报告接服务端 ✅ 已完成（2026-11-04，`bdd4265`）

实际实现：

1. `server/src/contract.ts`：抽出 `parseProfile()` 供 chat/report 共用；新增报告契约 `REPORT_TYPES`（今日简报 / 训练建议 / 学习观察）、`REPORT_RANGE_DAYS`（7/30/90）、`ReportRequest{type,rangeDays,digest}`、`ReportContent{title,status,summary,conclusions,actions,warnings}`、`ReportResponse{report,model}`；`digest` 四个来源必须至少有一个非 `null`。
2. `server/src/ai/prompts.ts`：`REPORT_SYSTEM_PROMPT`（只写文字结论、禁止编造与**任何数值推算**、未授权来源不得提及、不输出 Markdown/代码块、不评价意志力、伤病用药引导就医）+ `reportDigestSummary()`（只渲染已授权来源，未授权整段不出现）+ `buildReportMessages()`（注入 Asia/Shanghai 今天与统计区间）。
3. `server/src/ai/report.ts`：`sanitizeReportContent()`——title 2–30、status 2–10、summary 20–400、conclusions 2–4（每条 4–80）、actions 2–4（每条 4–80）、warnings 0–4；拒绝 ``` 代码块与列表内重复项；`warnings` 缺省补 `[]`；不合格抛错 ⇒ 路由 502，不返回半成品。
4. `server/src/routes/report.ts`：`POST /api/report`——请求校验 400 `invalid_request`、无 Key 503 `ai_not_configured`、限流 429（与 chat 共用限流器）、25 s 超时 504、上游失败 502、客户端断开 `reply.raw.on('close')` → abort → 499 `client_closed`；成功 200 `{report, model}` + `cache-control: no-store`；不在日志里记录请求体/档案/报告正文。
5. `app/src/lib/report-types.ts` + `app/src/lib/ai-report-client.ts`：镜像类型 + `probeAiReport()`（要求 `/api/health` 的 `status==='ok'` 且 `ai==='deepseek'`）+ `requestAiReport()`（POST JSON、网络/超时 503/504 → `ReportUnavailableError`、400/422 与解析失败 → `ReportContractError`、429 显示「请求过于频繁」、`AbortError` 原样抛出）+ `parseReportContent()`（前端再校验一遍长度与条数）。
6. `app/src/pages/ReportsPage.tsx`：`probeState`（probing/ai/mock）由授权 + 探测结果派生 `reportSource`；`reportDigest` 只组装已授权且来源开关打开的模块（未授权为 `null`）；本地生成与 AI 生成共用 `buildDailyReport()` 生成指标/依据/区间，**模型只覆盖文字字段**；AI 不可用 ⇒ 回退 Mock + `REPORT_FALLBACK_NOTE` 且徽标变回 Mock；契约错误 ⇒ 红字报错、不伪造报告、记录不受影响；详情页按 `origin` 显示三种说明（AI / Mock / 示例数据）；服务卡片按来源显示「服务端代理已连接 / 本地 Mock 模式」。
7. `app/src/types.ts`：`ReportRecord` 增加可选 `origin?: 'ai' | 'mock'`（旧数据无此字段，详情按「示例数据」解释）。
8. `app/src/styles/reports.css`：新增一行 `.reports-generation-copy .reports-fallback-note` 颜色。
9. 测试：`server/test/report.test.ts` 17 条（请求校验 7 / 净化 4 / 路由 6），服务端合计 58；`app/src/lib/ai-report-client.test.ts` 10 条，app 合计 149；`e2e/mock-data-flows.spec.ts` 的简报历史用例补断言「Mock 徽标 + 本地 Mock 模式 + 详情说明」（E2E 无后端，恒走 Mock）。

验证：

- app：`typecheck` 0 错、`npm test` **149/149**（10 文件）、`playwright test` **102 次执行全绿（59.5 s）**、`oxlint` 0 错 3 既有警告、`prettier --check` 通过、`npm run build` 通过（`index-DmnjkjkL.js` 564.70 kB / gzip 168.01 kB，`index-CrJgYfMj.css` 137.70 kB / gzip 23.83 kB）。
- server：`typecheck` 0 错、`npm test` **58/58**（8 文件）、`build` 与 `format:check` 通过。
- 真实 Key 联调（本机临时进程，Key 仅经进程环境变量传入，未写入任何文件/构建产物）：`PORT=3001` + `/api/health` 返回 `ai:"deepseek"`；`POST /api/report` 完整摘要 **2.7 s** 返回 200 与中文简报；只授权学习时报告**完全不出现训练/饮食字样**、`warnings` 为空；首次联调模型给出「再补水约 0.5 L」（由 1.5−1.0 推算、摘要里没有该数字）⇒ 提示词改为禁止任何数值推算后复验通过。
- 泄漏检查：`git grep` 与 `app/dist`、`server/dist` 全量扫描均无 `sk-` 开头密钥；服务端日志不含 Key 与请求体。

未做 / 已知差异：

- 报告页的服务端生成只接「今日简报」；`训练建议` / `学习观察` 仍是打开本地已有报告（服务端 `type` 已支持三种，后续可直接接）。
- `/reports` 视觉基线未重跑（8c 改了徽标/服务卡片/生成面板文案与按钮），需用户重新验收后再更新 `design/`。
- 报告不做服务端缓存/去重、不做账号级额度；仍是按 IP 限流。
- 真实报告质量与延迟只在单机单 Key 下观察；Nginx 反代下 `/api/report` 的长请求超时与 SSE 的 `proxy_buffering off` 需步骤 9 复验。

目标：

- 在 `server/` 实现 Fastify 服务（`127.0.0.1:3000`，兼容服务器 Node 20.20.2）。
- 接入 DeepSeek，前端不再生成 Mock 报告，并复用 `ChatClient` 流式契约实现真实 AI 建档与计划建议。
- 前端只请求相对路径 `/api/*`；Mock 作为「无 Key / 服务不可用」时的降级路径。

建议工作：

1. 定义 AI 请求/响应 schema（放 `shared/`，前端与服务端复用）。
2. 仅允许授权数据源进入请求。
3. 服务端保存 API Key（`/etc/persist/server.env`，600）。
4. 增加鉴权、限流、超时、缓存和重试上限。
5. 增加结构化响应校验与失败降级。
6. 日志脱敏，不记录完整敏感档案。
7. 前端接入加载、成功、失败、重试和取消状态。
8. 报告生成后仍由用户确认是否写入计划。
9. 部署侧：本地构建上传 `app/dist`，Nginx 配 `try_files` 深链回退 + `/api` 反代 + gzip/长缓存，Fastify 由 systemd 常驻（命令与配置草案见 `docs/部署与服务器现状.md`）。

完成标准：

- 前端构建产物和 Android 包中没有 API Key。
- 未授权数据源不会发送。
- 服务端超时/错误不阻塞记录功能。
- 返回内容通过 schema 校验。
- 报告可追溯数据范围但不泄露敏感原文。
- IP 直连部署可验收：`http://<IP>/` 可打开、`/reports` 直接刷新不 404、`/api/health` 返回 200。

### P4：数据层与 AI 综合分析（终态架构）

> 2026-11-04 用户拍板方向：**本地优先 + 服务端可检索副本**（路线 2），不是「继续加厚前端摘要」（路线 1）。完整设计已定稿：**`docs/P4-数据层与AI综合分析设计方案.md`**（目标架构、SQLite DDL、同步协议、事实包契约 v2、隐私边界、部署影响、拆分与验收）。本节只保留执行口径，细节以该文档为准。

目标：

- 让「AI 检索我的全部历史记录做综合分析」成立，而不是只对前端临时摘要做润色：IndexedDB 仍是写入与离线的权威，后台增量同步到自建 Fastify + SQLite；**服务端 SQL 算数字，模型只写文字**；报告可归档、缓存、可选定时生成。
- 补齐账号（设备令牌 + 恢复码）、备份/恢复/导出/删除，使数据能换设备、能找回、能带走、能删除。

前置条件（必须先做，否则无从分析）：

- **8d 数据历史化**：当前只有学习记录带日期是真实历史；健身历史是 `FitnessPage.tsx` 的演示常量，饮食只有「今天」，饮水无日期，计划只存当天。先升级为按日台账 + 真实训练历史（`schemaVersion` 1→2、备份 0.3.0）。
- **SQLite 驱动选型**：服务器 Node 20 无内置 `node:sqlite`；要么升级 Node 22 LTS 用内置模块（推荐，无 native 依赖），要么保留 Node 20 用 `better-sqlite3`（需编译工具链）。开工前一次性定死，驱动封装在 `server/src/db/driver.ts`。

建议工作（拆成四步，每步独立验收、独立提交）：

- **步骤 11（8d）**：数据历史化；健身历史列表改读真实记录，空态明确；饮食/饮水/计划按日归档；v1→v2 迁移与 0.1.0/0.2.0 备份导入兼容。
- **步骤 12（P4a）**：SQLite 表结构 + migration + repository；`/api/v1/devices*`、`/api/v1/sync/{bootstrap,push,pull}`（opId 幂等、LWW、墓碑、rev 游标）；客户端 outbox/拉取/合并；设置页同步区块（开关、恢复码、最后同步、吊销）。
- **步骤 13（P4b）**：facts builder（逐日/逐周/趋势/覆盖率，按 `settings.sources` 过滤未授权模块）、`ANALYSIS_SYSTEM_PROMPT`（禁止任何算术）、`/api/v1/analysis/{facts,reports}`、报告归档 + `dataRev` 缓存 + 可选每日定时简报 + 规则降级；报告页渲染 `analysis` 段落与服务端指标，失败按码分流（离线回退 8c 本地报告并标注）。
- **步骤 14（P4c）**：`/api/v1/backups*`（`VACUUM INTO` 快照 + sha256 + 恢复预览 + 二次确认 + 恢复前自动备份）、`/api/v1/export`（0.3.0 同构 JSON）、`DELETE /api/v1/account`（删数据/报告/备份/设备）、定时备份与保留策略、设置页隐私与数据区块文案。

完成标准：

- 断网可正常记录；联网后服务端可查到同步数据；两台设备用恢复码绑定后双向一致；冲突按 LWW 且可解释；重复 push 幂等。
- 7/30/90 天综合分析的事实包数字与手写 SQL 一致（快照测试）；报告文字来自模型时**无自行推算的数字**（真实 Key 人工核对）；未授权模块在事实包与报告中都不出现。
- 同一 `dataRev` 二次请求命中缓存、不重复调模型；新增记录后重新生成；无 Key/超时降级为服务端规则报告并如实标注；契约非法返回真实错误，不伪造报告。
- 能从空库恢复完整数据；损坏备份不覆盖当前库；恢复失败可回滚；导出 JSON 可被客户端导入；删除账号后服务端与备份无残留。
- 每步：类型检查 0 错、单测/E2E/构建全绿、有视觉变化则重跑基线并经用户双端验收、文档同步、按主题独立提交并推送。

### P5：Capacitor Android 发布

目标：

- 从浏览器 Mock 过渡到可安装 Android 应用。

建议工作：

- 接入 Capacitor 和 Android 工程。
- 配置网络、通知、分享和安全区。
- 验证返回键、键盘、横竖屏和后台行为。
- 验证 IndexedDB 在 WebView 中的持久化。
- 执行 USB 安装、真机测试和升级迁移。
- 配置离线与 AI 不可用降级。

完成标准：

- 目标手机可安装并启动。
- 断网可记录。
- 数据和设置重启后保留。
- 升级安装不丢数据。
- 真机无安全区遮挡和键盘遮挡。

### P6：质量与性能清理

- 修复 3 条 `set-state-in-effect` lint 警告。
- 按路由做 `React.lazy()` / 动态导入，拆分 548.38 kB 主包（`/plans` 优先）。
- ~~评估移除 `prettier-plugin-tailwindcss` 并把条件类名统一为 `cn()`/完整字符串三元，随后一次性解决 15 个既有格式漂移文件~~ ✅ 已于 2026-11-03 完成：插件从配置与 `package.json` 移除，19 个文件一次性格式化，`prettier --check` 全仓通过（见 §18 第 43 条）。
- 将健身历史升级为通用 `WorkoutSet`。
- 补充纯业务单元测试：健身汇总、饮水边界、学习统计、报告数据源、导入导出。
- 将可复用类型和纯函数逐步迁移到 `shared/`。
- 评估无障碍、键盘导航和焦点管理。

---

## 14. 当前风险、限制与技术债

### 14.1 高优先级风险

| 风险 | 影响 | 建议 |
|---|---|---|
| 数据只在本机浏览器 IndexedDB | 清站点数据 / 换浏览器 / 换设备即丢失，无法跨设备恢复 | 已在界面文案说明（设置页、学习页、删除确认）；P4 做账号令牌 + 同步副本 + 备份恢复（方案见 `docs/P4-数据层与AI综合分析设计方案.md`） |
| **历史数据缺口：只有学习记录是真实历史** | 训练历史是 `FitnessPage` 演示常量、饮食只有「今天」、饮水无日期、计划只存当天 ⇒ 就算接上 AI 也没有历史可综合分析 | P4 的第一步是步骤 11（8d）数据历史化：按日台账 + 真实训练历史 + `schemaVersion` v2 迁移；未完成前不得对外宣称「AI 能分析历史」 |
| 持久化无跨标签页同步 | 两个标签页同时编辑会互相覆盖，最后写入为准 | P4 补 `BroadcastChannel` 同步或写入前版本比对；清空入口已在步骤 7 补齐 |
| 旧规划与现状不一致 | 新接手者可能误删 AI 主入口、回退五项导航或按 16 条旧路由找页面 | 以本文档和当前代码为准；规划文档已加现状标注 |
| `PlansPage.tsx` 是等价重写而非原始源码 | 该页曾因写入事故丢失，当前由 dist 产物反解后重写，虽已通过全量验证，但不排除丢注释/丢少量细节 | 已包含在首个提交 `bd779eb` 中；后续该页改动请先读现状再改 |
| ~~Prettier 插件会压平条件类名~~ | 风险已消除：`prettier-plugin-tailwindcss` 已于 2026-11-03 从配置和 `package.json` 移除，全仓格式化不再破坏条件类名 | 保留规则：条件类名仍统一用 `cn()` 或完整字符串三元；格式化前后仍建议 `Select-String` 抽查条件类名 |
| “快照”容易被误解 | 用户可能以为可以恢复数据 | UI 和文档明确其只是元信息（但它会持久化保存） |
| 回滚粒度仍偏粗 | 现有提交链（`bd779eb` / `da787c4` / `128d6a2` / `e3e9730` / `d4c9696` / `style:`），清理与格式化已单独成提交，但整体仍是按阶段而非按功能切片 | 每个阶段结束时提交一次，保持可回滚 |
| 报告质量与口径 | 8c 后报告文字可来自模型，但只有「今日简报」接服务端；若提示词失控，模型可能写出摘要里没有的数字 | 提示词已明确禁止任何数值推算，`sanitizeReportContent()` 兜底长度与结构；真实联调曾捕获「再补水 0.5 L」并修复；报告指标与依据始终由前端确定性生成，模型无法改数字 |
| 服务器 root 密码登录 + 安全组开着 3389 | 公网 22 端口暴露且允许密码爆破；3389 对 Linux 无用 | 部署前改为 SSH 密钥登录、禁用 root 密码登录、删除 3389 规则、装 `fail2ban`（见部署文档 §6/§10） |
| 2 GiB 内存 + 3 Mbps 峰值带宽 + 按流量计费（0.8 元/GB） | 在服务器上 `npm ci` + `vite build` 极易 OOM；未配压缩/缓存时每次回访都重复计流量 | 前端只在本地构建后上传 `app/dist`；Nginx 开 gzip，hashed 资源 `immutable` 一年、`index.html` `no-cache`（见部署文档 §5.1） |
| 域名备案中（2026-11-03 提交；**2026-11-04 阿里云初审已通过**；计划 2026-11-05 提交省通信管理局审核） | 备案号下发前不能用域名对外提供 HTTP 服务，阿里云会拦截；管局审核时长不可控（法定期限 20 个工作日） | 现阶段只用 IP 直连做内部验收；步骤 10（解析域名、开 443、签证书）只能等备案号下发，**不要按经验值承诺上线日期**，也不要在任何对外文案里写域名已可用 |
| P3 服务端尚未部署、无账号鉴权 | 真实 AI 能力只在联调环境验证过，未上线；任何人拿到地址都能按 IP 限流额度打 `/api/chat` 与 `/api/report` | 8b 已接前端并完成真实 Key 联调（`b99d3ad`），8c 报告也已接服务端（`bdd4265`）；步骤 9 部署时用 Nginx 反代 + 限流 + 系统密钥，**不得对外宣称「已上线」**；上线前轮换已暴露在对话里的 Key |
| 无 Android 工程 | 尚未达到可安装目标 | 持久化和服务端接口稳定后再打包 |

### 14.2 中低优先级技术债

- 健身历史详情仍为力量专用结构。
- 主 JS 包超过 500 kB（`/plans` 可优先拆为懒加载路由）。
- 3 条 lint 警告未清理。
- 饮食照片没有真实存储。
- 提醒没有系统通知能力。
- 当前报告周期和统计口径仍有 Mock 成分：报告**文字**在 8c 后可来自真实模型，但「训练建议 / 学习观察」两类仍打开本地已有报告，只有「今日简报」走 `/api/report`。
- ~~`/reports` 视觉基线在 8c 后过期~~ ✅ 已于 2026-11-04 重跑（6 张 png 更新，`overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`、exit 0），经用户桌面端 + 移动端验收后随 `7625865` 提交推送；reports 基线现与代码一致。
- 持久化已有 UI 入口的清空（步骤 7「清空本机数据」，`a544a38`）；导入会整体替换本机数据且无撤销；读盘失败只在控制台告警，没有面向用户的提示。
- 没有跨标签页同步与写入冲突处理；同一浏览器两个标签页同时编辑时以最后写入为准。
- P3 服务端（`9138175` + `b99d3ad` + `bdd4265`）只有按 IP 限流，**没有用户鉴权**（P3 无账号体系）；未配 `DEEPSEEK_API_KEY` 时 `/api/health` 报 `ai: "disabled"`、`/api/chat` 与 `/api/report` 固定 503，前端据此回退 Mock，属预期降级路径。两个接口共用同一个 20 次/5 分钟限流器（有意为之：消耗同一份额度），因此连续做报告会挤占建档对话的额度。
- 真实 DeepSeek 调用尚未做费用/额度监控与 token 统计；模型输出质量（追问条数、周目标数量）仍有波动。真实 Key 曾出现在开发对话中，**上线前必须轮换**。
- 服务端请求/响应类型暂放 `server/src/contract.ts`，`shared/` 仍为占位；改 `ChatEvent` 须同时改 `app/src/lib/chat-types.ts`，改报告契约须同时改 `app/src/lib/report-types.ts`；迁移推迟到 P3 收尾或 P4。
- 未做跨日期流程的自动化（数据不按日分区，`waterLog` 等日期字段自然累积）。
- 页面内弹层较多，未来若要 deep link 或恢复操作状态，需要补 URL 状态设计（目前只有 `/plans?onboard=1`）。
- ~~`PreviewPages.tsx` 是未接入当前路由的预览页面~~：已于 2026-11-03 清理（全 `app/src` 零引用，属死代码；同时删除 `persist.css` 中仅供它使用的 `.preview-*` 样式 173 行）。Git 历史可随时找回。
- `design/` 现状（2026-11-04 重跑基线后）：94 个文件（93 张 PNG + `home-v3-countdown.html`，约 18.8 MB），其中 91 张是 `visual:check` 现行基线（15 状态 × 6 视口，+1 张快速记录）、2 张是 v3 首页设计基线对照图。基线每次重跑都会更新 77 张左右（日期类内容天然漂移），单次提交约 14 MB 二进制，属正常但会推高仓库体积（`.git` 里仍保留历史版本，**注意**：只更新文件不会让 `.git` 变小）。此前 2026-11-03 清理删除了 `design/_snapshot-before-fixes/` 59 张旧快照（16.5 MB）、v1/v2 遗留原型 2 HTML + 6 PNG，以及未入库的 `design/.edge-profile*/`（13.7 MB）；要真正瘦身需重写历史，已推送的仓库不建议做。
- 尚未添加 `.gitattributes`：Windows 下 `core.autocrlf=true` 时提交时提示 “LF will be replaced by CRLF”，仓库内存 LF、检出转 CRLF，不影响构建与测试。
- ~~15 个既有文件未通过 `prettier --check`~~ ✅ 已于 2026-11-03 解决：16 个漂移文件 + `ReportsPage.tsx` + `.prettierrc.json`/`package.json` 一次格式化，`prettier --check .` 全仓通过。**注意**：Prettier 拆行时会给 JSX 文本补 `{' '}` 子节点，`ReportsPage.tsx` 因此出现移动端换行位置变化（4 张截图 0.02%～0.04% 像素差），已改为显式字符串子节点还原，产物哈希与格式化前完全一致（见 §18 第 43 条）。

### 14.3 不应误判为缺陷的既定行为

- SPA 导航时数据保留。
- 全页刷新后数据从本机 IndexedDB 水合恢复；只有首次访问、清除站点数据或读盘失败时才回到初始 Mock。
- 饮水 1200 ml 是 `INITIAL_WATER_MILLILITERS` 常量（初始演示基线），只作为初始值，不参与持久化写入，因此不会因为刷新而重复累计。
- 持久化写入有 200 ms 防抖，刚点完按钮立即强杀进程可能丢最后一次编辑（正常关标签页有 `pagehide` 补写）。
- AI 报告在探测到服务端可用时显示「DeepSeek 生成 · 经本站服务端代理」，否则显示「本地生成 · Mock 报告」；E2E 与视觉检查里没有后端，因此看到的是 Mock 徽标，这不是未接 8c 的证据。
- 快照不是备份。
- 连接测试不是网络请求。
- 照片只是元数据。
- 提醒只是配置。

上述行为是当前阶段设计边界，不是本轮需要立即修复的“回归”。

---

## 15. 工程约束与协作注意事项

### 15.1 禁止事项

- **禁止**执行 `git reset`、`git clean` 或删除项目目录。
- **禁止**在视觉验收前大范围重构数据层或页面结构。
- **禁止**把 API Key 写进前端源码、环境变量文件或 Android 包。
- **禁止**将未实现的 Mock 能力描述为真实 AI、真实备份或真实同步。
- ~~**不要修改** `D:\Persist\app\src\pages\PreviewPages.tsx`~~：该文件已于 2026-11-03 删除（未接路由、全仓库零引用），不再需要这条约束。
- **不要**无条件全仓库格式化：插件移除后 `prettier --write` 已安全，但批量格式化会让 diff 不可 review。默认只格式化本轮改动文件；若要全仓格式化，先单独开一个 `style:` 提交并复跑 `prettier --check`、构建哈希比对与 `visual:check`。格式化后**必须**核对产物哈希是否变化，并逐像素比对截图（Prettier 拆行会改变 JSX 文本节点，可能挪动换行位置）。

### 15.2 文件与编码

PowerShell 读取中文：

```powershell
Get-Content -Encoding utf8
```

写 UTF-8 无 BOM：

```powershell
[IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))
```

### 15.3 Git 状态

截至 2026-11-04（步骤 8b 后）：

- 当前分支：`main`（由 `master` 改名而来，已建跟踪关系）。
- 远端：`origin` = `git@github.com:save626/Persist.git`（SSH，密钥已注册在 `save626` 账号下；HTTPS 侧也配置了 Git Credential Manager）。
- 提交链已全部推送、远端 `refs/heads/main` 与本地 HEAD 哈希一致：
  - `bd779eb`（`chore: initial commit`，262 文件 / 37.39 MB）
  - `da787c4`（步骤 5 的文档同步）
  - `128d6a2`（步骤 6 本机 IndexedDB 持久化 + 文档同步，41 个文件：4 新增 / 14 修改 / 23 张截图）
  - `e3e9730`（步骤 6 的文档同步）
  - `d4c9696`（`chore:` 清理死代码与历史设计制品，73 个文件 +34/−724）
  - 最新 `style:` 提交（移除 `prettier-plugin-tailwindcss` 并格式化既有漂移文件，22 个文件；哈希以 `git log` 为准，见 §18 第 43 条）
  - `a544a38`（步骤 7 设置页「清空本机数据」入口）
  - `9138175`（步骤 8a 服务端 Fastify + DeepSeek 代理骨架）
  - `b99d3ad`（步骤 8b 前端接入 `/api/chat` + 真实 Key 联调，11 文件 +973/−23）
  - 其后多次 `docs:` 文档同步提交（哈希以 `git log` 为准）
- **工作区当前干净**（`## main...origin/main`，无未提交改动）。
- 提交前已删除根目录 `$null` 与 `app/$null` 两个重定向误建的垃圾文件；`.gitignore` 排除了 `node_modules/`、`app/dist/`、`app/coverage/`、`app/playwright-report/`、`app/test-results/`、`*.tsbuildinfo`、`.env*`、`design/.edge-profile*/`、`Water intake record/`、`*.log`、`.chrome-headless-*/`。
- 提交前审计命令（每次提交都用）：`git diff --cached --name-only` 过滤 `node_modules/|^app/dist/|test-results|playwright-report|coverage|Water intake record|\.log$|\.tsbuildinfo$`。
- 中文文件名：`git -c core.quotepath=false status` 才能正确显示中文文件名（本机已设 `core.quotepath=false`）。
- **提权**：`git push` / `git ls-remote` 在受限沙箱下会失败（git 启动 `ssh.exe` 时报 `couldn't create signal pipe, Win32 error 5`），需要一次性提升到完整访问权限；本地 `git add/commit/status/log` 不需要提权。

建议每个阶段（P3、P4、P5）结束时提交一次，保持回滚粒度；禁止 `git reset`、`git clean`、`git push --force`（除非用户明确要求且远端仍为单基线）。

### 15.4 修改后的最小验证顺序

```text
npm run typecheck
npm test
npx playwright test
npm run lint
npm run build
```

涉及布局或弹层时再执行：

```text
npm run visual:check
```

环境注意（2026-11-03 实测）：

- `npm test`、`npm run build`、`npx playwright test`、`npm run visual:check`、`git push` / `git ls-remote` 在受限文件沙箱下都会失败：Tailwind 原生模块加载报 `UNLOADABLE_DEPENDENCY`，Vite 的 `windowsSafeRealPathSync` 与浏览器启动报 `spawn EPERM`，git 启动 `ssh.exe` 报 `couldn't create signal pipe, Win32 error 5`。这几类命令需要一次性提升到完整访问权限执行；`prettier` / `tsc` / `oxlint` 以及本地 `git add/commit/status/log` 在受限模式下可正常跑。
- Playwright 的 `webServer` 会自己拉起 4173 端口的 dev server，不需要手动先启动；`visual:check` 则要求 4173 已在运行（`PERSIST_URL` 可覆盖目标地址）。
- 真机同 Wi-Fi 访问需要 `--host 0.0.0.0` 且 Windows 防火墙放行 4173（需管理员），否则手机端会超时；退路是 Chrome DevTools 设备模拟。
- 写文件请用 3 参数 `[IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))`；2 参数重载会把文件写成 24 字节的 `System.Text.UTF8Encoding`（本仓库已因此丢失过一次 `PlansPage.tsx`）。

---

## 16. 关键文件索引

### 16.1 入口与壳

- `D:\Persist\app\src\main.tsx`
- `D:\Persist\app\src\App.tsx`
- `D:\Persist\app\src\components\AppShell.tsx`
- `D:\Persist\app\src\components\QuickRecordSheet.tsx`
- `D:\Persist\app\src\context\UIProvider.tsx`

### 16.2 数据与状态

- `D:\Persist\app\src\types.ts`
- `D:\Persist\app\src\context\MockDataProvider.tsx`
- `D:\Persist\app\src\context\mock-data-context.ts`
- `D:\Persist\app\src\data\complete-mock-data.ts`
- `D:\Persist\app\src\data\profile.ts`
- `D:\Persist\app\src\data\reports.ts`
- `D:\Persist\app\src\data\settings.ts`
- `D:\Persist\app\src\data\study.ts`
- `D:\Persist\app\src\data\diet.ts`

### 16.3 业务工具

- `D:\Persist\app\src\lib\fitness.ts`
- `D:\Persist\app\src\lib\mock-data-transfer.ts`
- `D:\Persist\app\src\lib\countdown.ts`
- `D:\Persist\app\src\lib\cn.ts`
- `D:\Persist\app\src\lib\profile-rules.ts`
- `D:\Persist\app\src\lib\chat-types.ts`
- `D:\Persist\app\src\lib\chat-extract.ts`
- `D:\Persist\app\src\lib\mock-chat-client.ts`
- `D:\Persist\app\src\lib\long-term-plan.ts`
- `D:\Persist\app\src\lib\plan-draft.ts`
- `D:\Persist\app\src\lib\persist-state.ts`（步骤 6：记录结构 / schemaVersion / 迁移 / 校验）
- `D:\Persist\app\src\lib\persist-storage.ts`（步骤 6：IndexedDB open / load / save / 降级）
- `D:\Persist\app\src\lib\ai-chat-client.ts`（步骤 8b：`/api/chat` SSE 客户端、探活、诚实回退）
- `D:\Persist\app\src\lib\ai-report-client.ts`（步骤 8c：`/api/report` 客户端、探活、错误分类、响应再校验）
- `D:\Persist\app\src\lib\report-types.ts`（步骤 8c：报告请求/响应类型，镜像 `server/src/contract.ts`）

### 16.4 页面

- `D:\Persist\app\src\pages\TodayPage.tsx`
- `D:\Persist\app\src\pages\FitnessPage.tsx`
- `D:\Persist\app\src\pages\DietPage.tsx`
- `D:\Persist\app\src\pages\StudyPage.tsx`
- `D:\Persist\app\src\pages\ProfilePage.tsx`
- `D:\Persist\app\src\pages\ReportsPage.tsx`
- `D:\Persist\app\src\pages\SettingsPage.tsx`
- `D:\Persist\app\src\pages\PlansPage.tsx`
- `D:\Persist\app\src\components\PlanChatSheet.tsx`
- `D:\Persist\app\src\components\PlanDraftSheet.tsx`
- `D:\Persist\app\src\styles\plans.css`

### 16.5 测试与视觉

- `D:\Persist\app\e2e\smoke.spec.ts`
- `D:\Persist\app\e2e\mock-flows.spec.ts`
- `D:\Persist\app\e2e\mock-data-flows.spec.ts`
- `D:\Persist\app\e2e\plans.spec.ts`
- `D:\Persist\app\e2e\complete-mock-data.spec.ts`
- `D:\Persist\app\e2e\fitness-freeform.spec.ts`
- `D:\Persist\app\e2e\persistence.spec.ts`（步骤 6：刷新后饮水 / 长期计划 / 提醒设置仍存在）
- `D:\Persist\app\src\lib\persist-state.test.ts`（步骤 6：迁移 / 版本拒绝 / 损坏降级）
- `D:\Persist\app\src\lib\ai-chat-client.test.ts`（步骤 8b：SSE 解析与回退语义）
- `D:\Persist\app\src\lib\ai-report-client.test.ts`（步骤 8c：探活、请求体、错误分类、响应校验）
- `D:\Persist\app\src\lib\*.test.ts`
- `D:\Persist\app\src\data\complete-mock-data.test.ts`
- `D:\Persist\app\scripts\visual-check.mjs`
- `D:\Persist\design\`

### 16.6 规划与占位

- `D:\Persist\docs\P4-数据层与AI综合分析设计方案.md`（**P4 终态架构唯一设计来源**：本地优先 + 服务端 SQLite 副本、同步协议、事实包契约 v2、隐私边界、步骤 11–14 拆分与验收）
- `D:\Persist\docs\Persist-项目开发规划.md`
- `D:\Persist\docs\部署与服务器现状.md`（部署侧唯一事实来源：服务器规格、5.1 七条硬规则、Nginx 草案、命令速查）
- `D:\Persist\docs\部署与服务器现状.local.md`（**不入库**，真实公网 IP；由 `.gitignore` 的 `*.local.md` 排除）
- `D:\Persist\docs\项目现状总览.md`（一页速览，交接第一读物）
- `D:\Persist\HANDOFF-新会话指令.md`（可整份复制给新会话的启动指令）
- `D:\Persist\server\README.md`（P3 服务端：API 契约、环境变量、开发与验证命令、真实 Key 联调注意事项、TODO）
- `D:\Persist\server\src\`（`app.ts` / `config.ts` / `contract.ts` / `rate-limit.ts` / `routes/`（`chat.ts` / `report.ts`）/ `ai/`（`deepseek.ts` / `prompts.ts` / `extract.ts` / `report.ts`））
- `D:\Persist\shared\README.md`
- `D:\Persist\README.md`

---

## 17. 已确认的产品与工程决策

| 决策 | 当前结论 |
|---|---|
| 主导航 | 今日、健身、饮食、学习、AI 报告 |
| AI 报告入口 | 主导航 + 移动底栏 + 今日页 + 学习页 |
| 健身动作 | 名称自由输入，预设仅辅助 |
| 运动类型 | 力量、时长、距离 |
| 非专业运动 | 跑步、跳绳、骑行、足球、爬山等均可记录 |
| 数据策略 | 长期目标是本地优先，当前仍为内存 Mock |
| AI 服务 | 计划使用 DeepSeek，通过服务端代理 |
| API Key | 只能保存在服务端 |
| 部署形态 | 阿里云 ECS（Alibaba Cloud Linux 3，`dnf`）+ Nginx 静态托管前端 + Fastify 反代 `/api`；**不在服务器构建前端**，本地 `build` 后上传 `app/dist` |
| 前端 API 前缀 | 相对路径 `/api`，不写死 IP / 域名（备案后换域名零改动） |
| 数据库 | P3 不落库；P4 终态用单文件 SQLite（`/var/lib/persist/persist.sqlite`，明确不用 MySQL/MariaDB），驱动二选一待定（Node 22 + `node:sqlite` 或 Node 20 + `better-sqlite3`），见 `docs/P4-数据层与AI综合分析设计方案.md` §4 |
| 照片识别 | 第一版不做 |
| 外部学习 App | 不抓取非公开数据 |
| AI 写入计划 | 必须用户确认 |
| AI 建档形态 | 结构化引导问答，不是开放式聊天机器人 |
| 长期计划 | 与今日计划分离，支持草案、启用、归档和周目标 |
| 长期计划入口 | 档案页「AI 建档」、`/plans?onboard=1`、今日页「长期计划」；长期计划不进主导航，导航固定五项 |
| 草案确认语义 | 确认即启用为 `active`，原 `active` 在新计划创建成功后才归档 |
| 计划起止日期 | `ChatPlanProposal.startDate/endDate` 可选；缺省时开始=今天、结束=最后里程碑；草案页可编辑 |
| 档案字段校验 | 统一走 `profile-rules.ts`；越界字段丢弃并用一条 toast 汇总提示，从不抛错、不中断对话 |
| 备份版本 | 当前 `0.2.0`（含 `longTermPlans`，兼容 `0.1.0`）；步骤 11（8d）数据历史化时升到 `0.3.0`（含训练/饮食/饮水/计划历史，仍兼容 0.1.0/0.2.0） |
| 条件类名写法 | 用 `cn()` 或「完整字符串三元」；不要依赖条件拼接里手写空格的写法（历史教训：`prettier-plugin-tailwindcss` 曾把它压平成 `plan-itemdone`，插件已于 2026-11-03 移除，规则继续保留） |
| 计划完成量 | 当前为估算，不能包装成精确统计 |
| 当前“快照” | 仅状态元信息，不是备份（会随持久化保存，但不具备恢复能力） |
| 本地持久化 | 原生 IndexedDB，单记录 `persist-mock-state`，`schemaVersion` 迁移，未来版本只读保护；未引入 Dexie |
| 刷新 / 重开 | 数据从本机 IndexedDB 水合恢复；清站点数据、换浏览器或换设备才回到初始 Mock |
| Android | 后续使用 Capacitor，当前未开始 |

旧规划文档 `D:\Persist\docs\Persist-项目开发规划.md` 仍以 v1.2（2026-10-27）目标态为主，其中「四项一级导航」「AI 报告为辅助页面」「16 条建议路由」都不是现状。2026-11-02 已在该文档头部与 §4.1/§4.2/§4.3 加上「规划 vs 现状」标注；任何冲突仍以本文档和当前代码为准。

---

## 18. 本轮工作变更摘要

本轮（2026-11-02）按用户批准的四项决策和「步骤 1 → 步骤 2」推进，已完成：

**步骤 1（只读审计 + 决策确认）**

1. 通读交接文档、`README`、`docs`、`app`/`server`/`shared` 说明、全部源码、配置、`design` 原型与 `Water intake record` 原始文件。
2. 核对代码与文档差异，输出 8 段报告，确认 4 项决策（草案确认即启用 + 归档旧计划、`ChatPlanProposal` 增加可选起止日期、统一档案校验规则、备份升到 0.2.0 并统计计划数）。

**步骤 2（AI 建档 + 长期计划闭环 + 全局缺陷修复）**

3. 新增 `/plans` 长期计划页、AI 建档对话、草案确认表、`plans.css`，并把三个入口接通（档案页 / 深链 / 今日页）。
4. 新增 `plan-draft.ts` 与 `profile-rules.ts`，把草案校验与档案字段校验抽成可测纯函数。
5. 备份层升级到 0.2.0：`serializeMockBackup` / `parseMockBackupJson` / `normalizeBackupVersion` / `countMockRecords` 全部支持长期计划与 0.1.0 兼容。
6. 修复全站 toast 不显示（`toastshow`）、主导航与底栏高亮失效（`navactive` / `bottom-linkactive`）、`confirm-mark.danger` 失效等条件类名拼接缺陷。
7. 修复 `prettier-plugin-tailwindcss` 压平条件类名引发的 14 处状态样式失效（今日 `done`、饮食 `empty/parsed`、健身 `done/active/today`、学习 `active/today`、设置 `active/is-off`、档案步骤条）。
8. 修复 `PageSheet` 与确认弹窗共用 DOM id 导致的可访问名错乱（改用 `useId()`）。
9. 新增 `e2e/plans.spec.ts`（4 条），并修正移动端次要按钮按设计隐藏导致的用例入口问题。
10. 单元测试从 38 增至 111（新增 `mock-data-transfer` 25、`plan-draft` 19、`profile-rules` 11，扩充 `chat-extract`/`long-term-plan`）；E2E 从 82 增至 90 次执行（89 通过、1 按设计跳过）。
11. 事故与恢复：`PlansPage.tsx` 因 PowerShell 2 参数写入被截断丢失（无 git 备份），从 `dist` 产物反解后等价重写，并通过类型检查、构建与全量 E2E。
12. 复跑 `typecheck` / `oxlint` / `prettier --check`（改动文件）/ `build` / 全量 Playwright，全部通过。

**遗留（下一步）**

13. 设置页导出仍为 0.1.0、不含长期计划；导入 toast 未显示计划数（步骤 3）。（已于 2026-11-03 完成，见下方 23–27）
14. `/plans` 未纳入 `visual:check`；1440/500/430/390/360 全量视觉复核未重跑（步骤 4）。（已于 2026-11-03 完成，见下方 26–31）
15. 3 条既有 lint 警告、15 个既有未格式化文件未处理；`PreviewPages.tsx:160` 遗留类名与其过时文案已随 2026-11-03 的清理（见下方 42）删除。

**本轮之后的纯文档同步（2026-11-02 17:30 起，无代码改动）**

16. 更新本文档：头部状态、§0 摘要、§2 进度表与完成度矩阵、§3.1 路由（补 `/plans` 与 `?onboard=1`）、§4.9 改为「页面闭环已完成」并重写已完成/未完成清单、§5.2/5.3/5.4、§6.1、§8.5、§9.1、§10.1–10.5、§11、§12（新增 12.7 长期计划清单，原报告/响应式顺延为 12.8/12.9）、§13 P0/P1/P6、§14、§15、§16、§17、§18–§20。
17. 同步 `README.md`（当前阶段、五项导航、命令说明）、`app/README.md`（页面清单/测试现状/条件类名约定）、`docs/工程初始化与前端约定.md`（导航与阶段顺序）、`docs/Persist-项目开发规划.md`（头部「规划 vs 现状」提示、§4.1–4.3 现状标注、§11 阶段现状、§16 执行清单进度、附录 A 资产表）。
18. 本次同步只改文档，没有触碰源码，因此不需要重跑类型检查、单元测试、E2E 或构建。

**2026-11-03 进度整理（仍为纯文档）**

19. 复核仓库现状：源码最后一次改动是 11-02 17:17，文档 11-02 17:33；此后无代码变化、无后台任务、无残留开发服务；Git 仍是 **0 提交**。
20. 新增 §0.4「下一步执行计划」，把步骤 3（导出导入 0.2.0）、步骤 4（视觉复核）、步骤 5（首个 Git 提交）、步骤 6（P2 持久化）写成可执行条目（目标 / 主要改动 / 验收标准），并让 §13、§19 与之一致。
21. 同步更新 `README.md`、`app\README.md`、`docs\工程初始化与前端约定.md`、`docs\Persist-项目开发规划.md` 的进度状态与下一步说明；本次同样未改源码，无需重跑验证。
22. 新增 `HANDOFF-新会话指令.md`：可整份复制给新会话的启动指令（必读顺序、现状快照、铁律、关键契约、步骤 3–6 执行清单、命令与沙箱坑、汇报格式、禁止事项、待决策项、需披露历史），并在 §0.4 加了指引。

**2026-11-03 步骤 3 + 步骤 4 实施（有代码改动）**

23. 步骤 3：`SettingsPage.exportMockData()` 改调 `serializeMockBackup()`，导出 `version: '0.2.0'` + `longTermPlans`，文件名带日期，序列化/下载失败走中文 toast；导入走 `parseMockBackupJson()` 版本分流，成功 toast 同时报学习记录数与长期计划数，失败不覆盖现有数据。
24. 步骤 3 验证：`mock-data-transfer.test.ts` 增加 round-trip 用例（25 → 26），`e2e/mock-data-flows.spec.ts` 增加导出/导入用例（7 → 8），单测 111 → 112、E2E 90 → 92 次执行。
25. 步骤 4：`scripts/visual-check.mjs` 纳入 `/plans` 五档状态（空 / 进行中 / 草案 / AI 对话 / 确认表），视口从 5 个增至 6 个（新增 421×926 的 6.78 英寸 20:9 真机视口），弹窗类状态改为只截视口尺寸，快速记录浮层等待时间改为 360ms；新增「必需元素」断言。
26. 全站弹窗居中：`surface.css` 与 `home-v3.css` 的 `.backdrop` 改 `align-items: center`，`.sheet` 加 `max-height: calc(100dvh - 36px)` + 内部滚动；`PageSheet` / `PlanDraftSheet` / `PlanChatSheet` 移除按页 placement 参数，统一由基类居中。
27. 修复移动端档案页找不到「AI 建档」：根因是 ≤900px 全局规则 `.head-actions .btn.secondary:not(.today-report-action)` 会隐藏所有次要按钮；给按钮加 `profile-onboard-action` 并从隐藏规则豁免，同时删除 `plans.spec.ts` 里对应的 `test.skip(isMobile)`。窄屏仍隐藏今日页「编辑计划」与健身页「训练模板」顶部按钮，二者都有页内入口。
28. 步骤 4 验证：`npm run visual:check` → 15 状态 × 6 视口 = 90 张 + 快速记录 1 张，`overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`；用户用 Chrome DevTools 421×926 设备模拟逐页验收通过，并明确「桌面端和移动端的所有视觉验收通过」。
29. 复跑：`npm run typecheck` 通过、`npm test` 112/112、`npx playwright test` 92 passed / 0 skipped（46.0s）、`npm run lint` 0 错 3 既有警告、`npm run build` 通过（JS 549.09 kB / CSS 139.92 kB），改动文件 `prettier --check` 通过。
30. 沙箱坑补充：`npm test` 与 `npm run build` 也需要 `danger-full-access`（Tailwind 原生模块加载 + Vite 的 `windowsSafeRealPathSync` 会 spawn 子进程，受限模式报 `spawn EPERM`），不只是 Playwright。
31. 视觉范围就此冻结：P1 全部收尾完成，下一步是步骤 5（首个 Git 提交）与步骤 6（Dexie 持久化）。
32. 步骤 5 完成（2026-11-03 13:40）：删除根目录 `$null`（62 B，rg 报错）与 `app/$null`（70 B，cmd 报错）两个重定向误建文件；`git branch -M main` → `git add -A`（262 文件，审计无 node_modules/dist/test-results/Water intake record）→ 提交 `bd779eb`（`chore: initial commit`，37.39 MB）→ 添加远端 `git@github.com:save626/Persist.git` → `git ls-remote` 确认空仓 → `git push -u origin main` 成功 → 核对远端 `refs/heads/main` 与本地 HEAD 哈希一致、`git status -sb` 为 `## main...origin/main`。提权点：`git push` / `git ls-remote` 需完整访问权限（git 启动 ssh 报 `Win32 error 5`）。随后 `da787c4` 提交了步骤 5 的文档同步并推送。

**2026-11-03 步骤 6 实施（本机持久化，有代码改动）**

33. 新增 `app/src/lib/persist-state.ts`：定义存储记录（`id / schemaVersion / savedAt / backup / snapshot`）、`MIGRATIONS` 迁移表（v0 → v1）、`migratePersistedStateRecord()` 与 `readPersistedState()`（损坏返回 `null`，不抛异常）；未来版本记录明确拒绝，避免新版数据被旧版代码降级写坏。
34. 新增 `app/src/lib/persist-storage.ts`：原生 IndexedDB 封装。`openDatabase()` 带 2 s 超时与缓存 Promise，`loadPersistedState()` 返回 `loaded / empty / unavailable / corrupt / unsupported-version` 五种状态，`savePersistedState()` 返回布尔且吞掉异常（写失败退化为纯内存），`clearPersistedState()` 已实现但暂未接 UI（当时留给 P4，**已在步骤 7 接上，见第 50 条**）。
35. `MockDataProvider` 改造：首挂载 `useEffect` 水合（读盘成功即 `replaceMockData` + 恢复快照），水合前 `return null` 防演示数据闪烁；`hydrated` 之前不写盘；状态变化 200 ms 防抖写整条记录；`pagehide` / `visibilitychange → hidden` 用 ref 取最新状态补写。13 个状态切片与全部回调签名未变。
36. `mock-data-transfer.ts` 抽出 `parseMockBackupValue(payload)`，导入与读盘共用同一套字段校验；`parseMockBackupJson()` 只负责 `JSON.parse` 后转调，行为与错误文案不变。
37. 新增 `persist-state.test.ts`（11 条）与 `e2e/persistence.spec.ts`（3 条 × 2 项目）；E2E 用真实 `page.reload()` 验证饮水、长期计划、提醒开关与时间都能恢复，并断言重复刷新不累加。首轮 E2E 有 2 条失败（移动端快速记录入口需先开「快速记录」弹层；提醒时间输入在开关关闭后 `disabled`），修正用例后 6/6 通过。
38. 文案改口：设置页、学习页、饮食/健身保存提示、今日复盘、删除确认等凡声称「仅当前会话 / 刷新重置」的副本，统一改为「已保存在本机浏览器（IndexedDB）」并说明清站点数据会丢失；`e2e/mock-data-flows.spec.ts` 两条过时注释同步修正。
39. 步骤 6 验证：`npm run typecheck` 通过；`npm test` 123/123（8 文件，新增 11 条）；`npx playwright test` 98 passed / 0 skipped（55.1s，49 用例 × 2 项目）；`npm run lint` 0 错 3 既有警告；`npm run build` 通过（JS 552.61 kB / CSS 139.92 kB，涨 3.52 kB）；`npm run visual:check` 15 状态 × 6 视口全零指标。
40. 收尾：对三个新增文件跑 `prettier --write`（改动前的 `persist-state.ts` / `persist-storage.ts` / `persist-state.test.ts` 有格式漂移），随后复跑 `typecheck`（0 错）、`lint`（0 错 3 警）、`npm test`（123/123）与 `npm run build`——产物哈希仍为 `index-DqZtxRhx.js` / `index-DBVxLcSp.css`，与格式化前完全一致，说明格式化未改变语义、E2E 结论继续有效。`TodaySheets.tsx` / `ReportsPage.tsx` 的 `prettier --check` 报警属 §14.2 记录的既有债务（这两个文件本轮只改了一行文案），未做全文件格式化以避免无关大 diff。
41. 步骤 6 已于 2026-11-03 14:1x 作为第三个提交 `128d6a2`（`feat: 步骤 6 本机 IndexedDB 持久化（刷新/重开不丢数据）`）提交并推送：41 个文件（4 新增 + 14 修改 + 23 张截图），推送后远端 `refs/heads/main` 与本地 HEAD 一致（`128d6a2`），`git status -sb` 为 `## main...origin/main`；`design/` 下 23 张截图因文案改口被 `visual:check` 重写（内容变化来自文案，指标仍全零），已一并进入该提交。
42. 2026-11-03 清理（用户批准后执行，`chore:` 提交，无功能变化）：删 `design/_snapshot-before-fixes/`（59 张 / 16.5 MB）、v1/v2 遗留原型（`home-v1.html`、`home-v2-blue.html` 与 6 张 PNG，保留 `home-v3-countdown.html` + 2 张 v3 对照图）、`design/.edge-profile*/`（13.7 MB，未入库）；删 `app/src/pages/PreviewPages.tsx`（全 `app/src` 零引用）及 `persist.css` 中仅供其使用的 `.preview-*` 样式 173 行；`.gitignore` 补 `app/dist-ssr/`、`app/.vite/`、`desktop.ini`、`app/tmp-*`、`*.tmp`。决定**保留** `Water intake record/`（368 MB，未入库，作为饮水行为参照）。
   验证（清理后实测）：`tsc` 0 错；`oxlint` 0 错 3 警（文件数 64 → 63，规则数不变）；`npm test` 123/123；`npx playwright test` 98 passed / 0 skipped（2.0m）；`npm run build` 通过，CSS 139.92 → 137.64 kB（删掉的 `.preview-*` 确实在产物里；本条原先记录的 134.42 kB 为笔误，见第 44 条复核），JS 552.61 kB 不变（`PreviewPages` 本来没被引用，早已 tree-shaken）；`npm run visual:check` 15 状态 × 6 视口 `overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`。
   截图字节的说明（不要误判为回归）：`git status` 一度显示 8 张基线 PNG 有变化，逐像素比对后确认差异 ≤0.07%、bbox 均落在首页倒计时那一行（`TodayPage` 有 1 s 实时时钟），`study-desktop-1440.png` 的最大色差仅 4/255（抗锯齿噪声）。连跑两次 `visual:check` 也复现了同样的抖动，故**还原为原基线图、不把抖动提交**。
43. 2026-11-03 格式化（用户批准的第二个提交：`style: 移除 prettier-plugin-tailwindcss 并格式化既有漂移文件`，22 个文件、语义零变化）：移除 `prettier-plugin-tailwindcss`（`app/package.json` 的 devDependency 与 `.prettierrc.json` 的 `plugins` 同时去掉，`package-lock.json` 手工剔除对应条目，未让 npm 重排锁文件）；`npx prettier --write` 一次性消除 19 个文件的格式漂移（16 个既有漂移 + `ReportsPage.tsx` + `.prettierrc.json` / `package.json`）。**发现并修正了一个真实副作用**：Prettier 拆行后给 `ReportsPage.tsx` 两处 JSX 文本补了 `{' '}` 空白文本节点（生成面板 `<p>`、引用范围 `<strong>`），移动端 `/reports` 的换行位置随之变化，4 张截图出现 0.002%～0.039% 像素差（逐像素 bbox 均落在同一行文字尾部，最大色差 47/255）；同一份格式化代码连跑两次该差异稳定复现，回退 `ReportsPage.tsx` 后 4 张截图与基线逐像素相同——确认是格式化引入而非截图抖动。修法：这两处改为显式字符串子节点（`{'当前有 '}{localRecordTotal}{' 条本地记录，本次可引用 '}…`），子节点切分与格式化前一致。
    验证（格式化后实测）：`npx prettier --check .` → `All matched files use Prettier code style!`；`tsc -b` 0 错；`oxlint` 0 错 3 既有警告（63 文件）；`npm test` 123/123（8 文件）；`npx playwright test` 98 passed / 0 skipped（1.1m）；`npm run build` 产物 **`index-D5Nq3TbM.js` 552,612 B + `index-C9ZcsQCi.css` 137,643 B，与格式化前逐字节相同**（中途版本 `index-BqOHakwA.js` 只因那两个 `{' '}` 多 6 字节，正好成为「格式化确实改了 DOM」的证据）；`npm run visual:check` 15 状态 × 6 视口 91 张全零指标，reports 4 张与基线逐像素相同，首页 7 张仅为实时时钟抖动（≤0.07%，已还原不提交）。两个提交已于 2026-11-03 15:2x 推送到 `origin/main`，`git status -sb` 为 `## main...origin/main`、远端 `refs/heads/main` 与本地 HEAD 一致。

**2026-11-03 文档整理与服务器交接（仍为纯文档，不改代码）**

44. 现状复核时重新执行 `npm run build`（2026-11-03 15:5x），产物为 `dist/index.html` 611 B、`dist/assets/index-C9ZcsQCi.css` 137,643 B（gzip 23.81 kB）、`dist/assets/index-D5Nq3TbM.js` 552,612 B（gzip 163.52 kB），与格式化提交后记录完全一致 ⇒ 自 `style:` 提交以来代码零漂移。**同时修正了两处数据笔误**：§18 第 42 条的「清理后 CSS 134.42 kB」应为 137.64 kB；§10.3 的构建产物清单原先停留在步骤 6 的 `index-DqZtxRhx.js` / `index-DBVxLcSp.css`，已更新为当前哈希并补了产物演进说明。
45. 修正三处过期陈述：§0.1「Git 已推送三次」→「提交链已全部推送」（不再写计数，计数会因每次提交自我失效）；§0.1/§10.1 的 CSS 体积 139.92 kB → 137.64 kB；§0.2、§13、§14.2、§16.6 里「清空本机数据入口留给 P4」→ 已提前为 §0.4 步骤 7（P3-0），并在 §13 新增 P3-0 小节写明实现顺序陷阱（清 IDB → 重置内存态 → 保留 `hydrated` → 清 `snapshot`，否则 200 ms 防抖把旧数据写回）。
46. 服务器交接落库：新增 `docs/部署与服务器现状.md`（脱敏：公网 IP 写作 `121.196.*.*`，真实值只在本机 `docs/部署与服务器现状.local.md`，`.gitignore` 增 `*.local.md`），记录 ECS 规格、已装环境（Node 20.20.2 / npm 10.8.2 / Nginx 1.24.0 / Alibaba Cloud Linux 3 用 `dnf`）、安全组与域名备案状态、目标架构、七条硬规则、待执行清单、命令速查与 Nginx 站点草案（含 SSE 的 `proxy_buffering off`）；`HANDOFF.md` §0.4 拆出步骤 7–10，§5.1/§13 P3/§14.1/§16.6/§17/§19/§20 同步；`HANDOFF-新会话指令.md` §6、`README.md`、`server/README.md` 同步。
47. 新增 `docs/项目现状总览.md`：一页速览（阶段完成度、验证基线数字、数据与 AI 现状、Git 现状、服务器现状、Top 10 限制、下一步顺序、文档地图），作为交接时的第一份读物，细节仍回指 `HANDOFF.md`。
48. 本次仍**未改动** `app/` 与 `design/`，因此不重跑单测 / E2E / 视觉检查；只跑了 `npm run build` 用于核对产物，并逐项 grep 审计文档中的过期数字（`推送三次` / `139.92` / `134.42` / `DqZtxRhx` / `留给 P4` 等）与真实 IP 泄露。
49. 重写 `HANDOFF-新会话指令.md` 为完整版（14 节，§0–§13）：修掉上一版里"步骤 6 已提交 / 提交三次 / 视觉 139.92 kB"等会随提交自失效的陈述，补入服务器与部署现状（脱敏）、步骤 7–10 验收标准、P3 服务端约束、构建哈希判读方法、`git push` 的 stderr 假失败坑、公开仓库的敏感信息边界；并给出文档之间的分层（速览 → HANDOFF → 新会话指令）。

**2026-11-03 步骤 7 实施（清空本机数据入口，有代码改动）**

50. 步骤 7（P3-0）以 `a544a38`（`feat: 步骤 7 设置页「清空本机数据」入口（P3-0）`）完成并推送：4 个文件、+142 −4。`MockDataContextValue` 新增 `clearLocalData(): Promise<void>`；`MockDataProvider` 新增模块级 `createInitialMockData()`（与 `useState` 初值一一对应的首开基线）与 `saveTimerRef`（跟踪 200 ms 防抖定时器）；`clearLocalData` 的固定顺序为「`persistEnabledRef=false` → `clearTimeout(saveTimerRef)` → `clearPersistedState()` → `replaceMockData(createInitialMockData())`（含 `snapshot=null`）→ 同步刷新 `latestStateRef` → `persistEnabledRef=true`」，`hydrated` 保持 true 不重新水合；`SettingsPage` 新增第二张危险区卡片（复用既有 `settings-danger-card` 样式，未新增 CSS）、中文二次确认 `alertdialog` 与 toast，原「清空设置」改名 `clearMockSettings` 以区分；`e2e/persistence.spec.ts` 新增第 4 条用例。
    验证（步骤 7 后实测）：`tsc -b` 0 错；`npm test` 123/123（8 文件，未新增单测，新逻辑由 E2E 覆盖）；`npx playwright test` **100 passed / 0 skipped / 0 failed**（1.2m，50 用例 × 2 项目，新增用例在 desktop 与 mobile 均真实跑过）；`oxlint` 0 错 3 既有警告（63 文件，未新增）；`prettier --check src e2e` 全绿（`SettingsPage.tsx` 首轮有格式漂移，`--write` 后 diff 仍仅为新增块）；`npm run build` 通过，JS 552.61 → **554.38 kB**（`index-BBQQW4ug.js`，554,382 B，gzip 163.89 kB），**CSS 哈希未变**（`index-C9ZcsQCi.css` 137,643 B）⇒ 新 UI 复用既有样式，未产生 CSS 漂移。`npm run visual:check` **未跑**：新卡片属于新 UI，跑脚本会覆盖 `design/` 基线截图，需用户确认后再跑并重新验收设置页。
    首次 E2E 与最终代码的差异说明：首轮 100 次全绿后，为堵住「清空后立刻关页面、`pagehide` 用旧 `latestStateRef` 补写旧数据」的窗口，又在 `clearLocalData` 里补了同步刷新 `latestStateRef` 的两行，**对最终代码重跑了全量单测与 E2E**（结论不变：123/123、100 passed），构建也基于最终代码。

**2026-11-03 步骤 8a 实施（服务端 Fastify + DeepSeek 代理骨架，有代码改动）**

51. 步骤 8a 以 `9138175`（`feat: 步骤 8 P3a 服务端 Fastify + DeepSeek 代理骨架`）完成：25 个文件（23 新增 + `.gitignore` 修改），`server/` 从只有 README 变为可运行服务。技术选型 Fastify 5.7.4 + TypeScript ~6.0.3 + Vitest ^5.0.5，`engines >=20.19`、`type: module`、NodeNext，**不兼容 Node 22 特性**（不用 `node:sqlite`）。关键实现：`config.ts` 环境变量钳制与 `describeConfig()` 脱敏；`contract.ts` 严格校验 `ChatRequest`（turns 1–20 / 单条 ≤2000 字 / 总量 ≤12000 字 / 末条必须 user / 档案 5 数字 + 8 文本 + `aiConsent`）；`ai/deepseek.ts` 流式 SSE（解析 `data:`、忽略 `[DONE]`、逐块产出）+ 非流式 `response_format: json_object`，每次尝试 25 s 超时、调用方 abort 透传、仅对 429/5xx/网络错误重试 1 次且**已产出内容后不再重试**；`ai/prompts.ts` 中文 system prompt（不编造、医疗问题引导就医、不复述隐私、≤150 字）+ 最近 12 轮上下文；`ai/extract.ts` 对模型返回做白名单净化（问题字段白名单/去重/≤4、档案越界数字丢弃、长期计划目标单位白名单 perWeek 1–999 ≤4、里程碑真实 ISO 日期 ≤6、无合法周目标则整份草案作废），**所有结构化结果先净化才发事件**；`routes/chat.ts` `reply.hijack()` + SSE headers（含 `X-Accel-Buffering: no`）、15 s `: ping`、`res.on('close')` → abort、失败发单个 `{ type: 'error' }` 且不发 `done`；`rate-limit.ts` 按 IP 固定窗口（默认 20 次/5 分钟，超限 429 + `Retry-After`）；`app.ts` / `index.ts` 依赖注入（ai / fetch / now）、统一 JSON 错误与 404、SIGINT/SIGTERM 优雅关闭、未配 Key 时仅告警并由 `/api/chat` 返回 503 `ai_not_configured`。
    验证（8a 实测，2026-11-03）：`npm run typecheck` 0 错；`npm test` **38/38**（6 文件：config 4 / contract 9 / rate-limit 3 / extract 8 / deepseek 7 / chat 7）；`npm run build` 通过（dist 10 个 js，`dist/index.js` 1,034 B）；`npm run format:check` All matched（新增 `server/.prettierrc` 与 `server/.prettierignore`）；真实进程冒烟 `PORT=3101 node dist/index.js` → `GET /api/health` 200 `{"status":"ok","service":"persist-server","ai":"disabled","model":"deepseek-chat",...}`、`POST /api/chat {"turns":[]}` 400 `invalid_request`。**未跑**：Playwright / 视觉检查 / `app` 侧任何检查——本步未改动 `app/`、`design/`，前端构建产物与步骤 7 完全一致。
    诚实披露的差异与未验证项：① **没有真实 DeepSeek Key**，上游返回格式、延迟、输出质量全部未验证，测试一律注入 fake `AiClient` / `FetchLike`；② **前端未接入**，`PlanChatSheet` 仍用 Mock 客户端、界面仍标注「本地生成 · Mock 对话」，8b 才接 `/api/chat`；③ 原计划把契约放 `shared/`，实际暂放 `server/src/contract.ts`（镜像 `app/src/lib/chat-types.ts`），因为前端已冻结、迁 `shared/` 要同时改 `app` 的 tsconfig 与构建入口，收益不抵风险，迁移推迟到 P3 收尾或 P4；④ 服务端只有按 IP 限流，无用户鉴权；⑤ 本机 `npm install` 必须带 `--cache .npm-cache`（默认缓存路径 EPERM），`npm test` 需一次性完整访问权限（Vite `windowsSafeRealPathSync` 会 spawn 子进程）。
**2026-11-04 步骤 8b 实施（前端接入服务端 AI + 真实 Key 联调，有代码改动）**

52. 步骤 8b 以 `b99d3ad`（`feat: 步骤 8b 前端接入 /api/chat（DeepSeek 真实对话 + Mock 诚实回退）`）完成：11 个文件、+973 −23。新增 `app/src/lib/ai-chat-client.ts`（增量 SSE 解析、`probeAiChat()` 健康探测、`createAppChatClient({ consent })` 组合真实/Mock、`ChatUnavailableError`、首个内容事件前才允许回退）与 `ai-chat-client.test.ts`（13 条）；`PlanChatSheet` 按 `profile.aiConsent` 切换客户端、副标题与回退提示如实标注来源；`PlansPage` 文案/徽标同步；`vite.config.ts` 加 `/api` 开发代理；`playwright.config.ts` 用 `PERSIST_API_TARGET=http://127.0.0.1:9` 隔离真实后端，`e2e/plans.spec.ts` 新增回退用例；服务端 `prompts.ts` 注入 `Asia/Shanghai` 当天日期（新增 `prompts.test.ts` 3 条），前端 `plan-draft.ts` 加日期兜底与过期里程碑过滤（`plan-draft.test.ts` 19 → 22）。
    验证（8b 实测，2026-11-04）：app `typecheck` 0 错、`npm test` **139/139**（9 文件）、`playwright test` **102 通过 / 0 跳过**（52.8 s）、`oxlint` 0 错 3 既有警告、`prettier --check src e2e vite.config.ts playwright.config.ts` All matched、`npm run build` 通过（`index-CsKy1ArK.js` 560.36 kB / gzip 166.13 kB，CSS 哈希未变）；server `typecheck` 0 错、`npm test` **41/41**（7 文件）、`npm run build` 通过。
    真实 Key 联调（本机临时进程 `PORT=3102`，Key 仅经进程环境变量传入，未写入任何文件/构建产物，进程用后即杀）：`GET /api/health` → `{"status":"ok","service":"persist-server","ai":"deepseek","model":"deepseek-chat"}`；`POST /api/chat` → HTTP 200、3.5 s、5643 B、127 个 SSE 事件（`stage` / `delta` / `proposal` / `done`）。首轮真实调用暴露质量缺陷：模型给出 `startDate "2025-01-06"`、`endDate "2025-03-02"`、里程碑全在 2025 年；修复提示词后复验 `startDate=2026-11-03`、`endDate=2026-12-28`、里程碑 `2026-11-30 第 4 周复盘` / `2026-12-28 第 8 周总结`。另一次调用遇到上游 503 `Service is too busy`，说明 Key 有效但服务端会波动。
    诚实披露与未做：① 保留的 Key 已经出现在开发对话历史里，**上线前必须轮换**（已扫描 `app/` 源码、构建产物、改动文件，均无 Key）；② AI 报告仍是前端 Mock（8c 未做）；③ 模型仍会追问 3 个澄清问题、周目标数量可能与用户描述不完全一致（质量波动，非阻塞）；④ 真实并发、限流与 Nginx 反代下的 SSE 行为需步骤 9 部署后复验；⑤ 视觉检查未重跑（会覆盖基线，待用户确认）；⑥ 本轮未修改样式，CSS 产物哈希与体积完全未变。

**2026-11-04 步骤 8c 实施（AI 报告接服务端，有代码改动）**

53. 步骤 8c 以 `bdd4265`（`feat: 步骤 8c 把 AI 报告接到服务端（/api/report + 报告页真实生成）`）完成：13 个文件、+1557 −80。服务端新增 `POST /api/report`（`routes/report.ts`）与非流式报告生成链路（`ai/report.ts` + `ai/prompts.ts` 的报告提示词与摘要渲染），`contract.ts` 抽出 `parseProfile()` 并新增报告契约（`ReportRequest` / `ReportContent` / `ReportResponse`，`digest` 四个来源至少一个非 null）；风险控制：请求校验 400、无 Key 503、共用 IP 限流 429、25 s 超时 504、上游失败 502、客户端断开 `reply.raw.on('close')` → 499，响应 `cache-control: no-store`，日志不记录请求体。前端新增 `app/src/lib/ai-report-client.ts` + `report-types.ts`（探活、POST JSON、`ReportUnavailableError` / `ReportContractError` 分流、响应再校验），`ReportsPage.tsx` 改为「授权 + 探活可用则经服务端生成文字，指标/依据/区间仍由本地记录确定性生成」；失败时回退本地 Mock 并显示 `REPORT_FALLBACK_NOTE` 且徽标同步降级，契约错误则明确报错不伪造报告；`ReportRecord` 新增可选 `origin`，详情页按来源显示三种说明；`reports.css` 新增 1 行回退提示颜色。
    验证（8c 实测，2026-11-04）：app `tsc -b` 0 错、`npm test` **149/149**（10 文件）、`playwright test` **102 通过 / 0 跳过**（59.5 s）、`oxlint` 0 错 3 既有警告（页面改动首轮触发的 `react(purity)` / `set-state-in-effect` / `exhaustive-deps` 已修掉）、`prettier --check` 全绿、`npm run build` 通过（`index-DmnjkjkL.js` 564.70 kB / gzip 168.01 kB，`index-CrJgYfMj.css` 137.70 kB / gzip 23.83 kB）；server `typecheck` 0 错、`npm test` **58/58**（8 文件，新增 `report` 17 条）、`build` 与 `format:check` 通过。
    真实 Key 联调（本机临时进程，Key 仅经进程环境变量传入，未写入任何文件/构建产物/日志，进程用后即杀）：`GET /api/health` → `ai:"deepseek"`；`POST /api/report` 完整摘要 **200 / 2.7 s** 返回中文简报；只授权学习时返回 200 / 2.0 s 且正文**完全不出现训练/饮食字样**、`warnings: []`。首轮真实调用暴露质量缺陷：模型算出「再补水约 0.5 L」（摘要里只有 1.5 L 与 1.0 L，差额是它自己减出来的）以及「把未完成的 2 组补齐」等推算数字 ⇒ 提示词改为**禁止任何数值推算**（缺口只能说「按目标补齐」）后复验，输出只含摘要里出现过的数字。
    诚实披露与未做：① 真实 Key 已在对话历史中暴露，**上线前必须轮换**；已扫描 `app/` 源码、`app/dist`、`server/dist` 与改动文件，均无 `sk-` 密钥；② 只有「今日简报」走服务端，`训练建议` / `学习观察` 仍打开本地已有报告（服务端 `type` 已支持三种）；③ 限流器与 `/api/chat` 共用（有意），做报告会挤占建档对话额度；④ 无账号鉴权、无费用/token 统计、无服务端缓存；⑤ 视觉检查未重跑——8c 改了 `/reports` 徽标、服务卡片、生成面板文案并删掉「模拟失败」按钮，基线已过期，需重跑并经用户验收后再更新 `design/`（**后记：该项已于当日闭环，reports 6 张基线重跑、各项 0、exit 0，经用户双端验收后随 `7625865` 入库**）；⑥ 真实并发与 Nginx 反代下的 `/api/report` 长请求需步骤 9 复验。

**2026-11-04 备案进度更新（纯文档，无代码改动）**

54. 用户同步备案最新状态：**阿里云初审已通过（2026-11-04）**，按平台要求**隔一天提交省通信管理局审核，计划 2026-11-05 提交**；管局通过并下发备案号前仍属「备案中」。据此同步文档：`docs/部署与服务器现状.md` §4 改为「初审 ✅ / 管局 ⏳待提交 / 备案号未下发」三段状态并新增六阶段备案时间线（提交 → 阿里云初审 → 提交管局 → 管局审核 → 下发备案号 → 解析域名 + 443 + 证书），§6 清单拆成「提交备案 ✅」与「提交管局 ⬜」两条；`HANDOFF.md` §0.2 / §0.4（步骤 10 行）/ §13（部署行）/ §14.1（备案风险行，新增「管局审核时长不可控、不要按经验值承诺上线日期」）/ §19（执行顺序）同步；`HANDOFF-新会话指令.md` §0/§3 快照/§6/§7 步骤表/前置提醒；`README.md`、`docs/项目现状总览.md`、`docs/工程初始化与前端约定.md`、`app/README.md`、`docs/Persist-项目开发规划.md`、`docs/部署与服务器现状.local.md`（不入库）一并更新。口径统一为「**拿到备案号才做步骤 10**」，并把原先「预计 1–2 周」的**初审**估计改为**管局**审核的法定期限（20 个工作日）＋「不承诺日期」。本轮未跑测试、未改代码、未动视觉基线。

---

## 19. 接手后的建议操作顺序

### 首次接手（了解现状，约 1 小时）

1. 阅读本文档，再读 `D:\Persist\app\src\App.tsx`、`MockDataProvider.tsx`、`types.ts`、`lib\chat-types.ts`、`lib\long-term-plan.ts`、`pages\PlansPage.tsx`。
2. 启动 `npm run dev -- --port 4173`（`http://127.0.0.1:4173/`，与 E2E / 视觉脚本同端口）。
3. 设置页加载完整演示数据，走一遍：档案页「AI 建档」→ 对话 → 确认草案 → `/plans` 查看进行中计划。
4. 按第 12 节清单做回归抽查（全量视觉基线已于 2026-11-03 通过并冻结，见 §10.5；第 12 节保留为改动后的回归清单）。

### 已确认的推进顺序（对应 §0.4）

5. **步骤 3** ✅ 已于 2026-11-03 完成：设置页导出导入切到 0.2.0（详见 8.5），补 round-trip 单测 + E2E。
6. **步骤 4** ✅ 已于 2026-11-03 完成：`/plans` 已加进 `visual:check`，15 状态 × 6 视口全量重跑，用户桌面端与移动端验收通过，前端视觉范围冻结。
7. **步骤 5** ✅ 已于 2026-11-03 完成：提交 `bd779eb` 已推送到 `github.com/save626/Persist`（`main` 分支），文档同步为 `da787c4`，仓库具备回滚基线。
8. **步骤 6** ✅ 已于 2026-11-03 完成并提交：本机 IndexedDB 持久化上线（详见 §6.6、§13 P2），`MockDataProvider` 契约不变，刷新/重开数据不丢，单测 123 条 + E2E 98 次执行全绿；提交 `128d6a2` 已推送。
9. **收尾清理与格式化** ✅ 已于 2026-11-03 完成并**推送**：`d4c9696` 清理死代码与历史设计制品，`style:` 提交移除 Tailwind 插件并格式化 19 个文件（详见 §18 第 42、43 条，均通过全量 `tsc` / `oxlint` / 单测 / E2E / 构建哈希比对 / 视觉检查）；推送后远端 `refs/heads/main` 与本地 HEAD 一致。
10. **下一步顺序（2026-11-04 更新，8c 已完成，P4 方案已定稿）**：步骤 7 ✅ P3-0「清空本机数据」入口（`a544a38`）→ 步骤 8 P3：8a 服务端 Fastify + DeepSeek 代理骨架 ✅（`9138175`）、8b 前端 `/api/chat` 接入 + Mock 诚实回退 + 真实 Key 联调 ✅（`b99d3ad`）、8c AI 报告接 `/api/report` + 真实 Key 联调 ✅（`bdd4265`，服务端 58/58、app 149/149、E2E 102 全绿）→ **步骤 9 = IP 直连首次部署**（本地构建上传 + Nginx 深链/反代/gzip + systemd；`/api/report` 需 `proxy_read_timeout ≥60s`，SSE 需 `proxy_buffering off`）→ 步骤 10 = 备案号下发后域名 + HTTPS（**备案进度：2026-11-03 提交、2026-11-04 阿里云初审通过、计划 2026-11-05 提交省通信管理局审核，管局通过并下发备案号前不得解析域名/开 443**）。**`/reports` 视觉基线已于 2026-11-04 重跑、6 张 png 更新并经用户双端验收（`7625865`），部署前置已完成。** 再往后：步骤 11（8d 数据历史化）→ 步骤 12–14（P4a 同步 / P4b 服务端 AI 综合分析 / P4c 备份恢复导出删除），终态方案见 `docs/P4-数据层与AI综合分析设计方案.md`；最后 P5 Android。步骤 11–14 可在备案等待期并行开发。每完成一个阶段提交一次，保持回滚粒度；部署侧规则见 `docs/部署与服务器现状.md`。

---

## 20. 交接结论

Persist 的当前成果是一个覆盖完整日常闭环、可跨模块联动、经过自动化验证的前端产品原型 + 已接通的 AI 服务端：八个页面（含长期计划）可完整点击验收，AI 引导建档 → 长期计划草案 → 确认启用 → 归档/重启的闭环已经打通（步骤 8b 起在授权 + 服务端可用时经本站代理调用真实 DeepSeek，失败自动回退本地 Mock 并如实标注），AI 报告文字也已经 `/api/report` 接真实模型（步骤 8c，指标与依据仍由前端生成，失败回退 Mock 并标注），JSON 导出导入已是备份 0.2.0（含长期计划、兼容旧 0.1.0），全部业务记录已写入本机 IndexedDB（刷新 / 关闭标签页 / 重开浏览器不丢，含长期计划），并已提供「清空本机数据」入口（删记录 → 重置内存态 → 清快照，二次确认），单元测试 app 149 条（10 文件）+ server 58 条（8 文件）、E2E 102 次执行（0 跳过）全部通过，两处 AI 联动均用真实 Key 完成端到端联调，视觉基线 15 状态 × 6 视口已由用户桌面端与移动端验收通过（8c 改了 `/reports` 文案与按钮后，reports 6 张基线已重跑并验收，`7625865`），Git 提交链已全部推送到 `github.com/save626/Persist`（`bd779eb` / `da787c4` / `128d6a2` / `e3e9730` / `d4c9696` / `style:` / `a544a38` / `9138175` / `b99d3ad` / `bdd4265` / `7625865` 及其后的 `docs:` 同步提交），仓库具备回滚基线。**P4 终态架构已定稿**（`docs/P4-数据层与AI综合分析设计方案.md`：本地优先 + 服务端 SQLite 可检索副本，服务端算数字、模型只写分析），实施尚未开始。第一份读物是 `docs/项目现状总览.md`，细节与契约以本文档为准。

但当前仍不是可长期使用的正式应用：数据只在本机浏览器（清站点数据即丢、无跨设备同步；清空入口已有但只在当前浏览器生效）、**AI 报告文字已可来自真实 DeepSeek（8c，`bdd4265`），但只有「今日简报」走服务端，指标与依据仍由前端生成，且服务端没有任何历史数据可检索**、服务端没有账号鉴权且真实 Key 需轮换、备份不可直接恢复、没有 Android 包。**服务器侧已就绪**（阿里云 ECS 2C2G + Node 20 + Nginx，80 端口已开放，见 `docs/部署与服务器现状.md`），**域名已购买、实名已通过、ICP 备案阿里云初审已通过（2026-11-04），计划 2026-11-05 提交管局审核，备案号未下发**，但项目代码尚未部署、443 未开。**P4 终态方案已定稿**（`docs/P4-数据层与AI综合分析设计方案.md`），但注意方案里的关键前提：当前只有学习记录是真实历史（训练历史是演示常量、饮食只有今天、饮水无日期），所以要先做步骤 11（8d）数据历史化。下一步顺序：步骤 9（IP 直连部署，reports 基线已验收，无前置）→ 步骤 10（备案后域名 + HTTPS）；步骤 11–14（8d → P4a 同步 → P4b AI 综合分析 → P4c 备份恢复）可在备案等待期并行推进，最后 P5 移动端发布。

交接时应坚持以下判断：

- 当前代码优先于旧规划文档；规划文档里的路由清单是目标态，不是现状。
- AI 报告不是学习板块的附属功能，四入口设计不得回退。
- 主导航固定五项；长期计划通过档案页 / 今日页 / `/plans` 进入。
- 健身动作必须保持自由输入。
- 不得把 Mock 能力包装成真实能力：AI 建档对话与 AI 报告在真实调用时必须标注「经本站服务端代理」，回退时必须标注「已回退到本地 Mock」；**报告文字可来自 DeepSeek，但指标数字与依据仍由前端按本地记录生成，且只有「今日简报」走服务端——不得宣称「报告全部由 AI 生成」**。
- 未确认前不得写档案或计划；档案写入必须过 `sanitizeProfilePatch`。
- 前端与服务端都不允许出现 API Key；Key 只经 `/etc/persist/server.env`（600）或本机进程环境变量注入，上线前轮换开发期间暴露过的 Key。
- 格式化已无插件风险（`prettier-plugin-tailwindcss` 已移除，`prettier --check .` 全绿），但批量格式化仍要单独成提交并比对构建哈希；条件类名仍用 `cn()` 或完整字符串三元。
- 持久化只写 IndexedDB 一条记录，改动 `MockDataProvider` 时必须同步维护 `persist-state.ts` 的迁移与版本，不能绕过 `schemaVersion`。
- 未经用户视觉验收不扩大无关功能范围；8c 已完成且 `/reports` 基线已验收，下一步最高优先级是步骤 9（IP 直连部署）→ 步骤 10（备案后域名 + HTTPS）；P4 按 `docs/P4-数据层与AI综合分析设计方案.md` 的步骤 11–14 顺序推进，不得跳过 8d 直接接数据库（否则没有历史可分析）。
- **不得把「计划中的 AI 综合分析」说成现有能力**：现状只有单窗口摘要 + 模型润色；真正的「检索全部历史做综合分析」要等 P4b 落地，且事实包里的数字必须由服务端 SQL 生成、模型禁止任何算术。
- P3 服务端契约以 `server/src/contract.ts` 与 `server/README.md` 为准；改动 `ChatEvent` 契约时必须同时改 `app/src/lib/chat-types.ts` 与 `server/src/contract.ts`，改动报告契约必须同时改 `app/src/lib/report-types.ts`，否则前后端事件顺序或报告字段会静默错位。