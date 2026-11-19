# Server

Fastify 服务端。P3 阶段只做一件事：**DeepSeek 代理**——浏览器不接触 API Key，服务端把
`ChatEvent` 流原样转发给前端、并生成 AI 报告的文字结论。P4 起加了**本地 SQLite 数据副本、
设备账号与增量同步**，以及**服务端 SQL 聚合 + AI 综合分析**。

**全部已实施并部署生产。** 生产实例运行 `/opt/persist-next/server`（Node v22.19.0，
数据库 `/var/lib/persist/persist.sqlite` **schema 5**），`/opt/persist/server` 是步骤 9 的
旧树，留作回滚锚点。设计见 [`docs/P4-数据层与AI综合分析设计方案.md`](../docs/P4-数据层与AI综合分析设计方案.md)，
现状与待办见 [`HANDOFF.md`](../HANDOFF.md)。

## 约束（不要破坏）

- 监听 `127.0.0.1:3000`，**不直接对外**；生产由 Nginx 反代 `/api/*`（见 `docs/部署与服务器现状.md`）。
- 服务器运行时是 **Node.js v22.19.0**（2026-11-06 按步骤 10 A 段升级，本机同为 v22.19.0）——**步骤 12 起代码要求 Node ≥ 22.5**：SQLite 用内置 `node:sqlite`（`engines` 已写 `>=22.5`，无 native 编译依赖；启动时会打印 `ExperimentalWarning: SQLite is an experimental feature`，属预期）。设计选型见 `docs/P4-数据层与AI综合分析设计方案.md` §4/§18-1：**已定 node:sqlite**。升级完成后，步骤 12/13 的服务端已于 2026-11-06 部署到 `/opt/persist-next`，线上进程即该版本（`ExecStart=/opt/node22/bin/node /opt/persist-next/server/dist/index.js`）；`/opt/persist/server` 保留为步骤 9 的回滚锚点。
- 任何 API Key 只能保存在服务器 `/etc/persist/server.env`（权限 `600`）；仓库只提交 `.env.example`，禁止 Key 进入 Web 构建产物或 Android 安装包。日志里也不打印 Key。
- **后端部署必须同时包含 `shared/package.json`**：生产 `server/node_modules/@persist/shared` 是软链，指向 `/opt/persist-next/shared`。2026-11-11 首次部署只带 `shared/dist`，旧 `package.json` 缺少 `contract/report` export，导致启动报 `ERR_PACKAGE_PATH_NOT_EXPORTED` 并由部署脚本回滚。发布包必须同时带 `server/dist`、`server/package.json`、`shared/dist`、`shared/package.json`。
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
│  ├─ routes/export.ts GET /api/v1/export（14c；当前账号 0.3.0 JSON 下载）
│  ├─ routes/account.ts DELETE /api/v1/account（14d；显式确认 + 事务硬删除）
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
│  ├─ export/account-export.ts 14c 账号业务行 → 客户端 0.3.0 备份形状
│  ├─ account/delete-account.ts 14d 账号硬删除 / 快照清理 / 多账号快照保护
│  ├─ db/
│  │  ├─ driver.ts      Db 抽象（prepare/run/all/get/exec/transaction），过渡期换驱动只改这里
│  │  ├─ migrations.ts  schema v2（v1 的 14 张表 + analysis_reports / job_runs）
│  │  ├─ entities.ts    实体 kind → 表/列映射、字段校验、训练容量统计
│  │  ├─ backup.ts      14a 快照 / sha256 / 保留瀑布
│  │  ├─ restore.ts     14b 预览 / 校验 / 原子替换与失败回滚
│  │  ├─ repositories/  entities / sync-seq / sync-ops / devices / reports 的 SQL
│  │  └─ index.ts       openPersistDatabase()：建目录、开库、迁移
│  └─ ai/
│     ├─ deepseek.ts    DeepSeek 客户端：SSE 解析、超时、取消、有限重试
│     ├─ prompts.ts     中文 system prompt 与档案摘要（含报告提示词）
│     ├─ analysis.ts    综合分析提示词与响应解析、数字白名单校验
│     ├─ extract.ts     结构化结果净化（问题/档案增量/计划草案/warnings）
│     └─ report.ts      报告内容净化（字数/条数/重复项/代码块，拒绝就报契约错误）
└─ test/                Vitest：config / contract / rate-limit / extract / deepseek / chat / prompts / report / analysis-* / jobs / db-* / devices / sync / export / account-delete / ai-*（条数以根目录 `HANDOFF.md` §2 实测为准）
```

> **`@persist/shared`（仓库根 `shared/`）**：同步契约（`contract/sync.ts`、`contract/entities.ts`、`contract/parse.ts`）与**综合分析契约**（`contract/analysis.ts`：事实包 v2 / 报告内容 / 错误码 / 保留期 / 每日简报时间）只有这一份，服务端与前端同源引用；`contract/backup.ts` 现同时承载快照列表 / 手动创建 / 恢复契约，14c 新增 `contract/export.ts` 导出信封与下载文件名契约，14d 新增 `contract/account.ts` 删除请求 / 响应计数契约。`shared/` 是独立 TS 项目，需先编译出 `shared/dist`：`npm run shared:build`（`prebuild` / `pretest` / `typecheck` 会自动先跑）。`npm install` 已按 `file:../shared` 建立链接；**部署时 `shared/` 必须一起上服务器**（见 `docs/部署与服务器现状.md`）。

## Android WebView 的 CORS

Capacitor Android 的 WebView 以 `https://localhost` 作为本地页面 origin，API 则按 `.env.mobile.local` 的 `VITE_PERSIST_API_BASE_URL` 跨源访问。服务端默认允许 `https://localhost`，也可用逗号分隔的 `PERSIST_ALLOWED_ORIGINS` 覆盖（只接受完整 http(s) origin）。这只解决浏览器 CORS，不是 API 鉴权；公开部署前仍必须补服务端 token 门、来源限制、配额与审计。
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

