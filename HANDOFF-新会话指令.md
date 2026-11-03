# Persist 新会话交接指令

> 生成时间：2026-11-03（步骤 6 完成后更新）  
> 用途：把本文件全部内容作为新一轮会话的启动指令。  
> 权威现状：同目录 `HANDOFF.md`（本文件只讲"怎么接手"，不重复也不替代它的状态结论）。

## 0. 一句话背景

Persist 是个人自用、本地优先的「计划 → 记录 → 复盘 → AI 分析」工具。当前是一个**可完整点击验收、已通过桌面端 + 移动端视觉验收的前端产品原型**：8 个页面、5 项主导航、业务数据全部写入本机浏览器 IndexedDB（刷新 / 关闭标签页 / 重开浏览器不丢，含长期计划）、AI 是本地规则式 Mock、JSON 导出导入已是备份 0.2.0（含长期计划）。没有真实 DeepSeek 调用、没有服务端数据库、没有 Android 包；仓库已有两个 Git 提交并推送 GitHub（`main` / `bd779eb` + `da787c4`），具备回滚基线。

## 1. 开工前必读（按顺序，不要跳）

1. `D:\Persist\HANDOFF.md` —— 唯一现状权威。重点读 §0.1–0.4、§2、§3.1、§4.9、§6.6（持久化）、§8.5、§9.1、§10、§13、§15、§16、§19。
2. `D:\Persist\README.md`、`D:\Persist\app\README.md` —— 阶段、命令、页面清单、条件类名约定。
3. `D:\Persist\docs\工程初始化与前端约定.md` —— 技术选型与前端阶段顺序。
4. `D:\Persist\docs\Persist-项目开发规划.md` —— **目标态规划，不是现状**。它的 §4.2（16 条路由）、§4.3（分模块页面）大多未实现；冲突时以 HANDOFF 与源码为准。
5. 源码按序：`app\src\App.tsx` → `context\MockDataProvider.tsx` → `lib\persist-state.ts` → `lib\persist-storage.ts` → `types.ts` → `lib\chat-types.ts` → `lib\long-term-plan.ts` → `lib\plan-draft.ts` → `lib\profile-rules.ts` → `lib\mock-data-transfer.ts` → `pages\SettingsPage.tsx` → `pages\PlansPage.tsx`。
6. 视觉对照再看 `design\home-v3-countdown.html` 与 `design\*.png`。

