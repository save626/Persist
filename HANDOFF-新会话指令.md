# Persist 新会话交接指令

> 生成时间：2026-11-03  
> 用途：把本文件全部内容作为新一轮会话的启动指令。  
> 权威现状：同目录 `HANDOFF.md`（本文件只讲"怎么接手"，不重复也不替代它的状态结论）。

## 0. 一句话背景

Persist 是个人自用、本地优先的「计划 → 记录 → 复盘 → AI 分析」工具。当前是一个**可完整点击验收、已通过桌面端 + 移动端视觉验收的前端 Mock 应用**：8 个页面、5 项主导航、数据全在内存（刷新即重置）、AI 是本地规则式 Mock、JSON 导出导入已是备份 0.2.0（含长期计划）。没有持久化、没有真实 DeepSeek 调用、没有 Android 包；仓库已有首个 Git 提交并推送 GitHub（`main` / `bd779eb`，262 文件 37.39 MB），具备回滚基线。

## 1. 开工前必读（按顺序，不要跳）

1. `D:\Persist\HANDOFF.md` —— 唯一现状权威。重点读 §0.1–0.4、§2、§3.1、§4.9、§8.5、§9.1、§10、§13、§15、§16、§19。
2. `D:\Persist\README.md`、`D:\Persist\app\README.md` —— 阶段、命令、页面清单、条件类名约定。
3. `D:\Persist\docs\工程初始化与前端约定.md` —— 技术选型与前端阶段顺序。
4. `D:\Persist\docs\Persist-项目开发规划.md` —— **目标态规划，不是现状**。它的 §4.2（16 条路由）、§4.3（分模块页面）大多未实现；冲突时以 HANDOFF 与源码为准。
5. 源码按序：`app\src\App.tsx` → `context\MockDataProvider.tsx` → `types.ts` → `lib\chat-types.ts` → `lib\long-term-plan.ts` → `lib\plan-draft.ts` → `lib\profile-rules.ts` → `lib\mock-data-transfer.ts` → `pages\SettingsPage.tsx` → `pages\PlansPage.tsx`。
6. 视觉对照再看 `design\home-v3-countdown.html` 与 `design\*.png`。

