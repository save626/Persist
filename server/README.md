# Server

Fastify 服务端。P3 阶段只做一件事：**DeepSeek 代理**——浏览器不接触 API Key，服务端把 `ChatEvent` 流原样转发给前端、并生成 AI 报告的文字结论。P4 开始加**本地 SQLite 数据副本、设备账号与增量同步**：步骤 12 的 12a–12f（服务端数据层与接口、共享契约、前端同步层、设置页「数据同步」卡片）**已于 2026-11-05 在本机完成并验收并推送，2026-11-06 已部署到生产**（Node v22.19.0，`/opt/persist-next`）；步骤 13（服务端 SQL 聚合 + AI 综合分析、每日简报 job、报告归档与 365 天保留）**已于 2026-11-05 在本机完成并验证，2026-11-06 随同一次切换部署**；步骤 14 的每日备份（14a）2026-11-06 已在生产启用，恢复 / 导出 / 删除账号尚未开始。设计见 `docs/P4-数据层与AI综合分析设计方案.md`。

## 约束（不要破坏）

- 监听 `127.0.0.1:3000`，**不直接对外**；生产由 Nginx 反代 `/api/*`（见 `docs/部署与服务器现状.md`）。
- 服务器运行时是 **Node.js v22.19.0**（2026-11-06 按步骤 10 A 段升级，本机同为 v22.19.0）——**步骤 12 起代码要求 Node ≥ 22.5**：SQLite 用内置 `node:sqlite`（`engines` 已写 `>=22.5`，无 native 编译依赖；启动时会打印 `ExperimentalWarning: SQLite is an experimental feature`，属预期）。设计选型见 `docs/P4-数据层与AI综合分析设计方案.md` §4/§18-1：**已定 node:sqlite**。升级完成后，步骤 12/13 的服务端已于 2026-11-06 部署到 `/opt/persist-next`，线上进程即该版本（`ExecStart=/opt/node22/bin/node /opt/persist-next/server/dist/index.js`）；`/opt/persist/server` 保留为步骤 9 的回滚锚点。
- 任何 API Key 只能保存在服务器 `/etc/persist/server.env`（权限 `600`）；仓库只提交 `.env.example`，禁止 Key 进入 Web 构建产物或 Android 安装包。日志里也不打印 Key。
- 步骤 12 起引入 **SQLite 单文件库**（生产 `/var/lib/persist/persist.sqlite`，本机默认 `server/data/persist.sqlite`，可用 `DB_PATH` 覆盖；WAL + `synchronous=NORMAL` + `foreign_keys=ON` + `busy_timeout=5000`）。**不装 MySQL/MariaDB**；不用 ORM，直接 SQL，驱动差异全部隔离在 `src/db/driver.ts`。**schema 现为 v2**（步骤 13 新增 `analysis_reports`、`job_runs` 两张表；迁移每个版本只跑一次、可重复执行，启动时自动升级，不需要手工建表）。
- 前端只请求相对路径 `/api/*`；Mock 是「无 Key / 服务不可用」时的降级路径，降级时界面必须如实标注。
- 流式接口是 SSE；Nginx 侧必须 `proxy_buffering off`，否则整段回答会一次性吐出。`/api/report` 是**非流式 JSON**（一次调用等 10–25 s 才返回），Nginx 侧 `proxy_read_timeout` 要 ≥60 s。综合分析同理是**非流式 JSON**（服务端超时 45 s，`ANALYSIS_TIMEOUT_MS`），Nginx 的 300 s 已足够覆盖。
- `/api/chat` 与 `/api/report` **共用同一个按 IP 限流器**（默认 20 次 / 5 分钟），这是有意的：两个接口都消耗同一个 DeepSeek 额度。`/api/v1/*`（账号 + 同步）用**另一个独立的限流器**（默认 240 次 / 5 分钟，`SYNC_RATE_LIMIT_MAX`），因为客户端会定时轮询同步，不能吃掉 AI 额度。**综合分析另有独立限流**（`/api/v1/analysis/*`，默认 **6 次 / 5 分钟**，`ANALYSIS_RATE_LIMIT_MAX`）——它是最贵的接口，不能和同步轮询共额度。

## 目录