**跳过**：`node_modules`、`dist`、`test-results`、`.chrome-headless-*`、`design\.edge-profile*`、`Water intake record\`（368 MB 旧 Electron 工具，仅作行为参考，已在 `.gitignore`）。

## 2. 技术栈与工程结构

- React 19.3.1 + TypeScript ~6.0.3 + Vite ^8.3.4（rolldown）+ React Router ^7.18.4。
- Tailwind CSS ^4.3.3，但已验收样式是完整 CSS：`app\src\styles\home-v3.css` 为主，新增放 `persist.css` / 模块 css（如 `plans.css`）。
- 测试：Vitest ^5.0.5（单元）、Playwright ^1.64.1（desktop-chrome + mobile-chrome 两个 project）。
- 质量：Oxlint ^1.88.0、Prettier ^3.9.10 + `prettier-plugin-tailwindcss` ^0.8.1。
- Node v22.19.0。业务数据由 React Context（`MockDataProvider`）持有，并在状态变化后 200 ms 防抖写入浏览器 IndexedDB（`persist-app` / `mock-state` / 单记录 `persist-mock-state`）；刷新与重开浏览器从 IndexedDB 水合恢复，清站点数据才会回到初始 Mock。**没有引入 Dexie**，用的是原生 IndexedDB 封装。

单棵 Provider 树：`main.tsx` → `App.tsx`（`BrowserRouter` > `UIProvider` > `MockDataProvider` > `AppShell`）。

路由（只有这 8 个，未知路径回 `/`）：

```text
/ 今日   /fitness 健身   /diet 饮食   /study 学习
/reports AI 报告   /profile 档案   /plans 长期计划   /settings 设置
```

主导航固定 **5 项**：今日 / 健身 / 饮食 / 学习 / AI 报告（`components\AppShell.tsx` 的 `NAV_ITEMS`，移动端 CSS 按 5 列硬编码在 `home-v3.css`）。

## 3. 现状快照（2026-11-03 步骤 6 完成后复核）

**已完成**：8 页面可访问 + 跨模块联动；AI 报告 4 个入口（桌面侧栏、移动底栏、今日页头部、学习页"查看分析依据"）；健身自由动作/自由运动输入；完整演示数据；AI 引导建档 → 草案 → 确认启用 → 归档/重启闭环（`/plans`）；设置页 JSON 导出导入已切到备份 0.2.0（含 `longTermPlans`，兼容 0.1.0，文件名带日期，导入 toast 报记录数 + 计划数）；**本机 IndexedDB 持久化**（13 个状态切片 + 快照写单条记录，带 `schemaVersion` 迁移与未来版本只读保护，`MockDataProvider` Context 契约不变）；全站弹窗统一居中；窄屏保留档案页「AI 建档」入口；视觉基线 15 状态 × 6 视口（1440 / 500 / 430 / 421×926 / 390 / 360）已由用户桌面端与移动端验收通过。

**验证数字（2026-11-03 步骤 6 后实测）**：`tsc` 0 错误；单元 **123 / 123 / 8 个文件**（`complete-mock-data` 5、`chat-extract` 24、`countdown` 4、`long-term-plan` 23、`mock-data-transfer` 26、`plan-draft` 19、`profile-rules` 11、**`persist-state` 11**）；E2E **49 条 × 2 project = 98 次执行，0 跳过 / 0 失败**（55.1s），新增 `e2e/persistence.spec.ts` 3 条；oxlint 0 错 / 3 警（`react(set-state-in-effect)`，在 `StudyPage.tsx`、`DietPage.tsx`、`FitnessPage.tsx`，行号会漂，按规则名找）；build 通过，`dist` 产物 JS 552.61 kB / CSS 139.92 kB；`visual:check` 15 状态 × 6 视口 = 90 张 + 快速记录 1 张，`overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`。

**未完成**：
1. **步骤 6 已提交并推送** —— 提交 `128d6a2`（`feat: 步骤 6 本机 IndexedDB 持久化`），已在 `main` 分支上推送（前两个：`bd779eb` 初始提交、`da787c4` 步骤 5 文档同步）。
2. 无真实 AI 服务端、无 P4 级别的备份恢复（JSON 导入不算可回滚恢复）、无 Android 包。
3. 持久化边界：只在本机当前浏览器有效（清站点数据 / 换浏览器 / 换设备即丢）、无跨标签页同步、无「清空本机数据」UI、读盘失败只在控制台告警、导入整体替换且不可撤销。
4. 技术债：3 条 lint 警告、既有未格式化文件（本批已处理，见铁律第 7 条）、主包超 500 kB；`PreviewPages.tsx` 及其过时文案已于 2026-11-03 删除。
5. 窄屏仍隐藏今日页「编辑计划」与健身页「训练模板」顶部按钮（均有页内入口），如需显示只需改 `home-v3.css` 的 `:not()` 列表。
6. `design/` 清理后为 94 个文件（93 PNG + `home-v3-countdown.html`，约 18.7 MB），其中 91 张是 `visual:check` 现行基线；`_snapshot-before-fixes/`（59 张）与 v1/v2 原型已删除，但仍留在 Git 历史里（`.git` 体积不变）。

## 4. 不可回退的铁律

1. 主导航 **5 项**，不许加第 6 项；`/plans` 是二级页（档案页「AI 建档」/ 今日页「长期计划 →」/ `/plans?onboard=1` 深链进入）。
2. AI 报告必须保留 4 个入口，不能退回"只能从学习页进"。
3. Mock 必须诚实标注：长期计划页有「本地生成 · Mock 对话」，任何地方不得暗示已调用 DeepSeek。
4. 前端不得出现 API Key；后续真实 AI 只能走 `server/` 代理。
5. 用户确认前不得写档案或计划；档案写回必须经 `sanitizeProfilePatch()`，丢弃字段用一条 `' · '` 拼接的中文 toast 提示，不抛错。
6. 条件类名用 `cn()`（`lib\cn.ts`）或**完整字符串三元**（`item.done ? 'plan-item done' : 'plan-item'`）。历史上的 `prettier-plugin-tailwindcss` 会把 `` `plan-item${x ? ' done' : ''}` `` 压平成 `plan-itemdone`，已导致 14 处状态样式静默失效——该插件已于 2026-11-03 从 Prettier 配置移除。
7. 不要对整个仓库执行 `prettier --write`，只格式化本轮改动的文件（批量格式化会掩盖真实改动，也让 review 变难）。
8. 删除需批准：`Water intake record/`（368 MB，2026-11-03 决定保留，作为饮水行为参照）。`design/_snapshot-before-fixes/`、旧 `design/` v1/v2 制品、`PreviewPages.tsx` 已于 2026-11-03 经批准删除（同批删除 `design/.edge-profile*/` 13.7 MB 未入库残留）。
9. **禁止** `git reset` / `git clean` / `git push --force` / 删除项目目录；任何破坏性命令先说明再执行。当前已有基线 `bd779eb`，正常回滚用 `git checkout -- <file>` / `git revert`。
10. 每完成一步就停下汇报，等用户确认后再做下一步，不要连做多步。

## 5. 关键契约（改代码前必须知道）

**ChatEvent 顺序**（`lib\chat-types.ts`）：

```text
stage('collect') → delta* → questions? → profilePatch?（一轮最多一次、非空才发）
→ stage('propose') → proposal? → warnings? → done
```

- `proposal.profilePatch` **只用于展示**；唯一写回来源是 `profilePatch` 事件，且只在用户确认后应用。
- `ChatPlanProposal.startDate/endDate` 可选：缺省=今天起、到最后一个里程碑止，草案页可编辑。

**长期计划生命周期**（`lib\long-term-plan.ts`）：`draft` →（确认）`active` →（归档）`archived` →（重新启用）`active`；同一时刻只有一个 `active`。确认顺序：`addLongTermPlan()`（标题/目标不完整返回 `null` 即中止）→ `activatePlan()`（内部 `activateLongTermPlan` 归档其它 active）→ 写档案。Provider 暴露 `addLongTermPlan` / `updateLongTermPlan` / `archiveLongTermPlan` / `activatePlan`，状态在 `longTermPlans`。

**备份格式**（`lib\mock-data-transfer.ts`）：`PERSIST_BACKUP_VERSION='0.2.0'`（L300）、`LEGACY_BACKUP_VERSION='0.1.0'`（L302）、`serializeMockBackup`（L334）、`parseMockBackupJson`（L360）、`countMockRecords`（L623）、`requireLongTermPlans`（L284）。0.2.0 才含 `longTermPlans`，导入必须兼容 0.1.0；设置页已两边接通（导出 `SettingsPage.tsx` 约 L119，导入 toast 含计划数约 L170）。

**本机持久化**（`lib\persist-state.ts` / `lib\persist-storage.ts`）：数据库 `persist-app`（版本 1）、对象仓 `mock-state`、唯一记录 `id='persist-mock-state'`，记录结构 `{ id, schemaVersion:1, savedAt, backup, snapshot }`，其中 `backup` 复用上面的 0.2.0 备份格式。`MockDataProvider` 首挂载水合（完成前 `return null`）、状态变化 200 ms 防抖写整条记录、`pagehide` / `visibilitychange` 补写、`hydrated` 之前不写盘。读盘状态有 `loaded / empty / unavailable / corrupt / unsupported-version`：不可用与损坏退回纯内存且不清数据；**未来版本记录只读不覆盖**。改 `MockDataProvider` 的状态切片时，必须同步维护 `persist-state.ts` 的 `schemaVersion` 与迁移；`clearPersistedState()` 已实现但未接 UI（留给 P4）。

**档案校验**（`lib\profile-rules.ts`）：`updateProfile` 本身**不做校验**，所有 UI 写入前必须 `sanitizeProfilePatch(...)`（年龄 14–100，越界丢弃并提示，绝不 throw）。

## 6. 下一步（严格按顺序，一次只做一步）

| 步骤 | 任务 | 主要文件 | 验收标准 |
|---|---|---|---|
| ~~**3**~~ ✅ | 导出导入升 0.2.0（2026-11-03 已完成） | `pages\SettingsPage.tsx` 已改调 `serializeMockBackup()` / `parseMockBackupJson()`，导入 toast 报记录数 + 计划数；round-trip 单测与导出/导入 E2E 已加 | 已达成：导出 JSON `version:'0.2.0'` 且含 `longTermPlans`；0.1.0 与 0.2.0 都能导入；单测与 E2E 全绿（当时 112 / 92，步骤 6 后为 123 / 98） |
| ~~**4**~~ ✅ | 全页面视觉复核（2026-11-03 已完成并通过用户验收） | `scripts\visual-check.mjs` 已含 `/plans` 五档状态 + 6 视口（新增 421×926）；全站弹窗居中；窄屏保留档案页「AI 建档」 | 已达成：91 张截图 + 用户桌面端与移动端明确通过 |
| ~~**5**~~ ✅ | 首个 Git 提交（2026-11-03 已完成并推送） | 删除 `$null` 垃圾文件后 `git add -A`；`.gitignore` 已排除 `Water intake record/`、`app/dist`、`test-results/` | 已达成：`main` / `bd779eb`（262 文件 37.39 MB）推送到 `github.com/save626/Persist`，远端 HEAD 与本地一致 |
| ~~**6**~~ ✅ | 本机 IndexedDB 持久化（2026-11-03 已完成，未提交） | 新增 `lib\persist-state.ts`（记录 / `schemaVersion` / 迁移）与 `lib\persist-storage.ts`（open / load / save / 降级）；`MockDataProvider` 水合 + 防抖落盘，Context 契约不变；`mock-data-transfer.ts` 抽出 `parseMockBackupValue()` 共用校验 | 已达成：刷新/重开不丢数据（含长期计划、设置、复盘、快照）；单测 123 / E2E 98 全绿；未来版本不被覆盖 |
| **下一步** | P3 Fastify + DeepSeek 服务端代理（未开始） | 见 `HANDOFF.md` §13 P3、§9.2 | 见 §13 P3 完成标准 |
| 后续 | P4 真实备份与恢复（含接 `clearPersistedState()` 的清空 UI）→ P5 Capacitor Android | 见 `HANDOFF.md` §13 | 见 §13 完成标准 |

## 7. 命令与沙箱坑（2026-11-03 实测）

```powershell
cd D:\Persist\app
npm run dev -- --port 4173        # http://127.0.0.1:4173/（与 E2E / 视觉脚本同端口）
npm run typecheck                 # tsc -b（受限沙箱可跑）
npm run lint                      # oxlint（受限沙箱可跑）
npx prettier --check <files>      # 只检查改动文件
npm test                          # vitest run，123 条 / 8 文件
npx playwright test               # 98 次执行，webServer 自动起 4173
npm run build                     # tsc -b && vite build
npm run visual:check              # 91 张截图到 design/
```

- `npm test`、`npm run build`、`npx playwright test`、`npm run visual:check`、`git push` / `git ls-remote` 在受限文件沙箱下都会失败（Tailwind 原生模块加载 + Vite `windowsSafeRealPathSync` / Chromium 启动触发 `spawn EPERM`，或管道限制；git 启动 `ssh.exe` 报 `couldn't create signal pipe, Win32 error 5`）→ 需要一次性提权到完整访问权限再执行；`tsc -b` / `oxlint` / `prettier` / 本地 `git add|commit|status|log` 不需要。
- Playwright 的 `webServer` 会自己拉起 4173，不要手动先启动 dev server；`visual:check` 需要 dev server 已在 4173 运行（可用 `PERSIST_URL` 覆盖）。
- 手机真机验收需 `--host 0.0.0.0`，且 Windows 防火墙要放行 4173（需管理员）；放行不了就退回 Chrome DevTools 设备模拟（自定义 421×926 / DPR 3）。
- 写文件必须用 3 参数：`[IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))`。2 参数重载会写出 24 字节的 `System.Text.UTF8Encoding` —— 本仓库已因此丢失过一次 `PlansPage.tsx`。
- `node -e` 的内联 JS 会被 PowerShell 破坏，需要脚本就写临时 `.cjs` 文件。
- 当前模型无图像输入能力：**不要假装看过截图**，视觉结论必须由用户给出。

