# Server

Fastify 服务端。P3 阶段只做一件事：**DeepSeek 代理**——浏览器不接触 API Key，服务端把 `ChatEvent` 流原样转发给前端、并生成 AI 报告的文字结论。P4 再加 SQLite 备份/同步。

## 约束（不要破坏）

- 监听 `127.0.0.1:3000`，**不直接对外**；生产由 Nginx 反代 `/api/*`（见 `docs/部署与服务器现状.md`）。
- 服务器运行时是 **Node.js v20.20.2**（本机 v22.19.0），代码与依赖必须兼容 Node 20；`engines` 写 `>=20.19`，**不能用 `node:sqlite`**。
- 任何 API Key 只能保存在服务器 `/etc/persist/server.env`（权限 `600`）；仓库只提交 `.env.example`，禁止 Key 进入 Web 构建产物或 Android 安装包。日志里也不打印 Key。
- P3 阶段**不引入数据库**（代理是无状态转发）。P4 用 **SQLite 单文件库**（`/var/lib/persist/persist.sqlite`），**不装 MySQL/MariaDB**。
- 前端只请求相对路径 `/api/*`；Mock 是「无 Key / 服务不可用」时的降级路径，降级时界面必须如实标注。
- 流式接口是 SSE；Nginx 侧必须 `proxy_buffering off`，否则整段回答会一次性吐出。`/api/report` 是**非流式 JSON**（一次调用等 10–25 s 才返回），Nginx 侧 `proxy_read_timeout` 要 ≥60 s。
- `/api/chat` 与 `/api/report` **共用同一个按 IP 限流器**（默认 20 次 / 5 分钟），这是有意的：两个接口都消耗同一个 DeepSeek 额度。

## 目录

```text
server/
├─ src/
│  ├─ index.ts          入口：读环境变量 → listen → SIGINT/SIGTERM 优雅关闭
│  ├─ app.ts            组装 Fastify（logger/脱敏、error/notFound、注册路由；依赖可注入）
│  ├─ config.ts         环境变量解析与钳制，describeConfig() 绝不回显 Key
│  ├─ contract.ts       请求校验（对应 app/src/lib/chat-types.ts 与 app/src/lib/report-types.ts）+ 错误体
│  ├─ rate-limit.ts     按 IP 的滑动窗口限流（内存实现，单进程够用；chat 与 report 共用）
│  ├─ routes/health.ts  GET /api/health
│  ├─ routes/chat.ts    POST /api/chat（SSE 编排）
│  ├─ routes/report.ts  POST /api/report（非流式 JSON，一次调用出一个报告）
│  └─ ai/
│     ├─ deepseek.ts    DeepSeek 客户端：SSE 解析、超时、取消、有限重试
│     ├─ prompts.ts     中文 system prompt 与档案摘要（含报告提示词；不含敏感原文以外内容）
│     ├─ extract.ts     结构化结果净化（问题/档案增量/计划草案/warnings）
│     └─ report.ts      报告内容净化（字数/条数/重复项/代码块，拒绝就报契约错误）
└─ test/                Vitest：config / contract / rate-limit / extract / deepseek / chat / prompts / report
```

## API

### `GET /api/health`

```json
{
  "status": "ok",
  "service": "persist-server",
  "ai": "deepseek",
  "model": "deepseek-chat",
  "time": "..."
}
```

`ai` 为 `disabled` 表示没配 Key（此时 `/api/chat` 返回 503，前端应回退 Mock）。只暴露「有没有配模型」，绝不回显 Key。

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

| 情况                    | 结果                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| 请求不合契约            | `400 { error: { code: 'invalid_request', message } }`               |
| 没配 `DEEPSEEK_API_KEY` | `503 ai_not_configured`                                             |
| 触发限流                | `429 rate_limited` + `Retry-After`（与 `/api/chat` 共享额度）       |
| 上游超时                | `504 ai_timeout`                                                    |
| 上游其它失败            | `502 ai_failed`                                                     |
| 模型返回不合净化规则    | `502 ai_failed`（宁可报错，也不给前端一份编造的报告）               |
| 客户端提前断开          | `499 client_closed`（不写日志噪音，不再浪费额度）                   |

实现要点：

