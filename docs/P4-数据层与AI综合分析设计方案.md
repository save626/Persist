# P4 数据层与 AI 综合分析设计方案（终态架构）

> 版本：v1（2026-11-04）
> 状态：**设计定稿待实施**（本文件只做设计，不含代码改动）
> 决策来源：用户在「本地组装摘要上传（路线 1）」与「本地优先 + 服务端可检索副本（路线 2）」之间选定**路线 2 作为终态方向**，本文件即为该方向的落地方案。
> 关系：本文件是 `HANDOFF.md` §13.4「P4」的展开，也是被它取代的旧规划（`docs/Persist-项目开发规划.md` §7、已于 2026-11-04 删除）在服务端与数据层的收敛稿；与 `HANDOFF.md` 冲突时以源码与 `HANDOFF.md` 为准，本文件负责「终态怎么走」。
> 读者：下一位接手的开发者（含 AI 会话）。读完本文件应能直接拆任务，不需要再做架构决策（§18 列出的少数待确认项除外）。

---

## 0. 结论摘要（TL;DR）

1. **终态架构 = 本地优先 + 服务端可检索副本**：浏览器 IndexedDB 仍是写入与离线可用的唯一权威；后台增量同步到自建 Fastify + SQLite；AI 分析需要的数字全部由服务端 SQL 聚合，模型只负责写文字。
2. **为什么必须换**：现状（8c）里 `/api/report` 只把前端临时拼出的「窗口摘要」发给模型，模型看不到历史，也没有跨模块、跨月趋势；「AI 检索我的所有数据综合分析」这个需求在无服务端数据库的架构下**做不到**，只能做「前端摘要 + 润色」。路线 1（继续加厚前端摘要）会让数字口径和隐私边界散落在前端，且摘要永远受浏览器本地数据量与请求体大小限制。
3. **前置条件被低估了**：现在真正带日期的历史数据只有学习记录；健身「历史」是 `FitnessPage.tsx` 里的常量演示数据，饮食只有「今天」的 `meals`，饮水没有日期字段，计划项只存当天。**没有历史可检索，AI 综合分析就是空谈**。所以 P4 的第一步不是接数据库，而是先把状态型数据升级为「按日台账 / 事件历史」（本文件称 8d）。
4. **落地顺序**（每步独立可验收、独立提交，一次只做一步）：
   - 步骤 11（8d）：数据历史化（前端，`schemaVersion` 1 → 2，备份格式 0.2.0 → 0.3.0）
   - 步骤 12（P4a）：设备令牌 + 增量同步（SQLite 数据层 + `/api/v1/sync/*` + 设置页同步区块）
   - 步骤 13（P4b）：服务端聚合 + AI 综合分析（`/api/v1/analysis/*`，报告归档、缓存、规则降级）
   - 步骤 14（P4c）：备份 / 恢复 / 导出 / 删除账号（PIPL 闭环）
   - 步骤 15（P5）：Capacitor Android（原计划不变）
   - 步骤 9（IP 直连部署）/ 步骤 10（备案后域名 HTTPS）**顺序不变**，且可以在备案等待期并行开发 8d/P4（服务器未部署也能本地开发 + 单测）。
5. **数字可信原则不变**：AI 只写 `title/status/summary/analysis/conclusions/actions/warnings` 这些文字字段；所有指标、趋势、依据由服务端确定性代码计算并随响应返回，前端只渲染、不做二次算术。模型输出一律过 schema + 白名单净化，不合格就失败，不用编造的兜底。
6. **隐私原则升级但要写死**：上传全量记录必须是用户显式开启的（默认安装后引导一次，可随时关闭；关闭即纯本地模式）；AI 只收到聚合事实包（约 6–10 KB JSON，不含自由文本备注）；日志不含正文与档案；提供导出与删除账号；HTTPS 之后才对外提供服务。

---

## 1. 现状与差距（为什么现在做不到）

### 1.1 现状事实（截至 2026-11-04，步骤 8c）

| 维度 | 现状 | 对「综合分析」的影响 |
|---|---|---|
| 数据位置 | 浏览器 IndexedDB（`persist-app` / `persist-mock-state` 单条记录，`schemaVersion: 1`） | 服务端无数据，无法检索 |
| 服务端数据库 | **无**。Fastify 纯代理，`/api/health`、SSE `/api/chat`、JSON `/api/report` | 没有可查询的历史 |
| 发给 AI 的内容 | 前端临时拼的 `ReportDigest`（只有窗口内计数/总和，且仅「今日简报」走 AI） | 单窗口、无历史、无趋势、无跨模块关联 |
| AI 输出 | 只有散文（`summary/conclusions/actions/warnings`） | 已符合「数字不由模型算」的原则，可沿用 |
| 学习历史 | `studyRecords[]` 带 `date`，是唯一真实历史 | 只能做学习单模块趋势 |
| 健身历史 | `FitnessPage.tsx` 的 `HISTORY` 常量（`history-1/2/3` 演示数据），不落库 | **无训练历史可分析** |
| 饮食历史 | `meals: Meal[]` 只有「今天」；食物条目有 id 但无日期 | 无饮食历史 |
| 饮水 | `waterLog: WaterLogEntry[]` 只有 `time` + `milliliters`，无日期 | 跨日无法归属 |
| 计划 / 目标 | `planItems` 只存当天；`goals` 有 `date` | 可以做「目标 → 计划 → 执行」但缺历史归档 |
| 报告 | `reports: ReportRecord[]` 本地存历史（含 `origin: 'ai' \| 'mock'`） | 报告有本地历史，但内容与数据脱钩，不可复算 |
| 账号 / 同步 / 备份恢复 | 都没有；只有 JSON 导出导入（备份 0.2.0） | 换设备即丢数据，也无法在服务端建可检索副本 |

### 1.2 两条路线与选择理由（保留决策记录）

- **路线 1（客户端摘要上传）**：保持无数据库，前端按窗口算更多摘要（逐日、逐周、跨模块），把摘要塞进 `/api/report` 请求体。优点：改动小、隐私面小、无运维。缺点：摘要逻辑与数字口径继续留在前端；窗口受请求体与浏览器数据量限制；无法做报告缓存/定时生成/历史口径统一；每加一个分析维度都要改前端并发版；「检索所有历史」实际做不到（历史本身不完整）。
- **路线 2（本地优先 + 服务端可检索副本）**：IndexedDB 继续做写入权威，后台同步到服务端 SQLite，服务端做聚合与 AI 分析。优点：历史完整、数字口径唯一、报告可缓存可定时、以后加维度只改服务端；缺点：需要数据库、同步协议、账号模型、备份与合规。
- **结论**：路线 2 作为终态；路线 1 的成果（8c 的 `ReportDigest`、`ai-report-client`、前端本地报告）**作为离线降级路径保留**，不再继续加厚。
- 进一步的技术选型见 §4（SQLite，不用 MySQL/MariaDB；服务端聚合，不把明细喂给模型）。

---

## 2. 目标与非目标

### 2.1 目标