## 备份、恢复、导出与删除

> **2026-11-18：备份 HTTP 端点已从服务端删除。**
> `GET /api/v1/backups`、`POST /api/v1/backups` 与 `POST /api/v1/backups/:id/restore`
> 原先只校验「任意有效设备令牌」，`listBackups` 返回整机快照列表、`executeRestore` 直接用
> `database.path` 换库，**没有管理员判断**——配上开放注册等于「任何注册者都能整库回滚」。
> 因前端零引用（`app/src` 无一处调 `/api/v1/backups`），**直接删除路由而非加管理员令牌**
>（那会复刻刚消灭的 `psa_` 问题）。公网探测现返回 **404**。
> **不要在没有管理员鉴权的前提下把这两个端点加回来。**

**备份与恢复改走服务器本机**：

- 每日 systemd timer 调 `dist/db/backup-cli.js` 执行 `VACUUM INTO`，快照与 `.sha256` 旁车同目录保存
- 保留策略由 `BACKUP_KEEP_*` 配置执行
- 手工建快照必须 `runuser -u persist -- ...`（root 跑出来的快照服务进程读不到 `.sha256`，
  `GET /api/v1/backups` 当时只返回 `sha256: null` 且不报错，**恢复时才失败**）
- 恢复的底层实现仍在 `server/src/db/restore.ts`，契约在 `@persist/shared/contract/backup`

**仍存在的 HTTP 端点**：

- **`GET /api/v1/export`**（14c）：设备令牌鉴权，返回账号级 JSON，客户端 0.3.0 导入格式
- **`DELETE /api/v1/account`**（14d）：设备令牌 + `confirm:true`，单事务硬删除当前账号的业务行、
  分析归档、任务、同步台账与设备，并清理规范快照及旁车；多 active 账号且存在整库快照时返回 409

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
npm test             # vitest run，226 条（25 个文件）
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

**已全部实施并部署生产**（2026-11-19 实测）：

- **AI 边界**：`/api/chat` 与 `/api/report` 需 `Authorization: Bearer psa_…`（PSK，
  `PERSIST_AI_GATE=enforce`），共用每日 100 次 + 20 万 token 双配额，写 `ai_calls` 审计
  （保留 30 天）。公网无凭据一律 `401 ai_unauthorized`。
- **数据层**：SQLite 单文件库，生产 **schema 5**，含 `users / devices / ai_usage /
  ai_calls / audit_log / analysis_reports / sync_ops / job_runs` 等表。
- **同步与账号**：`/api/v1/devices*`、`/api/v1/sync/*`、设备令牌 + 恢复码；
  **注册已关闭**（生产 `PERSIST_REGISTRATION_MAX_ACCOUNTS=1` 且 `users=1`，新注册 409）。
- **综合分析**：`/api/v1/analysis/*`、`/api/v1/reports*`、每日简报 job（默认关闭）、
  报告归档 365 天保留。
- **备份**：每日 systemd timer 走 `dist/db/backup-cli.js`（`VACUUM INTO` + sha256 旁车 +
  保留瀑布）。**备份 HTTP 端点已删除**（见「备份、恢复、导出与删除」一节）。
- **安全**：`TRUST_PROXY=loopback`（只信本机代理）；Nginx 用
  `proxy_set_header X-Forwarded-For $remote_addr`（**不是** `$proxy_add_x_forwarded_for`，
  否则客户端伪造头即可绕过按 IP 的限流）；`/api/health` 不返回 schema 与 model。

**待办**（详见根目录 [`HANDOFF.md`](../HANDOFF.md) §4）：

- **P3 Android 正式签名**（keystore 与密码保管方式待用户拍板）
- `devices` 吊销行无清理任务（低优先，行数缓慢增长）

**生产实况与操作规则**见 [`docs/部署与服务器现状.md`](../docs/部署与服务器现状.md)。