```text
server/
├─ src/
│  ├─ index.ts          入口：读环境变量 → 开库跑迁移 → listen → SIGINT/SIGTERM 优雅关闭
│  ├─ app.ts            组装 Fastify（logger/脱敏、error/notFound、注册路由、开/关库；依赖可注入）
│  ├─ config.ts         环境变量解析与钳制，describeConfig() 绝不回显 Key
│  ├─ contract.ts       chat/report 请求校验（镜像 app/src/lib/*-types.ts）+ 错误体
│  ├─ auth.ts           设备令牌与恢复码的生成 / 规范化 / 哈希（只存哈希）
│  ├─ rate-limit.ts     按 IP 的滑动窗口限流（内存实现，单进程够用）
│  ├─ routes/health.ts  GET /api/health
│  ├─ routes/chat.ts    POST /api/chat（SSE 编排）
│  ├─ routes/report.ts  POST /api/report（非流式 JSON，一次调用出一个报告）
│  ├─ routes/guards.ts  /api/v1 的限流与设备鉴权前置
│  ├─ routes/devices.ts POST /api/v1/devices{,/restore,/revoke}
│  ├─ routes/sync.ts    POST /api/v1/sync/{push,bootstrap} + GET /api/v1/sync/pull
│  ├─ routes/analysis.ts POST /api/v1/analysis/reports + GET /api/v1/analysis/facts（独立限流）
│  ├─ routes/reports.ts GET /api/v1/reports + GET /api/v1/reports/:id（服务端归档）
│  ├─ sync/
│  │  ├─ accounts.ts    注册 / 恢复 / 吊销的业务动作
│  │  └─ service.ts     认证、push 幂等、bootstrap 事务、pull 响应整形
│  ├─ analysis/
│  │  ├─ time.ts        本地日期 / 7-30-90 天窗口与周粒度切分
│  │  ├─ facts.ts       ReportFactsV2 事实包：档案、计划、按日聚合、总量、趋势、覆盖率、授权
│  │  ├─ metrics.ts     指标卡（AnalysisMetric）与前后对比
│  │  ├─ rules.ts       规则降级内容（无 Key / 上游超时时用）
│  │  └─ service.ts     缓存判定（dataRev）、生成编排、白名单校验、归档落库
│  ├─ jobs/daily-brief.ts  每日简报 job：进程内 60 s tick、按本地日期每天一次、失败的 run 下一 tick 可重新抢锁
│  ├─ db/
│  │  ├─ driver.ts      Db 抽象（prepare/run/all/get/exec/transaction），过渡期换驱动只改这里
│  │  ├─ migrations.ts  schema v2（v1 的 14 张表 + analysis_reports / job_runs）
│  │  ├─ entities.ts    实体 kind → 表/列映射、字段校验、训练容量统计
│  │  ├─ repositories/  entities / sync-seq / sync-ops / devices / reports 的 SQL
│  │  └─ index.ts       openPersistDatabase()：建目录、开库、迁移
│  └─ ai/
│     ├─ deepseek.ts    DeepSeek 客户端：SSE 解析、超时、取消、有限重试
│     ├─ prompts.ts     中文 system prompt 与档案摘要（含报告提示词）
│     ├─ analysis.ts    综合分析提示词与响应解析、数字白名单校验
│     ├─ extract.ts     结构化结果净化（问题/档案增量/计划草案/warnings）
│     └─ report.ts      报告内容净化（字数/条数/重复项/代码块，拒绝就报契约错误）
└─ test/                Vitest：config / contract / rate-limit / extract / deepseek / chat / prompts / report / analysis-* / jobs / db-* / devices / sync（18 个文件 / 175 条）
```

> **`@persist/shared`（仓库根 `shared/`）**：同步契约（`contract/sync.ts`、`contract/entities.ts`、`contract/parse.ts`）与**综合分析契约**（`contract/analysis.ts`：事实包 v2 / 报告内容 / 错误码 / 保留期 / 每日简报时间）只有这一份，服务端与前端同源引用。`shared/` 是独立 TS 项目，需先编译出 `shared/dist`：`npm run shared:build`（`prebuild` / `pretest` / `typecheck` 会自动先跑）。`npm install` 已按 `file:../shared` 建立链接；**部署时 `shared/` 必须一起上服务器**（见 `docs/部署与服务器现状.md`）。

## API

### `GET /api/health`

```json
{
  "status": "ok",
  "service": "persist-server",
  "ai": "deepseek",
  "model": "deepseek-chat",
  "time": "...",
  "db": "ok",
  "version": 2
}
```

`ai` 为 `disabled` 表示没配 Key（此时 `/api/chat` 返回 503，前端应回退 Mock）。只暴露「有没有配模型」，绝不回显 Key。`db` 为 `ok` / `error`（读一次 `SELECT 1` 探活），`error` 时 `status` 变 `degraded`；`version` 是当前 schema 版本（迁移跑到第几版，**步骤 13 起为 2**）。这两个字段是步骤 12 新增的向后兼容扩展，旧调用方忽略即可。

### `POST /api/chat`

请求体与前端 `ChatRequest` 一致：

```json
{
  "turns": [{ "role": "user", "content": "我想减脂，每周练 3 次" }],
  "profile": { "age": 30, "height": 175, "...": "...", "aiConsent": true },
  "askedFields": ["goal"]
}
```

响应是 SSE（`text/event-stream`），事件顺序与 `app/src/lib/chat-types.ts` 的契约一一对应：

```text
stage(collect) → delta* → questions? → profilePatch? → stage(propose) → proposal? → warnings? → done
```

失败路径：

| 情况                    | 结果                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| 请求不合契约            | `400 { error: { code: 'invalid_request', message } }`                                             |
| 没配 `DEEPSEEK_API_KEY` | `503 ai_not_configured`                                                                           |
| 触发限流                | `429 rate_limited` + `Retry-After`                                                                |
| 上游失败/超时           | SSE 里发一个 `{ type: 'error', code: 'ai_failed' \| 'timeout', message }` 后断流，**不发 `done`** |

实现要点：