## 7.1 Git 现状与推流（2026-11-03）

```powershell
cd D:\Persist
git status -sb                       # ## main...origin/main（干净）
git log --oneline                    # 128d6a2 步骤 6 持久化 / da787c4 步骤 5 文档同步 / bd779eb chore: initial commit
git remote -v                        # origin git@github.com:save626/Persist.git（SSH）
```

- 分支 `main`（由 `master` 改名），已有三个提交：`bd779eb`（`chore: initial commit`，262 文件 / 37.39 MB）、`da787c4`（步骤 5 文档同步）、`128d6a2`（步骤 6 本机持久化 + 文档同步），均已推送且远端哈希一致；身份 `save626 / 2137153161@qq.com`。
- **步骤 6 已于 2026-11-03 提交并推送**（`128d6a2`，41 个文件：4 新增 + 14 修改 + 23 张截图）。
- 认证已就绪：`ssh -T git@github.com` 返回 `Hi save626!`，HTTPS 侧另有 Git Credential Manager；**不需要**用户提供 Token/密码/私钥。
- 推送前审计：`git diff --cached --name-only` 过滤 `node_modules/|^app/dist/|test-results|playwright-report|coverage|Water intake record|\.log$|\.tsbuildinfo$`。
- 每个阶段结束提交一次（P3、P4、P5），禁止 `git push --force`。

