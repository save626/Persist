# Persist 项目交接文档

> 更新：2026-11-07 · 分支 `main` · 基线 `e260602` + 提交链：步骤 9 IP 直连部署（`76df093`）→ 晨间简报接真实模型（`9f9cc71`）→ 文档同步（`267146a`）→ 双端验收通过记录（`27858da`）→ 清理 lint 警告与残留文件（`f5a57f5`）→ 第三次重部署与文档同步 → 步骤 11（8d）数据历史化：11a 数据层 v2（`6d769a7`）→ 11b 健身真实历史（`bc4ee88`）→ 11c 报告窗口（`12de14b`）→ 报告页返回态修复（`8edb8ba`）→ 视觉基线入库（`5ee8d85`）→ 步骤 12（P4a）账号 + 增量同步：12a 数据层（`ca02250`）→ 12b 账号与同步接口（`6fe6b3d`，文档同步 `d555cb0`）→ 12c 同步契约搬 `shared/`（`c6a65fd`）→ 12d 客户端同步层（`9abd8bb`）→ 12e 设置页「数据同步」（`f09c3da`）→ 12f 收尾（pull 形状守卫 + 本机验收 + 视觉重跑 + 文档同步）→ 饮食照片/选图附件下线（`fbab985`）与跨日空餐次修复（`50d90ef`）→ 格式与文档同步（`c7cbcaa` / `91081a3`，当前 `HEAD` = `origin/main`）→ **步骤 13（P4b）服务端聚合 + AI 综合分析：13a 契约（`41ed92f`）→ 13b 服务端聚合与接口（`82ed773`）→ 13c 前端综合分析块与每日简报（`40d2bf4`）→ 文档同步（`7f13727`）→ 13d：内容不合规重试一次 + 提示词纠正（`18d5f77`）→ 真实 Key 结论与 13d 口径文档同步（`5ba4f7e`，当前 `HEAD` = `origin/main`）**——本机完成并验证（2026-11-05），**已推送，且服务端已于 2026-11-06 部署到生产**（只换后端，见 §13.3 实况），12 张视觉基线 png 已经用户授权随 `chore(design)` 入库。**2026-11-07 复核**：`HEAD` = `origin/main`；服务器实况已变——`/opt/node22/bin/node` **v22.19.0**、`ExecStart=/opt/node22/bin/node /opt/persist-next/server/dist/index.js`、`ProtectSystem=strict` + `ReadWritePaths=/var/lib/persist` + `UMask=0027`、`/var/lib/persist/persist.sqlite` 为 schema 2、`persist-backup.timer` active 且 **2026-11-07 03:00:55 无人值守实跑成功**、磁盘 40 G 用 14%；**前端静态包仍是步骤 9 那版 `index-DVS7rlR_.js`**（新产物 `index-F8XZrWTT.js` 628242 B 未上传）。步骤 14a（每日备份 + 磁盘水位）已上线，14b–14d 未开始。
> 本文件是「**现在是什么 + 下一步做什么**」的唯一事实源。其他分工：项目介绍与长期规划 → [`docs/Persist-项目开发规划.md`](docs/Persist-项目开发规划.md)（v2.0）；部署与服务器 → [`docs/部署与服务器现状.md`](docs/部署与服务器现状.md)；P4 终态设计 → [`docs/P4-数据层与AI综合分析设计方案.md`](docs/P4-数据层与AI综合分析设计方案.md)；工程/视觉/测试约定 → [`docs/工程约定.md`](docs/工程约定.md)。
> 当前阶段：八个页面（含 `/plans`）与既有交互已完成并视觉验收，**前端已冻结**——例外只有五处经用户批准：2026-11-04「今日页晨间简报接入真实 AI」（`9f9cc71`）与**步骤 11（8d 数据历史化）**（`6d769a7` / `bc4ee88` / `12de14b` / `8edb8ba`，只换数据来源与历史口径，不改导航与设计语言）、2026-11-05 饮食照片/选图附件下线（`fbab985`，按用户要求删除拍照与选图，只留手填与 AI 粘贴解析）、2026-11-05 跨日空餐次回归修复（`50d90ef`，用户双端报障后修）、**2026-11-05 步骤 13（P4b 服务端综合分析）在 `/reports` 末尾新增「服务端综合分析」块与设置页「每日简报」卡片**（不改既有页面结构与视觉语言；该批 png 已重跑并经用户授权随 `chore(design)` 入库）；服务端 P3（8a/8b/8c）已完成，**步骤 9（IP 直连部署）已于 2026-11-04 完成并通过验收**（真实 DeepSeek Key 已轮换，只存服务器 `/etc/persist/server.env`）；**P4 步骤 12（账号 + 增量同步）已于 2026-11-05 在本机完成并通过验收**（12a–12f：SQLite 数据层 + 设备令牌/恢复码 + `shared/` 同步契约 + 客户端同步层 + 设置页「数据同步」卡片），**已推送到 `origin/main`，服务端已于 2026-11-06 部署到生产**（Node v22.19.0 + `/opt/persist-next` + `/var/lib/persist`，停机 482 ms），**但线上前端仍是步骤 9 那版静态包**（`index-DVS7rlR_.js`），设置页「数据同步」卡片还没上传；设置页新增「数据同步」卡片带来的 **13 张视觉基线改动已经用户桌面端 + 移动端验收后随 `4d3edcf` 入库**；**2026-11-05 又完成三件事**：①按用户要求下线饮食拍照/选图附件（只保留手填与 AI 粘贴解析，`fbab985`，20 张视觉基线经双端验收后入库）；②修复用户双端报障的跨日缺陷——前一天有记录、第二天首次打开时今日餐次为空，导致「记录下一餐」无响应、AI 登记选不了餐次、登记不入库（`50d90ef`，app 单测 295/295、E2E 112 全绿）；③**步骤 13（P4b 服务端聚合 + AI 综合分析）本机完成并验证，源码与文档已推送（`41ed92f` / `82ed773` / `40d2bf4` / `7f13727` / `18d5f77` / `5ba4f7e`），服务端已于 2026-11-06 部署到生产**——事实包 v2 / 四个 `/api/v1` 分析接口 / 报告归档 365 天 / 每日简报 job / 前端综合分析块与设置卡片；server 175/175（18 文件）、app 334/334（24 文件）、E2E 120（9 文件 / 1.2 m）、oxlint 0/0（98 文件）、`vite build` JS 628.24 kB / CSS 145.40 kB；**本机已用真实 DeepSeek Key 验证 `/api/chat`、`/api/report`、`/api/v1/analysis/reports` 三条链路（2026-11-05），联调暴露的「模型偶尔写 6 段直接 502、正文夹带 `daysWithAnyRecord` 等英文字段名」已修（`18d5f77`：内容不合规带原因重试一次 + 提示词禁止内部标识符）；12 张视觉基线 png 已随 `chore(design)` 入库；**P4 步骤 14 已开工：14a 每日备份（`c6ed57e` / `7d6ef32`）已上线运行，14b 恢复 / 14c 导出 / 14d 删账号仍是设计**；ICP 备案阿里云初审已通过（2026-11-04），计划 2026-11-05 提交管局，**备案号未下发 ⇒ 仍属「备案中」，不得宣称「已上线」**。**2026-11-06 口径更正**：步骤 10 不再整步等备案号——只有**域名解析 / 443 证书 / HTTP→HTTPS / 页脚备案号 / 「上线」表述**必须等；**服务器升 Node 22、建 `/var/lib/persist`、systemd `ReadWritePaths`、每日备份、部署步骤 12/13、前端产物上传、SSH 加固都不必等（其中升 Node 22、建库目录、备份、部署 12/13 已于 2026-11-06 完成；剩前端产物上传、SSH 加固、删 3389）**（分解见 §13.3，落地清单见 `docs/部署与服务器现状.md` §6）。推荐路径：先在服务器做**零影响预演**（`/opt/node22` 并行安装 + `/opt/persist-staging` + 3100 端口，不动线上 3000/80），预演通过后再找窗口切换（1–3 分钟中断，保留一键回滚）。**实际做法（2026-11-06，已获用户授权并执行）：跳过 3100 端口预演，改为「备份先行 + 版本化目录 `/opt/persist-next` + 只改 `ExecStart`」，实测中断 482 ms，回滚锚点 `/root/step10-backup-20261106-143445`。**
> 本地验收地址：`http://127.0.0.1:4173/`（`cd app` 后 `npm run dev -- --port 4173`；手机访问加 `--host 0.0.0.0`）。
> 本文档地位：**代码实现优先于任何文档**；如文档与代码冲突，以 `D:\Persist\app` 与 `D:\Persist\server` 为准。

---

## 0. 一分钟接手

### 0.1 一句话现状

Persist 是个人自用、本地优先的「计划 → 记录 → 复盘 → AI 分析」工具。当前是**可完整点击验收、已通过桌面端 + 移动端视觉验收的前端产品原型 + 已接通的 AI 服务端**：8 个页面（今日 / 健身 / 饮食 / 学习 / 个人档案 / AI 报告 / 设置 / 长期计划）与 5 项主导航可用；业务数据写入本机 IndexedDB（刷新 / 关标签页 / 重开浏览器不丢，含长期计划、设置、复盘、快照，且**训练/饮食/饮水/计划已按日台账落历史**，`schemaVersion: 2`）；AI 引导建档、AI 报告文字与今日页晨间简报文字在「档案页开启授权 + 服务端可用」时经本站代理调用真实 DeepSeek，失败回退本地 Mock 并如实标注；JSON 导出导入为备份 0.3.0（含历史字段，兼容 0.2.0 / 0.1.0）；设置页有「清空本机数据」。自动化为 app 单测 334 条（24 个文件）+ server 单测 175 条（18 个文件）+ E2E 120 次执行（9 文件）+ 视觉基线 91 张（步骤 12 的 13 张、步骤 13 重跑的 12 张均已入库）（oxlint 0 错 0 警告 / 98 文件）。**步骤 12 起本机已有服务端 SQLite 副本、设备令牌与增量同步**（设置页「数据同步」默认关闭，关闭时不发任何同步请求；开启后全量 bootstrap + 5 秒防抖增量），**步骤 13 起本机还有服务端综合分析**（7/30/90 天事实包、四个 `/api/v1` 接口、报告归档 365 天、每日简报 job；分析结果只存服务端，不写回本机），**且服务端已于 2026-11-06 部署到生产**（Node v22.19.0、`/opt/persist-next`、schema 2、停机 482 ms）；**但线上前端静态包仍是步骤 9 的版本**——设置页「数据同步」卡片与 `/reports` 的服务端综合分析块还没上传，进线上页面看不到。**仍不得对外宣称「已上线」**（备案号未下发、只有 IP 直连）。

### 0.2 现在能做什么 / 不能做什么

**能**：八个页面全部交互与跨页联动（今日、健身含自由运动、饮食饮水、学习、档案、AI 报告、设置、长期计划）；本机持久化与一键清空；备份 0.3.0 导出/导入；训练/饮食/饮水/计划按日历史与「近 7 / 30 / 90 天」报告窗口；AI 建档对话真实调用（授权 + 服务端可用时）；AI 报告文字真实调用（数字与依据由前端按窗口内的本地记录确定性生成）；无 Key / 未授权 / 服务不可用时自动回退并标注来源；**步骤 13 起本机可让服务端按 7/30/90 天窗口聚合事实包并出「综合分析」**（模型只写文字、数字全部来自 SQL，规则降级、缓存、365 天归档都在本机验证过），`/reports` 页底新增「服务端综合分析」块、设置页新增「每日简报」卡片。

**不能**（不要当成已有能力）：

- ~~没有服务端数据库、账号、跨设备同步~~ → 步骤 12 的代码（SQLite 副本 + 设备令牌 + 增量同步）**已在本机完成并验收，服务端也已于 2026-11-06 部署到生产**，但**前端同步卡片（12e）还没上传**，所以在线上页面里仍然没有跨设备同步：换浏览器 / 清站点数据 / 无痕模式即丢数据。
- **历史只覆盖本机落过盘的天**：8d 之后训练（归档会话）/饮食（按日餐次）/饮水（带 `date`）/计划（带 `date`）都有真实历史，但更早的月份没有补录数据；演示种子只覆盖最近 7 天，因此「近 30 / 90 天」窗口数字与近 7 天相同。同步只把本机已有记录复制到服务器，**不会补出没落过盘的历史**。
- 没有**恢复** / 导出 / 删账号（步骤 14b–14d 未做），本机也没有真实快照恢复（快照只记录生成时间与记录数）；导入会整体替换本机数据且不可撤销。步骤 12 的同步副本**不是备份**；**14a 的每日快照（2026-11-06 上线）才是备份主体**，但恢复 / 导出 / 删账号仍未完成。
- AI 能力边界：**步骤 13 的服务端综合分析已部署**（`/api/v1/analysis/*` 线上可用），但**前端综合分析块还没上传**（线上页面看不到）；报告页「今日简报」的数字仍由前端按窗口内的本地记录确定性生成；每日简报 job **默认关闭**，且读的是同步上来的设置——**跨设备同步没开、设置没同步上去，它就不会跑**。
- 服务端 AI 接口只有按 IP 限流（20 次 / 300 s），**没有账号鉴权**；步骤 12 新增的 `/api/v1/*` 有设备令牌鉴权、步骤 13 的分析接口再加独立限流，**且已部署到生产**（2026-11-06）。线上服务端现为步骤 13 版本（IP 直连、仅内部调试），任何人拿到 IP 都能按限流额度调用 `/api/chat` 与 `/api/report`，`/api/v1/*` 需要设备令牌；**仍不得对外宣称「已上线」**（备案号未下发）。
- 无 Android 包（P5 未开始）、无系统通知（提醒只在界面配置）、健身历史详情按真实动作类型展示但仍只覆盖力量/有氧两类自由运动字段。
- 域名 `wpersist.top` 未解析、443 未开、无证书；**备案号下发前不得用域名对外提供 HTTP 服务**。

### 0.3 铁律（不可回退）

1. **一次只做一步**：做完写报告并停下等用户确认，不连做、不擅自扩大范围。
2. **前端视觉已冻结**：不改视觉、类名、布局，除非用户明确要求；改了任何页面文案/结构（尤其 `/reports`、`/plans`）必须重跑 `visual:check` 并请用户桌面端 + 移动端重新验收。
3. **契约先行**：改 `ChatEvent` / `profilePatch` / `/api/report` 请求响应，必须同步 `server/src/contract.ts` 与 `app/src/lib/*-types.ts`，并在报告中说明契约是否变化。
4. **无 Key 也能跑**：AI 不可用时回退本地规则/Mock，并在界面**如实标注来源**，绝不把 Mock 伪装成 AI。
5. **不许编造数据**：提示词已禁止任何数值推算（真实联调暴露过「1.5−1.0 推出再补水 0.5 L」），报告数字只能由确定性代码生成；不得写过去日期。
6. **未授权模块对 AI 不可见**：只发送 `ProfileData.aiConsent` + `MockSettings.sources` 允许的摘要，未授权模块在 `digest` 中为 `null`。
7. **公开仓库**：不得提交真实公网 IP（写作 `121.196.*.*`）、root 密码、API Key、`.env`、`*.local.md`、日志与构建产物。
8. **不得宣称已上线**：备案号下发前不得用域名对外服务，不得编造备案号，不得按经验值承诺上线日期（管局法定期限 20 个工作日）。
9. **不得把计划写成现状**：P4 的**恢复 / 导出 / 删除账号（14b–14d）仍是「设计」**，只有 **14a 每日备份已上线**（`c6ed57e` / `7d6ef32`，2026-11-07 03:00:55 定时实跑成功）；步骤 12 的账号与增量同步、步骤 13 的服务端综合分析**均已推送（`41ed92f` / `82ed773` / `40d2bf4` / `7f13727` / `18d5f77` / `5ba4f7e`）且服务端已于 2026-11-06 部署到生产**，但**线上前端静态包仍是步骤 9 那版**（`index-DVS7rlR_.js`）——所以「浏览器里已经能跨设备同步」「线上页面已有服务端综合分析」仍是错的，只有「服务端接口已可用」成立；不得写成「已上线」；真实 Key 验证**本机与服务器各做过一次**，但只说明接口可用，不代表对外可用。
10. **提交纪律**：提交前 `git diff --cached --name-only` 审计一遍（排除 `node_modules/`、`app/dist/`、`test-results/`、`Water intake record/`），推送后核对远端 `refs/heads/main` 与本地 HEAD 一致。

### 0.4 下一步（一次一步，做完停下）

| 步骤 | 内容 | 状态 / 前置 |
|---|---|---|
| ~~9~~ | ~~IP 直连首次部署~~ | ✅ **已完成（2026-11-04）**：`/var/www/persist` + `/opt/persist/server` + systemd `persist-server` + `/etc/nginx/conf.d/persist.conf`；8 个页面深链均 200、SSE 188 个事件 4.2 s 内增量到达、`/api/report` 2.78 s、限流 429 + `Retry-After` 实测通过；真实 Key 已轮换且只存 `/etc/persist/server.env`（`600`）。细节见 `docs/部署与服务器现状.md` §6 |
| **10** | 拆分推进：**A 段**（服务器升 Node 22、`/var/lib/persist` + `ReadWritePaths`、每日 `VACUUM INTO` 备份、部署步骤 12/13、前端产物、SSH 仅密钥 + `fail2ban`、删 3389 由用户控制台操作）+ **B 段**（域名解析、开 443、certbot、HTTP→HTTPS、页脚备案号） | **A 段第 1–7 项已于 2026-11-06 完成**（停机 482 ms；第 5 项备份与第 6 项部署均已实跑验证），**剩第 8–10 项：前端产物上传、SSH 加固、删 3389（控制台）**；**B 段等备案号下发**。备案进度：提交备案 ✅ 2026-11-03 → 阿里云初审 ✅ 2026-11-04 → 提交管局 ⏳ 计划 2026-11-05（实际状态以控制台为准）→ 管局审核 ⏳ 法定期限 20 个工作日 → 下发备案号 ⏳ |
| **11**（8d） | 数据历史化：训练真实历史落库、饮食/饮水/计划按日台账、`schemaVersion` 1→2、备份 0.3.0 | ✅ **已完成（2026-11-04）**：11a 数据层 v2（`6d769a7`）→ 11b 健身真实历史（`bc4ee88`）→ 11c 报告窗口（`12de14b`）→ 报告页返回态修复（`8edb8ba`）、学习来源随科目切换清空（`971e1b6`）；app 单测 230/230、E2E 106 全绿，P4 §6.3 前四项达标；**视觉基线已于 2026-11-05 双端验收通过并入库（`5ee8d85`）**；8d 前端资源尚未部署 |
| **12**（P4a） | 设备令牌 + 恢复码 + 增量同步：服务端 SQLite 数据层、`/api/v1/devices*`、`/api/v1/sync/*`、`shared/` 同步契约、客户端同步层、设置页「数据同步」 | ✅ **本机完成并验收（2026-11-05，12a–12f）**：app 292/292（21 文件）、server 112/112（13 文件）、E2E 110、P4 §7.4 19/19（**均为步骤 12 完成时的数字**；步骤 13 之后是 app 334、server 175、E2E 120）；**已推送，服务端已于 2026-11-06 部署到生产**（Node v22.19.0 + `/opt/persist-next` + `/var/lib/persist`，schema 2；前端「数据同步」卡片待随静态包上传；视觉基线 13 张已入库） |
| **13**（P4b） | 服务端聚合 + AI 综合分析：facts builder → 模型只写文字、报告缓存/归档、规则降级 | ✅ **本机完成并验证（2026-11-05，13a–13d），已推送（`41ed92f` / `82ed773` / `40d2bf4` / `7f13727` / `18d5f77` / `5ba4f7e`），服务端已于 2026-11-06 部署到生产**（本机与服务器均用真实 Key 验证过；前端综合分析块待随静态包上传）：server 175/175（18 文件）、app 334/334（24 文件）、E2E 120（9 文件 / 1.2 m）、oxlint 0/0（98 文件）；**真实 DeepSeek Key 本机验证** chat / report / 综合分析三条链路（分析首次 5.7 s、同参 `cached:true`、`force` 5.4 s、正文无英文字段名）；视觉 png 已重跑并**随 `chore(design)` 入库**（用户授权） |
| **14**（P4c） | 备份 / 恢复 / 导出 / 删除账号（PIPL 闭环） | 🟡 **进行中 1/4**：**14a 每日备份 + 保留策略 + `/api/health` 磁盘水位已上线运行**（`c6ed57e` / `7d6ef32`；2026-11-07 03:00:55 定时实跑成功）；14b 恢复 / 14c 导出 / 14d 删账号未开始（设计见 P4 §12） |
| **15**（P5） | Capacitor Android 打包与真机验证 | 依赖部署与冻结后的前端 |

步骤 3–9、11 已于 2026-11-03/04 完成、步骤 12 于 2026-11-05 本机完成、步骤 13 于 2026-11-05 本机完成并验证（明细见 §13 与 §18，不在本表重复）。**步骤 12、13 均已本机完成、推送，并已于 2026-11-06 部署到生产**（Node v22.19.0，`/opt/persist-next`）。**下一步是步骤 14b–14d（恢复 / 导出 / 删账号）与步骤 10 A 段第 8–10 项（前端产物上传、SSH 加固、删 3389）**。**终态方案的唯一来源是 P4 文档**，不要照旧规划的 Dexie / Drizzle / Docker 设想实施。

### 0.5 每步汇报格式（固定 8 段，中文）

1. 本次完成内容；2. 修改文件列表；3. `ChatEvent` / `profilePatch` 契约是否变化；4. 长期计划生命周期与导出导入方案；5. 实际执行的测试及结果（命令 + 数字，未跑就写「未跑」）；6. 已知限制与未完成事项；7. 建议的下一阶段；8. 是否需要用户重新视觉验收。

### 0.6 必读顺序与文档地图

新会话接手顺序：本文件 → [`docs/Persist-项目开发规划.md`](docs/Persist-项目开发规划.md)（项目介绍 + 长期规划） → [`docs/部署与服务器现状.md`](docs/部署与服务器现状.md) → [`docs/P4-数据层与AI综合分析设计方案.md`](docs/P4-数据层与AI综合分析设计方案.md) → [`docs/工程约定.md`](docs/工程约定.md) → [`README.md`](README.md) / [`app/README.md`](app/README.md) / [`server/README.md`](server/README.md) → 源码 `app/src/App.tsx` → `context/MockDataProvider.tsx` → `lib/persist-state.ts` → `lib/persist-storage.ts` → `types.ts` → `lib/chat-types.ts` / `lib/report-types.ts` / `lib/ai-chat-client.ts` / `lib/ai-report-client.ts` / `lib/report-digest.ts` / `lib/morning-brief.ts` / `lib/use-new-record-param.ts` → `pages/PlansPage.tsx` / `pages/ReportsPage.tsx` / `components/TodaySheets.tsx` → 视觉对照 `design/home-v3-countdown.html` 与 `design/*.png`。

| 文档 | 作用 |
|---|---|
| `HANDOFF.md`（本文） | 现状、契约、风险、执行计划、路线、历史（**唯一权威**） |
| `docs/Persist-项目开发规划.md` | 项目介绍与长期规划（v2.0）：定位、边界、功能规划、数据与技术架构、P0–P6 / 步骤 9–15、风险、Backlog、验收清单 |
| `docs/部署与服务器现状.md` | 部署侧唯一事实源：服务器规格、备案、七条硬规则、Nginx 草案、命令速查、待执行清单 |
| `docs/P4-数据层与AI综合分析设计方案.md` | P4 终态设计（唯一）：SQLite 选型与 DDL、8d 历史化、同步协议、事实包 v2、隐私边界、步骤 11–14 验收、待确认项 |
| `docs/工程约定.md` | 技术选型、视觉与响应式基线、可访问性、非功能要求、测试门禁、术语 |
| `docs/部署与服务器现状.local.md` | **不入库**（`.gitignore` 的 `*.local.md`），真实公网 IP |
| `README.md` / `app/README.md` / `server/README.md` | 项目门面与本目录说明、命令 |

