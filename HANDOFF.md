# Persist 项目完整交接文档

> 文档日期：2026-11-03（11:50 更新：步骤 3、步骤 4 已完成并经用户桌面端 + 移动端验收；下一步为步骤 5 首个 Git 提交）  
> 工作区：`D:\Persist`  
> 应用目录：`D:\Persist\app`  
> 当前阶段：**八个页面（含 `/plans` 长期计划页）与既有 Mock 交互已完成；AI 引导建档 → 长期计划草案 → 确认启用 → 归档/重启的页面闭环已打通；设置页 JSON 导出导入已切到备份 0.2.0（含 `longTermPlans`，兼容 0.1.0 旧备份）；全页面视觉复核已完成 15 个状态 × 6 个视口（含 20:9 真机视口 421×926），全站弹窗统一居中且档案页「AI 建档」在窄屏可见；单元 112 条、E2E 92 次执行全部通过。下一步顺序见 §0.4：步骤 5 首个 Git 提交 → 步骤 6 P2 持久化。真实持久化、服务端 AI、备份恢复和 Android 发布尚未开始。**  
> 本地验收地址：`http://127.0.0.1:4173/`（`cd app` 后 `npm run dev -- --port 4173`；需要手机访问时加 `--host 0.0.0.0`，见第 11 节）  
> 当前技术形态：React SPA + 内存 Mock 数据 + 本地 Mock 报告 + 本地规则式（Mock）对话引擎 + 长期计划领域模型  
> 本文档地位：当前代码实现优先于旧版规划文档；如文档与代码冲突，以 `D:\Persist\app` 中的实现为准。

---

## 0. 一页交接摘要

### 0.1 现在是什么状态

Persist 目前已经是一个可完整点击验收的前端高保真 Mock 应用：

- 八个页面均可访问：今日、健身、饮食、学习、个人档案、AI 报告、设置、长期计划（`/plans`）。
- 主导航已按要求调整为五项：**今日 / 健身 / 饮食 / 学习 / AI 报告**；长期计划从档案页「AI 建档」入口与今日页的计划区进入。
- AI 报告可从桌面主导航、移动底部导航、今日页头部和学习页分析依据入口进入，不再依赖学习板块作为唯一入口。
- 健身动作名称可以自由输入，也可记录跑步、跳绳、骑行、足球、爬山等非专业训练、非力量运动。
- 今日、健身、饮食、学习、档案、AI 报告、设置和长期计划之间存在当前会话内的跨页面数据联动。
- 已提供一份完整演示数据，可覆盖主要 Mock 交互和跨模块分析流程。
- AI 引导建档闭环已可用：中文自由描述 → 规则提取档案字段 → 最多两次追问 → 计划草案（周目标 / 里程碑 / 假设 / 冲突警告）→ 用户确认 → 写回档案并启用长期计划，旧计划自动归档。
- 自动化验证已通过：类型检查、112 个单元测试、46 条 Playwright 用例 × 2 个项目 = 92 次执行全部通过（0 跳过）、生产构建（JS 549.09 kB / CSS 139.92 kB）。
- 已通过用户桌面端与移动端视觉验收（2026-11-03）：八个页面与全部弹窗在 1440 / 500 / 430 / 421 / 390 / 360 六个视口下无横向溢出、弹窗统一居中，基线截图见 `design/`（15 状态 × 6 视口 + 快速记录浮层 = 91 张）。

### 0.2 现在不是什么状态

以下内容尚未实现，不能误认为已经具备生产能力：

- 刷新页面不会保留用户修改，数据会恢复初始 Mock。
- 没有 IndexedDB、SQLite、LocalStorage 或服务端数据库持久化。
- 没有登录、账号、同步、多设备或冲突处理。
- 没有真实 DeepSeek 调用；AI 报告是前端 Mock 内容和本地拼装。
- 没有真实服务端 API、鉴权、限流、缓存、日志和密钥管理。
- 没有真实快照恢复；当前“快照”仅记录生成时间和记录数量。
- 没有 Capacitor Android 工程，也没有 APK 或真机测试。
- 提醒只在界面中配置，不会触发系统通知。
- 饮食照片只保存文件名 Mock，不上传、不识别、不持久化。
- 健身“最近训练历史”仍是力量训练专用结构，自由运动联动覆盖当前会话、今日页和报告，历史详情尚未全面通用化。
- 长期计划与其它 Mock 数据一样没有持久化，刷新后恢复初始 Mock；JSON 备份只能手动导出/导入文件（含长期计划），不会自动保存，也没有“从备份恢复”按钮。
- AI 建档是本地规则引擎（Mock），不是 DeepSeek；真实服务端仍属于后续阶段。