**跳过**：`node_modules`、`dist`、`test-results`、`.chrome-headless-*`、`design\.edge-profile*`、`Water intake record\`（368 MB 旧 Electron 工具，仅作行为参考，已在 `.gitignore`）。

## 2. 技术栈与工程结构

- React 19.3.1 + TypeScript ~6.0.3 + Vite ^8.3.4（rolldown）+ React Router ^7.18.4。
- Tailwind CSS ^4.3.3，但已验收样式是完整 CSS：`app\src\styles\home-v3.css` 为主，新增放 `persist.css` / 模块 css（如 `plans.css`）。
- 测试：Vitest ^5.0.5（单元）、Playwright ^1.64.1（desktop-chrome + mobile-chrome 两个 project）。
- 质量：Oxlint ^1.88.0、Prettier ^3.9.10 + `prettier-plugin-tailwindcss` ^0.8.1。
- Node v22.19.0。数据只存在于 React Context（`MockDataProvider`），刷新即重置。

单棵 Provider 树：`main.tsx` → `App.tsx`（`BrowserRouter` > `UIProvider` > `MockDataProvider` > `AppShell`）。

路由（只有这 8 个，未知路径回 `/`）：

```text
/ 今日   /fitness 健身   /diet 饮食   /study 学习
/reports AI 报告   /profile 档案   /plans 长期计划   /settings 设置
```

主导航固定 **5 项**：今日 / 健身 / 饮食 / 学习 / AI 报告（`components\AppShell.tsx` 的 `NAV_ITEMS`，移动端 CSS 按 5 列硬编码在 `home-v3.css`）。

## 3. 现状快照（2026-11-03 复核，之后只有 Git 操作、无代码变化）

**已完成**：8 页面可访问 + 跨模块联动；AI 报告 4 个入口（桌面侧栏、移动底栏、今日页头部、学习页"查看分析依据"）；健身自由动作/自由运动输入；完整演示数据；AI 引导建档 → 草案 → 确认启用 → 归档/重启闭环（`/plans`）；设置页 JSON 导出导入已切到备份 0.2.0（含 `longTermPlans`，兼容 0.1.0，文件名带日期，导入 toast 报记录数 + 计划数）；全站弹窗统一居中；窄屏保留档案页「AI 建档」入口；视觉基线 15 状态 × 6 视口（1440 / 500 / 430 / 421×926 / 390 / 360）已由用户桌面端与移动端验收通过。

**验证数字（2026-11-03 11:4x 实测）**：`tsc` 0 错误；单元 **112 / 112**（`complete-mock-data` 5、`chat-extract` 24、`countdown` 4、`long-term-plan` 23、`mock-data-transfer` 26、`plan-draft` 19、`profile-rules` 11）；E2E **46 条 × 2 project = 92 次执行，0 跳过 / 0 失败**（46.0s）；oxlint 0 错 / 3 警（`react(set-state-in-effect)`，在 `StudyPage.tsx`、`DietPage.tsx`、`FitnessPage.tsx`，行号会漂，按规则名找）；build 通过，`dist` 产物 JS 549.09 kB / CSS 139.92 kB；`visual:check` 15 状态 × 6 视口 = 90 张 + 快速记录 1 张，`overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`。

**未完成**：
1. **持久化未开始（步骤 6）** —— 首个 Git 提交已于 2026-11-03 完成并推送（`main` / `bd779eb` → `github.com/save626/Persist`），仓库现有回滚基线。
2. 无持久化、无真实 AI、无备份恢复、无 Android。
3. 技术债：3 条 lint 警告、既有未格式化文件、`PreviewPages.tsx:160` 遗留类名、主包超 500 kB。
4. 窄屏仍隐藏今日页「编辑计划」与健身页「训练模板」顶部按钮（均有页内入口），如需显示只需改 `home-v3.css` 的 `:not()` 列表。
5. 首个提交含 `design/` 全部 161 个文件（158 PNG + 3 HTML，36.36 MB），其中 `design/_snapshot-before-fixes/` 59 张旧快照（约 15.7 MB）在“待批准删除”清单内，暂留在历史中。

## 4. 不可回退的铁律

1. 主导航 **5 项**，不许加第 6 项；`/plans` 是二级页（档案页「AI 建档」/ 今日页「长期计划 →」/ `/plans?onboard=1` 深链进入）。
2. AI 报告必须保留 4 个入口，不能退回"只能从学习页进"。
3. Mock 必须诚实标注：长期计划页有「本地生成 · Mock 对话」，任何地方不得暗示已调用 DeepSeek。
4. 前端不得出现 API Key；后续真实 AI 只能走 `server/` 代理。
5. 用户确认前不得写档案或计划；档案写回必须经 `sanitizeProfilePatch()`，丢弃字段用一条 `' · '` 拼接的中文 toast 提示，不抛错。
6. 条件类名用 `cn()`（`lib\cn.ts`）或**完整字符串三元**（`item.done ? 'plan-item done' : 'plan-item'`）。`prettier-plugin-tailwindcss` 会把 `` `plan-item${x ? ' done' : ''}` `` 压平成 `plan-itemdone`，已导致 14 处状态样式静默失效。
7. 不要对整个仓库执行 `prettier --write`，只格式化本轮改动的文件。
8. 未获批准不得删除：`Water intake record/`、`design/_snapshot-before-fixes/`、旧 `design/` 制品、`PreviewPages.tsx`（根目录 `$null` 与 `app/$null` 两个误建垃圾文件已于 2026-11-03 经批准删除）。
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

**档案校验**（`lib\profile-rules.ts`）：`updateProfile` 本身**不做校验**，所有 UI 写入前必须 `sanitizeProfilePatch(...)`（年龄 14–100，越界丢弃并提示，绝不 throw）。

## 6. 下一步（严格按顺序，一次只做一步）

| 步骤 | 任务 | 主要文件 | 验收标准 |
|---|---|---|---|
| ~~**3**~~ ✅ | 导出导入升 0.2.0（2026-11-03 已完成） | `pages\SettingsPage.tsx` 已改调 `serializeMockBackup()` / `parseMockBackupJson()`，导入 toast 报记录数 + 计划数；round-trip 单测与导出/导入 E2E 已加 | 已达成：导出 JSON `version:'0.2.0'` 且含 `longTermPlans`；0.1.0 与 0.2.0 都能导入；单测 112 / E2E 92 全绿 |
| ~~**4**~~ ✅ | 全页面视觉复核（2026-11-03 已完成并通过用户验收） | `scripts\visual-check.mjs` 已含 `/plans` 五档状态 + 6 视口（新增 421×926）；全站弹窗居中；窄屏保留档案页「AI 建档」 | 已达成：91 张截图 + 用户桌面端与移动端明确通过 |
| ~~**5**~~ ✅ | 首个 Git 提交（2026-11-03 已完成并推送） | 删除 `$null` 垃圾文件后 `git add -A`；`.gitignore` 已排除 `Water intake record/`、`app/dist`、`test-results/` | 已达成：`main` / `bd779eb`（262 文件 37.39 MB）推送到 `github.com/save626/Persist`，远端 HEAD 与本地一致 |
| **6**（下一步） | Dexie / IndexedDB 持久化 | 建 schema/迁移，`MockDataProvider` 改持久化实现但保留 Context 契约 | 刷新/重开不丢数据（含长期计划） |
| 后续 | P3 Fastify + DeepSeek → P4 备份恢复 → P5 Capacitor Android | 见 `HANDOFF.md` §13 | 见 §13 完成标准 |

## 7. 命令与沙箱坑（2026-11-03 实测）

```powershell
cd D:\Persist\app
npm run dev -- --port 4173        # http://127.0.0.1:4173/（与 E2E / 视觉脚本同端口）
npm run typecheck                 # tsc -b（受限沙箱可跑）
npm run lint                      # oxlint（受限沙箱可跑）
npx prettier --check <files>      # 只检查改动文件
npm test                          # vitest run，112 条
npx playwright test               # 92 次执行，webServer 自动起 4173
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
git status -sb                       # ## main...origin/main
git log --oneline                    # bd779eb chore: initial commit
git remote -v                        # origin git@github.com:save626/Persist.git（SSH）
```

- 分支 `main`（由 `master` 改名），唯一提交 `bd779eb`（262 文件 / 37.39 MB），已推送且远端哈希一致；身份 `save626 / 2137153161@qq.com`。
- 认证已就绪：`ssh -T git@github.com` 返回 `Hi save626!`，HTTPS 侧另有 Git Credential Manager；**不需要**用户提供 Token/密码/私钥。
- 推送前审计：`git diff --cached --name-only` 过滤 `node_modules/|^app/dist/|test-results|playwright-report|coverage|Water intake record|\.log$|\.tsbuildinfo$`。
- 每个阶段结束提交一次（步骤 6、P3、P4、P5），禁止 `git push --force`。

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

1. 删除 `Water intake record/`（368 MB）、`design/_snapshot-before-fixes/`（59 张旧快照，约 15.7 MB，已随首个提交进入历史）、旧 `design/` 制品、`PreviewPages.tsx`（根目录 `$null` 与 `app\$null` 已于 2026-11-03 批准删除）。
2. 是否移除 `prettier-plugin-tailwindcss` 并一次性格式化既有漂移文件（会产生大 diff）。
3. 是否为今日页「编辑计划」、健身页「训练模板」恢复窄屏头部按钮（目前按设计隐藏，均有页内入口）。
4. 是否补充 Windows 防火墙入站规则以放行 4173，让手机同 Wi-Fi 直接访问（需管理员）。
5. 是否补 `.gitignore` 规则（`app/tmp-*`、`*.tmp`、`desktop.ini`、`app/dist-ssr/`、`app/.vite/`）。

## 11. 需要主动披露的历史

- `PlansPage.tsx` 曾因 2 参数 `WriteAllText` 被截断丢失（当时无 Git 备份），现版本是从 `dist` 产物反解后**等价重写**，已通过类型检查、构建与全量 E2E，但不是原始源码；该重写版已包含在首个提交 `bd779eb` 中，此后有历史可比对。
- `AppShell`、`TodayPage`、饮食/健身/学习页曾因条件类名被 Prettier 压平导致状态样式失效，已用 `cn()` 与完整字符串三元修复；再动这些文件的类名要注意回归。
- 视觉基线截图已更新到 2026-11-03（`design/`，15 状态 × 6 视口 + 快速记录 = 91 张），并经用户桌面端与移动端验收通过；更早的 2026-10-30 基线已作废。