## 8. 每步汇报格式（固定 8 段，中文）

1. 本次完成内容；2. 修改文件列表；3. ChatEvent / profilePatch 契约是否变化；4. 长期计划生命周期与导出导入方案；5. 实际执行的测试及结果（命令 + 数字）；6. 已知限制与未完成事项；7. 建议的下一阶段；8. 是否需要用户重新视觉验收。

## 9. 禁止事项

- 不要为"看起来完成"而伪造验证结果；没跑就写没跑。
- 不要绕过 `sanitizeProfilePatch`，不要在未确认时写档案/计划。
- 不要新增第 6 个导航项、不要把 AI 报告降级为学习页附属。
- 不要全仓 Prettier、不要用 2 参数 `WriteAllText`、不要 `git reset/clean`。
- 不要把 Mock 能力包装成真实能力，不要在前端引入密钥。
- 不要用文件修改时间或旧聊天记录推断进度 —— 以 HANDOFF §2/§10 的实测数据与当前代码为准。

## 10. 待用户决策（未批准前不要动）

1. ~~删除 `design/_snapshot-before-fixes/`、旧 `design/` 制品、`PreviewPages.tsx`~~ —— 已于 2026-11-03 批准执行（`chore:` 清理提交，同时补 `.gitignore`、删未入库的 `design/.edge-profile*/`）。**`Water intake record/`（368 MB）经分析决定保留**：未入库、不影响仓库体积，是饮水缺口/杯量/跨天重置的唯一行为参照，等饮水被真实数据取代后再删。
2. 是否移除 `prettier-plugin-tailwindcss` 并一次性格式化既有漂移文件 —— 已批准执行（插件从配置移除，见下方第 5 条与 `HANDOFF.md` §18）。
3. 是否为今日页「编辑计划」、健身页「训练模板」恢复窄屏头部按钮（目前按设计隐藏，均有页内入口）—— 建议不做，等待真机使用反馈。
4. 是否补充 Windows 防火墙入站规则以放行 4173，让手机同 Wi-Fi 直接访问（需管理员）—— 暂缓到真机验收或 P5 Capacitor 联调时。
5. ~~是否补 `.gitignore` 规则~~ —— 已于 2026-11-03 补齐（`app/dist-ssr/`、`app/.vite/`、`desktop.ini`、`app/tmp-*`、`*.tmp`）。
6. ~~是否现在提交并推送步骤 6 的改动~~ —— 已于 2026-11-03 提交 `128d6a2` 并推送，此项关闭。
7. 是否在 P3 之前先接一个「清空本机数据」入口（`clearPersistedState()` 已实现但未接 UI）—— 结论：**提前到 P3 之前做**，因为它让 P3 能快速回到干净状态测试真实 AI 与 Mock 的切换；实现时注意顺序 `清空 IndexedDB → 重置内存态 → 保持 hydrated`，并同时清 `snapshot`，否则 200 ms 防抖会把旧数据写回。