1. 「今日 / 健身 / 饮食 / 学习 / 计划 / 目标」六类数据都有**可跨日检索**的持久化形态（本地 + 服务端一致）。
2. AI 报告基于**服务端检索出的全窗口事实**生成：逐日、逐周、跨模块、环比上一窗口，覆盖 7 / 30 / 90 天。
3. 报告可归档、可回看、可缓存（同一数据版本不重复烧 token），每日简报可选定时生成。
4. 离线（无网 / 服务端不可用 / 未登录）时功能不退化到今天以下：本地 Mock 报告与 8c 路径照常工作，并如实标注。
5. 数据可导出（JSON）、可备份（服务端快照）、可恢复、可删除（账号级）。
6. 单台 2C2G 服务器可长期运行；部署流程仍遵守「不在服务器上构建」的硬规则。

### 2.2 非目标（明确不做）

- 不做多用户 / 社交 / 分享 / 排行榜（表结构留 `user_id` 维度，但产品语义仍是单用户自用）。
- 不做云盘式多端实时协同；冲突策略是 LWW + 墓碑，不追求字符级合并。
- 不做自由文本备注上传（默认不上传，见 §9.2）；不做图片/语音识别（留给 P6+）。
- 不自建/微调模型；仍走 DeepSeek API，只改「喂什么、怎么算」。
- 不迁移到 MySQL / PostgreSQL / Redis / 消息队列；单进程 Fastify + 单文件 SQLite 是刻意选择。
- 不做多实例水平扩展（单进程假设写进部署文档）。

---

## 3. 终态架构

### 3.1 分层图

```text
┌────────────────────────── 浏览器（PWA，未来 Capacitor 复用） ──────────────────────────┐
│ UI（8 页面，导航固定 5 项）                                                             │
│   ↑ ↓ React Context（MockDataProvider：13 个状态切片）                                  │
│ 领域层                                                                                  │
│   ├─ 本地报告（8c，离线降级）：digest → 本地 Mock 报告                                   │
│   ├─ 同步层（新增）：outbox → /api/v1/sync/push；启动/回前台 → /sync/pull                 │
│   └─ 分析客户端（新增）：/api/v1/analysis/reports → 渲染文字 + 服务端指标                │
│ 存储层                                                                                  │
│   ├─ IndexedDB：权威写入（含 history / 台账 / outbox / token）                          │
│   └─ 报告缓存：服务端报告落本地，离线可回看                                              │
└───────────────────────────────────────┬─────────────────────────────────────────────────┘
                                        │ HTTPS + Bearer device token（/api/*，Nginx 反代）
┌───────────────────────────────────────┴─────────────────────────────────────────────────┐
│ Fastify 单进程（127.0.0.1:3000，不对外）                                                 │
│  现有：GET /api/health、SSE POST /api/chat、JSON POST /api/report（8c，保留为降级）        │
│  新增 v1：                                                                              │
│   /api/v1/devices*（注册 / 恢复码 / 吊销）                                              │
│   /api/v1/sync/{bootstrap,push,pull}       增量同步（LWW + 墓碑 + 幂等 op）               │
│   /api/v1/analysis/{facts,reports}          服务端聚合 + AI 综合分析                      │
│   /api/v1/reports*                          报告归档查询                                │
│   /api/v1/backups*、/export、/account       备份 / 导出 / 删除                            │
│  服务层：repository（SQL）→ facts builder（确定性聚合）→ AI（仅文字）/ rules 降级         │
│  存储：/var/lib/persist/persist.sqlite（WAL），备份 /var/backups/persist/                 │
│  定时：每日简报（可选）、每日备份、墓碑清理（均单进程内，重启跳过已执行任务）              │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 职责边界（写死，避免以后扯皮）

| 关注点 | 责任方 | 说明 |
|---|---|---|
| 记录真实产生 | 客户端 | 离线也可写；写成功不依赖网络 |
| 记录持久权威 | 客户端 IndexedDB | 服务端是**副本**，不是权威；恢复时以服务端快照为来源 |
| 同步顺序 / 冲突 | 客户端 outbox + 服务端 LWW | 以 `updatedAt` 较新者胜；删除落墓碑 |
| 指标 / 趋势 / 覆盖率 | **服务端 SQL**（前端只用响应值） | 消除「前端算一套、服务端算一套」 |
| 报告文字 | 模型（DeepSeek）或服务端规则模板 | 模型禁止算术，只叙述 |
| 报告缓存 / 定时 | 服务端 | 键 = 用户 + 类型 + 窗口 + 数据版本 |
| 离线体验 | 客户端 | 回退 8c 本地报告，标注「本地生成」 |
| 身份 | 服务端签发 device token，客户端保存 | 单用户，多设备共享同一 `user_id` |
| 备份 / 导出 / 删除 | 服务端（+ 客户端导出保留） | 见 §9 / §12 |

### 3.3 为什么「服务端聚合 + 只喂事实包」而不是「把明细全塞进 prompt」

- 成本与延迟：90 天逐条明细可达数百 KB～MB 级，token 成本与 25 s 超时都不可控；事实包固定 6–10 KB。
- 正确性：模型做算术必然出错（8c 真实联调已复现「模型自行减法」缺陷），数字必须由代码算。
- 可复算 / 可测试：facts builder 是纯函数 + SQL，可用 fixture 做快照测试；模型输出只做文字校验。
- 隐私：可精确控制哪些字段出网（见 §9.2），明细不出网。

---

## 4. 数据层选型（SQLite）

### 4.1 结论

- 单文件 **SQLite**，路径 `/var/lib/persist/persist.sqlite`，`journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`、`synchronous=NORMAL`。
- 明确不用 MySQL / MariaDB / PostgreSQL / Redis：单用户、单进程、数据量（十年逐日记录 ≈ 数十万行）远未到 SQLite 上限；2C2G 上少一个守护进程、少一套备份与调优。
- 驱动只有两个候选，**二选一，部署前一次性定死**（§18 待确认）：
  - **A. 升级服务器 Node 到 22 LTS，用内置 `node:sqlite`**（推荐）：零 native 依赖，2C2G 上没有编译工具链也能装；代价是服务器 Node 版本升级（Fastify 5 支持 Node ≥20，升级风险低，但要在步骤 9 前实测 `server/` 全套单测 + 真机启动）。
  - **B. 保留 Node 20，用 `better-sqlite3`**：需要预编译二进制（受 GitHub 下载可达性影响）或 `dnf install gcc-c++ make python3` 本地编译；`engines` 保持 `>=20.19`。
- 本机 Node v22.19.0 已可用 `node:sqlite` 做原型（Node 22 中该模块为实验性，会打印 ExperimentalWarning；服务端启动脚本需允许该警告，或在 Node 24 LTS 上再确认稳定性）。**无论选哪个，repository 层必须只使用一小撮公共 API（`prepare/run/all/get/exec/transaction`），把驱动差异收敛在一个文件里**（`server/src/db/driver.ts`），便于换驱动。
- 结论落到契约：`server/package.json` 的 `engines` 与部署文档必须在 8d/P4a 完成前定稿，不允许一边写代码一边改 Node 版本。

### 4.2 容量与运维预估

| 项目 | 估算 | 说明 |
|---|---|---|
| 每日新增行 | 20–60 行 | 计划项、学习、饮食条目、饮水、训练组（按会话存 JSON） |
| 10 年行数 | 约 10 万–20 万 | SQLite 毫无压力 |
| 库文件体积 | 50–200 MB | 加索引后；`VACUUM` 只在备份脚本里做 |
| 进程内存 | Fastify + SQLite ≈ 100–150 MB | 2C2G 余量充足 |
| 备份体积 | 每份 50–200 MB，7 日 + 4 周 + 3 月 ≈ 1–2 GB | 需在部署文档写磁盘水位告警（`df` 检查） |

---

## 5. 数据模型设计

### 5.1 设计原则

1. **实体级同步，不做整条大 JSON 覆盖**：现状是「一个 IndexedDB 记录装全部状态」，同步若按整条记录做，冲突粒度太粗（改一条饮水会覆盖全部）。因此同步单位是「实体」：`plan_item` / `study_record` / `diet_entry` / `water_log` / `fitness_session` / `goal` / `long_term_plan` / `report` / `profile` / `settings`。
2. **混合存储**：高频聚合字段提成列（`date`、`category`、`duration_min`、`calories`、`milliliters`、`done` 等），完整业务对象仍存 `payload_json`。这样 SQL 聚合不依赖 JSON 展开，前端回放也不丢字段。
3. **统一同步列**：每条实体都有 `updated_at`（epoch ms，客户端时钟）、`deleted_at`（墓碑，NULL 表示未删）、`rev`（服务端单调递增序号）。
4. **日期用 `YYYY-MM-DD`（Asia/Shanghai）**，时间戳用 epoch ms；绝不在服务端用本地时区做日期切分。
5. **主键由客户端生成 UUID**（已有 `id` 的实体沿用），服务端不做 ID 生成，保证离线可写。

### 5.2 DDL 草案（v1 schema，实施时以 migration 文件为准）

```sql
-- 元信息
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
CREATE TABLE sync_seq (            -- 单行，全局单调 rev
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL
);
INSERT INTO sync_seq (id, value) VALUES (1, 0);