### 0.3 优先事项摘要（详细执行计划见 §0.4）

1. **步骤 5：建立首个 Git 提交**（当前仓库仍 0 commit、全部文件未跟踪；先在 GitHub 建空仓，不要勾 README / .gitignore 模板，否则首推冲突）。
2. 接入 Dexie / IndexedDB，完成刷新后持久化、数据迁移和异常回滚。
3. 实现 Fastify 服务端 AI 代理、DeepSeek 接入和安全边界。
4. 实现真实备份、快照恢复和空安装恢复。
5. 进入 Capacitor Android 打包和真机验证。
6. 清理 lint 警告、路由分包、清理 Prettier 工具链隐患并补足纯业务单元测试。

### 0.4 下一步执行计划（2026-11-03 起，按此顺序做）

| 步骤 | 目标 | 主要改动 | 验收标准 |
|---|---|---|---|
| **步骤 3** ✅ 已完成（2026-11-03） | JSON 导出导入升到备份 0.2.0 | `SettingsPage.exportMockData()` 已改调 `serializeMockBackup()`；文件名带日期；导入 toast 显示计划数；`mock-data-transfer.test.ts` 加 round-trip；`mock-data-flows.spec.ts` 覆盖导出/导入 | 导出 JSON `version: '0.2.0'` 且含 `longTermPlans`；0.1.0 与 0.2.0 备份都能导入；单测 112 条 + E2E 92 次执行全绿 |
| **步骤 4** ✅ 已完成（2026-11-03） | 全页面视觉复核 | `scripts/visual-check.mjs` 已纳入 `/plans` 空态 / 进行中 / 草案 / AI 对话 / 确认弹窗；视口 1440/500/430/421/390/360；全站弹窗统一居中；窄屏保留档案页「AI 建档」入口 | 已产出 91 张截图并由用户桌面端 + 移动端明确通过 |
| **步骤 5** | 建立首个 Git 提交 | 先处理待删文件（`$null`、旧 design 制品）再 `git add`；确认 `Water intake record/`(368 MB) 与 `app/dist` 已被 `.gitignore` 排除 | 仓库有可回滚基线（当前 **0 commit**，已因无备份丢过一次源码） |
| **步骤 6** | P2 Dexie / IndexedDB 持久化 | 建 schema 与迁移，`MockDataProvider` 改为持久化实现但保留 Context 契约 | 刷新/重开页面数据不丢，含长期计划 |
| **后续** | P3 Fastify + DeepSeek → P4 备份恢复 → P5 Android | 见 §13 | 见 §13 对应完成标准 |