**跳过**：`node_modules`、`dist`、`test-results`、`playwright-report`、`.chrome-headless-*`、`design/.edge-profile*`、`Water intake record/`（368 MB 旧 Electron 工具，仅作饮水行为参照，已 gitignore）。

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
- **渐进扩展**：先稳定日常闭环，再增加复杂训练计划与同步。

### 1.3 第一版成功标准与当前状态

| 成功标准 | 当前状态 | 说明 |
|---|---|---|
| AI 引导式建档并可修改 | ✅ 已完成（8b 起可走真实 DeepSeek） | 档案页「AI 建档」→ `/plans?onboard=1`；确认后才写回档案并启用计划；服务端不可用时回退本地规则并如实标注 |
| 今日计划可创建、调整、完成 | ✅ 已完成 | 记录写入本机 IndexedDB，刷新不重置；计划项带 `date` 按日台账，今日页只读写当天（8d 已完成） |
| 健身/饮食/饮水/学习可记录 | ✅ 已完成 | 可跨页联动并持久化到本机 |
| 关闭并重新打开后数据仍存在 | ✅ 已完成（本机浏览器级） | IndexedDB 持久化；换浏览器 / 清站点数据会丢，线上页面仍无跨设备同步（步骤 12 代码已完成、服务端 2026-11-06 已部署，但前端同步卡片未上传） |
| 晚间状态与 AI 复盘 | ✅ 已完成（8c 起文字可来自真实模型） | 指标与依据仍由前端按本地记录确定性生成，模型只写文字；不可用时回退 Mock 并标注 |
| 近 7 天和月度统计 | ✅ 已完成（本机） | 报告页本地块按近 7 / 30 / 90 天窗口汇总真实历史（8d）；步骤 13 起 `/reports` 增加「服务端综合分析」块：事实包由服务端 SQL 聚合（7 / 30 / 90 天，30 天给逐日 + 周汇总、90 天只给周汇总），模型只写文字，跨月趋势叙述已可如实生成（**后端已部署、前端块未上传**；本机与服务器均已用真实 Key 验证） |
| 完整导出并在空环境恢复 | 🟡 本机 JSON 导出导入 0.3.0 已完成 | 含历史字段，兼容 0.2.0 / 0.1.0；无服务端备份与真实空库恢复（P4 步骤 14） |
| Android APK 可安装 | ⬜ 未开始 | 尚未接 Capacitor |
| DeepSeek 不可用时可降级 | ✅ 已完成 | 8b/8c 已实现探活 + 回退 + 如实标注；`/reports` 契约错误显式报错，不伪造报告 |

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
| 服务器 | 阿里云 ECS 环境准备（Node 20 + Nginx + 安全组 80） | ✅ 环境就绪（2026-11-03）；**代码已于 2026-11-04 部署**（见 `docs/部署与服务器现状.md`） |
| 步骤 7 | P3-0：设置页「清空本机数据」入口 | ✅ 已完成（2026-11-03，`a544a38`，E2E 100 次全绿） |
| 下一阶段 C | Fastify + DeepSeek 服务端代理（步骤 8） | ✅ 代码完成：8a 服务端骨架（`9138175`）、8b 前端接入 + 真实 Key 联调（`b99d3ad`）、8c AI 报告接服务端（`bdd4265`）；app 单测 230/230、server 58/58、E2E 106 全绿；**步骤 9 部署验收已完成（2026-11-04）**；此后今日页晨间简报也接入 `/api/report`（`9f9cc71`），清理 3 条 lint 警告（`f5a57f5`），并完成步骤 11（8d）数据历史化（`6d769a7` / `bc4ee88` / `12de14b` / `8edb8ba`），修复学习来源不随科目切换（`971e1b6`） |
| 步骤 12 | P4a：账号 + 增量同步（本机） | ✅ **本机完成并验收（2026-11-05，12a–12f）**：服务端 SQLite 数据层 + 设备令牌/恢复码 + `/api/v1/*` + `shared/` 同步契约 + 客户端同步层 + 设置页「数据同步」卡片；**已推送，服务端已于 2026-11-06 部署到生产**（Node v22.19.0；前端同步卡片待随静态包上传） |
| 步骤 13 | P4b：服务端聚合 + AI 综合分析（本机） | ✅ **本机完成并验证（2026-11-05，13a–13d）**：事实包 v2（7/30/90 天，数字全部来自 SQL）+ 四个 `/api/v1` 分析接口 + 报告缓存（`dataRev`）与 365 天归档 + 规则降级 / 数字白名单 + 内容不合规重试一次 + 每日简报 job + `/reports` 综合分析块与设置卡片；server 175/175（18 文件）、app 334/334（24 文件）、E2E 120（9 文件）、oxlint 0/0；**已推送（`41ed92f` / `82ed773` / `40d2bf4` / `7f13727` / `18d5f77` / `5ba4f7e`），服务端已于 2026-11-06 部署到生产**（本机与服务器均用真实 DeepSeek Key 验证过三条链路；前端综合分析块待随静态包上传） |
| 部署 | 步骤 9 IP 直连部署 → 步骤 10 拆分推进（可先做项 + 域名 / HTTPS） | ✅ 步骤 9 完成（2026-11-04，仅 IP 直连内部调试，**未宣称上线**）；**2026-11-06 拆解并执行**：升 Node 22、`/var/lib/persist`、每日备份、部署步骤 12/13 已于当日完成（停机 482 ms），剩前端产物上传、SSH 加固、删 3389；只有域名解析 / 443 / 证书 / 页脚备案号要等（阿里云初审 2026-11-04 通过；管局审核状态以阿里云控制台为准，不承诺日期） |
| 下一阶段 D | 服务端备份、校验与恢复（步骤 14） | 🟡 **14a 每日备份 + 保留策略 + 磁盘水位已上线**（`c6ed57e` / `7d6ef32`）；14b 恢复 / 14c 导出 / 14d 删账号仍是设计，**可在本地先行，不依赖部署或备案号** |
| 下一阶段 E | Capacitor / Android 发布 | 未开始 |
| 后续 | 高级统计、恢复 / 导出 / 删除账号（步骤 14b–14d）、外部数据接入 | 未开始 |

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
| 服务端 | 仅 API（`/api/health`、SSE `/api/chat`、JSON `/api/report`），无页面 | 8a/8b/8c 已完成（Fastify + DeepSeek 代理骨架 + 前端接入 + 报告生成）；12a–12c 完成数据层、账号/同步接口与 `shared/` 契约；13a–13d 完成 schema v2、事实包聚合、`/api/v1/analysis/*` 与 `/api/v1/reports`、每日简报 job、内容不合规重试与综合分析契约 | 已接入（`/api/chat` 供 AI 建档；`/api/report` 供报告；`/api/v1/analysis/reports` 供服务端综合分析） | 生产库 `/var/lib/persist/persist.sqlite`（schema 2、WAL、`640`）+ 每日快照（14a）；`/api/health` 返回 `db:"ok"` / `version:2` / `storage` | 服务端单测 175/175（18 文件）；E2E 用不可达端口验证回退 |
| 账号与同步 | 无新路由；设置页新增「数据同步」卡片（12e）与「每日简报」卡片（13c） | 同步开关默认关闭（关闭时不发任何请求）；开启后全量 bootstrap → 5 秒防抖增量；恢复码 / 立即同步 / 吊销本机；每日简报默认关闭（21:00），**改设置后需同步上去服务端才会跑** | 与今日、健身、饮食、学习、档案、计划等切片联动（outbox → push/pull，LWW + 墓碑） | 本机 `server/data/persist.sqlite` + 生产 `/var/lib/persist/persist.sqlite`（均 `node:sqlite`，Node ≥ 22.5，schema v2）；**服务端已于 2026-11-06 部署**（生产 Node v22.19.0），前端同步卡片未上传 | 12d/12f app 同步层单测 62 条（5 文件）；13b/13c 服务端分析用例含在 175 内；E2E `reports-analysis.spec.ts` 4 条 × 2 |
| 部署 / 服务器 | ECS 2C2G：系统 Node 20.20.2 + `/opt/node22` v22.19.0 + Nginx；2026-11-04 部署前端静态 + Fastify（IP 直连），2026-11-06 后端切到 `/opt/persist-next`（步骤 12/13），**前端静态包仍是步骤 9 那版** | 有（SQLite 数据层 + 设备令牌 + `/api/v1/*` + 综合分析，Node v22.19.0） | 无（同源相对 `/api`） | 生产 SQLite `/var/lib/persist/persist.sqlite` + 每日备份 timer | ✅ 步骤 9 验收 7/7 通过（含双端人工验收，§13.2）；2026-11-06 切换复验 health 200 / 停机 482 ms |
| Android | 未开始 | 无 | 无 | 无 | 无 |

说明：持久化是**整库单记录**方案——13 个状态切片（8d 起含 `fitnessHistory` / `dietDays` 与带 `date` 的饮水、计划历史）合成一条 `persist-mock-state` 记录（`schemaVersion: 2`），不按模块拆分 store；任一模块改动都会重写整条记录（写入量约 100–300 KB/次，200 ms 防抖）。

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
- 8d（11b）已删除 `FitnessPage.tsx` 的 `HISTORY` 演示常量与 `HistoryExercise` 类型：历史列表读 `fitnessHistory`（`FitnessSessionRecord[]`），详情按真实动作类型展示力量（重量 / 次数）或有氧（时长 / 距离）字段，模板缺失时标题退回「自由训练」。

## 4.3 饮食页

关键文件：

- `D:\Persist\app\src\pages\DietPage.tsx`

已完成 Mock 能力：

- 早餐、午餐、晚餐、加餐四个餐次。
- 食物条目新增、编辑、删除。
- 热量、蛋白质、碳水、脂肪录入。
- 餐次备注和时间编辑。
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

- 不提供拍照/选图入口：餐食只记录文字、餐次与营养数据，本机不保存任何图片（2026-11-05 移除原照片附件 Mock）。
- 外部 AI 营养文本解析发生在浏览器本地，不是调用 DeepSeek。
- 今日饮水总量由 `1200 ml` 初始基线和今日 `waterLog` 增量组成；`1200 ml` 是初始演示常量，不会随持久化重复叠加（写入的是 `waterLog` 增量与其它状态，不含基线本身）。\n- **口径差异（8d 明确记录）**：报告页按窗口汇总饮水时只累加真实 `waterLog` 记录（含 `date`），不叠加 1200 ml 基线、也不按「基线 +1 个记录节点」计数；今日页与晨间简报保持上面的基线口径。历史窗口数值因此与今日页不同，这是有意为之。

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
- `D:\Persist\app\src\lib\analysis-client.ts`（步骤 13：四个分析接口 + 四态来源标签 + 9 类错误分流）
- `D:\Persist\app\src\lib\analysis-contract.ts`（步骤 13：转出 `@persist/shared/contract/analysis`）

当前能力（8c 之后已接真实模型，8d 之后数字按窗口）：

- 报告类型卡片、报告周期切换（近 7 / 30 / 90 天）、分析依据查看/收起、数据源开关（健身 / 饮食 / 学习 / 档案）。
- 8d（11c）：所有数字、依据行与「本次引用 N 条」都按 `createDateWindow(range, today)` 的窗口汇总——训练读 `fitnessHistory` 归档记录 + 未归档的进行中会话；饮食读 `dietDays`、饮水读带 `date` 的 `waterLog`、学习按 `date` 过滤、计划读按日台账；窗口文案写「近 7 / 30 / 90 天」。
- 8c：授权 + `/api/health` 可用时走同源 `/api/report`（DeepSeek），展示「DeepSeek · 经本站服务端代理」；失败分流为可读错误并回退 Mock，绝不伪装成真实模型。
- 指标卡、结论、行动建议由确定性代码按窗口事实生成（`report-window.ts` + `report-digest.ts`），模型只写分析文字；服务端不可用时仍可看到本地简报。
- 历史报告保存/查看、应用建议到今日计划（复制计划项）、Mock 报告导出。
- 步骤 13c：页面末尾新增「服务端综合分析」块（与上面的本地简报并存）——窗口 7 / 30 / 90 天、生成 / 重新生成（`force`）、来源标记（`DeepSeek 经本站服务端代理` vs `规则降级`）、`cached:true` 缓存标记、归档列表与详情（`GET /api/v1/reports`）。服务端结果**只存在页面状态与服务端归档**里，不写本地 `reports`。**依赖 `/api/v1/analysis/*`：该接口已于 2026-11-06 随部署上线，但这块前端产物还没上传，所以线上页面看不到**。

已知边界：

- 本地简报的服务端提示词仍写「今日…」，但数字已按窗口汇总；跨窗口的趋势叙述由步骤 13 的服务端综合分析块给出（本机）。
- 两个块互不覆盖：服务端结果只留在页面状态与服务端归档，**不写回本地 `reports`**，0.3.0 导出里也没有这些报告（本地简报与导出仍是步骤 11 口径）。
- 无服务端历史检索、无 Token 费用统计；限流为服务端 20 次 / 300 s，步骤 13 的分析接口另有一个独立限流器（默认 6 次 / 5 分钟）。

## 4.7 设置页

关键文件：

- `D:\Persist\app\src\pages\SettingsPage.tsx`
- `D:\Persist\app\src\data\settings.ts`（`MockSettings.dailyBrief?`，可选字段，`schemaVersion` 仍是 2、备份仍是 0.3.0）

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
- 数据同步卡片（步骤 12e）：跨设备同步开关（默认关）、注册后展示恢复码（4×8 大写）、「用恢复码绑定已有账号」、本机设备 / 最近同步、立即同步、吊销本机（`alertdialog` 二次确认）。**依赖服务端 `/api/v1/*` 与 SQLite：服务端已于 2026-11-06 部署（`/var/lib/persist`，schema 2），但这张卡片所在的前端产物还没上传，线上页面看不到**。
- 每日简报卡片（步骤 13c）：开关（默认**关**）、时间输入（默认 `21:00`）、非法时间回退到默认值并给提示；卡片明确写「需先开启数据同步并把设置同步到服务端才生效」。**同样是「服务端已部署、前端未上传」**（服务端 job 默认关闭）。

重要边界：

- “清空本地 Mock 设置”只重置提醒、AI 授权和数据源选择，不删除业务示例数据。
- “生成快照”不创建可恢复磁盘副本，只记录时间和当前记录数量。
- Mock 连接测试不是实际网络请求。
- 「数据同步」开关关闭时不发起任何同步请求；开启后先把本机数据全量上传一次，再按 5 秒防抖做增量。同步副本**不是备份**（不能回滚到历史版本），恢复码即账号凭据、丢失无法找回。
- 「每日简报」只在服务端按 `settings.payload_json.dailyBrief`（同步上来的设置）判断，env 只是兜底；开关默认关、默认 21:00，进程内 60 s tick，**不需要 systemd timer / cron**；设置改了但没同步上去时服务端看到的还是旧值。
- 设置（含提醒开关、时间、AI 授权、数据源、每日简报）修改后写入本机 IndexedDB，刷新与重开浏览器都保持；只有清除站点数据才回到初始值。

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
- 备份层现为 0.3.0（8d）：`serializeMockBackup` 输出 `longTermPlans` 与历史字段，解析兼容 0.2.0 / 0.1.0（缺字段补齐为空数组），`countMockRecords()` 统计计划数与历史记录数。

- 设置页 JSON 导出已切换到 `serializeMockBackup()`：当前输出 `version: '0.3.0'`、含 `longTermPlans` 与历史字段、文件名带日期、失败走 try/catch toast；导入走 `parseMockBackupJson()` 版本分流，成功 toast 同时报学习记录数与长期计划数（步骤 3 起，8d 升级版本号）。
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
| 当前后端 | Fastify 5（P3 8a+8b+8c + P4a 12a–12c + P4b 13a–13d 已实现，`server/`，监听 `127.0.0.1:3000`；本机 `npm test` 197/197（21 文件，含 14a 备份），前端 AI 建档、报告与综合分析都已在**本机用真实 DeepSeek Key** 联调（2026-11-05；综合分析首次 5.7 s、缓存命中、`force` 重生成均通过）；**脚本不读 `.env`，真实 Key 启动用 `node --env-file=.env dist/index.js`**；**服务端已于 2026-11-06 切到步骤 12/13**：systemd `persist-server` 常驻，`ExecStart=/opt/node22/bin/node /opt/persist-next/server/dist/index.js`（Node v22.19.0），`/var/lib/persist/persist.sqlite` schema 2，`persist-backup.timer` 每日 03:00 且已实跑成功；**前端静态包仍是步骤 9 版本**） |
| 部署/托管 | Nginx 1.24（阿里云 ECS / Alibaba Cloud Linux 3；系统 Node.js v20.20.2，服务实际跑并行安装的 `/opt/node22/bin/node` v22.19.0），前端纯静态托管 + `/api` 反代 `127.0.0.1:3000`，详见 `docs/部署与服务器现状.md` |
| AI 供应商 | DeepSeek（`deepseek-chat`；Key 只在服务端 `/etc/persist/server.env`。前端 AI 建档走 `/api/chat`，报告文字走 `/api/report`） |
| 数据库 | SQLite **单文件库**（步骤 12a 已引入）：驱动**已定**内置 `node:sqlite`（2026-11-05，P4 §11.4，要求 Node ≥ 22.5；服务器在步骤 10 一并升级）。本机默认 `server/data/persist.sqlite`（`DB_PATH` 可覆盖），生产库 `/var/lib/persist/persist.sqlite`（2026-11-06 已建，schema 2，WAL）；**明确不装 MySQL/MariaDB**，不用 ORM，驱动差异隔离在 `server/src/db/driver.ts` |
| 当前共享层 | `@persist/shared`（步骤 12c 建包，步骤 13a 扩到综合分析）：`contract/{sync,entities,parse,analysis}.ts`，`app` 与 `server` 以 `file:../shared` 同源引用（`shared/dist` 由 `npm run shared:build` 产出、已 gitignore）；chat/report 的请求响应类型与校验仍暂放 `server/src/contract.ts`（镜像 `app/src/lib/chat-types.ts` 与 `app/src/lib/report-types.ts`），迁 `shared/` 另排期 |

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
│     │                   （步骤 12：sync-contract / sync-client / sync-queue / sync-store / sync-entities / sync-engine）
│     ├─ pages/           八个业务页面（含 plans）
│     ├─ styles/          分模块样式
│     └─ test/            测试初始化
├─ design/                视觉原型与截图
├─ docs/                  产品规划与工程文档
├─ server/                Fastify + DeepSeek 代理（P3 8a+8b+8c）+ 数据层与同步接口（步骤 12a/12b）+ 综合分析（步骤 13a–13d）
│  ├─ src/                app / config / contract / auth / rate-limit / index
│  │  ├─ routes/          health、chat、report、guards、devices、sync、analysis、reports
│  │  ├─ sync/            accounts（注册/恢复/吊销）、service（push 幂等 / bootstrap / pull）
│  │  ├─ analysis/        time、facts（7/30/90 天事实包）、metrics、rules（规则降级）、service（缓存 / 归档 / 白名单）
│  │  ├─ jobs/            daily-brief（进程内 60 s tick、默认关闭、按 runKey 幂等）
│  │  ├─ db/              driver、migrations（v1→v2）、entities、index、repositories（entities / devices / sync-ops / sync-seq / reports / jobs）
│  │  └─ ai/              deepseek、prompts、extract、report、analysis
│  └─ test/               Vitest 18 文件 175 条
└─ shared/                @persist/shared（步骤 12c 建包，步骤 13a 加综合分析契约）：contract/{sync,entities,parse,analysis}.ts，app / server 同源引用
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

当前实现（8d 后已定案）：

```text
今日页总饮水量 = 初始基线 1200 ml + 今日 waterLog 增量
报告窗口饮水量 = 窗口内 waterLog 记录之和（不叠加基线）
```