-- 身份
CREATE TABLE users (
  id         TEXT PRIMARY KEY,     -- usr_<uuid>
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE devices (
  id           TEXT PRIMARY KEY,   -- dev_<uuid>
  user_id      TEXT NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL UNIQUE,   -- sha256(device token)，不存明文
  recovery_hash TEXT UNIQUE,           -- sha256(恢复码)，用后即失效/轮换
  label        TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER
);

-- 档案 / 设置（单行）
CREATE TABLE profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  payload_json TEXT NOT NULL,
  updated_at   INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
CREATE TABLE settings (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  payload_json TEXT NOT NULL,      -- 提醒、sources 授权、同步开关等
  updated_at   INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);

-- 六类记录 + 计划 + 报告
CREATE TABLE goals (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  title TEXT, target_date TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
CREATE TABLE plan_items (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  date TEXT NOT NULL, kind TEXT, done INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
CREATE TABLE study_records (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  date TEXT NOT NULL, category TEXT NOT NULL, duration_min REAL NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
CREATE TABLE fitness_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  date TEXT NOT NULL, status TEXT NOT NULL,        -- active | completed
  started_at INTEGER, ended_at INTEGER,
  total_sets INTEGER, done_sets INTEGER,
  volume_kg REAL, duration_min REAL, distance_km REAL,
  payload_json TEXT NOT NULL,                     -- exercises[].sets[] 原样
  updated_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
CREATE TABLE diet_entries (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  date TEXT NOT NULL, meal TEXT NOT NULL,          -- breakfast/lunch/dinner/snack
  name TEXT, calories REAL, protein REAL, carbs REAL, fat REAL,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
CREATE TABLE water_logs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  date TEXT NOT NULL, time TEXT NOT NULL,          -- HH:MM
  milliliters INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
CREATE TABLE long_term_plans (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  status TEXT NOT NULL,                            -- draft|active|archived
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);

-- 报告（服务端生成 + 归档）
CREATE TABLE reports (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  type TEXT NOT NULL,                              -- 今日简报|训练建议|学习观察|综合分析
  range_days INTEGER NOT NULL,                     -- 7|30|90
  range_start TEXT NOT NULL, range_end TEXT NOT NULL,
  data_rev INTEGER NOT NULL,                       -- 生成时的事实包数据版本
  origin TEXT NOT NULL,                            -- ai | rules
  model TEXT,
  payload_json TEXT NOT NULL,                      -- ReportContentV2（文字字段）
  metrics_json TEXT NOT NULL,                      -- 服务端算好的指标，前端直接渲染
  created_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
CREATE TABLE report_cache (
  user_id TEXT NOT NULL, type TEXT NOT NULL, range_days INTEGER NOT NULL,
  data_rev INTEGER NOT NULL, report_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, type, range_days, data_rev)
);

-- 同步幂等 / 备份元数据 / 审计（不含正文）
CREATE TABLE sync_ops (
  op_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, applied_at INTEGER NOT NULL
);
CREATE TABLE backups (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL, created_at INTEGER NOT NULL, reason TEXT
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
  event TEXT NOT NULL, detail_json TEXT                 -- 不含记录正文与档案
);

CREATE INDEX idx_plan_user_date    ON plan_items (user_id, date)    WHERE deleted_at IS NULL;
CREATE INDEX idx_study_user_date   ON study_records (user_id, date) WHERE deleted_at IS NULL;
CREATE INDEX idx_fit_user_date     ON fitness_sessions (user_id, date) WHERE deleted_at IS NULL;
CREATE INDEX idx_diet_user_date    ON diet_entries (user_id, date)  WHERE deleted_at IS NULL;
CREATE INDEX idx_water_user_date   ON water_logs (user_id, date)    WHERE deleted_at IS NULL;
CREATE INDEX idx_goals_user_date   ON goals (user_id, target_date)  WHERE deleted_at IS NULL;
CREATE INDEX idx_reports_user_time ON reports (user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_sync_rev          ON study_records (rev); -- 各实体都有 (user_id, rev)，migration 里逐表建
```

### 5.3 与 `app/src/types.ts` 的映射

| 前端类型 / 状态切片 | 服务端实体 | 关键列 | 备注 |
|---|---|---|---|
| `ProfileData` | `profiles` | 单行 | 含 `aiConsent`；档案字段不外传日志 |
| `MockSettings` | `settings` | 单行 | `sources.{fitness,diet,study,profile}` 决定事实包模块 |
| `Goal[]` | `goals` | `target_date` | 目标不绑定当日计划 |
| `PlanItem[]` | `plan_items` | `date` / `done` | 今日计划按日归档（8d 新增历史） |
| `StudyRecord[]` | `study_records` | `date/category/duration_min` | 已有真实历史 |
| `FitnessSessionState` | `fitness_sessions` | `date/status/volume_kg/...` | 8d 起完成后落历史，不再只有一个活动会话 |
| `Meal[]` / `FoodEntry[]` | `diet_entries` | `date/meal/calories` | 8d 起食物条目带日期、按日台账 |
| `WaterLogEntry[]` | `water_logs` | `date/time/milliliters` | 8d 起带日期 |
| `LongTermPlan[]` | `long_term_plans` | `status` | 已存在 |
| `ReportRecord[]` | `reports` | `type/range_days/data_rev/origin` | 服务端归档；本地仍缓存一份 |
| `EveningReviewPayload` | 暂不入库 | — | 复盘是自由文本，默认不上传（§9.2） |

---

## 6. 前置改造：数据历史化（步骤 11 / 8d）

> 没有这一步，P4 的「综合分析」只能分析学习一个模块。8d 是纯前端改动，不引入数据库，可在备案等待期独立完成并验收。

### 6.1 数据结构变更（`schemaVersion` 1 → 2）

1. **训练历史**：新增 `fitnessHistory: FitnessSessionState[]`（完成训练即归档一条；`fitnessSession` 保留为「进行中的那个」）；删除 `FitnessPage.tsx` 的 `HISTORY` 常量演示数据，历史列表读真实记录，空态明确写「还没有训练记录」。
2. **饮食台账**：`meals` 从「今天」改为可寻址的按日结构，建议 `dietDays: { date, meals: Meal[] }[]`（或 `dietEntries` 扁平 + `date`）；今日页仍只展示今天，历史页/报告按日读数。热量/蛋白等数值继续由现有食物数据推导，不新增字段。
3. **饮水日期**：`WaterLogEntry` 增加 `date`，今日页写入 `YYYY-MM-DD`，历史聚合按日汇总。
4. **计划归档**：`planItems` 增加 `date`（写入时=今天），跨日保留；今日页只显示今天，报告按日算完成率。
5. **报告保持**：本地 `reports` 继续存，服务端版本后与之合并展示（§8.4）。
6. **迁移**：`persist-state.ts` 的 `migrate` 从 v1 → v2：旧记录里 `fitnessSession` 若已完成则搬进 `fitnessHistory`；`meals`/`waterLog`/`planItems` 打上「今天」日期；**演示用的 `HISTORY` 常量不入库**。备份格式升到 `0.3.0`：新增历史字段，导入仍兼容 `0.1.0` / `0.2.0`（缺字段给空数组）。

### 6.2 UI 影响（需视觉复核）

- 健身页历史列表、饮食页（若加按日浏览）、报告页的数据来源变化会改变文案与列表内容 → 8d 完成后必须重跑 `npm run visual:check` 并经用户桌面端 + 移动端验收，再更新 `design/*.png` 基线。
- 不改 5 项主导航、不新增一级路由；历史浏览放在各页内的既有面板/sheet 里，避免视觉基线全面扩散。

### 6.3 验收标准（8d）

- [ ] `schemaVersion: 2` 落库；v1 记录可无损迁移；旧备份可导入。
- [ ] 完成一次训练 → 刷新页面 → 历史列表出现该记录（不再出现 `history-1` 演示行）。
- [ ] 记录饮食/饮水/计划后跨日（改系统日期或用测试注入日期）仍能按日读取，报告窗口能取到多日数据。
- [ ] 单元测试覆盖迁移与历史归档；E2E 覆盖「记录 → 历史出现」；视觉基线重跑并验收。

---

## 7. 同步与账号（步骤 12 / P4a）

### 7.1 账号模型（单用户、设备令牌 + 恢复码）

- 首次开启同步：`POST /api/v1/devices` → 返回 `{ userId, deviceId, token, recoveryCode }`；**token 与恢复码只在这一次响应里出现**，服务端只存 `sha256` 哈希。客户端把 token 存 IndexedDB（单独库/单独列），恢复码提示用户抄下（可复制），设置页可再次查看（本地保存的副本，不是从服务端取回）。
- 第二台设备 / 重装：`POST /api/v1/devices/restore { recoveryCode }` → 签发新 token（旧 recovery 不变或轮换，实施时定：**建议轮换**并在设置页重新展示）。
- 吊销：`POST /api/v1/devices/revoke`（吊销当前或指定设备），服务端写 `revoked_at`；吊销后该 token 一律 401。
- 说明：不做邮箱/手机号注册（避免短信、实名、密码找回全套复杂度）；这是**个人自用工具的账号**，不是互联网账号体系。风险与替代见 §17。

### 7.2 同步协议

```text
客户端 outbox（IndexedDB 表 persist-outbox）：
  每次本地写操作 → 生成/更新实体 → 写入 outbox { opId, kind, id, updatedAt, deleted, data }

POST /api/v1/sync/push
 Authorization: Bearer <token>
 { "opId": "uuid",                       // 幂等键，重试安全
   "entities": [ { "kind": "study_record", "id": "...", "updatedAt": 1730...,
                   "deleted": false, "data": { ...完整业务对象... } } ] }
 → 200 { "applied": 3, "skipped": [ { "kind": "...", "id": "...", "reason": "stale" } ],
         "serverRev": 128 }

服务端对每个实体：
  1) sync_ops 里有 opId → 直接返回上次结果（幂等）
  2) 查同 id 行：incoming.updatedAt <= row.updated_at → skipped(stale)（LWW）
  3) 否则 upsert 业务列 + payload_json，deleted=true 写 deleted_at + rev
  4) rev = ++sync_seq.value（同一事务内），updated_at 保留客户端值

GET /api/v1/sync/pull?since=<rev>&limit=500
 → { "entities": [ { "kind": "...", "id": "...", "data": {...},
                     "updatedAt": ..., "deleted": false, "rev": 129 } ],
     "nextSince": 129, "hasMore": true }
 客户端：按 rev 应用（本地 updatedAt 更新者胜），写回 IndexedDB，记 lastPulledRev

POST /api/v1/sync/bootstrap
 { "entities": [ 全量实体... ] }        // 首次绑定已有数据时用；同一事务写入，超时上限 30 s
```

补充规则：

- **墓碑保留 30 天**后物理删除（定时任务），删除时清空 `payload_json` 但保留 `deleted_at/rev` 供游标推进；已删除用户的墓碑直接清。
- **时钟漂移**：`updatedAt` 用客户端时钟，服务端只做比较不做校正；若客户端时钟倒退，可能被 stale 丢弃，客户端在 push 收到 `skipped` 后用 pull 结果回填（服务端是这一冲突下的胜者）。
- **游标**：客户端存 `lastPulledRev`，服务端 `rev` 单调，因此 pull 可以断点续传；删除的实体也会以 `deleted: true` 出现在 pull 里。
- **频率**：启动、回到前台、写操作后 5 s 防抖、每 60 s 兜底；`navigator.onLine === false` 直接跳过。同步失败指数退避（5 s → 5 min 封顶），UI 只显示三态：「已同步 / 待同步 N / 离线」。
- **离线优先**：IndexedDB 写成功即视为成功；同步永不阻塞本地操作。
- **数据校验**：服务端对每个实体做 schema 校验（长度、枚举、数值范围、日期格式），不合法整条拒绝并返回 `reason: "invalid"`，不落库；客户端把该条标记为「同步失败」并保留本地（不静默丢数据）。
- **首次引导**：设置页新增「数据同步」区块（非新路由）：开关、生成恢复码/显示设备、最后同步时间、立即同步、吊销本机。关闭同步 → 停止 push/pull、可「删除服务端副本」（见 §12），本地数据不动。

### 7.3 客户端同步层落点（`app/src/lib/`）

| 文件（新增） | 职责 |
|---|---|
| `sync-client.ts` | fetch 封装、鉴权头、错误分类、退避重试 |
| `sync-queue.ts` | outbox 读写、按 kind 聚合、防抖触发 |
| `sync-store.ts` | `persist-sync` IndexedDB 库：token、lastPulledRev、outbox、同步状态 |
| `sync-merge.ts` | pull 结果应用到 13 个状态切片（LWW 比较 + 墓碑移除） |

`MockDataProvider` 只增加一个「记录已变更」的通知（现有写路径已集中），不在每个页面里散落同步调用。

### 7.4 验收标准（P4a）

- [ ] 断网 → 记录 → 联网 → 数据出现在服务端（可用 `sqlite3` 命令行核对），本地无任何阻塞。
- [ ] 两台浏览器用同一恢复码绑定 → 任一设备写入 → 另一设备 pull 后可见；删除会同步为墓碑。
- [ ] 冲突：同一实体两台设备分别改，`updatedAt` 新者胜，旧者被 `skipped` 且本地回填。
- [ ] 重复 push（同一 opId 重试）不产生重复行。
- [ ] 未带 token / token 被吊销 → 401；错误 token 不泄露任何数据；日志无正文。
- [ ] 关掉同步后不再发请求，本地功能完整。

---

## 8. 服务端聚合与 AI 综合分析（步骤 13 / P4b）

### 8.1 事实包（ReportFacts v2）

服务端在请求时从 SQLite 现算，**不缓存明细**：

```jsonc
{
  "version": 2,
  "generatedAt": 1730000000000,
  "range": { "days": 30, "start": "2026-10-06", "end": "2026-11-04" },
  "dataRev": 128,                       // = 当前 sync_seq，用于报告缓存键
  "profile": { "age": 27, "height": 178, "weight": 72.5, "targetWeight": 68,
               "goal": "增肌", "experience": "2 年", "frequency": "每周 4 次" },
  "plan": { "title": "...", "weeklyTargets": {...}, "progressPct": 62 },
  "days": [ { "date": "2026-10-06",
              "fitness": { "sessions": 1, "sets": 18, "volumeKg": 4200, "minutes": 52 },
              "study":   { "minutes": 90, "byCategory": { "english": 60, "math": 30 } },
              "diet":    { "calories": 2100, "protein": 120, "meals": 3 },
              "waterMl": 1800,
              "plan":    { "total": 4, "done": 3 } } ],
  "weekly": [ { "weekStart": "2026-10-06", "fitnessSessions": 3, "volumeKg": 12400,
                "studyMinutes": 520, "avgWaterMl": 1750, "planRate": 0.72 } ],
  "totals": { "fitnessSessions": 11, "fitnessMinutes": 610, "volumeKg": 45100,
              "studyMinutes": 1980, "waterAvgMl": 1720, "planRate": 0.68,
              "daysWithAnyRecord": 24, "daysMissing": 6 },
  "trend": { "previousRange": {...}, "fitnessSessionsChangePct": 12.5,
             "studyMinutesChangePct": -8.2, "planRateChangePct": 5.1 },
  "coverage": { "fitnessDays": 9, "studyDays": 18, "dietDays": 12, "waterDays": 20 },
  "consent": { "profile": true, "fitness": true, "diet": false, "study": true }
}
```

- **`consent` 由服务端按 `settings.sources` + `profiles.aiConsent` 计算**：未授权的模块，`days/weekly/totals` 里该模块字段全 `null`，模型看不到；这是对「未授权数据不出网」的硬保证，不做「前端传什么就发什么」。
- 体积控制：7 天 ≈ 2–3 KB；30 天 ≈ 6–8 KB；90 天把 `days` 折叠为周（`weekly` 为主 + 每 7 天一行粗粒度），≤ 10 KB。超过则服务端继续折叠（`granularity: "week"`），永不截断成错的数。
- `trend` 的百分比由 SQL 算好；模型只能用这些百分比，不得自行做除法。

### 8.2 请求 / 响应契约（v2）

```text
POST /api/v1/analysis/reports
 { "type": "综合分析", "rangeDays": 30, "force": false }
 → 200 {
     "reportId": "rpt_...",
     "cached": false,
     "origin": "ai",                     // ai | rules
     "model": "deepseek-chat",
     "range": { "start": "...", "end": "...", "days": 30 },
     "content": { ...ReportContentV2... },
     "metrics": [ { "label": "训练次数", "value": "11 次", "detail": "较前 30 天 +12.5%" } ],
     "dataRev": 128,
     "createdAt": 1730000000000
   }
 错误：401 未认证 / 403 未授权（aiConsent 关闭）/ 409 数据不足（窗口内无记录）/
       422 参数不合法 / 429 限流 / 502 AI 返回不可用（不编造）/ 503 服务端未配置 Key
```

`ReportContentV2`（文字字段，全部过白名单净化）：

```ts
interface ReportContentV2 {
  title: string          // ≤ 24 字
  status: string         // ≤ 16 字（如「稳步推进」）
  summary: string        // 80–160 字，逐日事实的总述
  analysis: string[]     // 2–5 段，每段 60–300 字：分模块 → 跨模块关联 → 趋势
  conclusions: string[]  // 2–4 条，每条 4–80 字
  actions: string[]      // 2–4 条，每条 4–80 字，可执行
  warnings: string[]     // 0–4 条，每条 4–80 字（数据缺失/强度风险/记录覆盖不足）
}
```

- 与 8c `ReportRecord` 并存：`analysis` 是新增字段；`metric/evidence` 改为服务端 `metrics` + `facts` 摘要（前端不再本地算数字）。
- `origin: "rules"` 时 `content` 由服务端规则模板按 facts 填出（不含任何模型文字），前端标注「服务端规则生成（AI 不可用）」；`origin: "ai"` 标注「服务端分析 · DeepSeek」。

### 8.3 提示词 v2 规则（`server/src/ai/prompts.ts` 新增 `ANALYSIS_SYSTEM_PROMPT`）

1. 输入只有 `facts` JSON；**禁止任何算术**（不加减乘除、不估算百分比、不把「+12.5%」再换算）；只能引用 facts 中出现的数字与结论。
2. 禁止编造缺失数据：`null` / 未授权模块一律不得出现，也不得用「可能/大约」补全。
3. 结构：先说记录覆盖与稳定度 → 分模块事实 → 跨模块关联（如训练日与学习时长、饮水与训练强度）→ 趋势（用 `trend` 字段）→ 2–4 条具体行动建议。
4. 不评价意志力/性格，不做医疗诊断，不推荐超量训练或极低热量饮食；涉及身体不适建议就医。
5. 中文简体；不用 Markdown 标题/代码块/链接/emoji；不写「根据数据」以外的空话。
6. 只输出 JSON（沿用 8c 的 strict JSON 解析与 schema 校验；不合法 → 502，不用编造内容兜底）。

### 8.4 报告归档、缓存与定时

- **归档**：每次生成写 `reports` 一行（`data_rev` 记录数据版本）；`GET /api/v1/reports?limit=20` 返回列表（含 `origin`、窗口、时间）；`GET /api/v1/reports/:id` 取详情。
- **缓存**：`report_cache (user,type,range_days,data_rev)`；同 `dataRev` 命中直接返回 `cached: true`（不再调模型）。同步写入会推进 `dataRev`，因此「数据变了就重新生成」，`force: true` 手动强制重生成。
- **定时**：可选「每日简报」（默认关闭，设置页开关 + 时间默认 21:00 Asia/Shanghai）。实现为服务端进程内定时器：每分钟检查一次「今天是否已生成」，任务表（`audit_log` 或独立 `jobs` 表）记录执行时间，重启不重复执行；失败重试 1 次后放弃并写审计。单进程假设，不做作业队列。
- **前端 ReportsPage**：请求 `/api/v1/analysis/reports`；成功渲染 `content.analysis` 段落 + `metrics`；失败按错误码分类：网络/离线 → 8c 本地报告（标注「本地生成 · Mock 报告」）；403 → 提示去档案页开启授权；502/503 → 显示「服务端分析暂不可用」并提供重试，**不回退成看似 AI 的本地内容**（除非用户点「使用本地报告」）。报告列表合并本地缓存与服务端归档，标注来源。

### 8.5 验收标准（P4b）

- [ ] 30 天窗口事实包字段齐全、数字与手工 SQL 一致（快照测试固定 fixture）。
- [ ] 真实 Key 生成一次报告：`analysis` 2–5 段，**全文无自行推算的数字**（人工核对 + 白名单校验）。
- [ ] 同一数据版本二次请求命中缓存（`cached: true`，无模型调用）；新增一条记录后再请求重新生成。
- [ ] 未授权 `diet` 时事实包与报告均不出现饮食内容。
- [ ] 无 Key / 超时 → `origin: "rules"`，报告可用且如实标注；契约非法 → 502，前端显示真实错误。
- [ ] 断网 → 前端回退本地 8c 报告并标注；恢复后不自动覆盖用户已读内容。

---

## 9. 隐私、合规与数据处理（PIPL / ICP）

### 9.1 必须做到（写进代码与文案）

1. **知情同意**：开启同步时弹一次说明（上传哪些数据、AI 收到什么、如何删除），需显式勾选；不开启则纯本地，功能不减（除「综合分析」外的 AI 能力仍可用 8c 路径）。
2. **最小必要**：AI 只收聚合事实（§8.1），不收自由文本（复盘正文、备注、聊天原文）；`diet`/`study`/`fitness`/`profile` 按 `settings.sources` 逐模块授权。
3. **可删除**：`DELETE /api/v1/account` → 删全部业务行、报告、备份文件、设备；返回回执；本地同时清空（二次确认）。
4. **可导出**：`GET /api/v1/export` 返回与客户端导出同格式（0.3.0）的 JSON；设置页仍保留本地导出。
5. **日志脱敏**：不记录请求体、档案、报告正文、token；只记方法/路径/状态码/耗时/错误码；沿用 8a 的 redaction 配置。
6. **传输安全**：token 与数据只走 HTTPS（步骤 10 后强制；IP 阶段仅内部验收，不做公开注册）。
7. **备案与文案**：`wpersist.top` 备案通过后，在设置页「隐私与数据」区块放隐私说明（上传范围、AI 处理、删除方式、联系方式）；不新增一级路由，避免视觉基线扩散。
8. **留存**：报告默认 365 天、墓碑 30 天、日志 30 天；超期由定时任务清理（可配置）。备份按 §12 滚动。
9. **数据出境**：DeepSeek 为国内 API，无跨境传输；若未来换海外模型，需重新评估。

### 9.2 默认不上传的字段（明确清单）

- `EveningReviewPayload` 复盘正文、学习 `note`、饮食自由备注、训练备注、聊天原文（`/api/chat` 仍走 8c 的「请求即发」，不落库）。
- 事实包中只保留数值与枚举（如 `goal`、`category`），不含任何自由文本。
- 若用户希望「AI 读我的复盘」，作为 P6+ 的单独开关，单独告知与单独开关，不在本方案内默认开启。

### 9.3 与现有 8c 路径的关系

- `/api/report` 继续存在（客户端摘要 + 模型润色），作为离线/未同步时的降级；P4b 完成后前端默认走 `/api/v1/analysis/reports`，8c 路径只在降级与「本地模式」下使用。
- `/api/chat` 契约不变（建档对话需要上下文，且不涉及历史检索）；P4 后可选择性改为服务端读档案，但**不在本方案内**，避免与「前端冻结」冲突。

---

## 10. API 一览（v1）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/v1/devices` | 无 | 注册设备，返回 token + 恢复码（仅一次） |
| POST | `/api/v1/devices/restore` | 无（凭恢复码） | 换新设备 token |
| POST | `/api/v1/devices/revoke` | Bearer | 吊销当前/指定设备 |
| POST | `/api/v1/sync/bootstrap` | Bearer | 首次全量上传（事务，≤30 s） |
| POST | `/api/v1/sync/push` | Bearer | 增量推送（opId 幂等，LWW） |
| GET | `/api/v1/sync/pull?since=&limit=` | Bearer | 增量拉取（rev 游标） |
| GET | `/api/v1/analysis/facts?type=&rangeDays=` | Bearer | 调试/自检用事实包（不含模型调用） |
| POST | `/api/v1/analysis/reports` | Bearer | 生成/读取综合分析（缓存、限流） |
| GET | `/api/v1/reports?limit=&cursor=` | Bearer | 报告归档列表 |
| GET | `/api/v1/reports/:id` | Bearer | 报告详情 |
| POST | `/api/v1/backups` | Bearer | 立即创建快照 |
| GET | `/api/v1/backups` | Bearer | 快照列表 |
| POST | `/api/v1/backups/:id/restore` | Bearer + 二次确认 | 恢复（先校验、先自动备份当前库） |
| GET | `/api/v1/export` | Bearer | 全量 JSON 导出 |
| DELETE | `/api/v1/account` | Bearer + 二次确认 | 删除账号与全部服务端数据 |
| GET | `/api/health` | 无 | 保留；增加 `db: "ok"` 与 `version` 字段 |

约定：`/api/v1` 全部 JSON（无 SSE）；错误体 `{ error: { code, message } }`；限流继续按 IP（`RATE_LIMIT_*`），分析接口单独更严（建议 6 次 / 300 s）；请求体上限 8 MB（bootstrap 用），其余 256 KB；分析请求超时 25 s（90 天可放宽到 40 s，Nginx `proxy_read_timeout` 同步放宽）。

---

## 11. 部署影响（步骤 9 / 10 与 P4 的关系）

### 11.1 顺序

- 步骤 9（IP 直连）**先部署当前 8c 版本**，验证 Nginx / 反代 / SSE / 静态缓存 / 进程守护；不引入数据库。
- P4a 开始前，服务器需完成：Node 版本决策（§4.1）、`/var/lib/persist` 与 `/var/backups/persist` 目录与属主、磁盘水位检查；这些作为步骤 9 的「预留项」写进部署文档，避免部署完再改系统。
- P4a/b/c 各自一次发布：`git pull` → 本机构建产物上传（或 CI）→ 服务器 `npm ci --omit=dev` + `node dist/db/migrate.js` → 重启 systemd → 健康检查。**永不在服务器上构建前端**（2C2G 硬规则）。

### 11.2 运行配置（`/etc/persist/server.env`，600，仅 root 可改）

```bash
HOST=127.0.0.1
PORT=3000
DEEPSEEK_API_KEY=...            # 上线前轮换（8c 联调用的 Key 已出现在开发对话里）
DEEPSEEK_MODEL=deepseek-chat
AI_TIMEOUT_MS=25000
AI_MAX_RETRIES=1
RATE_LIMIT_MAX=20
RATE_LIMIT_WINDOW_MS=300000
DB_PATH=/var/lib/persist/persist.sqlite
DB_BACKUP_DIR=/var/backups/persist
BACKUP_RETENTION_DAYS=7
BACKUP_RETENTION_WEEKS=4
DAILY_REPORT_ENABLED=false
DAILY_REPORT_AT=21:00
```

### 11.3 systemd / 权限

- `User=persist`、`Group=persist`；`ReadWritePaths=/var/lib/persist /var/backups/persist`；`ProtectSystem=strict`、`ProtectHome=true`、`PrivateTmp=true`、`NoNewPrivileges=true`。
- 库目录 `750`、文件 `640`；备份文件 `640`；`server.env` `600 root:persist`。
- 迁移用独立命令（`node dist/db/migrate.js`）在有备份的前提下执行；迁移失败不启动服务（fail fast），保留旧库副本。
- 备份：每日 03:00 `VACUUM INTO` 快照 + `PRAGMA integrity_check` + sha256；保留 7 日 + 4 周 + 3 月；磁盘水位 > 85% 时在 `/api/health` 报 `warn`。

### 11.4 数据库驱动带来的部署差异

| 选项 | 部署动作 | 风险 |
|---|---|---|
| A. Node 22 + `node:sqlite` | 升级服务器 Node（dnf 安装或二进制替换），重跑 8a–8c 单测与真机启动 | Node 升级影响现有 P3 代理；`node:sqlite` 实验性警告；（本地 Node 22.19 可先验证） |
| B. Node 20 + `better-sqlite3` | `npm ci` 拉预编译二进制；失败则 `dnf install gcc-c++ make python3` 后编译 | 2C2G 编译慢（数分钟）、内存紧张；GitHub 下载可达性 |
| C. 升级 Node 24 再确认 `node:sqlite` | 同 A，稳定性更好 | 偏离服务器既有 20.20.2 基线；需重测全部 |

---

## 12. 备份、恢复、导出与删除（步骤 14 / P4c）

- **快照**：`POST /api/v1/backups`（手动）与每日定时；`VACUUM INTO` 生成一致副本，记录 `bytes/sha256/created_at/reason`。
- **恢复**：先校验 sha256 + `integrity_check`；对比当前库行数给出预览（各实体条数、报告数）；要求显式 `confirm: true`；恢复前自动备份当前库（reason=`pre-restore`）；恢复用「新库写入 + 原子替换 + 重开连接」，失败回滚。
- **滚动**：7 日 + 4 周 + 3 月；删除最旧前确认文件存在且校验通过。
- **导出**：`GET /api/v1/export` → 与客户端 0.3.0 同构 JSON（含 history/outbox 之外的业务数据）；用于用户搬走数据与跨设备恢复兜底。
- **删除**：`DELETE /api/v1/account`：先备份（可选）→ 删业务行/报告/设备/备份文件 → 审计（无正文）；客户端二次确认并清空本地。
- **离线兜底**：即使服务端全丢，客户端 IndexedDB + JSON 导出仍可恢复；这是「本地优先」的底线。

---

## 13. 失败模式与降级矩阵

| 场景 | 表现 | 系统行为 | 用户看到 |
|---|---|---|---|
| 无网络 | 写记录正常 | 不 push；本地 8c 报告可用 | 「离线 · 待同步 N」+ 本地报告标注 |
| 服务端不可用 | push/pull 失败 | 指数退避；本地全功能 | 同步状态「离线」，报告走 8c 本地 |
| 未开启同步 | 纯本地 | 不请求 v1 接口 | 功能同 8c |
| 有同步、无 AI Key | 分析降级 | 服务端规则模板生成 | 「服务端规则生成（AI 不可用）」 |
| AI 超时/返回非法 | 不编造 | 规则模板 + warning；或 502 | 真实状态提示，可重试 |
| 数据不足（窗口内无记录） | 409 | 不生成报告 | 「该窗口还没有记录」引导记录 |
| 未授权某模块 | 事实包该模块 null | 模型不可见 | 报告不含该模块，不提示缺失 |
| 时钟漂移导致 stale | skipped | pull 回填服务端版本 | 无感（最终一致） |
| 同步数据非法 | 整条拒绝 | 保留本地、标记失败 | 「有一条记录同步失败」可查看 |
| DB 损坏 | 启动 `integrity_check` 失败 | fail fast，从最近备份恢复 | 维护页/日志指引（内部验收阶段） |

---

## 14. 测试与验收策略

### 14.1 服务端（新增 `server/test/`）

- **repository / migration**：`:memory:` SQLite；迁移幂等、`sync_seq` 单调、LWW、墓碑、pull 游标、幂等 op。
- **facts builder**：fixture 注入 7/30/90 天数据（含缺失模块、空窗口、授权关闭、跨月、时钟乱序），快照断言；数字与手写 SQL 对照。
- **报告**：净化白名单（长度/数量/禁用字符）、缓存命中/失效、rules 降级、403/409/422/502/503 分支。
- **鉴权与限流**：无 token、吊销 token、恢复码换 token、分析接口单独限流。
- **备份/恢复/删除**：快照 sha256、恢复预览与二次确认、删除后无残留行。

### 14.2 客户端（`app`）

- **迁移**：v1 → v2（训练历史归档、日期补齐、演示数据不入库）；备份 0.1.0/0.2.0 → 0.3.0 导入。
- **同步层**：outbox 幂等、防抖、退避、LWW 合并、墓碑移除、失败标记；用 mock fetch，不连真实服务端。
- **报告页**：四态（服务端 AI / 服务端规则 / 本地降级 / 错误）；标注文案。
- **设置页**：同步区块（开关、恢复码、最后同步、吊销）；关闭后不再请求。

### 14.3 E2E 与真实联调

- Playwright 保持「无真实后端」隔离（`PERSIST_API_TARGET=http://127.0.0.1:9`）；新增用例只覆盖离线态与降级文案。
- 真实后端联调沿用现有手工流程：本机起 `server` + 临时 Key（不入库、用完删除），验证注册 → push → facts → 报告 → 缓存 → 备份 → 恢复 → 删除全链路；真实 Key 上线前轮换。
- 视觉：8d、P4a（设置页新增区块）、P4b（报告页结构变化）各重跑 `visual:check` 并需用户双端验收后更新基线。

### 14.4 验收总门槛（每步结束时报告，不连做）

- 类型检查 0 错、Oxlint 无新增 error、单元测试全绿、构建成功、E2E 全绿（与基线一致或更好）。
- 文档同步（`HANDOFF.md` / `docs/部署与服务器现状.md` / `README.md` / 本文件）。
- 一次一个提交主题（`feat:` / `docs:`），推送并核对远端哈希。

---

## 15. 实施计划（拆分到可验收的步骤）

| 步骤 | 内容 | 主要改动 | 验收要点 | 依赖 |
|---|---|---|---|---|
| **11（8d）** | 数据历史化（前端） | `types.ts`、`persist-state.ts` v2 迁移、`MockDataProvider`、`FitnessPage` 历史列表、饮食/饮水/计划按日、备份 0.3.0 | §6.3 | 无（可与备案等待并行） |
| **12（P4a）** | 账号 + 增量同步 | `server/src/db/*`（驱动/repo/migrate）、`/api/v1/devices*`、`/api/v1/sync/*`、客户端 `sync-*`、设置页同步区块 | §7.4 | 11 + Node 版本决策（§18-1） |
| **13（P4b）** | 服务端聚合 + AI 综合分析 | facts builder、`ANALYSIS_SYSTEM_PROMPT`、`/api/v1/analysis/*`、`/api/v1/reports*`、报告页改造、缓存与可选定时 | §8.5 | 12 |
| **14（P4c）** | 备份/恢复/导出/删除 | `/api/v1/backups*`、`/api/v1/export`、`DELETE /api/v1/account`、定时备份、隐私区块文案 | §12 | 12 |
| 9 / 10 | 部署与域名（不变） | 部署 8c 版本 → 备案后 HTTPS | HANDOFF §13 | 备案 |

说明：11–14 均可在服务器未部署时本地开发（SQLite 本地文件、单测 `:memory:`）；真正影响线上的是步骤 9 之后的每次发布。

---

## 16. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `better-sqlite3` 在服务器编译失败 / 预编译下载不了 | P4a 卡住 | 优先 Node 22 + `node:sqlite`；驱动隔离在一个文件；部署前先在服务器跑一次 `node -e "require('node:sqlite')"` 验证 |
| 同步冲突导致数据丢失 | 用户信任受损 | outbox 幂等 + LWW + 墓碑 + bootstrap 全量 + 服务端每日备份；客户端保留「同步失败」条目，不静默丢弃 |
| token 泄露（XSS / 本地设备） | 数据泄露 | 只存哈希、可吊销、HTTPS、无第三方脚本、CSP；单用户低价值目标，仍按最小权限做 |
| 模型输出质量不稳 / 违约 | 报告不可信 | schema + 白名单 + 长度校验；不合法即失败；rules 降级；真实 Key 人工核对 |
| token 成本随使用增长 | 账单 | 事实包上限 10 KB、缓存按 `dataRev`、分析限流 6/300s、90 天折叠为周 |
| 2C2G 资源不足 | 服务不稳 | 单进程 + WAL + 索引；不在服务器构建；`df`/内存水位告警；备份保留有上限 |
| 合规（备案、隐私政策、删除权） | 上线受阻 | §9 清单 + 步骤 10 前完成隐私区块文案；导出/删除接口先于公开注册上线 |
| 前端冻结被打破后视觉漂移 | 返工 | 8d/P4a/P4b 每步重跑视觉检查并请用户验收；不改导航与设计语言 |
| 日期/时区错位（客户端 vs 服务端） | 统计错日 | 统一 `Asia/Shanghai` + `YYYY-MM-DD`；服务端不接受客户端时区；单测固定时区 |
| 报告与本地数据不一致（本地改了还没同步） | 用户困惑 | 报告页显示「数据截至上次同步时间」；手动同步按钮；离线时明确用本地口径 |

---

## 17. 与现有文档 / 契约的对照

| 现有内容 | 本方案的处理 |
|---|---|
| `HANDOFF.md` §13.4 P4 四步拆分 | 本文件是其实施级展开（§15），备份恢复对应步骤 14 |
| 旧规划（`docs/Persist-项目开发规划.md`）§7.1 Dexie / Drizzle / Docker Compose | 该文档已于 2026-11-04 删除；实际为原生 IndexedDB、无 Docker、无 ORM（SQLite 直写 SQL），本方案维持该偏离并写明原因 |
| 旧规划 §7.5 同步预设计（UUID / `updatedAt` / `deletedAt` / `serverRevision` / Outbox） | 本方案落地并补齐：`rev` 游标、opId 幂等、bootstrap、墓碑保留期、LWW 细节 |
| 旧规划 §7.6 `/api/v1/...` 建议 API | 本方案的 §10 是其收敛版（删除未采用的端点，补 devices/backups/export/account） |
| 8c `/api/report` 契约（`ReportRecord`） | 保留为降级路径；v2 增加 `analysis` 与 `metrics`，前端兼容两种来源 |
| 8a `/api/chat` SSE 契约 | 不变 |
| 前端「数据只在本机」的既定文案（README / 设置页 / 隐私说明） | **必须同步改写**：开启同步后数据副本在自建服务器；默认仍是本地优先，需明确告知差异 |
| `shared/` 占位 | P4 起把 `sync` / `analysis` 契约放 `shared/src/contract/`（`app` 与 `server` 共用，需 tsconfig/vite 路径调整）；`chat` 契约暂留 `server/src/contract.ts`，避免与前端冻结冲突 |

---

## 18. 待用户确认（实施前逐条拍板，未确认不写代码）

1. **服务器 Node 版本策略**：升级 Node 22 LTS 用内置 `node:sqlite`（推荐，无编译依赖）／保留 Node 20 + `better-sqlite3`（需编译工具链）／升级 Node 24 后再确认。→ 影响步骤 9 的部署准备。
2. **同步默认值**：安装后是否弹一次「开启云端同步」引导（推荐：弹，可关，关闭后纯本地）；还是完全手动开启（默认关闭）。
3. **历史数据改造的 UI 变化**：健身历史列表改为真实记录（演示数据消失）、饮食/饮水/计划按日归档 —— 是否接受这次视觉基线重跑与验收。
4. **每日简报定时生成**：是否要（推荐默认关闭，设置页开关，时间 21:00）。
5. **报告保留期**：默认 365 天是否合适；墓碑 30 天、日志 30 天是否接受。
6. **恢复码形态**：一长串码（32 hex）抄写/复制即可（推荐，简单）；还是要更友好的分组码（如 4×8 位）。
7. **是否接受「未授权模块 AI 不可见」的硬边界**（推荐：接受，这是合规与诚实的基础）。

---

## 19. 附录：本方案新增/改动的文件清单（实施时对照）

```text
server/src/db/driver.ts          数据库驱动封装（node:sqlite / better-sqlite3 二选一）
server/src/db/migrate.ts         schema_migrations + DDL
server/src/db/repositories/*.ts  各实体 upsert/pull/查询
server/src/routes/devices.ts     注册 / 恢复 / 吊销
server/src/routes/sync.ts        bootstrap / push / pull
server/src/routes/analysis.ts    facts / reports
server/src/routes/backups.ts     快照 / 恢复 / 导出 / 删除
server/src/analysis/facts.ts     事实包构建（纯函数 + SQL）
server/src/analysis/rules.ts     规则降级模板
server/src/ai/prompts.ts         新增 ANALYSIS_SYSTEM_PROMPT
server/src/ai/analysis.ts        调用模型 + v2 净化 + schema 校验
server/src/jobs/*.ts             定时简报 / 备份 / 墓碑清理
app/src/lib/sync-client.ts       同步 HTTP 客户端
app/src/lib/sync-queue.ts        outbox
app/src/lib/sync-store.ts        token / lastPulledRev / 状态
app/src/lib/sync-merge.ts        pull 合并
app/src/lib/history*.ts          8d 历史归档工具
app/src/types.ts                 8d 历史结构、报告 v2 类型
app/src/lib/persist-state.ts     schemaVersion 2 + 迁移
app/src/lib/mock-data-transfer.ts 备份 0.3.0
app/src/pages/SettingsPage.tsx   同步区块 / 隐私与数据区块
app/src/pages/FitnessPage.tsx    历史列表改真实数据
app/src/pages/ReportsPage.tsx    服务端报告渲染 + 降级
shared/src/contract/*.ts         sync / analysis 共享契约（P4 内迁移）
docs/*.md、README、HANDOFF       每步完成后同步
```

---

## 20. 一句话总结

**先用 8d 把「只有今天」的数据变成「有历史」，再用 P4a 把历史同步成服务端可检索副本，然后用 P4b 让服务端自己算数字、让模型只写分析，最后用 P4c 把备份/导出/删除补齐 —— 这就是「AI 检索我所有数据做综合分析」的终态，而不是继续在前端拼摘要。**