步骤 3、步骤 4 已于 2026-11-03 完成并经用户桌面端与移动端验收通过。步骤 5 的前置条件是：在 GitHub 建**空仓**（不勾 README / .gitignore / license 模板），并按 §14.2 与本文档「待批准删除清单」清理（至少删掉根目录误建的 `$null` 与 `app/$null` 垃圾文件），否则容易把大文件或垃圾文件提交进仓库。步骤 6 需要一次 Playwright / vitest 提权执行（沙箱下 `spawn EPERM`，方法见 §15.4）。

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
| 今日计划可创建、调整、完成 | 前端 Mock 已完成 | 刷新会重置 |
| 健身/饮食/饮水/学习可记录 | 前端 Mock 已完成 | 当前会话内可跨页联动 |
| 关闭并重新打开后数据仍存在 | 未开始 | 需要 IndexedDB 等持久化 |
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
| Phase 1 | 八页面（含 `/plans`）、响应式应用壳、视觉体系 | 基本完成，等待用户最终视觉验收 |
| Phase 2 | 今日页 Mock 交互 | 已完成 |
| Phase 3 | 健身页 Mock 交互与自由运动 | 已完成 |
| Phase 4 | 饮食、营养与饮水 Mock 交互 | 已完成 |
| Phase 5 | 学习页 Mock 交互 | 已完成 |
| Phase 6 | 个人档案与 AI 报告前端 Mock | 已完成 |
| Phase 7 | JSON/CSV、演示数据、快照 UI | 已完成前端 Mock |
| 当前增量 | AI 引导建档、长期计划页面、草案确认、归档/重启、周进度 | 页面闭环、单元测试与 E2E 已完成（P1 全部完成） |
| 下一阶段 A | P1 收尾：JSON 导出导入迁移到 0.2.0 + 全页面视觉复核 | ✅ 已完成（2026-11-03，用户桌面端 + 移动端验收通过） |
| 下一阶段 A2 | 首个 Git 提交（建立可回滚基线） | 下一步 |
| 下一阶段 B | Dexie / IndexedDB 本地持久化 | 未开始 |
| 下一阶段 C | Fastify + DeepSeek 服务端代理 | 未开始 |
| 下一阶段 D | 服务端备份、校验与恢复 | 未开始 |
| 下一阶段 E | Capacitor / Android 发布 | 未开始 |
| 后续 | 高级统计、同步、照片识别、外部数据接入 | 未开始 |

### 2.2 完成度矩阵

| 模块 | 页面 | Mock 交互 | 跨模块联动 | 持久化 | 自动化验证 |
|---|---|---|---|---|---|
| 今日 | 已完成 | 已完成 | 已完成 | 无 | 已覆盖 |
| 健身 | 已完成 | 已完成 | 已完成 | 无 | 已覆盖 |
| 饮食 | 已完成 | 已完成 | 已完成 | 无 | 已覆盖 |
| 学习 | 已完成 | 已完成 | 已完成 | 无 | 已覆盖 |
| 个人档案 | 已完成 | 已完成 | 已完成 | 无 | 已覆盖 |
| AI 报告 | 已完成 | Mock 已完成 | 已完成 | 无 | 已覆盖 |
| 设置 | 已完成 | Mock 已完成 | 已完成 | 无 | 已覆盖 |
| 长期计划 | 已完成（`/plans`） | 已完成（含 AI 建档对话） | 已完成 | 无 | 已覆盖 |
| 服务端 | 只有 README | 无 | 无 | 无 | 无 |
| Android | 未开始 | 无 | 无 | 无 | 无 |

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

- 计划编辑后当前 SPA 会话内保持。
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

- 照片只保存文件名元数据，不上传、不识别、不持久化。
- 外部 AI 营养文本解析发生在浏览器本地，不是调用 DeepSeek。
- 饮水总量由 `1200 ml` 初始基线和 `waterLog` 增量组成；持久化改造时必须重新确认这一产品语义，避免每次启动重复叠加基线。

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
- 刷新页面后所有设置也回到初始状态。

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
- `D:\Persist\app\src\lib\chat-extract.ts`
- `D:\Persist\app\src\lib\mock-chat-client.ts`
- `D:\Persist\app\src\lib\long-term-plan.ts`
- `D:\Persist\app\src\lib\plan-draft.ts`
- `D:\Persist\app\src\lib\profile-rules.ts`
- 测试：`chat-extract.test.ts`(24)、`long-term-plan.test.ts`(23)、`plan-draft.test.ts`(19)、`profile-rules.test.ts`(11)、`e2e\plans.spec.ts`(4)

已完成的能力：

- 从中文自由描述中提取年龄、身高、体重、目标体重、健身目标、训练经验、频率、器械、饮食偏好、过敏、睡眠、压力等档案字段；不凭空补全未提到的字段。
- 对越界数值进行过滤（`profile-rules.ts` 统一规则：年龄 14–100 等），越界字段丢弃并通过一条非阻塞 toast 提示，从不抛错、不中断对话。
- 缺失关键信息时最多追问两个问题，支持已问字段去重。
- 识别目标与体重、训练频率与睡眠等冲突并给出警告。
- 根据目标和频率生成周目标、阶段里程碑、假设和高亮摘要。
- 定义并实现 `ChatClient` / `ChatEvent` 流式契约（`stage → delta* → questions? → profilePatch? → stage('propose') → proposal? → warnings? → done`）。
- 提供本地 Mock 对话客户端，标签明确为「本地生成 · Mock 对话」，不联网、前端无 API Key。
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
- 没有持久化：刷新后长期计划与档案修改都会恢复初始 Mock。
- 饮食周进度目前固定为 0；健身只按当前单个会话估算，不能当成真实周期统计。
- Mock 对话不是 DeepSeek；真实服务端接入仍属于 P3。