- **报告只让模型写文字**：`title / status / summary / conclusions / actions / warnings` 由模型生成，**指标数字、依据条目、统计区间仍由前端按本地记录确定性生成**——模型没有机会改数字。
- **提示词明确禁止推算**：只能引用摘要里直接出现的数字，不能做相减/相加/取平均（例如「饮水还差 0.5 L」这种由 1.5 - 1.0 算出来的数字不允许），缺口只能说「按目标补齐」。未授权的来源会从摘要里整段消失，模型也被告知不要提及。
- **净化后再返回**：`sanitizeReportContent()` 校验字数区间、条数上下限、拒绝代码块与重复条目；不合格直接报错走 502，绝不把半成品当报告返回。
- **取消与超时**：`reply.raw.on('close')` 绑定 `AbortController`，客户端关页面即中止上游；单次 25 s 超时，超时映射 504。
- **不落库、不缓存**：响应带 `cache-control: no-store`；服务端不记录请求体、档案或报告正文。

## 开发与验证

```powershell
cd D:\Persist\server
npm install --no-audit --no-fund --cache "D:\Persist\server\.npm-cache"   # 本机沙箱下必须带 workspace 内缓存
npm run typecheck    # tsc -p tsconfig.test.json（含 test）
npm test             # vitest run，58 条
npm run build        # tsc -p tsconfig.json → dist/
npm run format:check # prettier
```

跑真实服务做冒烟（无 Key 时 `/api/chat` 应为 503）：

```powershell
$env:PORT='3101'; node dist/index.js
curl http://127.0.0.1:3101/api/health
```

需要真实联调时，只在**临时进程**里注入 Key、用完即杀，禁止写入任何文件：

```powershell
$env:DEEPSEEK_API_KEY='<临时粘贴>'; $env:PORT='3102'; node dist/index.js
# 另开一个终端：POST /api/chat，确认 HTTP 200 + SSE 事件序列，随后停进程并清环境变量
```

> 本机受限沙箱下 `vitest` 会因 Vite 的 `windowsSafeRealPathSync` 启动子进程报 `spawn EPERM`，需要一次性完整访问权限执行。

## 当前状态与 TODO

- ✅ 8a（`9138175`）服务端骨架 + DeepSeek 客户端 + 净化 + 限流 + SSE 编排，单测覆盖（现共 58 条）。
- ✅ 8b（`b99d3ad`）前端接入：`app/src/lib/ai-chat-client.ts` 用 `createAppChatClient({ consent })` 在真实/Mock 间切换，`probe()` 走 `/api/health`，只在首个内容事件前回退；`PlanChatSheet` / `PlansPage` 如实标注来源。**已用真实 Key 端到端联调**（`/api/chat` 200、3.5 s、127 事件）；真实调用暴露模型给出过去日期，已用「提示词注入 Asia/Shanghai 今天 + 前端日期兜底」修复并复验。
- ✅ 8c（`bdd4265`，2026-11-04）报告接服务端：新增 `POST /api/report`（非流式 JSON）+ `ai/report.ts` 净化 + 报告提示词；前端 `app/src/lib/ai-report-client.ts` 先 `probeAiReport()` 探活，可用才走真实生成，不可用/失败自动回退本地 Mock 并如实标注。**已用真实 Key 验证**：完整摘要 2.7 s 返回、只授权学习时报告不出现训练/饮食字样；提示词原版允许「推算」，真实调用确实算出了「再补水约 0.5 L」这类未授权数字，已改为**禁止任何推算**并复验通过。
- ⚠️ 联调用过的真实 Key 必须在上线前轮换；并发、按 IP 限流命中、Nginx 反代下的 SSE 与 `/api/report` 长连接超时需部署后复验。
- ⬜ 9 部署：systemd `persist-server.service` + `/etc/persist/server.env`(600) + Nginx（`/api` 反代 + SSE `proxy_buffering off` + `proxy_read_timeout ≥60s`）。
- 结构说明：请求/响应类型暂放 `src/contract.ts`（镜像 `app/src/lib/chat-types.ts`、`app/src/lib/report-types.ts`），`shared/` 迁移**推迟**——前端已冻结，现在挪动会同时改 app 的 tsconfig/构建，收益不抵风险；P3 收尾或 P4 再统一。