- **一轮对话调用两次模型**：第一次流式生成自然语言回复（逐块转 `delta`），第二次非流式 `response_format: json_object` 抽取结构化结果。结构化结果先过 `sanitizeExtraction()` 白名单净化再发，模型说什么都不能直接决定写档案或建计划。
- **客户端断开即 abort**：`res.on('close')` → `AbortController.abort()`，不再浪费额度；每 15 s 发 `: ping` 心跳防反代超时。
- **重试策略**：只对 429/5xx/网络错误重试，默认 1 次；流式**一旦已吐出内容就不再重试**（否则同一段话出现两次）。
- **日志脱敏**：只记错误对象与元数据，不记请求体/档案内容；Key 从不进日志。

### `POST /api/report`

请求体与前端 `ReportRequest` 一致（`app/src/lib/report-types.ts`）：**只发用户已授权的摘要**，未授权来源在 `digest` 里是 `null`，绝不用 `0` / `[]` 顶替（否则模型会把「没授权」误读成「没有记录」）。

> 调用方有两个：`/reports` 页的「今日简报」与今日页的「晨间简报」（`app/src/lib/morning-brief.ts`，固定 `type='今日简报'`、`rangeDays=7`）。服务端不区分调用方，契约完全相同；晨间简报的缓存（`sessionStorage`，按天 + 摘要指纹）与回退全部在前端完成。

```json
{
  "type": "今日简报",
  "rangeDays": 7,
  "digest": {
    "fitness": {
      "hasSession": true,
      "exerciseCount": 3,
      "doneSets": 6,
      "totalSets": 8,
      "strengthVolumeKg": 1200,
      "durationMinutes": 0,
      "distanceKm": 0,
      "exerciseNames": ["深蹲", "卧推"]
    },
    "study": { "recordCount": 4, "englishCount": 3, "mathCount": 1, "totalMinutes": 120 },
    "diet": { "mealCount": 2, "foodEntryCount": 5, "waterLiters": 1.45, "waterEvents": 2 },
    "profile": { "age": 30, "goal": "减脂", "...": "...", "aiConsent": true }
  }
}
```

`digest` 的 `fitness` / `study` / `diet` / `profile` 允许为 `null`，但至少要有一个不是 `null`。

响应是非流式 JSON：

```json
{
  "report": {
    "title": "把训练未完成的组数补齐",
    "status": "待推进",
    "summary": "……120–220 字……",
    "conclusions": ["……", "……"],
    "actions": ["……", "……"],
    "warnings": []
  },
  "model": "deepseek-chat"
}
```

失败路径：

| 情况                    | 结果                                                          |
| ----------------------- | ------------------------------------------------------------- |
| 请求不合契约            | `400 { error: { code: 'invalid_request', message } }`         |
| 没配 `DEEPSEEK_API_KEY` | `503 ai_not_configured`                                       |
| 触发限流                | `429 rate_limited` + `Retry-After`（与 `/api/chat` 共享额度） |
| 上游超时                | `504 ai_timeout`                                              |
| 上游其它失败            | `502 ai_failed`                                               |
| 模型返回不合净化规则    | `502 ai_failed`（宁可报错，也不给前端一份编造的报告）         |
| 客户端提前断开          | `499 client_closed`（不写日志噪音，不再浪费额度）             |

实现要点：

- **报告只让模型写文字**：`title / status / summary / conclusions / actions / warnings` 由模型生成，**指标数字、依据条目、统计区间仍由前端按本地记录确定性生成**——模型没有机会改数字。
- **提示词明确禁止推算**：只能引用摘要里直接出现的数字，不能做相减/相加/取平均（例如「饮水还差 0.5 L」这种由 1.5 - 1.0 算出来的数字不允许），缺口只能说「按目标补齐」。未授权的来源会从摘要里整段消失，模型也被告知不要提及。
- **净化后再返回**：`sanitizeReportContent()` 校验字数区间、条数上下限、拒绝代码块与重复条目；不合格直接报错走 502，绝不把半成品当报告返回。
- **取消与超时**：`reply.raw.on('close')` 绑定 `AbortController`，客户端关页面即中止上游；单次 25 s 超时，超时映射 504。
- **不落库、不缓存**：响应带 `cache-control: no-store`；服务端不记录请求体、档案或报告正文。

## 账号与同步 API（`/api/v1`，步骤 12）

公共约定：

- 只接受 JSON；错误体统一 `{ "error": { "code", "message" } }`。
- 账号 / 同步接口共用独立限流器（默认 **240 次 / 5 分钟**，`SYNC_RATE_LIMIT_MAX`），按 IP 计数；超限 `429 rate_limited` + `Retry-After`。
- 除注册 / 恢复外都要 `Authorization: Bearer <token>`；令牌无效、被吊销、格式错统一 `401 unauthorized`，**不区分原因**。
- **服务端只存哈希**：设备令牌（`pst_` 前缀）与恢复码（32 位十六进制）都不落库明文；令牌与恢复码只在响应里出现一次，响应带 `cache-control: no-store`。
- 账号模型：一个账号 = 一个 `users` 行 + 多台 `devices`；**恢复码属于账号、固定不变**，换设备只轮换令牌（设计文档 §7.1 原写「恢复时轮换恢复码」，实现改为固定——用户只抄一次，轮换一旦响应丢失用户的码就作废）。