重要产品边界：

- 这是“结构化引导对话”，不是开放式聊天机器人。
- 草案必须先展示再确认，不能自动修改档案或计划。
- 长期计划不进入主导航（导航固定五项），只能从档案页、今日页与 `/plans` 进入。
- 页面必须始终诚实标注「本地生成 · Mock 对话」，接入真实服务端前不得宣称已使用 DeepSeek。

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
| 格式化 | Prettier + Tailwind 插件 |
| 当前数据层 | React Context 内存状态 |
| 当前后端 | 未实现 |
| 当前共享层 | 未实现 |

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
│     ├─ lib/             健身统计、导入导出、对话解析、长期计划
│     ├─ pages/           八个业务页面（含 plans）
│     ├─ styles/          分模块样式
│     └─ test/            测试初始化
├─ design/                视觉原型与截图
├─ docs/                  产品规划与工程文档
├─ server/                服务端占位，目前只有 README
└─ shared/                共享层占位，目前只有 README
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
- `MockDataProvider` 管理全部业务 Mock 状态。
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
2. 全页刷新会恢复初始数据，动态联动结果也会丢失。
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

它只是界面状态和记录计数，不具备恢复能力，也不是备份文件。不得在交接或产品说明中将其描述为真实备份。

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

已记录的剩余缺口（P2 之后再做）：导入预览、差异确认与回滚；真实快照恢复与空安装恢复。

---
## 9. AI 能力现状与目标边界

### 9.1 当前真实情况

- 报告生成是前端 Mock。
- AI 引导建档同样是前端本地规则引擎（`chat-extract.ts` + `mock-chat-client.ts`），没有模型调用。
- 没有调用 DeepSeek。
- 没有网络请求。
- 没有真实 AI Token、费用、延迟和错误日志。
- 报告结论由 Mock 数据和本地文案模板组成。
- 失败状态是模拟 UI，不是实际服务错误。
- “Mock 连接测试”不代表服务端已可用。
- 页面必须保持「本地生成 · Mock 对话」「未调用 DeepSeek」这类诚实标注。

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
| 类型检查 | `npm run typecheck` | 通过，0 错误（2026-11-03 复跑） |
| 单元测试 | `npm test` | **112/112 通过，7 个测试文件**，4.15s（2026-11-03 复跑） |
| 端到端测试 | `npx playwright test` | **92 通过 / 0 跳过 / 0 失败**，46 个用例 × 2 个项目 = 92 次执行，46.0s（2026-11-03 复跑） |
| Lint | `npm run lint` | 0 错误，3 条既有 `react(set-state-in-effect)` 警告（`StudyPage.tsx` / `DietPage.tsx` / `FitnessPage.tsx`，2026-11-03 复跑） |
| 格式检查 | `npx prettier --check <本次改动文件>` | 通过；全仓仍有既有未格式化文件（见 14.2） |
| 生产构建 | `npm run build` | 通过（`index-NOS18Onn.js` 549.09 kB / gzip 162.11 kB，CSS 139.92 kB / gzip 24.11 kB） |
| 视觉检查 | `npm run visual:check` | **通过**：15 个状态 × 6 个视口 = 90 张 + 快速记录 1 张 = 91 张；overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0（2026-11-03 复跑） |

Playwright 配置为两个项目：

- `desktop-chrome`
- `mobile-chrome`（Pixel 7，`isMobile: true`）

共 46 个用例 × 2 个项目 = 92 次执行，**0 跳过**。原先 `plans.spec.ts` 中「档案页 AI 建档入口」在移动端被 `test.skip(isMobile)` 跳过，原因是该按钮在 ≤900px 被全局隐藏规则一并向隐藏；现已给按钮加 `profile-onboard-action` 并从隐藏规则豁免，移动端同样真实点击验证，测试不再跳过。