## 11. 需要主动披露的历史

- `PlansPage.tsx` 曾因 2 参数 `WriteAllText` 被截断丢失（当时无 Git 备份），现版本是从 `dist` 产物反解后**等价重写**，已通过类型检查、构建与全量 E2E，但不是原始源码；该重写版已包含在首个提交 `bd779eb` 中，此后有历史可比对。
- `AppShell`、`TodayPage`、饮食/健身/学习页曾因条件类名被 Prettier 压平导致状态样式失效，已用 `cn()` 与完整字符串三元修复；再动这些文件的类名要注意回归。
- 视觉基线截图已更新到 2026-11-03（`design/`，15 状态 × 6 视口 + 快速记录 = 91 张），并经用户桌面端与移动端验收通过；更早的 2026-10-30 基线已作废。
- 步骤 6 交付的是**浏览器本机持久化**，不是"数据安全"：清除站点数据、换浏览器、换设备、无痕模式都会丢；也没有「清空本机数据」入口。不要在交接或对外说明中把它说成服务端存储或云同步。
- 持久化没有引入 Dexie（原计划写的是 Dexie / IndexedDB），理由是沙箱内 `npm install` 受缓存路径 EPERM 限制、当前只有单用户单记录场景；这是对原计划的主动偏离，已在 `HANDOFF.md` §13 P2 与 §6.6 记录。