### `POST /api/v1/devices`

首次开启同步时调用，建账号 + 第一台设备。

```json
{ "label": "本机 Chrome" }
```

`label` 可选（≤40 字符，首尾空白会被压掉）。响应 `201`：

```json
{
  "userId": "usr_...",
  "deviceId": "dev_...",
  "token": "pst_...",
  "recoveryCode": "0123456789abcdef0123456789abcdef"
}
```

### `POST /api/v1/devices/restore`

拿恢复码在新设备上换一个新令牌（同一账号，旧设备不受影响）。

```json
{ "recoveryCode": "0123 4567 89ab cdef 0123 4567 89ab cdef", "label": "新手机" }
```

恢复码大小写、空格、短横线都会被规范化。响应 `200 { userId, deviceId, token }`；恢复码格式错或不存在一律 `400 invalid_recovery_code`（不透露账号是否存在）。

### `POST /api/v1/devices/revoke`

吊销本机（不带 `deviceId`）或同账号的指定设备：

```json
{ "deviceId": "dev_..." }
```

响应 `200 { "revoked": true, "deviceId": "dev_..." }`；设备不存在或不属于本账号 `404 device_not_found`。

### 实体格式

同步的所有实体共用一个信封，`kind` 取 9 种之一：`profile`、`settings`、`plan_item`、`study_record`、`fitness_session`、`diet_entry`、`water_log`、`goal`、`long_term_plan`。

```json
{
  "kind": "goal",
  "id": "g_1",
  "updatedAt": 1793847000000,
  "deleted": false,
  "data": { "id": "g_1", "date": "2026-11-05", "title": "每周三练", "enabled": true }
}
```

- `id` 可放在信封上，也可只放在 `data.id`；`profile` / `settings` 是单行实体，不需要 id。
- `updatedAt` 是客户端毫秒时间戳，用于 LWW 裁决（服务端只认这个，不认本地时钟顺序）；`deleted: true` 写墓碑（30 天后可清理）。
- `data` 原样存进 `payload_json`，同时把日期 / 科目 / 热量 / 训练容量等高频字段拆成列（步骤 13 的服务端聚合只读列）。

### `POST /api/v1/sync/push`

增量推送，一次 1–500 个实体：

```json
{ "opId": "c0ffee00-...", "entities": [/* 实体数组 */] }
```

响应：

```json
{
  "applied": 3,
  "skipped": [{ "kind": "plan_item", "id": "pi_9", "reason": "stale" }],
  "serverRev": 42
}
```

- **幂等**：同一 `opId` 重试直接回放上次结果（结果存在 `sync_ops`），不会重复写；`opId` 已被别的账号用过 → `400 invalid_request`。
- `skipped[].reason`：`stale`（服务端已有更新的 `updatedAt`，LWW 判负）、`missing`（删除一个服务端从未见过的实体）、`invalid`（业务字段不合法，带 `message`；**只跳过这一条**，同批其他实体照常写入）。
- 请求形状不对（缺 `opId`、实体超过上限、`kind` 未知名、`updatedAt` 不是正数等）**整批 400**——这类是客户端 bug，不该带病写入。

### `POST /api/v1/sync/bootstrap`

首次全量上传，一次 1–2000 个实体，**一个事务写完**（要么全成、要么不留半套数据）；请求体上限放宽到 8 MB（其余接口仍是 256 KB）。响应结构与 push 相同（无 `opId`，本身按 LWW 幂等：重复上传全部返回 `stale`）。

### `GET /api/v1/sync/pull?since=<rev>&limit=<n>`

增量拉取，按全局 `rev` 升序：

```json
{
  "entities": [
    {
      "kind": "goal",
      "id": "g_1",
      "data": { "id": "g_1", "title": "每周三练" },
      "updatedAt": 1793847000000,
      "deleted": false,
      "rev": 12
    }
  ],
  "nextSince": 12,
  "hasMore": false
}
```

- `since` 传上次的 `nextSince`（首次 0）；`limit` 1–1000，默认 200，越界夹紧而不是报错。
- 墓碑也会返回（`deleted: true`、`data: null`），客户端据此删除本地副本。
- 响应带 `cache-control: no-store`。

## 综合分析 API（`/api/v1`，步骤 13）

> **2026-11-05 本机完成并验证，2026-11-06 已部署到生产。** 设计见 `docs/P4-数据层与AI综合分析设计方案.md` §8–§12。全部接口要 `Authorization: Bearer <deviceToken>`，响应均带 `cache-control: no-store`；**数字全部来自 SQL 聚合，模型只写文字**。

### `POST /api/v1/analysis/reports`

```json
{ "type": "综合分析", "rangeDays": 30, "force": false }
```

- `rangeDays` 只接受 `7 / 30 / 90`（`ANALYSIS_RANGE_DAYS`）；`type` 目前只有 `综合分析`（`ANALYSIS_REPORT_TYPE`）。
- **成功响应是平铺对象，没有 `{ report }` 包裹**（`AnalysisReportResponse`）：