### 10.2 测试文件与覆盖主题

| 文件 | 用例数 | 覆盖内容 |
|---|---:|---|
| `app\e2e\smoke.spec.ts` | 21 | 导航、今日、健身、饮食、学习、档案、设置、报告、移动溢出 |
| `app\e2e\mock-flows.spec.ts` | 8 | 学习/餐食/健身/档案/授权/复盘跨页保持，报告数据源联动 |
| `app\e2e\mock-data-flows.spec.ts` | 8 | 简报历史、周期、饮水 KPI、快照、JSON 导出/导入、CSV、非法导入 |
| `app\e2e\plans.spec.ts` | 4 | 档案页 AI 建档入口深链（桌面 + 移动）、AI 建档对话→确认启用→写回档案、手工新建→归档→重新启用、360px 无横向溢出 |
| `app\e2e\complete-mock-data.spec.ts` | 3 | 完整演示数据覆盖全部主模块、报告数据源和建议应用 |
| `app\e2e\fitness-freeform.spec.ts` | 2 | 自由距离/时长运动跨页联动，旧 JSON 兼容与非法数据拒绝 |
| `app\src\lib\mock-data-transfer.test.ts` | 26 | 0.2.0 序列化、round-trip、0.1.0 兼容、longTermPlans 校验、计数、CSV |
| `app\src\lib\chat-extract.test.ts` | 24 | 中文档案字段提取、追问、冲突、计划草案、Mock 流式事件和中断 |
| `app\src\lib\long-term-plan.test.ts` | 23 | 长期计划校验、周范围、周进度、整体进度和估算完成量 |
| `app\src\lib\plan-draft.test.ts` | 19 | 草案 ↔ 计划互转、标题/日期/周目标校验文案、档案补丁展示 |
| `app\src\lib\profile-rules.test.ts` | 11 | 年龄等越界字段过滤、空补丁、丢弃字段提示 |
| `app\src\data\complete-mock-data.test.ts` | 5 | 完整演示数据结构和跨模块引用 |
| `app\src\lib\countdown.test.ts` | 4 | 倒计时边界和格式化 |

### 10.3 最新构建产物

```text
dist/index.html                  0.61 kB
dist/assets/index-DBVxLcSp.css  139.92 kB（gzip 24.11 kB）
dist/assets/index-NOS18Onn.js   549.09 kB（gzip 162.11 kB）
```

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

最后一次完整视觉检查时间为 **2026-11-03 11:4x**（`states 15 / screenshots 90 / overflow 0 / consoleErrors 0 / missingDialogs 0 / missingElements 0 / failures 0`），随后由用户在桌面端与移动端（Chrome DevTools 421×926 设备模拟）明确验收通过，前端视觉范围就此冻结。全站弹窗已统一居中（`surface.css` + `home-v3.css` 的 `.backdrop` / `.sheet` 改为 `align-items: center`，窄屏 sheet 用 `width: min(100%, 580px)` + `max-height: calc(100dvh - 36px)` + 内部滚动）。

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

2026-11-03 验收时开发服务一直在 4173 运行，用户在桌面端与该设备模拟下完成验收（会话内数据不持久化，刷新即回初始 Mock）。

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

如果只启动了 5173，可指定：

```powershell
$env:PERSIST_URL = 'http://127.0.0.1:5173'
npm run visual:check
```

### 11.4 测试注意事项

- 不要用刷新页面验证动态记录是否保留。
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
- [ ] 清空设置不会误导为删除全部业务数据。

### 12.7 长期计划（`/plans`）

- [ ] 档案页「AI 建档」可打开对话（窄屏同样可见，见 12.10）。
- [ ] 对话流式文本、追问选项、停止生成正常。
- [ ] 草案表可修改标题、目标、起止日期、每周目标；非法值给中文提示而不是崩溃。
- [ ] 未确认前档案与长期计划都不发生变化。
- [ ] 确认后 toast 提示「已启用长期计划」，`/plans` 显示「进行中」。
- [ ] 写回档案的字段与对话内容一致；越界字段有丢弃提示。
- [ ] 手工新建 → 归档 → 重新启用全流程可用。
- [ ] 同一时间只有一个「进行中」计划，旧计划出现在归档列表。
- [ ] 页面明确标注「本地生成 · Mock 对话」。
- [ ] 360px 下草案行与操作按钮不溢出，操作区换行后左对齐。
- [ ] 刷新后计划恢复初始 Mock（当前会话内不持久化，属既定行为）。

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

