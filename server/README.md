# Server

Fastify 服务端。P3 阶段只做一件事：**DeepSeek 代理**——浏览器不接触 API Key，服务端把 `ChatEvent` 流原样转发给前端。P4 再加 SQLite 备份/同步。

## 约束（不要破坏）

- 监听 `127.0.0.1:3000`，**不直接对外**；生产由 Nginx 反代 `/api/*`（见 `docs/部署与服务器现状.md`）。
- 服务器运行时是 **Node.js v20.20.2**（本机 v22.19.0），代码与依赖必须兼容 Node 20；`engines` 写 `>=20.19`，**不能用 `node:sqlite`**。
- 任何 API Key 只能保存在服务器 `/etc/persist/server.env`（权限 `600`）；仓库只提交 `.env.example`，禁止 Key 进入 Web 构建产物或 Android 安装包。日志里也不打印 Key。
- P3 阶段**不引入数据库**（代理是无状态转发）。P4 用 **SQLite 单文件库**（`/var/lib/persist/persist.sqlite`），**不装 MySQL/MariaDB**。
- 前端只请求相对路径 `/api/*`；Mock 是「无 Key / 服务不可用」时的降级路径，降级时界面必须如实标注。
- 流式接口是 SSE；Nginx 侧必须 `proxy_buffering off`，否则整段回答会一次性吐出。

## 目录

```text
server/
├─ src/
│  ├─ index.ts          入口：读环境变量 → listen → SIGINT/SIGTERM 优雅关闭
│  ├─ app.ts            组装 Fastify（logger/脱敏、error/notFound、注册路由；依赖可注入）
│  ├─ config.ts         环境变量解析与钳制，describeConfig() 绝不回显 Key
│  ├─ contract.ts       请求校验（对应 app/src/lib/chat-types.ts）+ 错误体
│  ├─ rate-limit.ts     按 IP 的滑动窗口限流（内存实现，单进程够用）
│  ├─ routes/health.ts  GET /api/health
│  ├─ routes/chat.ts    POST /api/chat（SSE 编排）
│  └─ ai/
│     ├─ deepseek.ts    DeepSeek 客户端：SSE 解析、超时、取消、有限重试
│     ├─ prompts.ts     中文 system prompt 与档案摘要（不含敏感原文以外内容）
│     └─ extract.ts     结构化结果净化（问题/档案增量/计划草案/warnings）
└─ test/                Vitest：config / contract / rate-limit / extract / deepseek / chat
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

## 开发与验证

```powershell
cd D:\Persist\server
npm install --no-audit --no-fund --cache "D:\Persist\server\.npm-cache"   # 本机沙箱下必须带 workspace 内缓存
npm run typecheck    # tsc -p tsconfig.test.json（含 test）
npm test             # vitest run，38 条
npm run build        # tsc -p tsconfig.json → dist/
npm run format:check # prettier
```

跑真实服务做冒烟（无 Key 时 `/api/chat` 应为 503）：

```powershell
$env:PORT='3101'; node dist/index.js
curl http://127.0.0.1:3101/api/health
```

> 本机受限沙箱下 `vitest` 会因 Vite 的 `windowsSafeRealPathSync` 启动子进程报 `spawn EPERM`，需要一次性完整访问权限执行。

## 当前状态与 TODO

- ✅ 8a（本步）服务端骨架 + DeepSeek 客户端 + 净化 + 单测 38 条，**未用真实 Key 联调**（本机没有 Key，上游返回格式未在真机上验证）。
- ⬜ 8b 前端适配器：`ChatClient` 换成 `/api/chat`，失败/无 Key 自动回退 Mock 并如实标注来源。
- ⬜ 8c AI 报告走服务端（现在仍是前端 Mock）。
- ⬜ 9 部署：systemd `persist-server.service` + `/etc/persist/server.env`(600) + Nginx。
- 结构说明：请求/响应类型暂放 `src/contract.ts`（镜像 `app/src/lib/chat-types.ts`），`shared/` 迁移**推迟**——前端已冻结，现在挪动会同时改 app 的 tsconfig/构建，收益不抵风险；P3 收尾或 P4 再统一。