```json
{
  "reportId": "ar_1",
  "type": "综合分析",
  "rangeDays": 30,
  "range": { "start": "2026-10-07", "end": "2026-11-05", "days": 30 },
  "origin": "ai",
  "cached": false,
  "model": "deepseek-chat",
  "dataRev": 42,
  "createdAt": "2026-11-05T13:20:00.000Z",
  "content": {
    "title": "...",
    "status": "...",
    "summary": "...",
    "analysis": ["...", "...", "..."],
    "conclusions": [],
    "actions": [],
    "warnings": []
  },
  "metrics": []
}
```

- **主键字段叫 `reportId`**（不是 `id`）；归档列表项才叫 `id`。
- **缓存键是 `dataRev`**（= 服务端 `sync_seq.value`，即该账号数据版本）：同一数据版本重复请求直接返回 `cached: true` 且不再调用模型；`force: true` 会重新生成，**只有新报告生成成功后才删旧缓存**（生成失败旧报告仍在）。
- **内容重试**：模型输出先过净化与数字白名单，段落数不在 2–5 段、正文出现事实包以外的数字、或正文夹带 `daysWithAnyRecord` / `weekly` 这类内部标识符时，服务端带失败原因**重试一次**（总预算 30 s）；仍不合规才 502 `invalid_response`，不落半份报告。

- **降级语义**（无 Key / 上游超时 / 上游 5xx）：仍是 **200**，`origin: "rules"`、`model: null`，内容走规则生成——分析失败不让用户白等，但要如实标来源。
- 错误码：

| HTTP | `error.code`        | 触发条件                                                 |
| ---- | ------------------- | -------------------------------------------------------- |
| 403  | `ai_consent_off`    | 同步上来的 `settings.aiConsent === false`                |
| 409  | `insufficient_data` | 窗口内没有任何记录                                       |
| 422  | `invalid_request`   | 请求体形状 / `rangeDays` 不合法                          |
| 429  | `rate_limited`      | 触发独立分析限流（默认 6 次 / 5 分钟）                   |
| 502  | `invalid_response`  | 重试一次后仍不合契约（不可解析 / 数字越界 / 段落数不对） |

- **数字白名单**：模型正文里出现的每个数字都必须能在 `JSON.stringify(facts)` 里找到，否则按 `invalid_response` 拒绝（先重试一次）、不归档。这条和前端共用 `ANALYSIS_CONTENT_LIMITS` / 校验口径。

### `GET /api/v1/analysis/facts?rangeDays=30`

返回同一套 SQL 聚合的 `ReportFactsV2`（档案、计划、按日记录、总量、趋势、覆盖率、授权）。粒度：**7 天只出日；30 天出日 + 周；90 天只出周**（`granularity: 'week'`）。这个接口不调用模型、不写库。

### `GET /api/v1/reports?limit=&cursor=` 与 `GET /api/v1/reports/:id`

服务端归档列表（`{ reports, nextCursor }`，倒序）与单条详情（不存在 → 404 `{ error: { code: 'not_found' } }`）。列表只回摘要字段，不回完整正文。

### 归档与保留

- 报告落 `analysis_reports` 表，`UNIQUE(user_id, type, range_days, data_rev)` 保证同一数据版本只有一条。
- 保留 **365 天**（`DATA_RETENTION.reportDays`）：**每次成功生成时顺带 `pruneReports(now - 365d)`**，没有独立的清理定时器。
- 墓碑 30 天 / 审计日志 30 天的清理**尚未实现**（只有设计常量，别当成已落地）。

### 每日简报 job（`src/jobs/daily-brief.ts`）

- 进程内 **60 s tick**（`unref`，不阻止退出），**不需要额外 systemd timer**；`DAILY_BRIEF_ENABLED` **默认关闭**。
- `runKey` = 当天本地日期（`job_runs` 表 `UNIQUE(name, run_key)` 保证同一天只跑一次）；生成失败记 `failed`，**下一个 tick（60 s 后）会重新抢锁再试**，成功后不再重跑。模型输出不合规的重试已由分析服务内部处理（见上），job 自己不再套一层重试，避免同一次简报打 4 次模型。
- 到点判断读的是**同步上来的** `settings.payload_json.dailyBrief`（`enabled` / `at`，`DAILY_BRIEF_AT` 默认 `21:00`）；**服务端环境变量只在完全没有 settings 时作兜底**——所以这个功能隐含「先开跨设备同步并把设置同步上来」。
- 日志只记 `{ reportId, origin, cached, rangeDays, runKey }` 或 `{ error, runKey }`，**绝不打印报告正文**。

## 开发与验证

```powershell
cd D:\Persist\server
npm install --no-audit --no-fund --cache "D:\Persist\server\.npm-cache"   # 本机沙箱下必须带 workspace 内缓存
npm run shared:build  # 先编译 ../shared → shared/dist（prebuild/pretest/typecheck 会自动跑）
npm run typecheck    # tsc -p tsconfig.test.json（含 test）
npm test             # vitest run，175 条（18 个文件）
npm run build        # tsc -p tsconfig.json → dist/
npm run format:check # prettier
```