P1（AI 引导建档 + 导出导入 0.2.0 + 全页面视觉复核）**已全部完成并冻结**，不再有收尾项；下一阶段按 §0.4 步骤 5（首个 Git 提交）与步骤 6（P2 持久化）推进。

完成标准：

- 用户可以通过自然语言完成一版可执行计划草案。
- 未确认前不会修改档案或计划。
- 确认后档案与长期计划正确更新。
- 页面明确显示「本地生成 · Mock 对话」。
- 长期计划能通过 JSON 导出导入，旧 0.1.0 备份可兼容导入。
- 新流程有 E2E、单元测试和移动端视觉验证。

### P2：本地持久化（完成 AI 建档后）


目标：

- 用 Dexie / IndexedDB 替换纯内存状态。
- 刷新、关闭标签页和重新打开后保留记录。
- 保持现有页面和 Context 调用方式尽量稳定。

建议工作：

1. 建立数据库 schema、版本和迁移机制。
2. 为 goals、planItems、waterLog、studyRecords、meals、fitnessSession、profile、settings、consent、eveningReview、reports、longTermPlans 建立仓储接口。
3. 将 `MockDataProvider` 逐步改为持久化 Provider，但保留现有 context contract，减少页面改动。
4. 处理每日数据边界：今日计划、饮水、训练会话、复盘与历史记录的切换规则。
5. 明确 1200 ml 饮水基线的真实语义。
6. 增加首次使用、空数据库、升级迁移和异常回滚。
7. 增加刷新后恢复、跨日期、导入后恢复和清空数据测试。
8. 保留“加载完整演示数据”为显式开发/演示操作，不能自动污染真实数据。

完成标准：

- 创建记录后刷新仍存在。
- 关闭浏览器后重新打开仍存在。
- 旧 Mock JSON 能迁移为持久化数据。
- 数据库异常时可回滚并提示，不静默丢数据。
- 自动化覆盖至少一条刷新后持久化和一条跨日期流程。

### P3：服务端 AI 代理

目标：

- 在 `server/` 实现 Fastify 服务。
- 接入 DeepSeek，前端不再生成 Mock 报告，并复用 `ChatClient` 流式契约实现真实 AI 建档与计划建议。

建议工作：

1. 定义 AI 请求/响应 schema。
2. 仅允许授权数据源进入请求。
3. 服务端保存 API Key。
4. 增加鉴权、限流、超时、缓存和重试上限。
5. 增加结构化响应校验与失败降级。
6. 日志脱敏，不记录完整敏感档案。
7. 前端接入加载、成功、失败、重试和取消状态。
8. 报告生成后仍由用户确认是否写入计划。

完成标准：

- 前端构建产物和 Android 包中没有 API Key。
- 未授权数据源不会发送。
- 服务端超时/错误不阻塞记录功能。
- 返回内容通过 schema 校验。
- 报告可追溯数据范围但不泄露敏感原文。

### P4：真实备份与恢复

目标：

- 将当前“内存快照”升级为可验证的备份恢复系统。

建议工作：

- 服务端 SQLite 或等价存储。
- 自动/手动快照。
- 校验和、schema 版本、导出时间。
- 恢复预览和差异提示。
- 空安装恢复完整数据。
- 备份失败不影响主数据记录。
- 恢复失败可回滚。

完成标准：

- 能从空数据库恢复完整数据。
- 损坏备份不会覆盖当前数据。
- 备份和恢复有可操作错误提示。
- 至少覆盖一次真实完整闭环。

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
- 评估移除 `prettier-plugin-tailwindcss` 并把条件类名统一为 `cn()`/完整字符串三元，随后一次性解决 15 个既有格式漂移文件。
- 将健身历史升级为通用 `WorkoutSet`。
- 补充纯业务单元测试：健身汇总、饮水边界、学习统计、报告数据源、导入导出。
- 将可复用类型和纯函数逐步迁移到 `shared/`。
- 评估无障碍、键盘导航和焦点管理。