- `waterLog` 初始为空数组，每条记录带 `date`（`YYYY-MM-DD` 本地日期）。
- 完整演示数据额外提供 3 条今日饮水事件（250 + 250 + 300 = 800 ml）。
- `undoWater()` 只撤销最后一条，不会撤销 1200 ml 基线。
- 1200 ml 定性为「今日页演示预置值」，只属于今日切片；`buildReportDigest` 在窗口模式下不再用它，也不再按「基线 +1 个记录节点」计数——因此报告页的历史饮水数字小于今日页，是有意口径差异，已在 `report-window.ts` 与测试中固定。

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
  schemaVersion: 2,             // 记录格式版本（8d 升到 2），不是备份文件版本
  savedAt: '2026-11-04T…Z',
  backup: { version: '0.3.0', exportedAt, data: { …13 个切片 + 历史字段… } },  // 复用备份校验
  snapshot: { id, createdAt, recordCount } | null
}
```

写入与读回规则：

1. **首挂载水合**：`MockDataProvider` 在 `useEffect` 里 `loadPersistedState()`，成功则用记录里的 13 个切片替换初始 Mock，然后才渲染子树；水合完成前该 Provider 返回 `null`，避免演示数据闪一帧后被覆盖。此时也不会写盘（`hydrated` 之前跳过保存）。
2. **防抖写盘**：状态变化后 200 ms 防抖写入整条记录；`pagehide` 与 `visibilitychange → hidden` 时用 ref 取最新状态立即补写一次，避免关标签页丢最后一次编辑。
3. **迁移**：`persist-state.ts` 的 `MIGRATIONS` 按 `schemaVersion` 逐级升级。现有 v0 → v1（早期无版本号记录，补 `schemaVersion` 与 `savedAt`）与 **v1 → v2（8d 数据历史化）**：把备份数据升到 0.3.0、给 `waterLog` / `planItems` 补 `date`（取上次保存日，避免写出未来日期）、旧 `meals` 搬进 `dietDays`、已完成但未归档的 `fitnessSession` 归档为 `workout-legacy-<时间戳>` 并清空活动会话（迁移里的 `archiveCompletedSession: true`；文件导入不走这条，避免把别人的今天当自己的）。版本高于当前应用的记录会被判定为 `unsupported-version`，**只读不覆盖**，控制台告警，等在更新版本的应用里打开——这样用户从新版退回旧版时不会把数据降级写坏。
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
- 8d 起版本 `0.3.0`：`data` 里多了 `fitnessHistory`、`dietDays`、带 `date` 的 `waterLog` 与 `planItems`；导入 `0.3.0` / `0.2.0` / `0.1.0` 均可用，缺历史字段按空数组补齐。

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

备份层（`mock-data-transfer.ts`）已按 0.3.0 完成（8d）：

- `PERSIST_BACKUP_VERSION = '0.3.0'`，`LEGACY_BACKUP_VERSION = '0.1.0'`；`normalizeBackupVersion()` 同时接受 `0.2.0` / `0.1.0` 并降级补齐。
- `serializeMockBackup()` 输出 `version: '0.3.0'`，`longTermPlans` 与历史字段（`fitnessHistory` / `dietDays` / 带 `date` 的 `waterLog`、`planItems`）按固定顺序写进 `data`，缺失时显式写 `[]`。
- `upgradeMockBackupData()` 负责旧格式升级：`meals` → `dietDays`、饮水与计划补日期、已完成会话归档；记录迁移传 `archiveCompletedSession: true`，**文件导入传 false**（不把文件里的「进行中会话」当成自己的今天）。
- `parseMockBackupJson()` 用 `normalizeBackupVersion()` 分流，版本不符给可读错误且不覆盖现有数据。
- `countMockRecords()` 已把长期计划与历史记录计入记录数。

页面层（步骤 3，2026-11-03 完成）：

- `SettingsPage.exportMockData()` 已改为调用 `serializeMockBackup()`：导出 `version: '0.3.0'`、包含 `longTermPlans` 与历史字段、文件名带日期，序列化/下载异常走 try/catch 并给中文 toast。
- 导入侧走 `parseMockBackupJson()` 的版本分流（可读 0.3.0 / 0.2.0 / 0.1.0）；成功 toast 同时展示学习记录数与长期计划数，失败给可读原因且不覆盖现有数据。
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
- 真实 AI 的 token/费用/延迟数据只在本机联调与 IP 直连部署后实测中观察（约 3.5 s 返回、单轮两次模型调用；部署后 `/api/chat` 首包 0.118 s、末包 4.215 s，`/api/report` 2.78 s），仍没有额度上限与费用统计。

**AI 报告也已接真实模型（步骤 8c，2026-11-04，`bdd4265`）**

- 报告页打开时先 `GET /api/health` 探测，只有 `ai === 'deepseek'` 才显示「DeepSeek 生成 · 经本站服务端代理」；否则显示「本地生成 · Mock 报告」。
- 生成时浏览器同源 `POST /api/report`，请求体只有 `{ type, rangeDays, digest }`；`digest` 里只有「授权已开启 + 设置里来源开关打开」的模块，其余是 `null`（不是 `0`），所以模型不会把未授权误读成「没有记录」。
- **模型只写文字**：`title / status / summary / conclusions / actions / warnings`；指标数字、依据条目、统计区间仍由前端按本地记录确定性生成——模型无法改数字。
- 失败分流：服务不可用（网络/503/429/504）→ 回退本地 Mock，并在生成面板显示「真实模型暂时不可用，本次已回退到本地 Mock（规则生成）」且徽标同步变回 Mock；响应不合契约 / 净化不通过 → **明确报错（`ReportContractError`），不伪造报告**，记录本身不受影响，可直接重试。
- 客户端断开（关页面/切页）→ 服务端 `AbortController` 中止上游，返回 499，不浪费额度。
- 真实 Key 验证（本机临时进程，Key 仅经进程环境变量传入，未写入任何文件）：完整摘要 **2.7 s** 返回 200 + 中文简报；只授权学习时，生成的报告**完全不出现训练/饮食字样**；首版提示词允许「推算」，模型算出了「再补水约 0.5 L」这种摘要里没有的数字，已改为**禁止任何数值推算**并复验通过。
- 仍有 Mock 的部分：`训练建议` / `学习观察` 两类报告目前仍打开本地已有报告；服务端 `type` 已支持三种类型，后续接上即可。

**今日页晨间简报也已接真实模型（2026-11-04，`9f9cc71`「晨间简报接入 /api/report 真实生成」）**

- 此前 `MorningBriefSheet` 是纯本地规则面板，**从未请求 `/api/report`**（2026-11-04 对代码核实：组件内无 `fetch`，底部说明写着「这是前端 Mock 简报」）。现按用户要求接通：打开面板时才 `POST /api/report`（`type='今日简报'`、`rangeDays=7`），摘要构造抽成 `app/src/lib/report-digest.ts`，报告页与今日页共用同一份授权/来源规则，避免两处漂移。
- **模型只写文字**：面板顶部的标题与摘要用模型返回的 `title` / `summary`；三个 KPI（今日记录 / 睡眠 / 饮水缺口）与「今天的建议节奏」三条仍由本机规则确定性生成。模型返回的 `conclusions` / `actions` 目前只做契约校验、不单独渲染，留给后续“简报详情”设计。
- 缓存与失效：`sessionStorage` 键 `persist.morning-brief.<YYYY-MM-DD>`，值里同时存 `digest` 指纹；换天或任一记录变化（饮水、餐次、学习、训练、设置来源开关、授权）都会失效重取——不展示过期文案，也不写 IndexedDB、不动备份格式。
- 失败与授权分流（底部说明按状态如实切换，绝不把规则文案标成 AI）：未授权 → 不发请求、不发数据，直接本机规则；没有任何打开的数据来源 → 同样不发请求；503 / 429 / 网络失败 → 回退本机规则并写明「已回退到本机规则，未使用模型输出」；结构不合契约 → 回退并写明「不符合契约」；只有真正拿到通过 `parseReportContent` 校验的内容才显示「文字由 DeepSeek 生成 · 经本站服务端代理」与点亮图标。
- 请求进行中先展示本地规则 + 「正在请求 DeepSeek…」说明，不空等、不闪烁；关闭面板会 `AbortController` 取消请求。

**服务端综合分析（步骤 13：服务端已部署，前端块未上传）**

- 服务端 `POST /api/v1/analysis/reports` 走**单次、非流式**模型调用（`deepseek-chat`，`timeout` 45 s、`max_tokens` 2600），事实包由 SQL 聚合后拼进提示词；模型只输出结构化文字，正文数字必须全部出现在事实包 JSON 里，否则 502 `invalid_response` 且不入档。
- **真实 DeepSeek Key 本机验证（2026-11-05，`server/.env` + `node --env-file=.env dist/index.js`，健康检查 `ai:"deepseek"`）**：`POST /api/v1/analysis/reports`（7 天）200 / 5.7 s、`origin:"ai"`、`model:"deepseek-chat"`；同 `dataRev` 再请求 `cached:true` 且 `reportId` 相同；`force:true` 200 / 5.4 s 生成新 `reportId`、归档列表与 `/:id` 详情标题一致；正文无英文字段名、数字都能在事实包里找到。**联调发现并已修（`18d5f77`）**：模型偶尔写 6 段（契约 2–5 段）导致 502、正文夹带 `daysWithAnyRecord` / `trend` 等内部标识符——现在内容不合规时带失败原因**重试一次**（总预算 30 s），提示词明确「analysis 固定 3 段、不出现英文字段名/JSON 键名/内部标识符」。修复前那版假客户端验证仍保留在单测里（`analysis-routes` 两条：首次不合规重试后落库 / 两次都不合规 502 不落库）。**2026-11-06 起该接口已在生产可用**（`/api/v1/analysis/*`，服务器上也用真实 Key 验过一次）；**但前端综合分析块没上传，线上页面仍看不到**。
- 降级与错误分流（都有单测）：无 Key / 超时 / 上游错 → 200 + 规则降级；`aiConsent === false` → 403 `ai_consent_off`；窗口无记录 → 409 `insufficient_data`；分析限流 → 429；请求体或 `rangeDays` 非法 → 422 `invalid_request`；缺令牌 → 401。

**服务端当前边界（8c 后仍成立）**

- 服务端只有按 IP 限流（`/api/chat` 与 `/api/report` 共用 20 次 / 5 分钟），**线上没有账号鉴权**；Key 只在服务端环境变量，前端/构建产物已扫描确认无 Key。步骤 12 新增的 `/api/v1/devices*`、`/api/v1/sync/*` 走设备令牌鉴权，**且已于 2026-11-06 部署到生产**（线上现有 P3 三接口 + `/api/v1/*`；前端还没上传同步卡片）。
- 真实 AI 的 token/费用/延迟数据只在本机联调与 IP 直连部署后实测中观察（chat 约 3.5 s、report 约 2.7 s），仍没有额度上限与费用统计。
- **Nginx 反代下已复验（2026-11-04）**：SSE 增量到达（`proxy_buffering off` 生效，188 事件 / 首包 0.118 s / 末包 4.215 s）、`/api/report` 长请求 2.78 s 返回（`proxy_read_timeout 300s`）、按 IP 限流真实命中（第 2 次 `429` + `Retry-After: 298`）。

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

- 原始餐次备注全文。
- 完整历史原始日志。
- 与服务当前报告无关的备注。
- 未授权的敏感健康信息。
- API Key、设备凭据或内部调试信息。

---

## 10. 自动化验证与质量结果

### 10.1 最近已验证结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | 通过，0 错误（2026-11-05 步骤 13 后复跑；`shared/` 独立 `tsc -b` 0 错，`app` / `server` 引用同源契约无类型漂移，`server` `tsc -b` 0 错） |
| 单元测试 | `npm test` | **334/334 通过，24 个测试文件**（2026-11-05 步骤 13 后复跑；步骤 13 新增 3 个文件共 39 条：`lib/analysis-client.test.ts` 26（四态映射、9 类错误分流、`dataRev`/`force`/`limit` 参数）、`pages/ReportsPage.analysis.test.tsx` 8（综合分析块渲染、缓存标记、归档列表与详情、错误分类文案、响应形状为平铺而非 `{report}`）、`pages/SettingsPage.brief.test.tsx` 5（每日简报默认关闭、21:00、非法时间回退与提示、需先开同步）；此前 295/21（饮食跨日修复）、292/21（步骤 12 收尾）、230/16（步骤 11 后），逐步只增不减） |
| 端到端测试 | `npx playwright test` | **120 通过 / 0 跳过 / 0 失败**，60 个用例 × 2 个项目 = 120 次执行，9 个文件，1.2 m（2026-11-05 步骤 13 后复跑；新增 `reports-analysis.spec.ts` 4 条 × 2 = 8 次执行：服务端综合分析块可生成并显示来源与缓存标记、归档列表与详情可打开、失败时显示错误分类文案、未开同步时显示前置说明；此前 112 次（格式化提交后 58.1 s）） |
| Lint | `npm run lint` | **0 错误 0 警告（98 个文件）**（2026-11-05 步骤 13 后复跑；3 条 `react(set-state-in-effect)` 已随 `f5a57f5` 消除） |
| 格式检查 | `npx prettier --check .`（在 `app` 内执行） | 通过：`All matched files use Prettier code style!`（2026-11-05 饮食修复收尾复跑：首次检查有 10 个文件未格式化——本次改动 6 个（`DietPage` / `SettingsPage` / `TodaySheets` / `MockDataProvider` / `history.test` / `day-rollover.spec`）+ 既有漂移 4 个（`morning-brief.ts` / `morning-brief.test.ts` / `persist-state.test.ts` / `use-new-record-param.test.tsx`，自 `9f9cc71` 起漏跑格式化）；`--write` 后实际改动 9 个文件（`MockDataProvider` 写入后与 HEAD 逐字节一致），全仓通过，重建产物哈希不变） |
| 生产构建 | `npm run build` | 通过（`index-<hash>.js` **628.24 kB / gzip 186.67 kB**，`index-<hash>.css` **145.40 kB / gzip 24.89 kB**，2026-11-05 步骤 13 后复跑；主 JS 仍超 500 kB 提示线，`/plans` 未拆 bundle。此前 604.31 kB / 138.98 kB（饮食跨日修复后）、606.08 kB / 140.20 kB（步骤 12 后）；本次 +23.93 kB 来自综合分析块 / 设置卡片 / 分析客户端与契约代码） |
| 视觉检查 | `npm run visual:check`（**前提：同源 `/api` 可达**，先起无 Key 后端，否则 502 会判 `consoleErrors > 0`） | 最近一次全量重跑为 2026-11-04 步骤 8b 后全绿：15 个状态 × 6 个视口 = 90 张 + 快速记录 1 张 = 91 张，`overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`（exit 0），77 张 png 更新并经用户双端验收通过后入库。**8c 改动 `/reports` 后，reports 相关基线已单独重跑（6 张 png 更新，各项 0、exit 0）并经用户双端验收通过，随 `7625865` 提交推送**。**晨间简报接入后再次重跑（未起后端）：91 张生成、`overflow 0 / missingDialogs 0 / missingElements 0 / quickRecordReady true`；`reports` 与 `plans-ai` 各 6 视口报 `Failed to load resource: 502`（同源 `/api` 不可达，属运行前提未满足，非本次改动）；`design/` 仅首页实时日期文字导致 7 张像素漂移（0.035%），已还原未入库**。**步骤 11（8d）后与 2026-11-05 报告页返回态修复后各重跑一次（未起后端，preview 4173）：两次均为 90 张生成、`overflow 0 / missingDialogs 0 / missingElements 0 / quickRecordReady true`；`failures 12`（`reports` 6 + `plans-ai` 6 的 502 控制台错误，非像素回归），exit 1；`design/` 累计 65 张 png 更新（18 张真实改动：`fitness-*` 6 / `fitness-new-*` 6 / `reports-*` 6；6 张首页为日期文字 11/4→11/5；其余 41 张单张变化 ≤ 400 B，属 1 s 实时时钟/倒计时漂移），**已于 2026-11-05 由用户桌面端 + 移动端验收通过并入库（`5ee8d85`）**；2026-11-05 学习来源修复只改分类按钮的处理逻辑并加一条用例，无静态样式变化，故未重跑视觉基线；**步骤 12（设置页新增「数据同步」卡片）后重跑（2026-11-05，未起后端，本地 `npm run dev -- --port 4173` + `PERSIST_API_TARGET=http://127.0.0.1:9`）：15 状态 × 6 视口 = 90 张 + 快速记录 1 张，`overflow 0 / missingDialogs 0 / missingElements 0`；`failures 12` 为 `reports` 6 + `plans-ai` 6 的 `502 (Bad Gateway)` 控制台错误（运行前提未满足，与基线同源），exit 1；与已入库基线 `5ee8d85` 相比 13 张 png 差异：6 张设置页（新增「数据同步」卡片，页面高度 +324~371 px）、6 张首页（仅每秒倒计时文字，像素差 0.03%~0.07%）、1 张快速记录；已随 `4d3edcf` 入库（用户双端验收通过）**；**2026-11-05 饮食照片附件下线后重跑（未起后端，本地 `npm run dev -- --port 4173` + `PERSIST_API_TARGET=http://127.0.0.1:9`）：15 状态 × 6 视口 = 90 张 + 快速记录 1 张，`overflow 0 / missingDialogs 0 / missingElements 0 / quickRecordReady true`；`failures 12` 仍为 `reports` 6 + `plans-ai` 6 的 502 噪声（exit 1）；20 张 png 差异全部来自本次界面改动：饮食页 7 张（6 视口 + `diet-new-mobile-430`，删附件行与文案后页面变短）、首页 6 张（快捷入口附件入口下线）、设置页 6 张（隐私说明去掉照片表述）、快速记录 1 张；已随 `fbab985` 入库（用户双端验收通过）**；**步骤 13（`/reports` 综合分析块 + 设置页「每日简报」卡片）后重跑（2026-11-05，未起后端，本地 `npm run dev -- --port 4173` + `PERSIST_API_TARGET=http://127.0.0.1:9`）：15 状态 × 6 视口 = 90 张 + 快速记录 1 张，`overflow 0 / missingDialogs 0 / missingElements 0 / quickRecordReady true`；`failures 12` 仍是 `reports` 6 + `plans-ai` 6 的 502 控制台错误（运行前提未满足），exit 1；12 张 png 差异（`reports-*` 6 与设置页 6），**但本轮未提交**——等用户桌面端 + 移动端验收后再入库** |
| 服务端类型/单测 | `npm run typecheck` + `npm test`（`server/`） | `tsc -b` 0 错；**175/175**（18 个文件：步骤 12 的 13 个文件 112 条 + 步骤 13 新增 `analysis-content` / `analysis-facts` / `analysis-routes` / `daily-brief` / `reports-repo` 5 个文件 63 条），**要求 Node ≥ 22.5**（内置 `node:sqlite`，Node 20 直接 `Cannot find module 'node:sqlite'`）（2026-11-05 步骤 13 修复后复跑） |
| 服务端冒烟 | `node dist/index.js`（真实 Key 用 `node --env-file=.env dist/index.js`）+ HTTP 调用 | 无 Key：`/api/health` 200（`ai: "disabled"`、`db: "ok"`、`version: 2`）、`/api/chat` 503、`/api/report` 503、`POST /api/v1/analysis/reports` **200 + `origin:"rules"` + `model:null`**（诚实降级而非报错）；真实 Key（本机临时进程，PORT=3001，历史记录）：`/api/health` 200（`ai: "deepseek"`）、`POST /api/report` 200 + 中文简报（2.7 s）、只授权学习时无训练/饮食字样；**步骤 12 冒烟（2026-11-05，PORT=3101）**：register → push → 杀进程 → 重启 → 同一 token pull 实体原样返回（重启后数据仍在）、`recoveryCode` restore 拿到同一 `userId` 的新 token、同一 `opId` 重放 rev 不变（幂等）；**步骤 13 冒烟（临时 vitest 走真实 HTTP，验收后已删除）**：bootstrap 5 类记录 → 分析 200 平铺 → 同 `dataRev` `cached:true` → `/api/v1/reports` 列表与 `/:id` 详情 → facts v2 粒度（30 天 `granularity:'day'`、只出有记录的天）→ 无 Key 规则降级 `model:null` → 白名单违规 502 不入档 → 空窗口 409 → 当日第 7 次 429（未授权 403 由路由单测覆盖，未在临时 HTTP 用例中跑）；**真实 Key 冒烟（2026-11-05，本机 3000 端口）**：`/api/chat` 200 / 2.4 s SSE 中文增量 + 追问、`/api/report` 200 / 3.3 s（引用当天 8/10 组与 1200 kg）、分析首次 200 / 5.7 s（`origin:"ai"`、`model:"deepseek-chat"`、正文无英文字段名）、同参 `cached:true` 且 `reportId` 相同、`force` 200 / 5.4 s 新 id、列表与详情 id/标题一致 |

Playwright 配置为两个项目：

- `desktop-chrome`
- `mobile-chrome`（Pixel 7，`isMobile: true`）

共 60 个用例 × 2 个项目 = 120 次执行（9 个文件），**0 跳过 0 失败**。原先 `plans.spec.ts` 中「档案页 AI 建档入口」在移动端被 `test.skip(isMobile)` 跳过，原因是该按钮在 ≤900px 被全局隐藏规则一并向隐藏；现已给按钮加 `profile-onboard-action` 并从隐藏规则豁免，移动端同样真实点击验证，测试不再跳过。步骤 13 新增 `reports-analysis.spec.ts` 4 条（×2），其中用于断言响应形状的用例正是为「平铺 vs 包一层」那次 bug 加的回归。

步骤 6 新增 `e2e/persistence.spec.ts` 3 条（饮水记录 / 长期计划 / 提醒设置）在桌面与移动两个项目都真实刷新页面验证，覆盖「刷新后仍在」与「重复刷新不累加」。步骤 7 在同一文件补第 4 条「清空本机数据后刷新回到初始示例数据」：先造出与基线不同的状态（饮水 1.2 L → 1.5 L、关掉饮水提醒）→ 进入设置页二次确认清空 → 断言界面立刻回到基线（提醒开关重新勾选、快照区显示「尚未生成快照」）→ 刷新后仍为基线（断言 1.2 L 且不含 1.5 L、提醒开关已勾选），用来抓「200 ms 防抖把旧数据写回」这类顺序错误。

### 10.2 测试文件与覆盖主题

| 文件 | 用例数 | 覆盖内容 |
|---|---:|---|
| `app\e2e\smoke.spec.ts` | 23 | 导航、今日、健身、饮食、学习、档案、设置、报告、移动溢出；步骤 12：设置页「数据同步」默认关闭 + 恢复码格式校验（桌面 + 移动）、mock `**/api/v1/**` 下开启同步并显示恢复码 |
| `app\e2e\mock-flows.spec.ts` | 9 | 学习/餐食/健身/档案/授权/复盘跨页保持，报告数据源联动；学习科目切换时来源清空 |
| `app\e2e\mock-data-flows.spec.ts` | 9 | 简报历史、周期、饮水 KPI、快照、JSON 导出/导入、CSV、非法导入、生成简报后跳页返回状态保持 |
| `app\e2e\plans.spec.ts` | 5 | 档案页 AI 建档入口深链（桌面 + 移动）、AI 建档对话→确认启用→写回档案、手工新建→归档→重新启用、360px 无横向溢出、**真实模型不可用时回退本地 Mock 并明确标注** |
| `app\e2e\complete-mock-data.spec.ts` | 3 | 完整演示数据覆盖全部主模块、报告数据源和建议应用 |
| `app\e2e\fitness-freeform.spec.ts` | 2 | 自由距离/时长运动跨页联动，旧 JSON 兼容与非法数据拒绝 |
| `app\e2e\persistence.spec.ts` | 4 | 步骤 6：饮水记录刷新后仍在且不累加、长期计划与「进行中」状态刷新后仍在、提醒开关与时间刷新后仍在；步骤 7：清空本机数据后界面与刷新均回到初始示例数据 |
| `app\e2e\day-rollover.spec.ts` | 1 | 2026-11-05 跨日回归：把 IndexedDB 里持久化饮食的日期整体改成昨天后重载，断言今日仍有 4 个餐次、「记录下一餐」能打开「编辑早餐」、AI 热量登记的餐次下拉有 4 个选项、确认登记后食物写入所选餐次，且全程无 `pageerror`（不必改系统时钟） |
| `app\src\lib\mock-data-transfer.test.ts` | 32 | 0.3.0 序列化、round-trip、0.2.0 / 0.1.0 兼容与升级（日期补齐、饮食按日、会话归档）、longTermPlans 校验、计数、CSV |
| `app\src\lib\chat-extract.test.ts` | 24 | 中文档案字段提取、追问、冲突、计划草案、Mock 流式事件和中断 |
| `app\src\lib\long-term-plan.test.ts` | 23 | 长期计划校验、周范围、周进度、整体进度和估算完成量 |
| `app\src\lib\plan-draft.test.ts` | 22 | 草案 ↔ 计划互转、标题/日期/周目标校验文案、档案补丁展示、过去日期回退与过期里程碑过滤 |
| `app\src\lib\profile-rules.test.ts` | 11 | 年龄等越界字段过滤、空补丁、丢弃字段提示 |
| `app\src\lib\persist-state.test.ts` | 18 | 步骤 6 + 8d：记录 round-trip、schemaVersion 2 与保存时间、v0 → v1 → v2 迁移（补日期 / 饮食按日 / 完成会话归档）、未来版本拒绝、损坏记录返回 null、非法快照降级、备份结构等价 |
| `app\src\data\complete-mock-data.test.ts` | 5 | 完整演示数据结构和跨模块引用 |
| `app\src\lib\ai-chat-client.test.ts` | 13 | 步骤 8b：SSE 增量解析（含跨块/CRLF）、健康探测、授权关闭不联网、首事件前失败回退、已有内容后失败不回退、abort 不误回退、标签与状态 |
| `app\src\lib\ai-report-client.test.ts` | 10 | 步骤 8c：`/api/health` 探活（含 404/网络失败）、报告请求体与 JSON 头、503/429/网络失败的错误文案与 `status`、400/坏 JSON/坏形状 → `ReportContractError`、abort 透传、`parseReportContent` 未知字段与缺字段、来源标签常量 |
| `app\src\lib\report-digest.test.ts` | 10 | 2026-11-04 晨间简报：完整摘要数值（含 `strengthVolumeKg: 480`、`waterEvents: 3`）、未授权时所有模块为 `null`、逐个来源开关只放开对应模块、摘要指纹随数据变化；8d：窗口口径（近 7 天只算窗口内训练 / 学习 / 饮食 / 饮水，digest 字段形状不变） |
| `app\src\lib\morning-brief.test.ts` | 13 | 2026-11-04 晨间简报：未授权/无来源不发请求、成功写会话缓存且同摘要不重复请求、摘要变化与换天使缓存失效、不可用/契约错误回退且不写缓存、`AbortError` 透传、缓存拒绝非法内容、底部说明诚实性、请求体形状、`sessionStorage` 抛错时安全降级 |
| `app\src\lib\use-new-record-param.test.tsx` | 4 | 2026-11-04 lint 清理：`?new=1` 命中、`clear()` 去掉 `new` 且保留其它参数、无参数时不改历史、`new` 取非 1 值不命中 |
| `app\src\lib\history.test.ts` | 28 | 8d：本地日期键工具（本地日期、加减天数、当前时间键）、`createDateWindow` 天数夹取与窗口边界、训练容量 / 组数 / 时长汇总、`dateKeyLabel`、饮食 / 饮水 / 计划按日读写；2026-11-05 跨日修复新增 3 条 `dayMeals` 用例（缺日给四餐次骨架且每次返回独立对象、当天有记录时原样返回） |
| `app\src\lib\fitness-history.test.ts` | 10 | 8d（11b）：完成记录 → 历史视图模型（模板名标题、本地日期与星期、容量只算已完成力量组、组数、用时；未完成组不入历史） |
| `app\src\lib\report-window.test.ts` | 6 | 8d（11c）：空窗口、按日过滤、进行中会话只在 `active` 时计入、归档记录聚合、饮水真实累加与日均、饮食 / 计划计数 |
| `app\src\lib\sync-store.test.ts` | 13 | 12d：`persist-sync` 元数据归一化（默认关闭 / 无凭据 / 游标夹取 / 脏数据回默认）、outbox 记录归一化（丢未知 kind、补 id）、`mergeOutbox` 合并规则（同实体取最新、变更作废旧批次、同时刻删除胜出）、批次切分与 `opId` 生成 |
| `app\src\lib\sync-queue.test.ts` | 7 | 12d：outbox 持久化读取、入队先加载已有记录（不覆盖上次未发完的变更）、同实体多次变更合并、`prepareBatches` 重试沿用同一 `opId`、`completeBatch` 清账 / `parkBatch` 换新批次、`clear` 只清队列、按上限切批 |
| `app\src\lib\sync-client.test.ts` | 12 | 12d：注册（POST `/api/v1/devices`、不带令牌）、缺 `recoveryCode` 判不可用、push 带 Bearer + `opId` 并解析 `skipped`、pull 的 `since`/`limit` 夹取、restore/revoke 路径、bootstrap 全量上传；失败分类（401 不可重试 / 429·5xx·网络·超时可重试 / 400 不可重试）与指数退避 5 s→5 min 封顶 |
| `app\src\lib\sync-engine.test.ts` | 14 | 12d：未开启时不发任何请求、enable 走「注册 → bootstrap → pull」、本地写入差分入 outbox 后 push 清账、本地删除发墓碑、pull 合并 LWW、令牌失效标 `needsAttention` 且保留 outbox、网络失败退避、离线只显示「离线」、disable 后停发请求并保留本地与凭据、重开补发关闭期间的写入、restore 从 rev 0 拉取且丢弃上一账号未发完的变更、revoke 回收状态、`noteDataChange` 触发 5 s 防抖 |
| `app\src\lib\sync-entities.test.ts` | 16 | 12f：8 个可同步切片摊平成实体（跳过报告 / 进行中会话）、单行实体占位 id 与顶层 `aiConsent`、饮食实体带日期/餐次且不含照片字段；`stableStringify` 与 `hashText`、`diffLocalEntities` 增量与消失键；`applyPulledEntities` 的 LWW、墓碑删除、未知 kind / 缺字段计 `skipped`、**远端记录形状不完整时跳过**（不把坏记录写进存档）、body id ≠ 信封 id 跳过、饮食按日合并；`toCandidates` / `removedCandidates` |
| `app\src\lib\analysis-client.test.ts` | 26 | 13b/13c：四个分析接口的请求构造（`rangeDays` / `force` / `limit` / `cursor`、Bearer 令牌）、平铺 `AnalysisReportResponse` 解析、四态来源标签与缓存标记、9 类错误分流（network / timeout / unauthorized / consent-off / insufficient / invalid / rate-limited / server / invalid-response）、归档列表与详情 |
| `app\src\pages\ReportsPage.analysis.test.tsx` | 8 | 13c：`/reports` 综合分析块——窗口 7/30/90 切换、生成后显示指标与来源、`cached:true` 标记、归档列表与详情打开、错误分类文案、未开同步时显示前置说明、**响应形状为平铺（不是 `{report}` 包一层）的回归断言** |
| `app\src\pages\SettingsPage.brief.test.tsx` | 5 | 13c：设置页「每日简报」卡片——默认关闭、默认 21:00、改时间后写入设置、非法时间回退并提示、未开同步时卡片提示需先开启同步 |
| `server\test\*.test.ts` | 175 | 服务端 18 个文件：步骤 12 的 13 个（config 4、contract 9、rate-limit 3、extract 8、deepseek 7、chat 7、prompts 3、report 17、db-driver 5、db-migrate 7、db-repositories 16、devices 10、sync 16）+ 步骤 13 的 5 个：`analysis-content`（数字白名单、文案净化与长度限制）、`analysis-facts`（7/30/90 天粒度与只出有记录的天、空窗口、事实包 v2 形状）、`analysis-routes`（200 平铺 / `cached` / `force` / 403 / 409 / 422 / 429 / 内容不合规重试后落库 / 两次不合规 502 不入档 / `no-store`）、`daily-brief`（未到点 / 环境变量关闭 / 无用户跳过、`runKey` 幂等、设置页开关优先于 env、两次失败记 `failed` 后下一 tick 重新抢锁、零记录记 `insufficient_data`、`start` 立即补跑一次）、`reports-repo`（归档写读、`dataRev` 唯一约束、365 天清理） |
| `app\src\lib\countdown.test.ts` | 4 | 倒计时边界和格式化 |

### 10.3 最新构建产物

```text
dist/index.html                  0.61 kB（611 B）
dist/favicon.svg                9,522 B
dist/icons.svg                  5,031 B
dist/assets/index-<hash>.css    145.40 kB（gzip 24.89 kB）
dist/assets/index-<hash>.js     628.24 kB（gzip 186.67 kB）
```

产物演进（便于识别“哈希变了是否正常”）：

1. 步骤 6 完成时：`index-DqZtxRhx.js` 552.61 kB（持久化层让主 JS 从 549.09 kB 涨 3.52 kB）、`index-DBVxLcSp.css` 139.92 kB。
2. `chore:` 清理后：删除 `persist.css` 中 173 行 `.preview-*` 样式，CSS 降至 137.64 kB，JS 不变（`PreviewPages` 本来未被引用，早已 tree-shaken）。
3. `style:` 格式化后：输出**逐字节相同**（格式化未改变语义），直至 2026-11-03 现状整理时复跑 `npm run build` 仍为 `index-C9ZcsQCi.css` / `index-D5Nq3TbM.js`——因此看到这两个哈希说明代码停在步骤 6。
4. 步骤 7（`a544a38`）后：主 JS 从 552.61 kB 涨到 554.38 kB（`index-BBQQW4ug.js`，+1.77 kB：清空逻辑、基线构造函数与 Context 契约），**CSS 哈希完全未变**（`index-C9ZcsQCi.css` 137.64 kB）——因为新卡片复用了既有 `.settings-danger-card` / `.settings-danger-button` 样式，没有新增 CSS。看到 `index-BBQQW4ug.js` 即代表代码停在步骤 7 之后。
5. 步骤 8b（`b99d3ad`）后：主 JS 从 554.38 kB 涨到 **560.36 kB**（`index-CsKy1ArK.js`，+5.98 kB：SSE 客户端、健康探测、回退逻辑、动态来源文案与日期兜底），**CSS 哈希与体积仍未变**（`index-C9ZcsQCi.css` 137.64 kB）——8b 只复用既有 `plan-chat-*` 样式并新增了一个复用基类的提示段落。看到 `index-CsKy1ArK.js` 即代表代码停在步骤 8b 之后。
6. 步骤 8c（`bdd4265`）后：主 JS 涨到 **564.70 kB**（`index-DmnjkjkL.js`，+4.34 kB：报告客户端、探活与错误分流、报告页引用与文案），CSS 哈希变为 `index-CrJgYfMj.css`（137.70 kB，+0.06 kB：只新增了回退提示的一行颜色规则）。看到 `index-DmnjkjkL.js` + `index-CrJgYfMj.css` 即代表代码停在步骤 8c 之后。
7. 晨间简报接真实模型（`9f9cc71`）后：主 JS 涨到 **567.71 kB**（`index-V0Wxk7Aw.js`，+3.01 kB；gzip 168.01 → 169.28 kB，+1.27 kB：`morning-brief` 客户端、摘要模块抽取与今日页接线），CSS 哈希仍为 `index-CrJgYfMj.css`（137.70 kB，**未新增任何样式类**，只改了底部说明文案与图标名）。
8. lint 清理（`f5a57f5`）后：主 JS 略降到 **567.59 kB**（`index-DVS7rlR_.js`，−0.12 kB；gzip 169.28 → 169.20 kB），CSS 哈希仍为 `index-CrJgYfMj.css` 且体积未变（只改了状态派生方式与删掉 3 个残留 .txt，**零样式改动**）。看到 `index-DVS7rlR_.js` 即代表构建产物已含深链派生改造与 lint 清零。
9. 步骤 11（8d）三次提交后：主 JS 涨到 **574.40 kB**（`index-DgFeE4P3.js`，+6.81 kB；gzip 169.20 → 171.26 kB，+2.06 kB）：11a 数据层 v2 与迁移、11b 健身真实历史（删 `HISTORY` 演示常量、新增 `fitness-history.ts`）、11c 报告窗口（`history.ts` 窗口工具 + `report-window.ts`）。**CSS 哈希与体积完全未变**（`index-CrJgYfMj.css` 137.70 kB）——8d 全部复用既有样式类，零 CSS 改动。看到 `index-DgFeE4P3.js` + `index-CrJgYfMj.css` 即代表构建产物已含数据历史化；该产物**尚未部署到服务器**（服务器仍是步骤 9 的旧包）。
10. 报告页返回态修复（`8edb8ba`）后：主 JS **574.64 kB**（`index-Bx1R0rsd.js`，+0.24 kB；gzip 171.26 → 171.38 kB，+0.12 kB），CSS 哈希与体积仍为 `index-CrJgYfMj.css` 137.70 kB——修复只改派生状态，**零样式改动**。看到 `index-Bx1R0rsd.js` 即代表报告页修复已包含在产物里；该产物**仍未部署**（服务器仍是步骤 9 的旧包）。
11. 学习来源随科目切换清空（`971e1b6`）后：主 JS **574.67 kB**（`index-BM4N278W.js`，574,679 B，+0.04 kB；gzip 171.38 → 171.41 kB），CSS 哈希与体积仍为 `index-CrJgYfMj.css` 137.70 kB——只改了分类按钮的处理函数并加了一条 E2E 用例，**零样式改动**。看到 `index-BM4N278W.js` 即代表构建产物已含该修复；该产物**仍未部署**。
12. 步骤 12（12c–12f）后：主 JS **606.08 kB**（`index-UkB7XkZI.js`，606,086 B；gzip 171.41 → 180.91 kB，+9.50 kB）：`shared/` 契约包、客户端同步层（`sync-contract` / `sync-client` / `sync-queue` / `sync-store` / `sync-entities` / `sync-engine`）与 12f 的 pull 形状守卫；CSS 变为 `index-7YbMuqJW.css`（140.20 kB，+2.50 kB：设置页「数据同步」卡片与恢复码/吊销对话框样式）。**注意：步骤 12 的前端产物依赖服务端同步接口，前端不单独发版**（该接口已于 2026-11-06 部署）；看到 `index-UkB7XkZI.js` + `index-7YbMuqJW.css` 即代表构建产物已含 12f 收尾。
13. 饮食照片附件下线 + 跨日空餐次修复（`fbab985` / `50d90ef`）后：主 JS **604.31 kB**（`index-Diy7Ja9h.js`，606,086 → 604,310 B 量级，gzip 180.91 → 180.26 kB：删掉附件行、图标与同步字段，新增 `createEmptyMeals` / `dayMeals` 骨架逻辑），CSS 变为 `index-BNFgRy0R.css`（138.98 kB，−1.22 kB：删除 97 行附件相关样式）。看到 `index-Diy7Ja9h.js` + `index-BNFgRy0R.css` 即代表产物已含本次两项改动；该产物**仍未部署**（服务器仍是步骤 9 的旧包）。
14. 步骤 13（13a–13d）后（**已推送，前端产物未上传**）：主 JS **628.24 kB**（gzip 186.67 kB，+23.93 kB / +6.41 kB gzip）：`analysis-contract`（转出 `@persist/shared/contract/analysis`）、`analysis-client`（四个接口 + 四态标签 + 9 类错误分流）、`/reports` 综合分析块与归档列表、设置页「每日简报」卡片；CSS **145.40 kB**（gzip 24.89 kB，+6.42 kB）：综合分析块、归档列表与简报卡片样式。**主 JS 已过 500 kB 提示线且 `/plans` 仍未拆包**；产物已随 `40d2bf4` 提交推送，但**未部署**（服务器仍是步骤 9 的旧包）。

> 部署状态更新（2026-11-06）：**服务端已切到步骤 12/13**（`/opt/node22` v22.19.0 +
> `/opt/persist-next`，实测停机 482 ms，14a 备份 timer 已无人值守跑通），但**前端静态包
> 仍是步骤 9 后那版**（`index-DVS7rlR_.js` 567,592 B + `index-CrJgYfMj.css`）——所以上面
> 第 9–14 条里「该产物仍未部署」对前端依然成立，只是服务端不再落后。本地 `app/dist` 现为
> `index-F8XZrWTT.js`（628,242 B）+ `index-DgJduU5l.css`（145,404 B），待上传
> （步骤 10 第 8 项）；上传前线上页面看不到同步、综合分析与每日简报卡片。

> 更正：清理后的 CSS 体积实测为 137.64 kB（早期摘要曾误记为 134.42 kB，以 §18.1 变更史为准）。

2026-11-03 起构建一直提示主 JS 超过 Vite 默认 500 kB 提示线；步骤 12 后 606.08 kB、2026-11-05 饮食改动后 604.31 kB、**步骤 13 后 628.24 kB**，**提示仍在但未阻塞验收**。后续建议按路由懒加载拆包（`/plans` 是天然的懒加载候选，`/reports` 的分析块也适合按需加载）。

### 10.4 Lint 警告（已清零）

历史上 3 条 `react(set-state-in-effect)` 警告已于 2026-11-04 随 `f5a57f5` 消除，现行 `npm run lint` 为 **0 错误 0 警告**。

三条警告同一模式：`?new=1` 深链参数在 `useEffect` 里 `setXxx(...)` 打开面板，再 `setSearchParams` 去掉参数。修复方式是把地址栏当唯一真相，不再复制状态：

- 新增 `app/src/lib/use-new-record-param.ts`：`active` 直接推导自 `?new=1`，`clear()` 用 `replace` 删除该参数（保留其它参数）。
- `FitnessPage` / `DietPage` / `StudyPage`：弹层展开条件改为 `本地状态 || active`；关闭、遮罩、保存、删除确认等所有收尾路径统一走 `closeXxx()`（置空本地状态 + `clear()`）。
- 行为保持：深链首帧即打开弹层（视觉基线与 E2E 依赖此点）、快速记录同路由 `navigate('/x?new=1')` 仍能打开；关闭后地址栏回到无参路径。

回归方式：`use-new-record-param.test.tsx` 4 条单测 + E2E「quick record URLs open the matching mock forms」（`/fitness?new=1`、`/diet?new=1`、`/study?new=1`，并断言关闭后 URL 回 `/study`、再点「新增记录」可重开）。若将来再出现同类警告，优先检查是否又引入了「effect 里同步 setState」的副本状态，而不是加 `eslint-disable`。

### 10.5 视觉检查细节

> **运行前提（2026-11-04 踩过的坑，必须遵守）**：步骤 8b 之后 `/plans` 打开 AI 对话框时会先探测 `/api/health`。`visual:check` 只连接已有 dev server、**自己不启动后端**，所以跑之前必须让同源 `/api` 可达，二选一：
> 1. 先起本机服务端（无 Key 即可）：`cd server; node dist/index.js` → 探针返回 200 `ai:"disabled"`，对话如实显示「本地生成 · Mock 对话」，与基线一致（要真实 Key 就把命令换成 `node --env-file=.env dist/index.js`，探针 `ai:"deepseek"`）；
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

2026-11-04 的一次完整视觉检查（步骤 7 卡片与 8b 对话文案之后，先按上文前提起了无 Key 后端）：`states 15 / screenshots 90 / overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / quickRecordReady true / failures 0`（另加快速记录 1 张，共 91 张，exit 0）。`design/` 中 **77 张 png 更新（14.4 MB）**，已在用户桌面端与移动端验收通过后作为 `chore:` 提交入库；未变的 16 张里 `/profile`、`/reports` 六视口像素级一致（8b 未碰这两页），其余是历史遗留图。变化构成：今日页倒计时与饮食/健身/学习页的「今天」类内容随日期自然漂移（每次重跑都会变，不是回归）+ 步骤 7 设置页危险区卡片 + 8b `/plans` 对话副标题与侧栏徽标。上一次完整检查为 **2026-11-03 14:00**（步骤 6 后，指标同为全零，视觉基线未因持久化改变）。全站弹窗已统一居中（`surface.css` + `home-v3.css` 的 `.backdrop` / `.sheet` 改为 `align-items: center`，窄屏 sheet 用 `width: min(100%, 580px)` + `max-height: calc(100dvh - 36px)` + 内部滚动）。

> **8c 之后的视觉基线状态（2026-11-04，已闭环）**：8c 改了 `/reports` 的可见文案与控件——徽标从「本地生成 · Mock 报告」变为按探测结果显示「DeepSeek 生成 · 经本站服务端代理」或 Mock 文本（无后端时即 Mock），删掉了「模拟失败」按钮，生成面板与服务卡片文案改为服务端代理口径，报告详情底部说明按 `origin` 分三种。随后已按同一前提（先起无 Key 后端，探针 200 `ai:"disabled"` ⇒ 页面稳定显示 Mock 徽标）单独重跑 `visual:check`：`design/` 中 6 张 reports 相关 png 更新，`overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`（exit 0），经用户桌面端 + 移动端验收通过后随 `7625865`（`chore:`）提交推送。**reports 基线现与 8c 代码一致，不再是待办。**

> **8d 之后的视觉基线状态（2026-11-04 重跑，2026-11-05 验收入库）**：步骤 11 改动了健身历史列表/详情、报告页窗口文案与依据行、今日页数据面板文案，因此在 `vite preview`（4173）上重跑了 `visual:check`。结果：`states 15 / screenshots 90 / overflow 0 / missingDialogs 0 / missingElements 0 / quickRecordReady true`，但 **`failures: 12`（exit code 1）**——12 条全部是 `Failed to load resource: 502 (Bad Gateway)`：preview 只有静态产物、同源 `/api` 无后端，`/reports` 6 个视口 + `plans-ai` 6 个视口各记 2 条控制台错误，正是上文「运行前提」描述的已知噪声，不是像素回归（`overflow`/`missingDialogs`/`missingElements` 全为 0）。`design/` 中 25 张 png 被更新（健身历史、报告窗口、今日面板等），**已于 2026-11-05 由用户桌面端 + 移动端验收通过并入库（`5ee8d85`）**；未变的是与 8d 无关的页面。若要以 `exit 0` 复跑，须先起本机无 Key 后端再执行。

> **步骤 12 之后的视觉基线状态（2026-11-05，已验收入库）**：设置页新增「数据同步」卡片（12e），因此在本地 dev 服务器（`npm run dev -- --port 4173`，`PERSIST_API_TARGET=http://127.0.0.1:9`）上重跑 `visual:check`。结果：`states 15 / screenshots 90 / overflow 0 / missingDialogs 0 / missingElements 0 / quickRecordReady true`，`failures 12`（`reports` 6 + `plans-ai` 6 的 `502 (Bad Gateway)`，同上属运行前提噪声），exit 1。与已入库基线 `5ee8d85` 相比 **13 张 png 变化**：6 张设置页（新增「数据同步」卡片，页面高度 +324~371 px）、6 张首页（仅每秒倒计时文字，像素差 0.03%~0.07%）、1 张快速记录。**这 13 张已由用户桌面端 + 移动端验收通过，随 `4d3edcf` 入库。**

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

> **前置条件（2026-11-04 起）**：8b 之后 `/plans` 会探测 `/api/health`，所以跑之前先让同源 `/api` 可达——最省事的做法是另开一个终端起本机后端：`cd D:\Persist\server; node dist/index.js`（无 Key 也会返回 200 `ai:"disabled"`，UI 显示 Mock，与基线一致；真实 Key 用 `node --env-file=.env dist/index.js`）。后端不在时 Vite 代理回 502，脚本会因控制台错误判失败（exit 1），详见 §10.5。

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
- [ ] 完成训练后「最近训练」出现本条真实记录（8d：不再读演示常量；标题来自训练模板，模板缺失显示「自由训练」）。
- [ ] 刷新页面后最近训练记录仍在（来自 `fitnessHistory`），没有重复或丢失。
- [ ] 历史详情按动作类型展示力量（重量 / 次数）或有氧（时长 / 距离），不出现错误 `kg`。
- [ ] 今日时间线出现训练摘要。
- [ ] AI 报告分析依据包含统一训练摘要。
- [ ] 移动端训练弹层可操作且无溢出。

### 12.4 饮食与饮水

- [ ] 四个餐次可展开。
- [ ] 食物可新增、编辑、删除。
- [ ] 营养汇总随食物变化。
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
- [ ] 生成中、成功、失败状态完整。
- [ ] 数据源开关影响分析依据。
- [ ] 训练、饮食、学习、档案依据可查看。
- [ ] 8d：切换近 7 / 30 / 90 天时，依据行、指标卡与「本次引用 N 条」按窗口变化；标题措辞（如「近 30 天共 N 条」）与实际数据一致。
- [ ] 8d：报告页饮水数字与今日页不同（窗口只累加真实饮水记录、不叠加 1200 ml 基线）——这是有意口径，页面文案不得让人误读为「丢数据」。
- [ ] 返回态：生成「今日简报」后跳到其他页面再回来、或整页刷新，顶部仍显示「今日简报已生成」且「查看简报」可直接打开（报告实体一直在 `reports` + IndexedDB 里，不得把页面级状态当成数据消失）。
- [ ] 限制（已知）：顶部成功态只在「最新一份报告就是今天生成的今日简报」时出现；历史记录的周期文案是生成时的快照，切换近 7 / 30 / 90 天不会改写已存报告，这是有意行为。
- [ ] “应用建议”会更新今日计划并跳转。
- [ ] 来源标识正确：后端可用时「DeepSeek 生成 · 经本站服务端代理」，不可用时明确写 Mock，不伪装。
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

### 13.1 阶段状态一览

| 阶段 | 状态 | 一句话 |
|---|---|---|
| **P0** 视觉验收与前端冻结 | ✅ 2026-11-03 | 八页（含 `/plans`）与关键弹层验收通过，页面结构与主要交互冻结；8c 改动的 `/reports` 6 张基线已重跑并双端验收（`7625865`） |
| **P1** AI 引导建档 + 长期计划闭环 | ✅ 2026-11-03 | `/plans?onboard=1` 深链 + 三入口、流式对话、草案确认后写档案并启用计划（旧计划归档）、列表/详情/归档、备份 0.2.0 含 `longTermPlans` |
| **P2** 本机持久化（步骤 6） | ✅ `128d6a2` | 原生 IndexedDB，整库单记录 + `schemaVersion` 迁移；刷新/重开不丢 |
| **P3-0** 清空本机数据（步骤 7） | ✅ `a544a38` | 停写回 → 清库 → 重置内存态 → 恢复写回，二次确认 + toast |
| **P3** 服务端 AI 代理 | ✅ 2026-11-04 | `9138175` + `b99d3ad` + `bdd4265` + 步骤 9 部署（Nginx + systemd + SSE/长请求/限流实测通过），步骤 10 A 段（升 Node 22 + 部署 12/13）**不等备案号，已于 2026-11-06 完成第 1–7 项**、B 段（域名 / HTTPS）等备案号 |
| **P4** 数据层与 AI 综合分析 | 🟡 进行中 3/4 | 终态设计已定稿（`docs/P4-数据层与AI综合分析设计方案.md`）：步骤 11（数据历史化）2026-11-04 完成；步骤 12（账号 + 增量同步）2026-11-05 **本机完成并验收、已推送**；步骤 13（服务端聚合 + AI 综合分析）2026-11-05 **本机完成并验证、已推送（`41ed92f` / `82ed773` / `40d2bf4` / `7f13727` / `18d5f77` / `5ba4f7e`）**；两者**服务端已于 2026-11-06 部署到生产**，前端静态包未上传；**步骤 14 已开工：14a 每日备份已上线，剩 14b 恢复 / 14c 导出 / 14d 删账号** |
| **P5** Capacitor Android | ⬜ 未开始 | 依赖前端冻结 + 部署稳定 |
| **P6** 质量与性能清理 | 🟡 部分完成 | 已移除 `prettier-plugin-tailwindcss` 并全仓格式化；lint 警告已清零（`f5a57f5`）；剩包拆分、补单测等 |

### 13.2 步骤 9：IP 直连首次部署（✅ 2026-11-04 完成，验收记录如下）

目标：`http<IP>/` 能打开页面、`/reports` 直接刷新不 404、`/api/health` 返回 200。必查 7 条：

1. 本地 `npm run build` 后只上传 `app/dist`（**不在服务器构建**，2 GiB 内存会 OOM）。
2. Nginx：`try_files $uri $uri/ /index.html;` 深链回退，`/api/` 的 `location` 必须排在静态规则**之前**。
3. Nginx：gzip + hashed 资源 `immutable` 一年 + `index.html` `no-cache`（按流量计费）。
4. Fastify 走 `systemd` 常驻 `127.0.0.1:3000`（`Restart=always`、`User=persist`），密钥只在 `/etc/persist/server.env`（`600`）。
5. **SSE**：`/api/chat` 的 location 必须 `proxy_buffering off`（否则流式被憋住）。
6. **长请求**：`/api/report` 需 `proxy_read_timeout ≥ 60s`（服务端 25 s 超时 + 网络余量）。
7. **限流真实命中**：`/api/chat` 与 `/api/report` 共用 20 次 / 5 分钟；上线前轮换曾出现在对话里的真实 Key，并复扫 `app/dist` / `server/dist` 无 `sk-`。

**实测（2026-11-04，基线 `e260602`）**：本地 `npm run build` 产物与服务器逐文件 sha256 一致；`/var/www/persist` 为 `index.html` 611 B + `index-CrJgYfMj.css` 137705 B + `index-DmnjkjkL.js` 564705 B；`npm ci --omit=dev` 48 包；`/etc/persist/server.env` `600 root:root`，`/api/health` 返回 `ai:"deepseek"`；8 个页面深链 + 不存在路径全部 `200 text/html` 611 B；`index.html` `Cache-Control: no-cache`，hashed 资源 `public, max-age=31536000, immutable`；JS gzip 后 167325 B；SSE 200 / `text/event-stream` / chunked，首包 0.118 s、末包 4.215 s、188 个事件（末段 `proposal`→`warnings`→`done`）；`/api/report` 200 / 2.78 s；限流临时 `RATE_LIMIT_MAX=1` 时第 2 次 `429` + `Retry-After: 298`，随后恢复 20 并重启；`sk-[A-Za-z0-9]{16,}` 在 `/var/www/persist`、`/opt/persist/server`、journal 中命中 0（仅 env 文件 1 处）。用户已于 2026-11-04 完成桌面 + 手机双端人工验收（通过）。

**同日再次部署（晨间简报接入真实模型，`9f9cc71`）**：仍为同一 IP 直连环境，`/var/www/persist` 更新为 `index.html` 611 B + `index-CrJgYfMj.css` 137705 B + **`index-V0Wxk7Aw.js` 567713 B**，旧 `index-DmnjkjkL.js` 返回 404（153 B 错误页）；JS gzip **168582 B**；`/` 与 `/reports` 均 200 / 611 B；`/api/health` 200 `ai:"deepseek"`；真实 `POST /api/report` **200 / 2.701 s**（`title:"先把餐次和饮水补齐"`、`status:"待推进"`、conclusions 3 / actions 3 / warnings 0）；本地与远程 sha256 逐个一致。

**第三次部署（lint 清理 `f5a57f5`，2026-11-04）**：仍为 IP 直连，`/var/www/persist` 更新为 `index.html` 611 B + `index-CrJgYfMj.css` 137705 B + **`index-DVS7rlR_.js` 567592 B**；旧 `index-V0Wxk7Aw.js` 返回 404（153 B 错误页）；JS gzip **168550 B**；8 个页面深链全部 200 / 611 B，`index.html` 仍 `no-cache`；`/api/health` 200 `ai:"deepseek"`；真实 `POST /api/report` **200 / 2.284 s**（`title:"先把餐次和饮水补齐"`、`status:"待推进"`、conclusions 2 / actions 3 / warnings 0）；本地与远程 sha256 三个文件逐个一致。服务端与 Nginx 配置本次**零改动**，只换静态产物。

**第三次部署后只换过后端**：步骤 11（8d）三次提交只在本地构建与验证；**2026-11-06 把后端切到步骤 12/13**（Node v22.19.0 + `/opt/persist-next`，停机 482 ms），但 `/var/www/persist` 仍是 `index-DVS7rlR_.js`（步骤 9 那版）——**前端产物至今未再上传**。新产物已在本地构建好（`index-F8XZrWTT.js` 628242 B + `index-DgJduU5l.css` 145404 B），**等用户授权后再传**（属步骤 10 第 8 项，仍走 IP 直连、不等于上线）。

可并行、无硬依赖的收尾项：`训练建议` / `学习观察` 两类报告接服务端（`type` 已支持三种）、契约类型迁 `shared/`、账号鉴权与额度（归 P4 步骤 12）。

### 13.3 步骤 10：拆成「可先做」与「等备案号」两段（2026-11-06 更正）

**口径更正**：此前把整个步骤 10 写成「等备案号」，这是错的。备案号只卡**域名解析之后**的对外服务；服务器升级与部署本不依赖它。实际拆分（详细清单见 `docs/部署与服务器现状.md` §6）：

| # | 动作 | 等备案号？ | 现状 |
|---|---|---|---|
| 1 | 服务器 Node 20.20.2 → Node 22 LTS（并行装 `/opt/node22`，不动系统 `/usr/bin/node`） | ❌ 不等 | ✅ 2026-11-06（`/opt/node22` = v22.19.0） |
| 2 | 建 `/var/lib/persist/{,backups}`（`persist:persist` 0700） | ❌ 不等 | ✅ 已建（`0700 persist:persist`） |
| 3 | systemd 加 `ReadWritePaths=/var/lib/persist` + `ProtectSystem=strict` + `UMask=0027` | ❌ 不等 | ✅ 已加（unit sha256 `045d1904…`） |
| 4 | 服务端 env 补 `DB_PATH` / `DB_BUSY_TIMEOUT_MS` / `SYNC_RATE_LIMIT_MAX` / `ANALYSIS_*` / `DAILY_BRIEF_*`（14a 再加 `DB_BACKUP_DIR` / `BACKUP_KEEP_*` / `DISK_WARN_PERCENT`） | ❌ 不等 | ✅ 已加（24 键，`600 root:root`） |
| 5 | 每日 `VACUUM INTO` 备份 + 保留策略（**先于新代码上线**） | ❌ 不等 | ✅ 已上线（14a；`persist-backup.timer` 03:00，2026-11-07 实跑成功） |
| 6 | 上传 `shared/dist` + `server/dist`，服务器 `npm ci --omit=dev`，部署步骤 12/13 | ❌ 不等 | ✅ 已部署 `/opt/persist-next`（49 包 0 漏洞） |
| 7 | 复验 `/api/health` → `db:"ok"`、`version: 2`（v1→v2 自动迁移），`POST /api/v1/analysis/reports` 200 `origin:"rules"`（无 Key 降级），`GET /api/v1/reports` 有归档 | ❌ 不等 | ✅ 已验（真实 Key 三链路 + 归档 200） |
| 8 | 前端产物上传 `/var/www/persist`（IP 访问验证） | ❌ 不等 | ⬜ **未做**：线上仍是 `index-DVS7rlR_.js`（步骤 9）；新产物 `index-F8XZrWTT.js` 628242 B 已构建、待授权上传 |
| 9 | SSH 仅密钥登录 + 禁密码 + 装 `fail2ban` | ❌ 不等 | 密码登录仍开着 |
| 10 | 删安全组 3389 | ❌ 不等 | **需用户在阿里云控制台操作**（无控制台权限） |
| 11 | 域名解析 `wpersist.top` → ECS IP | **✅ 等** | 未解析 |
| 12 | 安全组开 443 + certbot 证书 + HTTP→HTTPS 跳转 | **✅ 等** | 未开始 |
| 13 | 页脚标注备案号 + 去掉「内部调试」表述 + 对外称「已上线」 | **✅ 等** | 不做 |

**实际执行记录（2026-11-06，第 1–7 项已完成；没走 3100 端口预演）**：

1. **（实际做法）** 并行装 Node 22 到 `/opt/node22`（系统 node 20 不动）、建 `/var/lib/persist`、先把备份 unit/timer 落地并实跑一次、把 `shared/dist` + `server/dist` 传到 `/opt/persist-next` 并在该目录 `npm ci --omit=dev`。**没有做 3100 端口预演**——风险改由「旧 `/opt/persist` 树与 Node 20 原样保留 + 动前整目录快照 `/root/step14-backup-20261106-165059`」控制。
2. **切换窗口（已执行）**：systemd 只改一行 `ExecStart` 指向 `/opt/node22/bin/node /opt/persist-next/server/dist/index.js`，并补 `ProtectSystem=strict` / `ReadWritePaths` / `UMask=0027` → `restart` → 复验（**停机 482 ms**、health 200 `db:"ok"` `version:2`、真实 Key 三条链路 200、归档接口 200）。回滚：把 `/root/step10-backup-20261106-143445` 里的 unit + 旧 `dist` 放回、`ExecStart` 指回 `/usr/bin/node`（Node 20 与旧树都保留）。
3. **等备案号**：第 11–13 项。此前对外只说「IP 直连内部联调，**未上线**」，也不得用域名提供 HTTP 服务。**第 8–10 项（前端产物上传、SSH 加固、删 3389）不等备案号，仍未做。**

**风险与限制（部署时已逐条核）**：①线上已从步骤 9 变成步骤 12/13（2026-11-06），本机 197 条 server 单测（含 14a）+ 120 次 E2E 全绿，**线上复验只做了 health + 三条 AI 链路 + 归档接口，没跑完整业务回归**；②部署后服务器首次写入 SQLite（`/var/lib/persist/persist.sqlite`，WAL），备份必须先于新代码到位；③2C2G 上 Node 22 + SQLite 内存占用需实测（当前可用约 1.4 G）；④服务器首次启动执行的是新车建库 + schema 2（2026-11-06，首建而非迁移，已核）；⑤`ssh` 虽可用 ed25519 密钥登录，但**禁用密码登录前必须再确认一次密钥登录成功**，改错会锁死。

**部署与复验实况（2026-11-06 / 07）**：

- 切换：2026-11-06T16:54:29+08:00，`downtime_ms=482`、`health_code=200`、`db=ok`、`schemaVersion=2`、`UMask=0027`、`verify_clean=1`（记录在 `/root/step10-backup-20261106-143445/switch-log-20261106.txt`）。
- 生产 `/api/health`：`{"status":"ok","service":"persist-server","ai":"deepseek","model":"deepseek-chat","db":"ok","version":2,"storage":{"usedPercent":13.2,"status":"ok"},"warnings":[]}`。**磁盘水位只改 `storage.status` / `warnings`，不动顶层 `status`**——前端把 `status !== 'ok'` 当成 AI 不可用，会整体退回 Mock。
- 真实 Key 三链路在服务器上各验一次：`/api/chat`（SSE）、`/api/report`、`/api/v1/analysis/reports`（`origin:"ai"`），均 200。
- 14a 定时器：`persist-backup.timer` active，`OnCalendar=*-*-* 03:00:00` + `Persistent=true` + `RandomizedDelaySec=120`。**2026-11-07 03:00:55 无人值守实跑成功**：`persist-20261107-030055-scheduled.sqlite` 229376 B + `.sha256` 107 B，`-rw-r----- persist persist`（`UMask=0027` 生效；用 `runuser` 手工跑**不继承**该 umask，会得到 `644`，所以验权限一律走 `systemctl start persist-backup.service`）。所有快照 sha256 相同（`cf5e5d60…`）是 `VACUUM INTO` 在库空闲时的确定性结果，不是损坏，`sha256sum -c` 全 OK。
- 磁盘：`df -h /` → `40G 5.0G 33G 14%`；内存可用约 1.4 G。
- **仍未做**：第 8 项前端产物上传、第 9 项 SSH 加固、第 10 项删 3389（需用户在阿里云控制台操作）。unit 原文与 CLI 用法见 `docs/部署与服务器现状.md` §6.1。

### 13.4 P4：四步拆分与依赖

设计细节唯一来源是 P4 文档（本文件不复述）。**前置 1（步骤 11 数据历史化）已于 2026-11-04 完成**；剩余前置：

1.（已解决）~~步骤 11（8d）数据历史化~~——✅ `6d769a7` / `bc4ee88` / `12de14b`：训练真实历史、饮食 / 饮水 / 计划按日台账、`schemaVersion` 2、备份 0.3.0；app 单测 230/230、E2E 106 全绿（含 `8edb8ba` 返回态修复与 `971e1b6` 学习来源修复）。
2.（已解决）**~~SQLite 驱动选型~~**——已定 **Node ≥ 22.5 + 内置 `node:sqlite`**（2026-11-05，决策记录见 P4 §11.4），差异隔离在 `server/src/db/driver.ts`；服务器已于 2026-11-06 并行装 `/opt/node22`（v22.19.0）并切到该解释器，系统 `/usr/bin/node` 仍是 20.20.2。

| 步骤 | 内容 | 依赖 |
|---|---|---|
| **11**（8d） | 数据历史化：按日台账、真实训练历史、`schemaVersion` 1→2、备份 0.3.0 | ✅ **已完成 2026-11-04**（`6d769a7` / `bc4ee88` / `12de14b` / `8edb8ba` / `971e1b6`；视觉基线已双端验收入库 `5ee8d85`） |
| **12**（P4a） | SQLite 表 + migration + repository、`/api/v1/devices*`、`/api/v1/sync/{bootstrap,push,pull}`（`opId` 幂等 / LWW / 30 天墓碑 / `rev` 游标）、客户端 outbox、设置页同步区块 | ✅ **本机完成并验收 2026-11-05**：12a `ca02250` / 12b `6fe6b3d`（文档 `d555cb0`）/ 12c `c6a65fd` / 12d `9abd8bb` / 12e `f09c3da` / 12f 收尾（pull 形状守卫 + 本机验收 + 视觉重跑 + 文档同步）；app 292/292、server 112/112、E2E 110、P4 §7.4 19/19（**步骤 12 完成时的数字**）。**已推送，服务端已于 2026-11-06 部署到生产**（Node v22.19.0 + `/opt/persist-next`；视觉基线 13 张已入库；前端同步卡片待上传） |
| **13**（P4b） | facts builder、`ANALYSIS_SYSTEM_PROMPT`（禁止算术）、`/api/v1/analysis/{facts,reports}`、`dataRev` 缓存 + 定时简报 + 规则降级 | ✅ **本机完成并验证 2026-11-05**：13a 契约 + schema v2 / 13b 聚合与四个接口 / 13c 每日简报 + 前端 / 13d 真实 Key 联调修复（内容不合规重试一次 + 提示词禁内部标识符）；server 175/175（18 文件）、app 334/334（24 文件）、E2E 120（9 文件）、oxlint 0/0（98 文件）；**已推送（`41ed92f` / `82ed773` / `40d2bf4` / `7f13727` / `18d5f77` / `5ba4f7e`），服务端已于 2026-11-06 部署到生产**（本机与服务器均用真实 DeepSeek Key 验证 chat / report / 综合分析三条链路；前端综合分析块待上传） |
| **14a**（P4c 备份） | 每日 `VACUUM INTO` 快照 + `PRAGMA integrity_check` + sha256 旁车 + 保留瀑布（7 日 / 4 周 / 3 月）+ `/api/health` 磁盘水位 | ✅ **已上线 2026-11-06**：`c6ed57e` 实现、`7d6ef32` 修 CLI 空格参数；systemd timer 03:00（2026-11-07 03:00:55 无人值守成功）；server 197/197 |
| **14b–14d**（P4c 其余） | `/api/v1/backups*`（恢复预览 + 二次确认 + 恢复前自动备份）、`/api/v1/export`（0.3.0 同构）、`DELETE /api/v1/account` | ⬜ 未开始，设计见 P4 §12 |

每步独立验收与提交，门禁：typecheck 0 错 + 单测 / E2E / 构建全绿 + 视觉有变化则重跑基线并请用户双端验收 + 文档同步 + 独立提交推送。**步骤 12 已按此走完 12a–12f，代码、文档与视觉基线均已于 2026-11-05 推送**（本地 `main` 与 `origin/main` 一致）。**步骤 13 已走完 13a–13d 的实施、验证与提交推送（`41ed92f` / `82ed773` / `40d2bf4` / `7f13727` / `18d5f77` / `5ba4f7e`）；视觉基线 12 张已经用户授权随 `chore(design)` 入库**。**两者的服务端已于 2026-11-06 部署到生产（门禁全部满足）；14a 备份另行走完「实现 → 单测 → 生产实跑 → 文档同步」，14b–14d 未开始。**

### 13.5 P5 / P6

- **P5 Android**：接 Capacitor + Android 工程 → 网络/通知/分享/安全区 → 返回键、键盘、横竖屏、后台行为 → WebView 内 IndexedDB 持久化复验 → USB 安装与真机验证 → 离线与 AI 不可用降级（复用 8b/8c 的 Mock 回退）。验收：目标机可装可启动、断网可记录、升级安装不丢数据。
- **P6 质量清理**：① ~~修 3 条 `set-state-in-effect` lint 警告~~ **已完成（`f5a57f5`，现行 oxlint 0 错 0 警告）**；② 按路由 `React.lazy()` 拆主包（`/plans` 优先，当前主包 **628.24 kB**，已过 500 kB 提示线）；③ ~~健身历史升级为通用 `WorkoutSet`~~ **已于 11b 完成**（历史读 `fitnessHistory`，按动作类型展示）；④ 补纯业务单测（健身汇总、饮水边界、学习统计、报告数据源、导入导出）；⑤ 可复用类型/纯函数迁 `shared/`（步骤 12c/13a 已迁同步与分析契约，chat/report 仍待迁）；⑥ 评估无障碍、键盘导航与焦点管理。

### 13.6 已完成阶段留下的技术约束（改动前必读）

- **持久化结构（P2）**：DB `persist-app` v1 / store `mock-state` / 单记录 `id='persist-mock-state'`，13 个状态切片（含 `fitnessHistory` / `dietDays` 等历史字段）合成一条记录整体重写（约 100–300 KB/次，200 ms 防抖）；`schemaVersion` 现为 **2**，`MIGRATIONS` v0→v1→v2，遇到更高版本返回 `unsupported-version` 只读；首挂载水合、`pagehide` / `visibilitychange` 补写；`unavailable`（2 s 超时）与 `corrupt` 降级；`corrupt` / `unavailable` 目前只有控制台告警，没有面向用户的 Toast（未做项）。
- **清空数据（P3-0）**：顺序固定为停止写回 → `clearTimeout(saveTimerRef)` → `clearPersistedState()` → `replaceMockData(createInitialMockData())`（含 `snapshot=null`）→ 同步刷新 `latestStateRef` → 恢复写回；`hydrated` 保持 true。
- **服务端契约**：`/api/chat` 请求 `turns` 1–20 条、单条 ≤2000 字、合计 ≤12000 字、末条必须 `user`；`/api/report` 请求体只有 `{ type, rangeDays, digest }`。改契约同时改 `server/src/contract.ts` 与 `app/src/lib/chat-types.ts` / `report-types.ts`。步骤 12/13 的新契约在 `@persist/shared`（`contract/{sync,entities,parse,analysis}.ts`）；`POST /api/v1/analysis/reports` 返回**平铺**的 `AnalysisReportResponse`（不是 `{ report }`），归档列表是 `{ reports, nextCursor }`。
- **为什么不用 Dexie**：`npm install` 受沙箱与全局缓存路径限制（EPERM），且当前只有「单用户单记录」场景；将来拆多 store / 多表查询再评估（步骤 11 会重新评估）。

---

## 14. 当前风险、限制与技术债

### 14.1 高优先级风险

| 风险 | 影响 | 建议 |
|---|---|---|
| 数据只在本机浏览器 IndexedDB | 清站点数据 / 换浏览器 / 换设备即丢失，无法跨设备恢复 | 已在界面文案说明（设置页、学习页、删除确认）；步骤 12 已实现「设备令牌 + 增量同步副本」并本机验收、**服务端已于 2026-11-06 部署**，但**前端同步卡片未上传，因此线上页面仍无跨设备同步**；**每日备份已于 14a 上线，恢复 / 导出 / 删账号在步骤 14b–14d**（方案见 `docs/P4-数据层与AI综合分析设计方案.md`） |
| ~~历史数据缺口：只有学习记录是真实历史~~ | ✅ 已由步骤 11（8d，`6d769a7` / `bc4ee88` / `12de14b`）关闭：训练真实归档到 `fitnessHistory`、饮食 / 饮水 / 计划按日台账、`schemaVersion` 2、备份 0.3.0 | 剩余限制：历史只覆盖本机落过盘的天；演示种子只覆盖最近 7 天，所以近 30 / 90 天窗口数字与近 7 天相同；跨设备历史要等 P4 同步 |
| 持久化无跨标签页同步 | 两个标签页同时编辑会互相覆盖，最后写入为准 | P4 补 `BroadcastChannel` 同步或写入前版本比对（步骤 12 未涉及，仍待办）；清空入口已在步骤 7 补齐 |
| 旧文档已清理，勿凭记忆恢复 | 2026-11-04 已删 `docs/项目现状总览.md`、`HANDOFF-新会话指令.md`、`docs/工程初始化与前端约定.md`（内容并入本文与 `docs/工程约定.md`）；`docs/Persist-项目开发规划.md` 已重写为 **v2.0**（项目介绍 + 长期规划），其中四项导航 / 16 条建议路由 / Dexie 方案都**不是现状** | 以本文档与代码为准；需要 v1.2 原文时用 `git show fccce42:docs/Persist-项目开发规划.md` 取回，只作历史参考，不要照它实施 |
| `PlansPage.tsx` 是等价重写而非原始源码 | 该页曾因写入事故丢失，当前由 dist 产物反解后重写，虽已通过全量验证，但不排除丢注释/丢少量细节 | 已包含在首个提交 `bd779eb` 中；后续该页改动请先读现状再改 |
| ~~Prettier 插件会压平条件类名~~ | 风险已消除：`prettier-plugin-tailwindcss` 已于 2026-11-03 从配置和 `package.json` 移除，全仓格式化不再破坏条件类名 | 保留规则：条件类名仍统一用 `cn()` 或完整字符串三元；格式化前后仍建议 `Select-String` 抽查条件类名 |
| “快照”容易被误解 | 用户可能以为可以恢复数据 | UI 和文档明确其只是元信息（但它会持久化保存） |
| 回滚粒度仍偏粗 | 现有提交链（`bd779eb` / `da787c4` / `128d6a2` / `e3e9730` / `d4c9696` / `style:`），清理与格式化已单独成提交，但整体仍是按阶段而非按功能切片 | 每个阶段结束时提交一次，保持可回滚 |
| 报告质量与口径 | 8c 后报告文字可来自模型，但只有「今日简报」接服务端；若提示词失控，模型可能写出摘要里没有的数字 | 提示词已明确禁止任何数值推算，`sanitizeReportContent()` 兜底长度与结构；真实联调曾捕获「再补水 0.5 L」并修复；报告指标与依据始终由前端确定性生成，模型无法改数字；步骤 13 再收紧一层：服务端综合分析正文里出现的每个数字都必须在事实包 JSON 里，否则 502 且不入档（`analysis-content` 单测 11 条） |
| 服务器 root 密码登录 + 安全组开着 3389 | 公网 22 端口暴露且允许密码爆破；3389 对 Linux 无用；部署用 ed25519 公钥已加入 `/root/.ssh/authorized_keys`（2026-11-04），但**密码登录仍开着** | 步骤 10：关闭 root 密码登录、删除 3389 规则、装 `fail2ban`（见部署文档 §6/§10） |
| 2 GiB 内存 + 3 Mbps 峰值带宽 + 按流量计费（0.8 元/GB） | 在服务器上 `npm ci` + `vite build` 极易 OOM；未配压缩/缓存时每次回访都重复计流量 | 前端只在本地构建后上传 `app/dist`；Nginx 开 gzip，hashed 资源 `immutable` 一年、`index.html` `no-cache`（见部署文档 §5.1） |
| 域名备案中（2026-11-03 提交；**2026-11-04 阿里云初审已通过**；计划 2026-11-05 提交省通信管理局审核） | 备案号下发前不能用域名对外提供 HTTP 服务，阿里云会拦截；管局审核时长不可控（法定期限 20 个工作日） | 现阶段只用 IP 直连做内部验收；步骤 10（解析域名、开 443、签证书）只能等备案号下发，**不要按经验值承诺上线日期**，也不要在任何对外文案里写域名已可用 |
| P3 服务端已部署但无账号鉴权 | IP 直连（仅内部调试）已可用；任何人拿到 IP 都能按 IP 限流额度（20 次 / 300 s）打 `/api/chat` 与 `/api/report`，无 token 计量 | Nginx 反代 + 系统密钥 + 限流已就位；**不得对外宣称「已上线」**；Key 已于 2026-11-04 轮换且只存服务器 env；备案号下发后（步骤 10）再收紧为域名 + HTTPS |
| ~~步骤 12 已推送但线上没变~~ | ✅ 2026-11-06 已消除：服务端升 Node v22.19.0 并部署到 `/opt/persist-next`，`/api/v1/*` 线上可用（`db:"ok"` / `version:2`） | 但**前端静态包仍是步骤 9 那版**（`index-DVS7rlR_.js`），设置页「数据同步」卡片与 `/reports` 综合分析块在线上页面看不到；任何文档/回复必须写「**后端已部署、前端产物未上传**」，不得写成「同步已上线」 |
| 同步的信任边界 | 同步副本在服务器上（部署后）；恢复码即账号凭据，`32` 位十六进制、不可修改，换设备只轮换 token，服务端只存 recoverCode 哈希 | 恢复码只在用户主动「显示恢复码」时呈现，不进日志、不进 URL；丢失恢复码等于丢账号（步骤 14 再用备份/导出兜底） |
| 无 Android 工程 | 尚未达到可安装目标 | 持久化和服务端接口稳定后再打包 |

### 14.2 中低优先级技术债

- ~~健身历史详情仍为力量专用结构~~ ✅ 11b 已改为按真实动作类型展示（力量：重量 / 次数；有氧：时长 / 距离）。
- 主 JS 包超过 500 kB（`/plans` 可优先拆为懒加载路由）。
- ~~3 条 lint 警告未清理~~ ✅ 已于 2026-11-04 随 `f5a57f5` 清零（深链改为从 URL 派生弹层状态，未用 `eslint-disable`）。
- ~~饮食照片没有真实存储~~ ✅ 2026-11-05 已整体移除照片入口（不再产生、同步或展示任何图片字段）。
- 提醒没有系统通知能力。
- 「训练建议」/「学习观察」两类报告仍打开本地已有报告；数字与依据在 8d 后已按近 7 / 30 / 90 天窗口真实汇总（不再用演示常量）。步骤 13 起 `/reports` 另有「服务端综合分析」块（事实包 v2 + 单次模型调用 + 365 天归档，**后端已部署、前端块未上传**），两套报告并存：本地块仍按已有口径出数，服务端结果不写回本地 `reports`。
- ~~`/reports` 视觉基线在 8c 后过期~~ ✅ 已于 2026-11-04 重跑（6 张 png 更新，`overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`、exit 0），经用户桌面端 + 移动端验收后随 `7625865` 提交推送；reports 基线现与代码一致。
- 持久化已有 UI 入口的清空（步骤 7「清空本机数据」，`a544a38`）；导入会整体替换本机数据且无撤销；读盘失败只在控制台告警，没有面向用户的提示。
- 没有跨标签页同步与写入冲突处理；同一浏览器两个标签页同时编辑时以最后写入为准。
- P3 服务端（`9138175` + `b99d3ad` + `bdd4265`）只有按 IP 限流，**没有用户鉴权**（P3 无账号体系）；未配 `DEEPSEEK_API_KEY` 时 `/api/health` 报 `ai: "disabled"`、`/api/chat` 与 `/api/report` 固定 503，前端据此回退 Mock，属预期降级路径。两个接口共用同一个 20 次/5 分钟限流器（有意为之：消耗同一份额度），因此连续做报告会挤占建档对话的额度。
- 真实 DeepSeek 调用尚未做费用/额度监控与 token 统计；模型输出质量（追问条数、周目标数量）仍有波动。真实 Key 曾出现在开发对话中，**上线前必须轮换**。
- `@persist/shared` 已在步骤 12c 建立、步骤 13a 扩到综合分析（`contract/{sync,entities,parse,analysis}.ts`，`shared/dist` 需 `npm run shared:build`）；**chat/report 的请求响应类型仍在 `server/src/contract.ts`**，改 `ChatEvent` 须同时改 `app/src/lib/chat-types.ts`，改报告契约须同时改 `app/src/lib/report-types.ts`；这部分迁移另排期。
- 服务端综合分析的已知边界（步骤 13，**后端已部署、前端块未上传**）：①只读同步上来的 `entities` 表——同步没开或数据没上来时窗口是空的（返回 409 `insufficient_data`，不会编）；②事实包粒度是 7 天逐日、30 天逐日 + 周、90 天只给周，**只包含有记录的天**，没有值的天不补零；③模型只写文字，正文数字必须在事实包内，否则 502 且不入档；④无 Key / 超时 / 上游错一律 200 + `origin:"rules"` 规则降级（`model:null`），不会假装成 AI；⑤报告缓存键是 `dataRev`（= 服务端 `sync_seq.value`），**同一份数据重复生成返回 `cached:true`**，`force:true` 才重建；⑥报告保留 365 天，清理发生在生成时，**墓碑 30 天与审计日志 30 天的清理任务仍未实现**。
- 每日简报 job（步骤 13c）：进程内 60 s tick（`unref`，**不需要 systemd timer / cron**）、默认关闭（`DAILY_BRIEF_ENABLED=false`）、默认 21:00；读的是**同步上来的设置**（`settings.payload_json.dailyBrief`），env 只是兜底——跨设备同步未开或设置没同步上去时不会跑；每天按 `runKey`（本地日期）幂等，最多尝试 2 次，失败记 `job_runs`。
- 同步的已知边界（步骤 12，后端已部署、前端卡片未上传）：① 只同步「本机已有记录」，不会补出没落过盘的历史；② pull 前有形状守卫（`matchesRecordShape`），形状不完整的远端实体会被计 `skipped` 丢弃而不是修复后写入，因此旧版本客户端写坏的实体同步不过来；③ 同步关闭时不发任何请求，失败只体现在设置页状态与指数退避重试，**没有逐条冲突 / 失败列表**，也没有「暂停某切片」之类的开关；④ 同步副本**不是备份**（无历史版本、无恢复）；**14a 的每日快照是备份主体，但恢复 / 导出 / 删账号仍未完成（步骤 14b–14d）**。
- 同步的冲突策略是 LWW（按 `updatedAt` 后写胜）+ 墓碑：同一实体的两处并发编辑不会合并，后写入者整体覆盖；删除写墓碑（`deleted_at` + 新 `rev`、payload 清空）并由 pull 传播给其他设备。**墓碑的 30 天保留 / 定期清理是 P4 §6 的设计口径，步骤 12 未实现清理任务**。这与「无冲突 UI」是有意取舍，不是缺陷。
- 跨日期自动化仍有限：8d 已让饮食 / 饮水 / 计划 / 训练按日台账累积，但 E2E 里没有「跨两天」的用例（本机日期切换靠改系统时钟，未纳入自动化）；演示种子只覆盖最近 7 天。
- 页面内弹层较多，未来若要 deep link 或恢复操作状态，需要补 URL 状态设计（目前只有 `/plans?onboard=1`）。
- ~~`PreviewPages.tsx` 是未接入当前路由的预览页面~~：已于 2026-11-03 清理（全 `app/src` 零引用，属死代码；同时删除 `persist.css` 中仅供它使用的 `.preview-*` 样式 173 行）。Git 历史可随时找回。
- `design/` 现状（2026-11-04 重跑基线后）：94 个文件（93 张 PNG + `home-v3-countdown.html`，约 18.8 MB），其中 91 张是 `visual:check` 现行基线（15 状态 × 6 视口，+1 张快速记录）、2 张是 v3 首页设计基线对照图；**步骤 12 重跑后 13 张 png（6 设置页 / 6 首页倒计时 / 1 快速记录）已经用户双端验收并随 `4d3edcf` 入库**。基线每次重跑都会更新几十张（日期类内容天然漂移），单次提交约 14 MB 二进制，属正常但会推高仓库体积（`.git` 里仍保留历史版本，**注意**：只更新文件不会让 `.git` 变小）。此前 2026-11-03 清理删除了 `design/_snapshot-before-fixes/` 59 张旧快照（16.5 MB）、v1/v2 遗留原型 2 HTML + 6 PNG，以及未入库的 `design/.edge-profile*/`（13.7 MB）；要真正瘦身需重写历史，已推送的仓库不建议做。
- 尚未添加 `.gitattributes`：Windows 下 `core.autocrlf=true` 时提交时提示 “LF will be replaced by CRLF”，仓库内存 LF、检出转 CRLF，不影响构建与测试。
- ~~15 个既有文件未通过 `prettier --check`~~ ✅ 已于 2026-11-03 解决：16 个漂移文件 + `ReportsPage.tsx` + `.prettierrc.json`/`package.json` 一次格式化，`prettier --check .` 全仓通过。**注意**：Prettier 拆行时会给 JSX 文本补 `{' '}` 子节点，`ReportsPage.tsx` 因此出现移动端换行位置变化（4 张截图 0.02%～0.04% 像素差），已改为显式字符串子节点还原，产物哈希与格式化前完全一致（见 §18.1 `style:` 行）。

### 14.3 不应误判为缺陷的既定行为

- SPA 导航时数据保留。
- 全页刷新后数据从本机 IndexedDB 水合恢复；只有首次访问、清除站点数据或读盘失败时才回到初始 Mock。
- 饮水 1200 ml 是 `INITIAL_WATER_MILLILITERS` 常量（初始演示基线），只作为初始值，不参与持久化写入，因此不会因为刷新而重复累计。
- 持久化写入有 200 ms 防抖，刚点完按钮立即强杀进程可能丢最后一次编辑（正常关标签页有 `pagehide` 补写）。
- AI 报告在探测到服务端可用时显示「DeepSeek 生成 · 经本站服务端代理」，否则显示「本地生成 · Mock 报告」；E2E 与视觉检查里没有后端，因此看到的是 Mock 徽标，这不是未接 8c 的证据。
- 快照不是备份。
- 连接测试不是网络请求。
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

截至 2026-11-05（步骤 13 本机完成之后；下面按阶段保留历史状态，**最新状态看最后一条「工作区现状」**）：

- 当前分支：`main`（由 `master` 改名而来，已建跟踪关系）。
- 远端：`origin` = `git@github.com:save626/Persist.git`（SSH，密钥已注册在 `save626` 账号下；HTTPS 侧也配置了 Git Credential Manager）。
- **步骤 12 相关提交已于 2026-11-05 推送**（用户确认视觉验收后）——远端 `refs/heads/main` 已从 `91abaeb`（步骤 12 前最后一次推送）前进到 `202e9d0`（步骤 12 全部提交 + 推送后文档修正），本地 `main` 与远端一致（`git ls-remote origin refs/heads/main` 核对）。下面是从 `bd779eb` 到 `5ee8d85` 的已推送历史：
  - `bd779eb`（`chore: initial commit`，262 文件 / 37.39 MB）
  - `da787c4`（步骤 5 的文档同步）
  - `128d6a2`（步骤 6 本机 IndexedDB 持久化 + 文档同步，41 个文件：4 新增 / 14 修改 / 23 张截图）
  - `e3e9730`（步骤 6 的文档同步）
  - `d4c9696`（`chore:` 清理死代码与历史设计制品，73 个文件 +34/−724）
  - 最新 `style:` 提交（移除 `prettier-plugin-tailwindcss` 并格式化既有漂移文件，22 个文件；哈希以 `git log` 为准，见 §18.1 `style:` 行）
  - `a544a38`（步骤 7 设置页「清空本机数据」入口）
  - `9138175`（步骤 8a 服务端 Fastify + DeepSeek 代理骨架）
  - `b99d3ad`（步骤 8b 前端接入 `/api/chat` + 真实 Key 联调，11 文件 +973/−23）
  - `bdd4265`（步骤 8c `/api/report` + 报告页真实生成，13 文件 +1557/−80）
  - `7625865`（`/reports` 6 张视觉基线重跑，用户双端验收后入库）
  - `3b246d2` / `f616ba4` / `fccce42`（8c 文档同步、P4 设计定稿、备案口径同步）
  - 本次「文档整理」提交（删除 3 篇冗余文档、新增 `docs/工程约定.md`、压缩本文）
  - 本次「步骤 9 部署验收」提交（步骤 9 完成记录 + 部署文档同步，**未改 `app/` 与 `server/` 源码**）
  - `9f9cc71`（今日页晨间简报接 `/api/report`）、`267146a`（晨间简报文档同步）、`27858da`（用户双端验收通过记录）
  - `f5a57f5`（lint 清理：深链弹层状态改为 URL 派生 + 删 3 个残留 .txt，app 172/172）
  - 本次「lint 清理文档同步 + 第三次部署记录」提交
  - `6d769a7`（步骤 11a 数据层 v2：`schemaVersion` 2 + 备份 0.3.0 + 按日历史字段 + v1→v2 迁移）
  - `bc4ee88`（步骤 11b 健身真实历史：删除 `HISTORY` 演示常量，历史读 `fitnessHistory`）
  - `12de14b`（步骤 11c 报告窗口：`history.ts` + `report-window.ts`，近 7 / 30 / 90 天按窗口汇总）
  - `8edb8ba`（报告页返回态修复：顶部成功态改为按最新报告派生，离开/刷新后不再误显示「尚未生成」）
  - `cabc72b` / `971e1b6` / `33616fb` / `5ee8d85`（视觉基线验收入库、学习来源不随科目切换等，2026-11-05 已推送）
- **步骤 12 的提交链（已推送 `origin/main`）**：
  - `ca02250`（12a 数据层：SQLite 驱动 / migration / repository）
  - `6fe6b3d`（12b 账号与同步接口：`/api/v1/devices*`、`/api/v1/sync/*`）与 `d555cb0`（12b 文档同步）
  - `c6a65fd`（12c 同步契约搬 `shared/`）
  - `9abd8bb`（12d 客户端同步层：outbox / 引擎 / 设置页开关接线）
  - `f09c3da`（12e 设置页「数据同步」卡片）
  - `e9c29a0`（12f pull 形状守卫 + 步骤 12 本机验收记录 + 文档同步）
  - `e7fbf45`（docs：12f 提交后的推送 / 工作区状态同步）
  - `4d3edcf`（`chore(design)`：13 张视觉基线重跑入库，用户双端验收通过）
  - 推送后的状态同步（`docs`，HEAD 见 `git log -1`）
- **2026-11-05 饮食修复的提交链（已推送 `origin/main`）**：
  - `fbab985`（`feat(app-diet)`：移除饮食拍照/选图附件，只保留手填与 AI 粘贴解析）
  - `50d90ef`（`fix(app-diet)`：跨日后今日餐次为空导致记录与 AI 登记失效）
  - 本次 `style(app)` 提交（9 个文件补 Prettier 格式化，纯空白/换行，产物哈希不变）
  - 本次 `docs` 提交（HANDOFF / 规划文档同步本表与构建、测试数字）
  - 推送后 `origin/main` = 本地 HEAD，`git ls-remote origin refs/heads/main` 核对一致；工作区干净，无未推送提交
- **推送状态（2026-11-05）**：用户确认视觉验收后执行推送，`origin/main` 已从 `91abaeb` 前进到步骤 12 的 HEAD（`202e9d0`；其后的哈希与计数修正提交同样已推送），**本地 `main` 与远端一致**（`git ls-remote origin refs/heads/main` 与本地 hash 核对）；工作区干净，无未推送提交。`git push` / `git ls-remote` 在受限沙箱下会失败（`spawn EPERM`），需要一次性提升权限（2026-11-05 即以 `danger-full-access` 完成推送）。
- **工作区（推送后，2026-11-05）**：干净——12f 的 pull 形状守卫（`app/src/lib/mock-data-transfer.ts` +36 / `sync-entities.ts` +68 / `sync-entities.test.ts` +42）与文档随 `e9c29a0` 提交，13 张 `design/*.png` 已随 `4d3edcf` 入库（用户桌面端 + 移动端验收通过）；本次饮食改动的 20 张 `design/*.png` 已随 `fbab985` 入库；`server/` 的 `dist/`、`data/`、`.env` 由 `.gitignore` 排除。
- **工作区现状（2026-11-07，最新）**：步骤 13（13a–13d）的源码、测试与文档分六个提交推送：`41ed92f`（13a 契约）、`82ed773`（13b 服务端）、`40d2bf4`（13c 前端与每日简报）、`7f13727`（文档同步）、`18d5f77`（13d 真实 Key 联调修复）、`5ba4f7e`（含真实 Key 结论的文档同步）；2026-11-06 追加 `8a243b1`（步骤 10 拆分 + 服务器实况核对 + 新会话交接指令）；**步骤 14a 又追加 `c6ed57e`（每日备份 / 保留策略 / 磁盘水位）与 `7d6ef32`（备份 CLI 接受 `--reason <值>` 空格写法）**，随后服务器升 Node 22 并部署步骤 12/13。基线：`HEAD` = `origin/main` = `7d6ef32`（本次文档同步与 `chore(design)` 提交后前进）。
  - `git status` 口径（截至本段）：12 张 `design/*.png` 已随 `chore(design)` 入库；`.step13-review/` 已写进 `.gitignore`（4 张评审截图与基线逐字节相同，只做验收用途，**不入库**）。
  - 提交纪律：源码提交按 13a / 13b / 13c / docs 分组 `git add`；12 张基线单独 `git add design/*.png` 提交为 `chore(design)`（用户已授权），`.step13-review/` 始终不入库。
- **工作区已干净**：65 张 `design/*.png`（18 张真实改动、6 张日期文字、41 张时钟漂移）已随 `5ee8d85` 入库，`git status` 无未提交改动（`server/` 的 `dist/` 与 `.env` 由 `.gitignore` 排除）。
- 提交前已删除根目录 `$null` 与 `app/$null` 两个重定向误建的垃圾文件；`.gitignore` 排除了 `node_modules/`、`app/dist/`、`app/coverage/`、`app/playwright-report/`、`app/test-results/`、`shared/dist/`、`server/dist/`、`server/data/`、`*.tsbuildinfo`、`.env*`、`design/.edge-profile*/`、`Water intake record/`、`*.log`、`.chrome-headless-*/`。
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
- `D:\Persist\app\src\lib\report-digest.ts`（2026-11-04：摘要构造唯一入口，报告页与晨间简报共用授权/来源规则）
- `D:\Persist\app\src\lib\morning-brief.ts`（2026-11-04：晨间简报取数、会话缓存、失败分流与诚实文案）
- `D:\Persist\app\src\lib\use-new-record-param.ts`（2026-11-04 lint 清理：`?new=1` 深链派生弹层状态 + `clear()` 清参数，替代 effect 里 setState 的副本状态）
- `D:\Persist\app\src\lib\sync-contract.ts`（步骤 12c/12d：客户端侧实体 kind / 信封 / 响应类型，与 `shared/src/contract/*` 同源）
- `D:\Persist\app\src\lib\sync-client.ts`（步骤 12d：`/api/v1/*` 客户端、失败分类与指数退避）
- `D:\Persist\app\src\lib\sync-store.ts`（步骤 12d：`persist-sync` IndexedDB 元数据 + outbox，归一化、合并与批次切分）
- `D:\Persist\app\src\lib\sync-queue.ts`（步骤 12d：outbox 入队 / 同实体合并 / 批次 `opId` 与清账）
- `D:\Persist\app\src\lib\sync-entities.ts`（步骤 12d/12f：8 切片摊平成实体、差分、pull 合并 LWW + 墓碑 + `matchesRecordShape` 形状守卫）
- `D:\Persist\app\src\lib\sync-engine.ts`（步骤 12d：开关 / bootstrap / 5 s 防抖 / 60 s 兜底轮询 / online·visibility 触发 / 退避）

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
- `D:\Persist\app\src\lib\sync-*.test.ts`（步骤 12：`sync-store` 13 / `sync-queue` 7 / `sync-client` 12 / `sync-engine` 14 / `sync-entities` 16 = 62 条）
- `D:\Persist\app\src\lib\analysis-client.test.ts`（步骤 13b/13c：四个分析接口、平铺响应、9 类错误分流，26 条）
- `D:\Persist\app\src\pages\ReportsPage.analysis.test.tsx`（步骤 13c：综合分析块与归档，8 条）、`D:\Persist\app\src\pages\SettingsPage.brief.test.tsx`（步骤 13c：每日简报卡片，5 条）
- `D:\Persist\app\e2e\reports-analysis.spec.ts`（步骤 13c：综合分析块生成 / 归档 / 错误文案 / 未开同步，4 条 × 2 项目）
- `D:\Persist\server\test\`（18 文件 175 条：步骤 12 的 13 个文件 + 步骤 13 的 `analysis-content` / `analysis-facts` / `analysis-routes` / `daily-brief` / `reports-repo`）
- `D:\Persist\app\src\lib\*.test.ts`
- `D:\Persist\app\src\data\complete-mock-data.test.ts`
- `D:\Persist\app\scripts\visual-check.mjs`
- `D:\Persist\design\`

### 16.6 文档与占位

- `D:\Persist\HANDOFF.md`（本文，唯一现状与计划来源）
- `D:\Persist\docs\Persist-项目开发规划.md`（**项目介绍与长期规划唯一来源 v2.0**：定位与边界、八页功能规划、数据与技术架构、P0–P6 / 步骤 9–15、风险与 Backlog、发布验收清单；v1.2 原文仅存于 `fccce42`）
- `D:\Persist\docs\P4-数据层与AI综合分析设计方案.md`（**P4 终态架构唯一设计来源**：本地优先 + 服务端 SQLite 副本、同步协议、事实包契约 v2、隐私边界、步骤 11–14 拆分与验收）
- `D:\Persist\docs\部署与服务器现状.md`（部署侧唯一事实来源：服务器规格、5.1 七条硬规则、Nginx 草案、命令速查）
- `D:\Persist\docs\工程约定.md`（技术选型、视觉与响应式基线、可访问性、非功能要求、测试门禁与术语）
- `D:\Persist\docs\部署与服务器现状.local.md`（**不入库**，真实公网 IP；由 `.gitignore` 的 `*.local.md` 排除）
- `D:\Persist\server\README.md`（服务端：P3 的 `/api/chat`、`/api/report` 契约 + 步骤 12 的 `/api/v1/devices*`、`/api/v1/sync/*` 与 SQLite 数据层；环境变量（含 `DB_PATH`）、开发与验证命令、真实 Key 联调注意事项、TODO）
- `D:\Persist\server\src\`（P3：`app.ts` / `config.ts` / `contract.ts` / `rate-limit.ts` / `routes/`（`chat.ts` / `report.ts`）/ `ai/`（`deepseek.ts` / `prompts.ts` / `extract.ts` / `report.ts`）；步骤 12：`auth.ts`、`index.ts`、`routes/`（`health.ts` / `guards.ts` / `devices.ts` / `sync.ts`）、`sync/`（`accounts.ts` / `service.ts`）、`db/`（`driver.ts` / `migrations.ts` / `entities.ts` / `index.ts` / `repositories/`（`entities.ts` / `devices.ts` / `sync-ops.ts` / `sync-seq.ts`）））
- `D:\Persist\shared\README.md`、`shared/src/index.ts`、`shared/src/contract/{sync,entities,parse}.ts`（步骤 12c 的契约包；`shared/dist` 由 `npm run shared:build` 产出且已 gitignore）
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
| 数据策略 | 本地优先：先写本机 IndexedDB，服务端不可用不影响记录；**跨设备同步的代码已在步骤 12 完成并验收、服务端 2026-11-06 已部署，但前端产物未上传**（线上页面仍无同步） |
| AI 服务 | 计划使用 DeepSeek，通过服务端代理 |
| API Key | 只能保存在服务端 |
| 部署形态 | 阿里云 ECS（Alibaba Cloud Linux 3，`dnf`）+ Nginx 静态托管前端 + Fastify 反代 `/api`；**不在服务器构建前端**，本地 `build` 后上传 `app/dist` |
| 前端 API 前缀 | 相对路径 `/api`，不写死 IP / 域名（备案后换域名零改动） |
| 数据库 | P3 不落库；步骤 12 起服务端用**单文件 SQLite**（本机 `server/data/persist.sqlite`，生产目标 `/var/lib/persist/persist.sqlite`，明确不用 MySQL/MariaDB、不用 ORM）；驱动**已定** Node ≥ 22.5 内置 `node:sqlite`（2026-11-05，见 `docs/P4-数据层与AI综合分析设计方案.md` §11.4） |
| 同步开关 | 设置页「数据同步」**默认关闭**，关闭时不发起任何同步请求；开启时先全量 bootstrap，之后 5 s 防抖增量 + 60 s 兜底轮询，`online` / `visibilitychange` 也触发（步骤 12） |
| 账号与凭据 | 无邮箱密码：注册设备即建号，凭 **32 位十六进制恢复码**（不可修改）在别的设备绑定同一账号；换设备只轮换设备令牌，服务端只存恢复码哈希（步骤 12） |
| 同步合并策略 | 实体级 LWW（按 `updatedAt` 后写胜）+ 墓碑；push 用 `opId` 幂等、pull 用 `rev` 游标分页；服务端只校验索引列、原样存 payload，客户端 pull 前加形状守卫，坏实体计 `skipped` 不写（步骤 12） |
| 照片识别 | 第一版不做；拍照/选图入口已于 2026-11-05 整体移除，不纳入后续路线 |
| 外部学习 App | 不抓取非公开数据 |
| AI 写入计划 | 必须用户确认 |
| AI 建档形态 | 结构化引导问答，不是开放式聊天机器人 |
| 长期计划 | 与今日计划分离，支持草案、启用、归档和周目标 |
| 长期计划入口 | 档案页「AI 建档」、`/plans?onboard=1`、今日页「长期计划」；长期计划不进主导航，导航固定五项 |
| 草案确认语义 | 确认即启用为 `active`，原 `active` 在新计划创建成功后才归档 |
| 计划起止日期 | `ChatPlanProposal.startDate/endDate` 可选；缺省时开始=今天、结束=最后里程碑；草案页可编辑 |
| 档案字段校验 | 统一走 `profile-rules.ts`；越界字段丢弃并用一条 toast 汇总提示，从不抛错、不中断对话 |
| 备份版本 | 当前 `0.3.0`（含 `longTermPlans` + 训练/饮食/饮水/计划历史，兼容 0.2.0 / 0.1.0；步骤 11（8d）已升版） |
| 条件类名写法 | 用 `cn()` 或「完整字符串三元」；不要依赖条件拼接里手写空格的写法（历史教训：`prettier-plugin-tailwindcss` 曾把它压平成 `plan-itemdone`，插件已于 2026-11-03 移除，规则继续保留） |
| 计划完成量 | 当前为估算，不能包装成精确统计 |
| 当前“快照” | 仅状态元信息，不是备份（会随持久化保存，但不具备恢复能力） |
| 本地持久化 | 原生 IndexedDB，单记录 `persist-mock-state`，`schemaVersion` 迁移，未来版本只读保护；未引入 Dexie |
| 刷新 / 重开 | 数据从本机 IndexedDB 水合恢复；清站点数据、换浏览器或换设备才回到初始 Mock |
| Android | 后续使用 Capacitor，当前未开始 |

规划文档 `docs/Persist-项目开发规划.md` 已于 2026-11-04 **重写为 v2.0**（项目介绍 + 长期规划）：四项导航 / AI 报告为辅助页 / 16 条建议路由 / 「Dexie、Drizzle、Docker」这些 v1.2 内容都**不是现状**；v2.0 里保留的规划口径与本文 §13 一致。需要 v1.2 原文（字段级功能规格等）用 `git show fccce42:docs/Persist-项目开发规划.md` 取回，只作参考；任何冲突以本文档与当前代码为准。

---

## 18. 变更史与遗留问题

### 18.1 里程碑

| 日期 | 步骤 | commit | 交付 | 关键验证数字 |
|---|---|---|---|---|
| 11-02 | 步骤 1–2 | 无（当时 Git 0 提交） | 只读审计 + 四决策；`/plans` 页、AI 建档对话、草案确认、`plan-draft.ts` / `profile-rules.ts`、备份 0.2.0、修 toast / 导航高亮 / 14 处状态样式、`useId()` | 单测 38→111；E2E 82→90（89 过 1 跳过） |
| 11-03 | 步骤 3 | 随 `bd779eb` 链 | 导出改 `serializeMockBackup()`（`version:'0.2.0'` + `longTermPlans` + 文件名带日期），导入按版本分流并报学习/计划数 | 单测 111→112；E2E 90→92 |
| 11-03 | 步骤 4 | 随 `bd779eb` 链 | 弹窗全站居中；`visual:check` 纳入 `/plans` 5 态、视口 5→6（增 421×926 真机视口） | 15 态 × 6 视口 = 90 张 + 快速记录 1 张全零；`npm test` 112/112；E2E 92/0 跳过（46.0 s）；JS 549.09 kB / CSS 139.92 kB |
| 11-03 | 步骤 5 | `bd779eb` + `da787c4` | 删 `$null` / `app/$null`，`git branch -M main`，262 文件首发并推送 `git@github.com:save626/Persist.git` | 37.39 MB；远端 `refs/heads/main` 与本地 HEAD 一致 |
| 11-03 | 步骤 6（P2） | `128d6a2` | 本机 IndexedDB 持久化（`persist-state.ts` / `persist-storage.ts` + Provider 水合 / 防抖写 / 补写） | 41 文件（4 新 / 14 改 / 23 截图）；`npm test` 123/123；E2E 98/0（55.1 s）；JS 552.61 kB（+3.52 kB） |
| 11-03 | 清理 `chore:` | §18 原表未记 | 删 `_snapshot-before-fixes/`（59 张 / 16.5 MB）、v1/v2 原型、`.edge-profile*`（13.7 MB）、`PreviewPages.tsx` 与 `.preview-*` 173 行 | `npm test` 123/123；E2E 98/0；CSS 139.92→137.64 kB |
| 11-03 | 格式化 `style:` | §18 原表未记 | 移除 `prettier-plugin-tailwindcss`，19 文件格式化，修 `{' '}` 副作用 | `prettier --check` 全仓通过；产物 `index-D5Nq3TbM.js` 552,612 B + `index-C9ZcsQCi.css` 137,643 B 与格式化前**逐字节相同** |
| 11-03 | 步骤 7（P3-0） | `a544a38` | 设置页「清空本机数据」入口 | 4 文件 +142/−4；`npm test` 123/123；E2E 100/0/0（1.2 m）；JS 554.38 kB |
| 11-03 | 步骤 8a | `9138175` | `server/` Fastify 5.7.4 + DeepSeek 代理骨架（SSE / 净化 / 限流 / 优雅关闭） | 25 文件（23 新）；server 38/38（6 文件）；`PORT=3101` 冒烟 `/api/health` 200 `ai:"disabled"` |
| 11-04 | 步骤 8b | `b99d3ad` | 前端接 `/api/chat`（真实对话 + 诚实 Mock 回退）+ 真实 Key 联调 | 11 文件 +973/−23；app 139/139、E2E 102/0（52.8 s）、JS 560.36 kB；server 41/41；真实调用 200 / 3.5 s / 5643 B / 127 事件；修日期后 `startDate=2026-11-03` |
| 11-04 | 步骤 8c | `bdd4265` | `/api/report` + 报告页真实生成（模型只覆盖文字，指标与依据仍前端生成） | 13 文件 +1557/−80；app 149/149（10 文件）、E2E 102/0（59.5 s）、JS 564.70 kB / gzip 168.01 kB；server 58/58（report 17 条）；真实报告 200 / 2.7 s；只授权学习 200 / 2.0 s、`warnings: []` |
| 11-04 | 视觉闭环 | `7625865` | `/reports` 6 张基线重跑，用户双端验收后入库 | 各项 0、exit 0 |
| 11-04 | P4 设计定稿 | `f616ba4` | `docs/P4-数据层与AI综合分析设计方案.md`（SQLite 选型、8d、同步协议、事实包 v2、隐私边界、待确认项） | 纯文档，未跑测试 |
| 11-04 | 备案口径更新 | `3b246d2` / `fccce42` | 全部文档同步「阿里云初审已通过（11-04）/ 计划 11-05 提交管局 / 备案号未下发 ⇒ 仍属备案中」 | 纯文档，未跑测试 |
| 11-04 | **文档整理** | `477cced` | 12 篇 → 8 篇：`docs/工程约定.md` 新建；`HANDOFF.md` 合并原「一页速览」「新会话指令」并压缩路线与变更史；删除 `HANDOFF-新会话指令.md`、`docs/项目现状总览.md`、`docs/Persist-项目开发规划.md`、`docs/工程初始化与前端约定.md` | 纯文档，未跑测试；旧文可取回 `git show fccce42:<path>` |
| 11-04 | **规划 v2.0** | 随本次 `docs:` 提交 | `docs/Persist-项目开发规划.md` 原路径重写为 v2.0：项目介绍 + 长期规划（八大页面、五项导航、原生 IndexedDB、P0–P6 / 步骤 9–15、备案前置、AI 只写文字、九章附录验收），20 章骨架保留、内容全部现状化 | 纯文档，未跑测试；v1.2 原文取回 `git show fccce42:docs/Persist-项目开发规划.md` |
| 11-04 | **步骤 9 部署** | 随本次 `chore(deploy):` 提交 | IP 直连部署：`/var/www/persist`（前端静态）+ `/opt/persist/server`（Fastify，`npm ci --omit=dev` 48 包）+ systemd `persist-server`（`User=persist`、`Restart=always`）+ `/etc/nginx/conf.d/persist.conf`（`default_server`、gzip、hashed 资源 immutable、`index.html` `no-cache`、`/api/` 反代 SSE + 300 s 超时）；新 DeepSeek Key 只写 `/etc/persist/server.env`（600） | 8 页深链 200、JS gzip 167325 B、SSE 188 事件 / 首包 0.118 s / 末包 4.215 s、`/api/report` 2.78 s、限流 429 + `Retry-After: 298`；`sk-` 扫描 0 命中（仅 env）；未改 `app/` 与 `server/` 源码，未跑单测/E2E |
| 11-04 | **晨间简报接真实模型** | `9f9cc71` | 今日页 `MorningBriefSheet` 从纯本地规则改为打开时 `POST /api/report`（`今日简报` / 7 天）；摘要构造抽成 `lib/report-digest.ts` 与报告页共用；`lib/morning-brief.ts` 负责会话缓存（按天 + 摘要指纹）、授权校验与失败分流；**未改服务端、未改 IndexedDB/备份格式、未新增 CSS** | app **168/168**（12 文件，+19）、E2E 102/0（53.5 s）、`tsc -b` 0 错、oxlint 0 错 3 条既有警告、JS **567.71 kB / gzip 169.28 kB**（+3.01 kB / +1.27 kB）、CSS 未变；生产部署后 `/` 与 `/reports` 200、JS gzip 168582 B、真实 `/api/report` 200 / 2.701 s、旧资源 404 |
| 11-04 | **lint 清理 + 再部署** | `f5a57f5` | 3 条 `react(set-state-in-effect)` 清零：新增 `lib/use-new-record-param.ts`，三个页面的 `?new=1` 深链改为「地址栏派生弹层状态 + 关闭时清参数」，所有关闭/保存/删除路径统一走 `closeXxx()`；同时删除误提交的 3 个 `app/src/pages/_write-test*.txt`；**未改服务端、未改 IndexedDB/备份格式、零样式改动** | app **172/172**（13 文件，+4）、E2E 102/0（52.9 s，深链用例扩到断言关闭后 URL 与重开）、`tsc -b` 0 错、oxlint **0 错 0 警告**、JS **567.59 kB / gzip 169.20 kB**（−0.12 kB）、CSS 未变；第三次部署后 8 页深链 200、JS gzip 168550 B、真实 `/api/report` 200 / 2.284 s、旧资源 404、sha256 三文件一致 |
| 11-04 | **步骤 11a 数据层 v2** | `6d769a7` | `schemaVersion` 1→2 + 备份 0.3.0；`MockState` 新增 `fitnessHistory` / `dietDays` / 带 `date` 的 `waterLog` 与 `planItems`；「今天」切片语义不变；v1→v2 迁移（补日期、饮食按日、完成会话归档）；`mock-data-transfer` 升级与兼容旧版 | app 单测随 11b/11c 一起复跑；`tsc -b` 0 错 |
| 11-04 | **步骤 11b 健身真实历史** | `bc4ee88` | 删除 `FitnessPage.tsx` 的 `HISTORY` 演示常量与力量专用 `HistoryExercise`；完成训练归档进 `fitnessHistory`；最近训练列表/详情读真实记录并按动作类型展示；新增 `lib/fitness-history.ts` 与 10 条单测 | `fitness-history.test.ts` 10/10；E2E 迁移断言 |
| 11-04 | **步骤 11c 报告窗口** | `12de14b` | 新增 `lib/history.ts`（`DateWindow`）与 `lib/report-window.ts`（窗口事实包）；报告页/摘要按近 7 / 30 / 90 天窗口汇总真实历史（饮食 `dietDays`、饮水真实累加、计划按日、训练归档 + 进行中会话）；今日页晨间简报保持「今天」口径不变；`/api/report` 请求体形状未变 | app **230/230**（16 文件）、E2E **102/0**（52.9 s；报告相关 22 条单跑 23.8 s）、`tsc -b` 0 错、oxlint 0 错 0 警告、JS **574.40 kB / gzip 171.26 kB**（+6.81 kB）、CSS 未变；`visual:check` 90 张生成、failures 12（全部 502 噪声）、25 张 png 待验收 |
| 11-05 | **报告页返回态修复** | `8edb8ba` | 报告页顶部「AI REPORT ENGINE」成功态原本只存在页面级 `useState`，跳转其他页面再回来或整页刷新会重置为「尚未生成」，用户误以为报告丢失；改为按「`reports[0]` 是今天生成的今日简报」派生 `generationDisplay` / `displayReport`（报告实体仍随 `reports` 走 IndexedDB，未丢失） | app **230/230**（16 文件，未动数据层）、E2E **104/0**（50.4 s；新增跨页 + 刷新用例）、`tsc -b` 0 错、oxlint 0 错 0 警告、JS **574.64 kB / gzip 171.38 kB**（+0.24 kB）、CSS 未变；`visual:check` 90 张、failures 12（502 噪声） |
| 11-05 | **学习来源随科目切换清空** | `971e1b6` | 用户反馈：新增/编辑学习记录时英语→高数，「学习来源」仍停在「百词斩」这类英语来源（候选列表和占位符已按科目换、输入框的值没换）。改为 `chooseCategory()` 在科目变化时一并把 `source` 置空，同科重复点击不清空，时长 / 日期 / 开始时间不动 | app **230/230**（16 文件，未动数据层）、E2E **106/0**（44.7 s；新增科目切换用例）、`tsc -b` 0 错、oxlint 0 错 0 警告、JS **574.67 kB / gzip 171.41 kB**（+0.04 kB）、CSS 未变 |
| 11-05 | **视觉基线双端验收 + 推送** | `5ee8d85` | 65 张 `design/*.png`（18 张真实改动 / 6 张首页日期文字 / 41 张时钟漂移）经用户桌面端 + 移动端验收确认无视觉回归后入库；随后 8 个本地提交（`bc4ee88`…`91abaeb`）推送 `origin/main`，远端与本地哈希一致 | 仅图片与文档；未改代码，app 单测 230 / E2E 106 不受影响 |
| 11-05 | **步骤 12a 数据层** | `ca02250` | 服务端 SQLite 数据层：`node:sqlite` 驱动封装（要求 Node ≥ 22.5）、migration（users / devices / 8 张实体表 + `sync_ops` / `sync_seq`）、表清单与 repository；驱动差异隔离在 `db/driver.ts` | server 112 中的 28 条（db-driver 5 / db-migrate 7 / db-repositories 16）；`tsc` 0 错 |
| 11-05 | **步骤 12b 账号与同步接口** | `6fe6b3d`（文档 `d555cb0`） | `/api/v1/devices`（注册）/ `/devices/restore` / `/devices/revoke`、`/api/v1/sync/{bootstrap,push,pull}`、设备令牌鉴权（`auth.ts` + `routes/guards.ts`）、`opId` 幂等与 `rev` 游标、删除写墓碑（`deleted_at` + 新 `rev`） | server 112 中的 26 条（devices 10 / sync 16），累计 **112/112（13 文件）** |
| 11-05 | **步骤 12c 同步契约搬 `shared/`** | `c6a65fd` | 新建 `@persist/shared`：`contract/{sync,entities,parse}.ts`；`app` / `server` 以 `file:../shared` 同源引用；新增 `npm run shared:build`（`shared/dist` 已 gitignore） | `shared` 独立 `tsc` 0 错；app / server 类型对齐、无重复定义 |
| 11-05 | **步骤 12d 客户端同步层** | `9abd8bb` | 新增 `sync-contract` / `sync-client` / `sync-store` / `sync-queue` / `sync-entities` / `sync-engine`；`persist-sync` IndexedDB（元数据 + outbox）；5 s 防抖增量、60 s 兜底轮询、`online` / `visibility` 触发；设置页开关接线 | 配套单测最终 62 条（store 13 / queue 7 / client 12 / engine 14 / entities 16，12e/12f 补齐） |
| 11-05 | **步骤 12e 设置页「数据同步」** | `f09c3da` | 设置页新增「数据同步」卡片：`aria-label="跨设备同步"` 开关（默认关，关闭时不发任何请求）、恢复码 4×8 大写、本机设备 / 最近同步 / 立即同步 / 吊销本机（二次确认）、「用恢复码绑定已有账号」与格式校验 | E2E 106→110（新增 2 条 × 2 项目）；`visual:check` 13 张 png 差异待验收 |
| 11-05 | **步骤 12f 收尾 + 文档同步** | `e9c29a0`（已推送） | pull 形状守卫 `matchesRecordShape`（形状不完整 / body id 与信封 id 不一致的实体计 `skipped`，不写坏本地存档）、本机同步验收 P4 §7.4 19/19、视觉重跑、8 篇文档同步 | app **292/292**（21 文件）、server **112/112**（13 文件）、E2E **110**、构建 JS 606.08 kB / CSS 140.20 kB；**未部署** |
| 11-05 | **视觉基线验收 + 推送** | `4d3edcf`（已推送） | 13 张 `design/*.png`（6 张设置页因新增同步卡片高度变化 / 6 张首页与 1 张快速记录仅秒级倒计时文字）经用户桌面端 + 移动端确认后入库；随后本地 10 个提交（`ca02250`…`202e9d0`）推送 `origin/main`，远端与本地一致（此后仅文档修正） | 仅图片与文档；12f 门禁数字沿用（292 / 112 / 110 / build 绿色） |
| 11-05 | **饮食照片/选图附件下线** | `fbab985`（已推送） | 用户要求「拍照和选择图片功能给删除，只能手动填写或者在 AI 热量登记时粘贴解析」：删除 `FoodEntry.photoName`、同步实体透传与旧数据回填、演示种子照片名、餐次编辑与首页快捷入口的附件行、隐私文案、失效 CSS（97 行）与相机图标；手动登记与 AI 粘贴解析保留，旧记录残留字段读取时忽略；20 张视觉基线重跑后经双端验收入库 | app 代码 31 文件 +30/−188；门禁与下一行一起复跑（最终 295 / 112） |
| 11-05 | **跨日空餐次回归修复** | `50d90ef`（已推送） | 用户双端报障：前一天有记录、第二天首次打开时「记录下一餐」点了没反应、AI 热量登记的餐次下拉选不了、确认登记不入库。根因：按日台账（12b）里 `mealsForDate(今天)` 在缺日时返回 `[]`，页面直接取 `meals[0].id` 抛 TypeError。修复：新增 `createEmptyMeals()` / `dayMeals()` 给页面四个空餐次骨架，Provider 今日切片改用它且 `setMeals` 以骨架为写入起点（否则 `patchMealsForDate` 吞掉首次写入），DietPage 加空值兜底；`mealsForDate` 仍返回 `[]`（统计口径不变），骨架只在内存、打开 App 不会凭空写空台账 | app **295/295**（21 文件，+3）、E2E **112/112**（修复当次 52.8 s、格式化后最终复跑 58.1 s，新增 `day-rollover.spec.ts` ×2 项目）、`tsc -b` 0 错、oxlint 0 错 0 警告、`prettier --check .` 通过、JS **604.31 kB / gzip 180.26 kB**、CSS **138.98 kB / gzip 23.96 kB**（格式化后重建哈希不变）、`visual:check` 15 态 90 张 `failures 12`（502 噪声，与基线一致）；双端确认修复 |
| 11-05 | **格式化收尾** | `c7cbcaa` | 饮食修复后跑全仓 `prettier --check` 发现 10 个文件不符合格式（本次改动 6 + 自 `9f9cc71` 起既有漂移 4），`prettier --write` 后实际改动 9 个文件、全仓通过；纯空白与换行改动，未改语义 | `tsc -b` 0 错、oxlint 0/0、app **295/295**、E2E **112/112**（58.1 s）、重建 `index-Diy7Ja9h.js` / `index-BNFgRy0R.css` **哈希与体积完全不变** |
| 11-05 | **步骤 13a 契约 + schema v2** | `41ed92f`（已推送） | `shared/src/contract/analysis.ts`（`ANALYSIS_REPORT_TYPE` / `ANALYSIS_RANGE_DAYS` / `ReportFactsV2` / `ANALYSIS_CONTENT_LIMITS` / 平铺的 `AnalysisReportResponse` / `ANALYSIS_ERROR_CODES` / `DATA_RETENTION` / `DEFAULT_DAILY_BRIEF_AT` + `parseDailyBriefAt` / `normalizeDailyBriefSettings`），`shared/package.json` 加 `./contract/analysis` 子路径；服务端 schema **v2**：`analysis_reports`（`UNIQUE(user_id,type,range_days,data_rev)` 做报告缓存与归档）+ `job_runs`（`UNIQUE(name,run_key)` 做 job 幂等）；`db/repositories/reports.ts`；`app/src/lib/analysis-contract.ts` 作为前端唯一入口 | `shared` 构建 0 错、server `tsc -b` 0 错；v1→v2 迁移在真实库上跑通（`/api/health` `version: 2`） |
| 11-05 | **步骤 13b 聚合与接口** | `82ed773`（已推送） | `server/src/analysis/{time,facts,metrics,rules,service}.ts` + `ai/analysis.ts`：SQL 聚合 7/30/90 天事实包（7 天只出日、30 天日出+周、90 天只出周）→ 单次模型调用 → 数字白名单校验；`POST /api/v1/analysis/reports`（`dataRev` 缓存、`force` 重新生成且**成功后才删旧缓存**、不传 `rangeDays` 默认 7）、`GET /api/v1/analysis/facts`、`GET /api/v1/reports{,/:id}`，全部 `cache-control: no-store`；独立分析限流（`ANALYSIS_RATE_LIMIT_MAX` 默认 6 / 5 分钟）；错误码 403 `ai_consent_off` / 409 `insufficient_data` / 422 `invalid_request` / 429 / 502 `invalid_response`；无 Key / 超时 / 上游错 → 200 + `origin:"rules"` + `model:null`；`pruneReports(now-365d)` 在生成时清理；`.env.example` 增 5 个变量 | server **174/174（18 文件，13d 修复后为 175/175）** 全过；临时 vitest 用例走真实 HTTP 四组全过（注册 → bootstrap 5 类记录 → 分析 200 平铺 → 同 `dataRev` `cached:true` → 归档列表/详情 → facts v2 粒度 → 规则降级 `model:null` → 白名单违规 502 不入档 → 空窗口 409 → 当日第 7 次 429（403 授权关闭由路由单测覆盖）），验收后已删除临时用例 |
| 11-05 | **步骤 13c 每日简报 + 前端** | `40d2bf4`（已推送；文档同步 `7f13727`） | 服务端 `src/jobs/daily-brief.ts`（进程内 60 s tick、`unref`、默认关闭、`runKey` = 本地日期、失败记 `failed`、下一 tick 重抢锁、读**同步上来的** `settings.payload_json.dailyBrief`、env 仅兜底、日志只记 `{reportId,origin,cached,rangeDays,runKey}`）；前端 `app/src/lib/analysis-client.ts`（四态 + 9 类错误）、`/reports` 末尾「服务端综合分析」块（窗口切换 / 生成 / 指标卡 / 来源与 `cached` 标记 / 归档列表与详情，**不写入本机 `reports`**）、设置页「每日简报」卡片（默认关闭、21:00、非法时间回退并提示）、`MockSettings.dailyBrief?`（`schemaVersion` 仍 2、备份仍 0.3.0）、`Provider` 暴露 `syncToken`；E2E 新增 `e2e/reports-analysis.spec.ts` 4 条 × 2 | app **334/334（24 文件）**、E2E **120/120（9 文件，1.2 m）**、oxlint **0/0（98 文件）**、`tsc` 0 错、`prettier --check` 通过、`vite build` JS **628.24 kB（gzip 186.67）** / CSS **145.40 kB（gzip 24.89）**；`visual:check` 90 张 + 1 张、`failures 12`（`/reports` 与 `plans-ai` 的既有 502 噪声，与基线一致），**png 已重跑但尚未提交**（等用户双端验收） |
| 11-05 | **步骤 13d 真实 Key 联调修复** | `18d5f77`（已推送） | 本机用真实 Key 联调暴露两处：模型偶尔输出 6 段（契约 2–5 段）导致直接 502；正文夹带 `daysWithAnyRecord` / `trend` 等内部标识符。改法：`MAX_CONTENT_ATTEMPTS = 2`——内容不合规时**带失败原因重试一次**（总预算 30 s，仅 `AnalysisContentError` 触发，`AnalysisFailure`/超时不重试），提示词明确「analysis 固定 3 段」「不出现英文字段名 / JSON 键名 / 内部标识符」，日简报 job 去掉外层重试（避免一次 tick 内 4 次调用模型）改为失败后下一 tick 重抢锁；新增 2 条路由单测（首次不合规重试后落库 / 两次不合规 502 且不落库）；`server/README.md` 同步响应主键 `reportId`、`force` 语义与重试口径 | server `tsc -b` 0 错、**175/175**（18 文件）、`prettier --check` 通过；真实 Key 复跑：分析 200 / 5.7 s（`origin:"ai"`、`model:"deepseek-chat"`）、同参 `cached:true` 同 `reportId`、`force` 200 / 5.4 s 新 id、列表与详情 id/标题一致、正文无英文字段名 |

### 18.2 关键披露

1. 真实 DeepSeek Key 曾出现在开发对话历史；**已于 2026-11-04 轮换**，新 Key 只写服务器 `/etc/persist/server.env`（`600`），并在服务器复扫 `/var/www/persist`、`/opt/persist/server`、journal 均无 `sk-`（仅 env 文件 1 处）。
2. `/api/chat` 与 `/api/report` **线上无账号鉴权**、无额度 / token 统计、无服务端缓存，只有按 IP 限流 20 次 / 5 分钟；步骤 12/13 的 `/api/v1/*` 有设备令牌鉴权，**且已于 2026-11-06 部署到生产**（IP 直连、仅内部调试）。
3. `/api/chat` 与 `/api/report` **共用限流器**（有意），做报告会挤占建档对话额度。
4. Nginx 反代下 SSE 与 `/api/report` 长请求**已于 2026-11-04 复验通过**：SSE 188 个事件、首包 0.118 s、末包 4.215 s 增量到达；`/api/report` 200 / 2.78 s（`proxy_read_timeout 300s`）。
5. 真实限流 / 并发只在单机单 Key 下观察过；上游会返回 503 `Service is too busy`。
6. `corrupt` / `unavailable` 只有控制台告警，**没有面向用户的回滚 Toast**（与原始完成标准有差异）。
7. ~~跨日期流程未自动化~~：8d 已让饮食 / 饮水 / 计划 / 训练按日台账累积（`schemaVersion` 2）；2026-11-05 新增 `e2e/day-rollover.spec.ts`，用「改写 IndexedDB 里持久化记录的日期」代替改系统时钟，覆盖「昨天有数据、今天首开」这一条最关键路径；其余跨多天累积仍只由单测覆盖。
8. ~~训练历史是演示常量；饮食只有「今天」、饮水无日期、计划只存当天~~ ✅ 步骤 11（8d）已全部改为按日真实历史（`6d769a7` / `bc4ee88` / `12de14b`）。新限制：历史只覆盖本机落过盘的天；演示种子只覆盖最近 7 天，因此近 30 / 90 天窗口数字与近 7 天相同。
9. 报告页仅「今日简报」走服务端，`训练建议` / `学习观察` 仍打开本地已有报告。
10. ~~3 条 `set-state-in-effect` lint 警告长期存在~~ ✅ 已于 2026-11-04 清零（`f5a57f5`）。
11. ~~契约类型暂放 `server/src/contract.ts` 而非 `shared/`~~ → 步骤 12c 已建 `@persist/shared` 承载**同步**契约；**chat / report 契约仍在 `server/src/contract.ts`**（镜像 `app/src/lib/chat-types.ts`、`report-types.ts`），迁移另排期。
12. 视觉基线易抖动：首页 1 s 实时时钟造成 ≤0.07% 像素差（最大色差 4/255），连跑两次可复现 ⇒ 归档还原、不提交；而 Prettier `{' '}` 造成的 47/255 差异是**真实回归**，须逐像素判定。
13. **步骤 12 已推送，服务端已于 2026-11-06 部署**：提交（至 `202e9d0`）与 13 张视觉基线（`4d3edcf`）均已推送，服务端现跑 Node v22.19.0（`node:sqlite`、schema 2）；但**前端同步卡片未上传**，浏览器里仍无跨设备同步。同步副本**不是备份**（无历史版本 / 无恢复），墓碑 30 天保留与定期清理是设计口径、**尚未实现**；pull 形状守卫会丢弃旧版本写下的不合规实体（计 `skipped`，不修复迁移）。
14. **跨日首开的空日语义（2026-11-05 定稿）**：`mealsForDate` 对缺日仍返回 `[]`（统计与同步口径），页面一律走 `dayMeals` 拿「四个空餐次」的可写骨架；骨架只存在于内存，打开 App 不会凭空写出一条空 `dietDays`，只有真实登记才落库。没有这层骨架时，页面直接取 `meals[0].id` 会抛 TypeError 并让整块餐次区静默失效——12b 起潜伏、2026-11-05 才被双端报障暴露（`50d90ef` 修复，并加跨日 E2E 防回归）。
15. **步骤 13 已本机完成并验证、源码与文档已推送（`41ed92f` / `82ed773` / `40d2bf4` / `7f13727` / `18d5f77` / `5ba4f7e`），服务端已于 2026-11-06 部署到生产**：13a–13d（分析契约 / schema v2 / 四个接口 / 每日简报 job / 前端综合分析块与设置卡片 / 真实 Key 联调修复）已提交，`design/*.png` 的 12 张重跑差异已随 `chore(design)` 入库。**但前端综合分析块没上传**——任何「线上浏览器里已有综合分析」的说法仍是错的，只有「`/api/v1/analysis/*` 接口可用」成立。
16. **本机已用真实 DeepSeek Key 验证三条 AI 链路（2026-11-05）**，但**只在本机**：`/api/chat` 200 / 2.4 s SSE 中文增量 + 追问、`/api/report` 200 / 3.3 s（引用当天 8/10 组与 1200 kg）、`POST /api/v1/analysis/reports` 200 / 5.7 s（`origin:"ai"`、`model:"deepseek-chat"`、正文无英文字段名）、同参 `cached:true` 同 `reportId`、`force` 200 / 5.4 s 新 id。**启动方式必须带 `--env-file`**：`npm run dev` / `start` / `node dist/index.js` 只读 `process.env`，本机写了 `server/.env` 也照样 `ai:"disabled"`。**本机结论不等于线上现状**（服务端 2026-11-06 部署后在服务器上也把三条链路各验一次，均 200）；Key 只存 `server/.env`（gitignored）与服务器 `/etc/persist/server.env`（`600 root:root`，24 键），不进脚本、文档、提交。
17. **步骤 13 的口径与未实现项**：①报告按 `dataRev`（= 服务端 `sync_seq.value`）缓存，同数据重复生成返回 `cached:true`，`force:true` **在生成成功后才删旧缓存**（失败时旧报告仍在）；②模型只写文字，正文出现的每个数字都必须在 `JSON.stringify(facts)` 里，段落数须在 2–5 段，否则**带原因重试一次**（`MAX_CONTENT_ATTEMPTS=2`、预算 30 s），仍不合规才 502 `invalid_response` 且**不入档**；③无 Key / 超时 / 上游错一律 200 + `origin:"rules"`（诚实降级，不伪装 AI），空窗口 409 `insufficient_data`，`aiConsent:false` 403 `ai_consent_off`，入参非法 422，独立限流 6 次 / 5 分钟 429；④报告保留 **365 天**，清理发生在**生成时**（`pruneReports`），不是定时任务；⑤墓碑 30 天与审计日志 30 天的**清理任务仍未实现**（设计口径）；⑥每日简报 job 默认关闭，读的是**同步上来的设置**——跨设备同步未开启 / 设置未同步时不会跑，env 仅兜底；⑦`/reports` 的前端产物已过 500 kB 警告线且 `/plans` 未拆 bundle，属已知问题。
18. **步骤 10 拆解（2026-11-06）**：步骤 10 不等于「等备案号」——备案号只卡**域名解析 / 443 证书 / HTTP→HTTPS / 页脚备案号 / 「已上线」表述**这 4 项；服务器升 Node 22 LTS、建 `/var/lib/persist`、systemd `ReadWritePaths`、每日 `VACUUM INTO` 备份、部署步骤 12/13、前端产物上传、SSH 仅密钥 + `fail2ban` **都不依赖备案号**（逐项表见 §13.3）。当日核实的服务器实况：Node 20.20.2、`persist-server` active、`ExecStart=/usr/bin/node /opt/persist/server/dist/index.js`、`ProtectSystem=full`、`/var/lib/persist` 不存在、`/var/www/persist` 为步骤 9 产物、磁盘 33 G 可用、内存可用约 1.4 G（总 1.9 G）。**上面这段实况已过时**：2026-11-06 经用户授权，服务器已并行装 `/opt/node22`（v22.19.0）、建 `/var/lib/persist`、备份 unit/timer 落地并实跑成功、后端切到 `/opt/persist-next` 的步骤 12/13（停机 482 ms）——**没有走 3100 端口预演**。现状见 §13.3「部署与复验实况」。**「前端产物仍未上传、未上线」的口径不变。**

### 18.3 不可丢失的历史教训

1. `PlansPage.tsx` 曾因 PowerShell 2 参数 `WriteAllText` 写入被截断且当时无 git 备份，靠从 `dist` 产物反解等价重写才恢复——**长文件写入必须走专用写文件路径**，不要用并行 PowerShell 重定向。
2. 视觉脚本口径固定为 `app/scripts/visual-check.mjs`：15 状态 × 6 视口（含 421×926 的 6.78 英寸 20:9 真机视口），弹窗类只截视口尺寸，快速记录浮层等待 360 ms，含「必需元素」断言，合计 91 张。
3. 措辞纪律：备案统一口径「**域名解析 / 443 / 证书 / 页脚备案号要等备案号；服务器升 Node 22 与部署步骤 12/13 不等**」（2026-11-06 更正，此前「拿到备案号才做步骤 10」的说法过粗）；不写「已经推送三次」这类会自我失效的计数；管局审核只说法定期限 20 个工作日，不承诺上线日期。
4. **响应形状要按契约读，不要凭记忆读**：步骤 13b 完成后前端第一版按 `{ report }` 包一层解析 `POST /api/v1/analysis/reports`，而服务端按契约返回**平铺**的 `AnalysisReportResponse`，结果生成成功却渲染成空态。修法不是各自打补丁，而是把「平铺 / 包一层」写进 `shared/README.md` 的响应形状约定，并补一条断言响应形状的回归测试（契约在 `@persist/shared/contract/analysis`，前后端都从它取类型）。
5. **E2E 选择器别复用刚被新块占用的类名**：步骤 13c 的 `/reports` 新增块沿用了 `.reports-kicker`，与既有块形成 strict-mode 冲突（Playwright 报多元素匹配），改为 `reports-analysis-kicker` 后 4 条用例恢复。新增 UI 块时先 grep 类名是否已被 spec 引用。

---

## 19. 接手后的建议操作顺序

1. 读本文档 → `docs/部署与服务器现状.md` → `docs/P4-数据层与AI综合分析设计方案.md` → `docs/工程约定.md`；用 `git log --oneline -5` + `git status` 确认 HEAD 与工作区状态与 §15.3 一致。
2. 复跑一遍基线（`typecheck` / `test` / 全量 E2E / `build`，受限沙箱下需一次性提权，见 §15.4），确认环境与 §10 数字一致再动手。
3. 与用户确认这一段要推进的步骤（步骤 9、11 已于 2026-11-04 完成；步骤 12 / 13 于 2026-11-05 本机完成并推送，**服务端已于 2026-11-06 部署到生产**，前端产物未上传；步骤 14a 每日备份已上线）。**2026-11-07 起的可选项**：①**上传前端产物**（步骤 10 第 8 项，`index-F8XZrWTT.js` 628242 B 已构建，需授权）；②**SSH 仅密钥 + `fail2ban` + 删 3389**（第 9–10 项，删 3389 需用户在阿里云控制台操作）；③在本地推进 **14b 恢复 / 14c 导出 / 14d 删账号**；④等备案号下发后做域名解析 / 443 / 证书 / 页脚备案号。
4. 一次只做一步：先说明计划与影响面 → 实施 → 跑验证 → 写 §0.5 的 8 段报告 → **停下等确认**。
5. 守纪律：视觉冻结不碰样式；改契约同步 `server/src/contract.ts`（chat/report）或 `shared/src/contract/*`（同步、综合分析）与前端对应类型；文档与代码同提交；每阶段独立提交并核对远端 hash（步骤 12 的提交**已推送**并核对远端哈希；步骤 13 的源码与文档已推送 `41ed92f` / `82ed773` / `40d2bf4` / `7f13727` / `18d5f77` / `5ba4f7e`，14a 为 `c6ed57e` / `7d6ef32`；12 张视觉基线 png 已随 `chore(design)` 单独入库，别和源码混在一起）。
6. 域名、443、证书与「已上线」表述必须等备案号下发；**但服务器升 Node 22、部署步骤 12/13、`/var/lib/persist` 与备份、SSH 加固都不必等**（2026-11-06 更正）。**前端产物未上传之前，任何「浏览器里已有跨设备同步 / 已有服务端综合分析」的说法都是错的**（服务端接口可用 ≠ 用户能用）；再动那台机器（Nginx / systemd / env / 安全组 / 静态包）属于生产性操作，动手前必须再拿用户明确授权，并先备份。
7. P4 的 Node 版本与 SQLite 驱动已拍板（Node ≥ 22.5 + `node:sqlite`，2026-11-05）；步骤 13 已落地，开工步骤 14 前只需逐条确认 P4 文档 §12 的备份 / 恢复 / 导出 / 删除账号口径。

---

## 20. 交接结论

Persist 当前是一个**覆盖完整日常闭环、经自动化验证的前端产品 + 已接通的 AI 服务端 + 本机跑通的同步与分析能力**：八个页面（含长期计划）可完整点击验收，AI 引导建档 → 长期计划草案 → 确认启用 → 归档/重启闭环已通，AI 建档对话、AI 报告文字与今日页晨间简报文字均可在授权 + 服务端可用时走真实 DeepSeek（失败自动回退 Mock 并如实标注），全部业务记录写入本机 IndexedDB（**训练 / 饮食 / 饮水 / 计划已按日台账落历史**，`schemaVersion` 2，刷新不丢，有清空入口与 0.3.0 导出导入；饮食不再有拍照/选图入口，只支持手填与 AI 粘贴解析），单元测试 app **334**（24 文件）+ server **197**（21 文件）、E2E **120** 次执行（9 文件）、视觉基线 91 张（13 张随 `4d3edcf`、20 张随 `fbab985` 入库；步骤 13 重跑的 12 张随 `chore(design)` 入库）、oxlint 0 错 0 警告（98 文件）。**P4 的前置步骤 11（8d 数据历史化）、步骤 12（P4a 账号 + 增量同步，12a–12f）与步骤 13（P4b 服务端聚合 + AI 综合分析，13a–13d）均已在本机完成并验收**：服务端 SQLite 数据层（schema v2）、设备令牌 / 恢复码、`/api/v1/*`、`shared/` 同步与综合分析契约、客户端同步层、设置页「数据同步」卡片、7/30/90 天事实包 + 单次模型调用 + 报告缓存与 365 天归档、规则降级与数字白名单、每日简报 job、`/reports` 综合分析块全部落地；步骤 12 P4 §7.4 验收 19/19、步骤 13 临时 HTTP 四组用例全过。**且服务端已于 2026-11-06 部署到生产**——步骤 12、13 均已推送（本地 `main` 与 `origin/main` 一致），当日把后端切到 Node v22.19.0 + `/opt/persist-next`（停机 482 ms，`db:"ok"` / `version:2`）；**但前端静态包仍是步骤 9 那版**（`index-DVS7rlR_.js`），所以页面里还看不到同步与分析。服务器已于 2026-11-04 完成 IP 直连部署与两次重新部署（Nginx + systemd + 真实 Key，仅内部调试，**未宣称上线**）；域名已购、阿里云初审通过、**备案号未下发**。P4 剩 14b 恢复 / 14c 导出 / 14d 删账号（14a 每日备份已于 2026-11-06 上线，2026-11-07 03:00:55 首次无人值守成功）；**线上还差步骤 10 第 8–10 项（前端产物上传、SSH 加固、删 3389）**。

接手时最需要记住三件事：

- **历史已真实，但只覆盖本机落过盘的天**：训练 / 饮食 / 饮水 / 计划自 8d 起按日台账落库，报告页可按近 7 / 30 / 90 天窗口汇总；但演示种子只覆盖最近 7 天，所以近 30 / 90 天数字与近 7 天相同。跨设备历史已有代码（步骤 12）且**服务端已部署**，但**前端产物未上传**，浏览器里仍要等上传后才成立。
- **下一步不是数据历史化，也不是步骤 12 / 13 的实现或部署**：三者都已完成，服务端也已于 2026-11-06 部署（Node v22.19.0）。**最短路径：①前端产物上传（`/var/www/persist` 换 `index-F8XZrWTT.js`，仍需授权）；②SSH 仅密钥 + `fail2ban` + 删 3389（后者用户控制台）；③本地推进 14b 恢复 / 14c 导出 / 14d 删账号。** 只有域名解析 / 443 / 证书 / 页脚备案号要等备案号下发。
- **口径要诚实**：AI 降级、只做了 IP 直连（**未上线**）、**后端已部署（Node v22.19.0，步骤 12/13，`/api/v1/*` 可用）但前端产物未上传**，所以浏览器里仍无跨设备同步、也无服务端综合分析、**真实 Key 已在服务器上验证 chat / report / 综合分析（只说明接口可用，不代表对外可用）**、14a 每日备份已上线但恢复 / 导出 / 删账号未做、视觉基线 12 张已入库、快照/备份与同步副本不是一回事——这些都要如实说，不得把计划或本机能力写成线上现状。