> **Node ≥ 22.5 必需**：`node:sqlite` 是内置模块，Node 20 跑不起来（`Cannot find module 'node:sqlite'`）。本机 v22.19.0 可用，启动时报一条 `ExperimentalWarning` 属预期。`tests` 用 `DB_PATH=':memory:'` 起库，不会在磁盘留文件。

跑真实服务做冒烟（无 Key 时 `/api/chat`、`/api/report` 应为 503，综合分析走规则降级）：

```powershell
$env:PORT='3101'; node dist/index.js
curl http://127.0.0.1:3101/api/health
# health 里应出现 "db": "ok" 与 "version": 2；默认库文件在 server/data/persist.sqlite
# "ai" 字段：没有 Key 时是 "disabled"，配了 Key 才是 "deepseek"
```

> **脚本不会自动读 `server/.env`**：`dev` / `start` / `node dist/index.js` 只读 `process.env`，本机写了 `.env` 也照样是 `ai: "disabled"`。要带真实 Key 启动，用 Node 的 `--env-file`（本机 Node v22.19.0 支持）：
>
> ```powershell
> cd D:\Persist\server
> node --env-file=.env dist/index.js    # 启动日志应出现 "ai":"deepseek"
> ```
>
> `--env-file-if-exists` 需要 Node ≥ 22.9，所以没写进 npm 脚本——服务器 Node 版本还没到，脚本保持 `node dist/index.js`，靠部署侧注入环境变量（systemd `EnvironmentFile`）。

综合分析冒烟：注册设备拿 token → `bootstrap` 推几条记录（**实体 id 用随机后缀或 uuid**，服务端实体表主键是全局 `id`，不同账号复用同一个 id 会撞主键报 500）→ `POST /api/v1/analysis/reports`（无 Key 时 200、`origin: "rules"`、`model: null`；有真实 Key 时 `origin: "ai"`、`model: "deepseek-chat"`）→ 再请求一次（同 `dataRev` 应 `cached: true` 且 `reportId` 相同）→ `GET /api/v1/reports` 与 `/:id` 能看到归档。

持久化冒烟（验证「重启后数据还在」）：注册 → push 一条 → 杀进程 → 重启 → 同一 token 再 pull，实体应原样返回；顺带用 `recoveryCode` 调 restore 能拿到同一 `userId` 的新 token。注意：**已经拉起的库文件会留在 `server/data/`**（已被 `.gitignore` 忽略），冒烟完可直接删。

本机真实 Key 联调：`server/.env`（gitignored）填 `DEEPSEEK_API_KEY`，用上面的 `--env-file` 方式启动，另开终端打 `/api/chat`（SSE）、`/api/report`、`/api/v1/analysis/reports` 三条链路。**别把 Key 写进任何脚本、文档或提交**；临时验证可在进程内注入环境变量，用完即杀。

> 本机受限沙箱下 `vitest` 会因 Vite 的 `windowsSafeRealPathSync` 启动子进程报 `spawn EPERM`，需要一次性完整访问权限执行。

## 当前状态与 TODO