---

## 14. 当前风险、限制与技术债

### 14.1 高优先级风险

| 风险 | 影响 | 建议 |
|---|---|---|
| 全部数据只在内存 | 刷新丢失，不能称为真实产品 | AI 建档闭环后接 IndexedDB |
| 旧规划与现状不一致 | 新接手者可能误删 AI 主入口、回退五项导航或按 16 条旧路由找页面 | 以本文档和当前代码为准；规划文档已加现状标注 |
| `PlansPage.tsx` 是等价重写而非原始源码 | 该页曾因写入事故丢失，当前由 dist 产物反解后重写，虽已通过全量验证，但不排除丢注释/丢少量细节 | 后续该页改动请先读现状再改；首个 git 提交务必包含它 |
| Prettier 插件会压平条件类名 | 一旦全仓 `prettier --write`，`plan-itemdone` 类缺陷会批量复发，状态样式静默失效 | 条件类名统一用 `cn()` 或完整字符串三元；移除 `prettier-plugin-tailwindcss` 需用户同意 |
| “快照”容易被误解 | 用户可能以为可以恢复数据 | UI 和文档明确其只是元信息 |
| 饮水 1200 ml 基线语义不明 | 持久化后可能重复累计 | 在接数据库前确认产品规则 |
| 无 Git 提交基线 | 难以回滚和审计（本轮已因无备份丢失过一次源码） | 视觉验收后尽快建立首个提交 |
| 无真实 AI/服务端 | 报告与建档分析不具备真实 AI 能力 | 不要对外宣称已经接入 DeepSeek |
| 无 Android 工程 | 尚未达到可安装目标 | 持久化和服务端接口稳定后再打包 |

### 14.2 中低优先级技术债

- 健身历史详情仍为力量专用结构。
- 主 JS 包超过 500 kB（`/plans` 可优先拆为懒加载路由）。
- 3 条 lint 警告未清理。
- 饮食照片没有真实存储。
- 提醒没有系统通知能力。
- 当前报告周期和统计口径仍有 Mock 成分。
- 没有端到端覆盖浏览器刷新后的真实持久化，因为持久化尚不存在。
- 页面内弹层较多，未来若要 deep link 或恢复操作状态，需要补 URL 状态设计（目前只有 `/plans?onboard=1`）。
- `PreviewPages.tsx` 是未接入当前路由的预览页面，不应在交接期间改动（其 L160 仍有一处被压平的类名，属已知遗留）。
- 仓库当前没有任何提交，几乎全部文件为未跟踪状态。
- 15 个既有文件未通过 `prettier --check`（EvidenceSheet、QuickRecordSheet、TodaySheets、ReportsPage、`src/data` 部分文件、`src/lib/fitness.ts`、6 个 CSS），mtime 均为 10-27～10-30，非本轮引入；批量格式化需先解决插件压平问题。

### 14.3 不应误判为缺陷的既定行为

- SPA 导航时数据保留。
- 全页刷新后数据恢复初始 Mock。
- AI 报告显示 Mock 标识。
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
- **不要修改** `D:\Persist\app\src\pages\PreviewPages.tsx`，除非用户明确要求。
- **不要**全仓库执行格式化：`prettier-plugin-tailwindcss` 会把条件拼接的类名字符串压平成 `plan-itemdone` 这类错误值，导致状态样式静默失效。只格式化你本轮真正改过的文件，并在格式化后用 `Select-String` 复查条件类名。

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

交接时：

- 当前分支：`master`。
- 仓库没有任何提交。
- `git status` 显示大量未跟踪文件。
- 因此没有可靠的历史基线可用于 reset 回滚。

建议视觉验收通过后，先提交一个清晰的前端 Mock 基线，再开始持久化改造。提交前需确认是否包含截图、构建产物和本地环境文件。

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

- `npm test`、`npm run build`、`npx playwright test`、`npm run visual:check` 在受限文件沙箱下都会失败：Tailwind 原生模块加载报 `UNLOADABLE_DEPENDENCY`，Vite 的 `windowsSafeRealPathSync` 与浏览器启动报 `spawn EPERM`。这几类命令需要一次性提升到完整访问权限执行；`prettier` / `tsc` / `oxlint` 等纯静态命令在受限模式下可正常跑。
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
- `D:\Persist\app\src\lib\*.test.ts`
- `D:\Persist\app\src\data\complete-mock-data.test.ts`
- `D:\Persist\app\scripts\visual-check.mjs`
- `D:\Persist\design\`

### 16.6 规划与占位

- `D:\Persist\docs\Persist-项目开发规划.md`
- `D:\Persist\server\README.md`
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
| 照片识别 | 第一版不做 |
| 外部学习 App | 不抓取非公开数据 |
| AI 写入计划 | 必须用户确认 |
| AI 建档形态 | 结构化引导问答，不是开放式聊天机器人 |
| 长期计划 | 与今日计划分离，支持草案、启用、归档和周目标 |
| 长期计划入口 | 档案页「AI 建档」、`/plans?onboard=1`、今日页「长期计划」；长期计划不进主导航，导航固定五项 |
| 草案确认语义 | 确认即启用为 `active`，原 `active` 在新计划创建成功后才归档 |
| 计划起止日期 | `ChatPlanProposal.startDate/endDate` 可选；缺省时开始=今天、结束=最后里程碑；草案页可编辑 |
| 档案字段校验 | 统一走 `profile-rules.ts`；越界字段丢弃并用一条 toast 汇总提示，从不抛错、不中断对话 |
| 备份版本 | `0.2.0`（含 `longTermPlans`），并兼容 `0.1.0` 旧备份 |
| 条件类名写法 | 用 `cn()` 或「完整字符串三元」；禁止依赖条件拼接里手写空格的写法（Prettier 插件会压平） |
| 计划完成量 | 当前为估算，不能包装成精确统计 |
| 当前“快照” | 仅状态元信息，不是备份 |
| 当前数据刷新 | 会重置为初始 Mock |
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
15. 3 条既有 lint 警告、15 个既有未格式化文件、`PreviewPages.tsx:160` 遗留类名未处理。

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
7. **步骤 5**（下一步）：视觉已通过，立刻建立首个 Git 提交（当前 0 commit，已因无备份丢过一次源码）。
8. **步骤 6**：从 P2 本地持久化开始，不要直接跳到真实 AI 或 Android。
9. 持久化稳定后再做服务端 AI（P3），最后备份恢复（P4）与 Android 发布（P5）。

---

## 20. 交接结论

Persist 的当前成果是一个覆盖完整日常闭环、可跨模块联动、经过自动化验证的前端 Mock 产品原型：八个页面（含长期计划）可完整点击验收，AI 引导建档 → 长期计划草案 → 确认启用 → 归档/重启的闭环已经打通，JSON 导出导入已是备份 0.2.0（含长期计划、兼容旧 0.1.0），单元测试 112 条、E2E 92 次执行（0 跳过）全部通过，视觉基线 15 状态 × 6 视口已由用户桌面端与移动端验收通过。

但当前仍不是可长期使用的正式应用：刷新会丢数据、AI 不是真实调用、备份不可直接恢复、没有 Android 包，而且仓库仍无任何 Git 提交（全部文件未跟踪）。下一步应先做步骤 5（首个 Git 提交，建立可回滚基线），再把全部内存状态升级为可靠的本地持久化，随后接入服务端 AI、备份和移动端发布。

交接时应坚持以下判断：

- 当前代码优先于旧规划文档；规划文档里的路由清单是目标态，不是现状。
- AI 报告不是学习板块的附属功能，四入口设计不得回退。
- 主导航固定五项；长期计划通过档案页 / 今日页 / `/plans` 进入。
- 健身动作必须保持自由输入。
- 不得把 Mock 能力包装成真实能力（对话必须标注「本地生成 · Mock 对话」）。
- 未确认前不得写档案或计划；档案写入必须过 `sanitizeProfilePatch`。
- 不要全仓 Prettier；条件类名用 `cn()` 或完整字符串三元。
- 未经用户视觉验收不扩大无关功能范围；P1 收尾完成后，本地持久化是下一项最高优先级工程任务。