- ✅ 8a（`9138175`）服务端骨架 + DeepSeek 客户端 + 净化 + 限流 + SSE 编排，单测覆盖（2026-11-03 时 58 条；步骤 13 后现共 **175 条 / 18 个文件**）。
- ✅ 8b（`b99d3ad`）前端接入：`app/src/lib/ai-chat-client.ts` 用 `createAppChatClient({ consent })` 在真实/Mock 间切换，`probe()` 走 `/api/health`，只在首个内容事件前回退；`PlanChatSheet` / `PlansPage` 如实标注来源。**已用真实 Key 端到端联调**（`/api/chat` 200、3.5 s、127 事件）；真实调用暴露模型给出过去日期，已用「提示词注入 Asia/Shanghai 今天 + 前端日期兜底」修复并复验。
- ✅ 8c（`bdd4265`，2026-11-04）报告接服务端：新增 `POST /api/report`（非流式 JSON）+ `ai/report.ts` 净化 + 报告提示词；前端 `app/src/lib/ai-report-client.ts` 先 `probeAiReport()` 探活，可用才走真实生成，不可用/失败自动回退本地 Mock 并如实标注。**已用真实 Key 验证**：完整摘要 2.7 s 返回、只授权学习时报告不出现训练/饮食字样；提示词原版允许「推算」，真实调用确实算出了「再补水约 0.5 L」这类未授权数字，已改为**禁止任何推算**并复验通过。
- ✅ 步骤 9 部署（2026-11-04）：systemd `persist-server.service`（`User=persist`、`Restart=always`）+ `/etc/persist/server.env`（`600 root:root`，新轮换的 Key 只在这里）+ Nginx `/etc/nginx/conf.d/persist.conf`（`/api` 反代 + SSE `proxy_buffering off` + `proxy_read_timeout 300s`）。IP 直连实测：`/api/health` `ai:"deepseek"`；SSE 188 事件、首包 0.118 s、末包 4.215 s 增量到达；`/api/report` 200 / 2.78 s；限流第 2 次 `429` + `Retry-After: 298`。**仅内部调试，未对外宣称上线。**
- ✅ 晨间简报接入后重部署（2026-11-04，`9f9cc71`）：**服务端代码零改动**（前端复用同一 `/api/report`），仅替换 `/var/www/persist` 静态产物；实测 `/api/health` `ai:"deepseek"`、真实 `/api/report` 200 / 2.701 s；旧 JS 资源 404。
- ✅ lint 清理后第三次重部署（2026-11-04，`f5a57f5`）：**服务端与 Nginx 配置零改动**，仅替换 `/var/www/persist` 静态产物（`index-DVS7rlR_.js` 567592 B）；实测 8 页深链 200、`/api/health` `ai:"deepseek"`、真实 `/api/report` 200 / 2.284 s；旧 JS 资源 404。
- ⬜ 下一阶段（步骤 10，2026-11-06 拆解）：**服务器 Node 升到 22 LTS**（本步起代码需要 `node:sqlite`）+ 建 `/var/lib/persist` 与 systemd `ReadWritePaths` + 每日 `VACUUM INTO` 备份 + 部署本服务（步骤 12/13 的代码）——**这一组不等备案号**；域名解析 + 443 + 证书 + 页脚备案号**才**等备案号；SSH 改仅密钥登录、删 3389、装 `fail2ban` 也不等备案号。
- ✅ 步骤 12a（2026-11-05）：`src/db/*` 数据层——`driver.ts`（`Db` 抽象：`prepare/run/all/get/exec/transaction`，`BEGIN IMMEDIATE` + 嵌套 `SAVEPOINT`）、`migrations.ts`（schema v1，14 张表）、`entities.ts`（9 类实体的列映射与校验）、`repositories/*`（实体 upsert/拉取、rev 分配、sync_ops、设备/账号）、`index.ts`（`openPersistDatabase()`）。单测覆盖驱动、迁移、仓储三层。
- ✅ 步骤 12b（2026-11-05）：账号 + 同步接口——`auth.ts`（令牌 / 恢复码生成与哈希，只存哈希）、`POST /api/v1/devices{,/restore,/revoke}`、`POST /api/v1/sync/{push,bootstrap}` + `GET /api/v1/sync/pull`（opId 幂等、LWW、墓碑、分页）、独立同步限流器、`/api/health` 增加 `db` / `version`。`engines` 提到 `>=22.5`。**本机验收**：tsc 0 错、单测 112/112、真实进程冒烟（重启后数据仍在、恢复码换设备拿到同一 userId）。**已于 2026-11-06 部署到服务器**（步骤 10 A 段已升 Node v22.19.0）；前端同步层与设置页开关见下面 12d/12e 条目。
- ⬜ P4 剩余（步骤 14）：备份 `VACUUM INTO`、导出、删除账号（步骤 14）。步骤 12 与步骤 13 的**部署**随步骤 10 A 段一起做（服务器升 Node 22，不等备案号）。设计见 `docs/P4-数据层与AI综合分析设计方案.md` §5–§12。
- ✅ 步骤 12c（2026-11-05）：同步契约搬进 `shared/src/contract/`（`sync.ts` / `entities.ts` / `parse.ts`），以 `@persist/shared` 包（`file:../shared`）供 `app` 与 `server` 同源引用；服务端删掉 `src/sync/contract.ts`、`db/entities.ts` 只做转出，前端新增 `app/src/lib/sync-contract.ts` 作为唯一入口。`shared/dist` 由 `shared:build` 产出（已 gitignore）。验收：shared 编译 0 错、服务端 tsc 0 错 + 单测 112/112、前端 tsc 0 错 + 单测 230/230 + oxlint 0/0、`vite build` 产物 hash 与 12b 一致（说明共享层未意外改动前端行为）、真实进程冒烟通过（push 幂等回放 rev 不变、重启后 pull 得到数据、恢复码换设备同 userId）。
- 结构说明：chat/report 的请求响应类型仍在 `src/contract.ts`（镜像 `app/src/lib/chat-types.ts`、`app/src/lib/report-types.ts`），迁移 `shared/` 另排期；**同步契约已迁完**（`shared/src/contract/sync.ts`），前端 12d 直接经由 `app/src/lib/sync-contract.ts` 引用，不再另抄。
- ✅ 步骤 12d（2026-11-05，`9abd8bb`）前端同步层：`app/src/lib/` 新增 `sync-client.ts`（`/api/v1/*` 客户端、错误分类、指数退避）、`sync-store.ts`（`persist-sync` IndexedDB：元数据 + outbox）、`sync-queue.ts`（opId 批次与合并）、`sync-entities.ts`（8 切片摊平 / 差分 / pull 合并 LWW + 墓碑）、`sync-engine.ts`（bootstrap、5 s 防抖增量、60 s 兜底、`online`/`visibility` 触发）。设置页开关默认关闭，关闭时不发任何同步请求。
- ✅ 步骤 12e（2026-11-05，`f09c3da`）设置页「数据同步」卡片：开关（`aria-label="跨设备同步"`）、注册后展示 32 位恢复码（4×8 大写）、「用恢复码绑定已有账号」、本机设备与最近同步时间、立即同步、吊销本机（`alertdialog` 二次确认）。E2E 增加 2 条用例（mock `**/api/v1/**`）。
- ✅ 步骤 12f（2026-11-05，`e9c29a0`）收尾：pull 合并前的形状守卫 `matchesRecordShape`（形状不合规 / body id 与信封 id 不一致的实体计 `skipped`，不写本地存档）；**本机验收** P4 §7.4 六项 19/19、app 单测 292/292（21 文件）、server 112/112（13 文件）、E2E 110、`vite build` JS 606.08 kB / CSS 140.20 kB；13 张视觉基线 png 差异已随 `4d3edcf` 入库。**已推送；服务端 2026-11-06 已部署**（视觉基线 13 张已随 `4d3edcf` 入库）。
- ✅ 步骤 13a（2026-11-05，`41ed92f`）契约与数据层：`shared/src/contract/analysis.ts`（`ANALYSIS_REPORT_TYPE` / `ANALYSIS_RANGE_DAYS` / `ReportFactsV2` / `ANALYSIS_CONTENT_LIMITS` / `AnalysisReportResponse` / `ANALYSIS_ERROR_CODES` / `DATA_RETENTION` / `DEFAULT_DAILY_BRIEF_AT` + `parseDailyBriefAt` / `normalizeDailyBriefSettings`），`package.json` 加 `./contract/analysis` 子路径；schema **v2** 迁移新增 `analysis_reports`（`UNIQUE(user_id, type, range_days, data_rev)`）与 `job_runs`（`UNIQUE(name, run_key)`）；`db/repositories/reports.ts` 与 jobs 仓储。
- ✅ 步骤 13b（2026-11-05，`82ed773`）聚合与接口：`src/analysis/{time,facts,metrics,rules,service}.ts` + `src/ai/analysis.ts`，四个接口（`POST /api/v1/analysis/reports`、`GET /api/v1/analysis/facts`、`GET /api/v1/reports`、`GET /api/v1/reports/:id`）全部 `no-store`；缓存键 `dataRev`、`force` 重新生成但只在成功后删旧缓存；降级 200 / `invalid_response` 502 / `ai_consent_off` 403 / `insufficient_data` 409 / 独立限流 429 / 入参 422；数字白名单校验；`ANALYSIS_RATE_LIMIT_MAX` 等 5 个新环境变量进入 `.env.example`。
- ✅ 步骤 13c（2026-11-05，`40d2bf4`）每日简报 job：`src/jobs/daily-brief.ts`，进程内 60 s tick（`unref`）、`runKey` = 本地日期、默认关闭、读同步上来的 `settings.dailyBrief`（env 仅兜底）、生成时 `pruneReports(now - 365d)`；日志只记元信息不记正文。失败记 `failed`，下一 tick 重新抢锁（不再由 job 自己套重试）。
- ✅ 步骤 13d（2026-11-05，`18d5f77`）**真实 Key 联调修复**：模型偶尔写 6 段（契约 2–5 段）导致 502、正文夹带 `daysWithAnyRecord` / `trend` 等内部字段名。改为内容不合规时**带失败原因重试一次**（`MAX_CONTENT_ATTEMPTS=2`、预算 30 s），提示词明确「analysis 固定 3 段、不出现英文字段名/JSON 键名/内部标识符」；日简报去掉外层重试避免 4 次调用模型。新增 2 条单测（首次不合规重试后落库 / 两次不合规 502 不落库），server 175 条全过。
- ✅ 步骤 13 **本机验收**（2026-11-05，已推送 `41ed92f` / `82ed773` / `40d2bf4` / `7f13727` / `18d5f77` / `5ba4f7e` + 文档提交；**服务端 2026-11-06 已部署**）：server `tsc -b` 0 错、`npm test` **18 文件 / 175 条全过**、`prettier --check` 通过；真实 HTTP 四组（临时 vitest 用例，验收后已删）：① 注册设备 → bootstrap 5 类记录 → 分析 200 平铺；② 同 `dataRev` 二次请求 `cached: true`；③ 归档列表 / 详情 → facts v2（30 天 `granularity: 'day'`，只含真正有记录的天）→ 规则降级 `model: null`；④ 数字白名单违规 502 且不入档、空窗口 409、当日第 7 次 429（未授权 403 由路由单测覆盖）。**真实 DeepSeek Key 本机验证（2026-11-05，`server/.env` + `node --env-file=.env dist/index.js`）**：`/api/chat` 200 / 2.4 s SSE 中文增量 + 追问问题；`/api/report` 200 / 3.3 s、引用当天 8/10 组与 1200 kg；综合分析首次 200 / 5.7 s（`origin: "ai"`、`model: "deepseek-chat"`）、同参 `cached: true` 且 `reportId` 相同、`force` 200 / 5.4 s 生成新 id、列表与详情 id/标题一致、正文无英文字段名。**线上服务器 2026-11-06 已部署步骤 12/13（Node v22.19.0），前端产物 2026-11-07 已上传（仍 IP 直连，未上线）。**
