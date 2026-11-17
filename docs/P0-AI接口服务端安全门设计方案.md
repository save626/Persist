# P0 AI 接口服务端安全门设计方案

> 版本：v1.1（2026-11-17 更新 Step 1 实施记录）
> 状态：**Step 1（凭据门）已在本机实施并通过门禁；Step 2 / Step 3 未实施；生产未部署**。§10 待确认项仍未拍板，不阻塞 Step 1。本文其余「将 / 应 / 计划」仍为待办，不代表已实现。
> 决策来源：2026-11-17 会话中用户选定**「PSK 一步到位」**路线（构建期预置凭据 + 配额 + 审计），并要求先出设计文档再动代码。
> 关系：本文是 `docs/项目交接-2026-11-16.md §10.1（P0）` 的展开与落地设计；与 `docs/工程约定.md` 冲突时以工程约定为准，与源码冲突时以源码为准。
> 读者：下一位接手 P0 的开发者。读完应能直接拆任务，不需要再做架构决策（§10 的少数待确认项除外）。
> 不涉及：域名 / HTTPS / 备案（P2）、Android 正式签名（P3）、生成式 AI 备案与安全评估（P1，本文只标出需要它承接的部分）。

---

## 0. 结论摘要（TL;DR）

1. **问题不是「缺一个 if」，而是 AI 接口没有「调用者身份」这个概念**。`/api/chat` 与 `/api/report` 只校验三件事：请求体格式、服务端有没有 Key、按 IP 限流。任何拿到公网 IP 的客户端都能直接调用，产生由作者付费的 DeepSeek 账单。
2. **不能复用设备令牌**。设备令牌存放在独立的 `persist-sync` 库，`SyncMetaRecord.enabled` 默认 `false`，同步关闭时本机没有可用令牌；且 `/api/v1/analysis/*` 已经绑定设备令牌，同步一关该能力本来就不可用。若 AI 门也复用设备令牌，等于让「同步关闭」变成「AI 全废」，与现有行为和产品定位冲突。
3. **主门采用预共享密钥（PSK）**：mobile 构建期通过 `.env.mobile.local` 注入 `VITE_PERSIST_AI_KEY`，请求时以 `Authorization: Bearer psa_<key>` 携带；服务端只保存**哈希**，按 `keyId` 归属配额与审计。web 构建天然读不到该文件，因此 demo / guest 不可能持有有效凭据。
4. **必须分三段开关上线（`off` / `warn` / `enforce`）**。这是本文最重要的工程约束：旧 APK 不带头，服务端一旦直接 `enforce`，作者自己的真机立刻失去真实 AI，且只能靠重新装包恢复。因此顺序固定为「服务端 warn → 装新 APK → 观察审计确认带对 key → 切 enforce」。
5. **配额分两步做**。`AiClient.streamChat` 当前只产出文本，不采集 token 用量（`server/src/ai/deepseek.ts` 未见 `stream_options.include_usage`）。Step 2 先做**按请求次数**的日配额（不依赖 usage），Step 3 再加 `onUsage` 回调采集 usage 后启用 token 配额。
6. **诚实边界**：PSK 在客户端不是绝对安全，APK 被反编译即可提取。本方案的提升是数量级的（从「零门槛」到「需要拿到包并逆向」），不是绝对的。要真正不可提取只能上账号体系，那会推翻「个人自用、不做注册」的产品边界。

---

## 1. 问题定义与现状取证

### 1.1 现状代码事实（2026-11-17 核对）

| 位置 | 事实 | 含义 |
| --- | --- | --- |
| `server/src/routes/chat.ts:39-54` | 只做 `parseChatRequest`（:40）→ 检查 `deepseekApiKey`（:45）→ `limiter.take(request.ip)`（:51） | 无任何身份校验 |
| `server/src/routes/report.ts:34-48` | 同上（`parseReportRequest` :35、Key 检查 :40、IP 限流 :46） | 无任何身份校验 |
| `server/src/auth.ts` | `readBearerToken` / `hashToken` 已实现，`TOKEN_PREFIX = 'pst_'` | 鉴权基建已存在，但 AI 路由未使用 |
| `server/src/routes/guards.ts` | `requireDevice` 供 `/api/v1/*` 使用 | 只有同步系接口有门 |
| `server/src/app.ts:72-90` | CORS 白名单默认 `['https://localhost']`，`allow-headers` 仅 `accept,authorization,content-type` | 只约束浏览器；且决定了新增请求头必须走 `authorization`，不能自定义头（见 §4.1） |
| `server/src/rate-limit.ts` | 按 `request.ip` 的内存滑动窗口，单进程、重启清零 | 目的是防单 IP 刷爆，不是身份识别 |
| `app/src/lib/ai-chat-client.ts:227-247` | 请求头只有 `Content-Type` / `Accept` | 客户端从不带凭据 |
| `app/src/lib/ai-report-client.ts:149-157` | 请求头只有 `Content-Type` / `Accept` | 同上 |
| `app/src/lib/analysis-client.ts:473` | `if (init.token) headers.authorization = Bearer ...` | 综合分析已带设备令牌，是本文要避开的耦合先例 |
| `app/src/lib/sync-store.ts:60-66` | `createEmptySyncMeta()` 的默认值为 `enabled: false`、`token: null`，令牌存 `persist-sync` 库 | 同步关闭时无令牌可用 |

### 1.2 为什么前端隔离不构成安全边界

`app/src/lib/runtime-mode.ts` 保证 web 构建**永远解析不出 owner**，`?mode=owner` 也会回落。这个设计是对的，但它作用于**使用页面的人**，不作用于**直接请求服务器的人**：

- owner 的 WebView 发出的 `POST /api/chat`，与陌生人在自己机器上用 `curl` 发出的请求，在网络层完全同构（同方法、同 JSON 契约、同 80 端口）。
- 请求体契约是公开的（`parseChatRequest` 即规格），照抄即可通过校验。
- CORS 只对浏览器生效，`curl` / 脚本不受约束；`Origin` 头可任意伪造。
- 前端产物里的任何判断都能被绕过——因为它运行在攻击者可控的环境里（或根本不需要运行）。

结论：**前端门保证「正常用户走不到那条路」，服务端门保证「走上去的人必须出示身份」。** 前者可绕过，后者不可。

### 1.3 威胁模型

| 威胁 | 是否在范围内 | 说明 |
| --- | --- | --- |
| 公网扫描器发现 `/api/chat` 并批量调用 | ✅ 主要目标 | IP 直连 + 默认端口 + 无鉴权，是扫描器常规目标 |
| 他人拿本站当免费 AI 代理对外提供服务 | ✅ 主要目标 | 内容合规责任落在作者身上，与 P1 风险面重叠 |
| 盗刷 DeepSeek 额度造成账单损失 | ✅ 主要目标 | 上游按 token 计费，无上限调用 |
| 事发后无法追溯调用方 | ✅ 主要目标 | 当前无审计表，`users=0 / devices=0` 也无法回答「谁调的」 |
| 攻击者拿到 APK 后逆向提取密钥 | ⚠️ 残余风险，不在本方案可消除范围 | 见 §6 |
| 针对作者设备的定向攻击 | ❌ 不在范围 | 个人自用工具的合理边界 |

---

## 2. 目标与非目标

### 2.1 目标

1. `/api/chat`、`/api/report` 在 `enforce` 状态下**拒绝一切无有效凭据的请求**，且拒绝响应不泄露凭据是否存在的细节。
2. **同步开关与 AI 可用性彻底解耦**：同步关闭时 owner 的真实 AI 行为与现在完全一致。
3. 每次成功调用都能归属到具体 `keyId`，可支撑日配额判断与事后审计。
4. 上线过程**不产生「作者自己也用不了」的窗口**，且回滚只需改一个环境变量、不需回滚代码。
5. 变更对现有前端回退语义零破坏：401 走与 429 / 5xx 相同的「明确降级 + 如实标注」路径。

### 2.2 非目标

1. 不做账号注册、手机号 / 邮箱登录。这与产品边界冲突。
2. 不做「AI 凭据的在线申领端点」。任何匿名可申领的端点都只是把匿名访问变成匿名注册，等于没锁。
3. 不做多租户、不做按用户计费。
4. 不在本方案内移除 IP 限流——它是第二道，保留。
5. 不改 `/api/v1/*` 现有鉴权方式。
6. 不把 `Origin` 提升为安全边界（见 §4.11）。

---

## 3. 决策记录

### 3.1 决策一：凭据载体 —— 预共享密钥，不复用设备令牌

| 方案 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- |
| A. 复用设备令牌 | 复用 `requireDevice`，代码最少 | ① 同步关闭时无令牌，AI 直接失效（功能倒退）；② 首次用 AI 需注册账号，违背产品边界；③ 与 `analysis` 的耦合进一步扩散 | ❌ 落选 |
| B. 独立 AI 凭据 + 匿名申领端点 | 有账号体系雏形，可精确吊销 | 任何人都能申领，门形同虚设；若加邀请码则退化为 PSK，多一层无用复杂度 | ❌ 落选 |
| C. 构建期预置 PSK（选定） | 同步开关无关；无注册；复用现有 `.env.mobile.local` 注入机制；web 构建天然拿不到 | APK 可逆向提取；轮换需发版 | ✅ **选定** |

选定理由：在「个人自用 + 单机 owner + 不做账号体系」的前提下，C 是唯一同时满足「不破坏现有功能」和「真实提高门槛」的选项。B 的问题在于它制造了安全感而没有安全性。

### 3.2 决策二：同步关闭时 AI 必须可用

保持现状。凭据与同步状态无关，凭据来自构建产物而非运行时账号。这也是选 C 的直接原因。

### 3.3 决策三：凭据获取方式 —— 构建期注入，不做运行时申领

`npm run build:mobile` 读取 `app/.env.mobile.local`（`package.json:13` 为 `vite build --mode mobile`），web 的 `npm run build`（`package.json:12`，无 `--mode`，即 `production`）**不会加载该文件**。现有 `VITE_PERSIST_API_BASE_URL` 已验证同一机制。

**必须遵守的放置规则**（否则整个方案作废）：密钥只能写进 `app/.env.mobile.local`。**不得**写进 `app/.env`、`app/.env.local`、`app/.env.production*` —— 这些文件在 web 构建时同样会被加载，会导致密钥被打进公开的 `/app/` 产物。`.gitignore` 已覆盖 `.env.*` 与 `*.local`，但「被忽略」不等于「不会被构建读取」，这是两个不同的问题。

`.gitignore` 现状：`.env`、`.env.*`、`*.local` 均被忽略，`!app/.env.mobile.example` 为例外（已核对，无需改动）。

### 3.4 决策四：配额归属 —— 按 `keyId`

不按 IP（可换）、不按设备（会与同步耦合）、不按账号（不存在）。`keyId` 是密钥轮换时的自然分界：轮换即重置口径，也便于「旧 key 观察期」与「新 key 正式期」分开统计。

---

## 4. 设计

### 4.1 凭据形态与传递方式

**格式**：`psa_` + 32 字节随机数的 base64url，与现有 `pst_` 设备令牌前缀区分（`server/src/auth.ts` 已有该约定及其注释理由：便于日志肉眼区分）。

**传递**：`Authorization: Bearer psa_<key>`。

为什么不用自定义头（如 `x-persist-ai-key`）：`server/src/app.ts:85` 的 `access-control-allow-headers` 只允许 `accept,authorization,content-type`。自定义头会触发 preflight 并在浏览器端被拒，必须同步改 CORS 配置；而 `authorization` 已在白名单内，且 `app.ts:39` 的日志 `redact` 已覆盖该头，无需额外脱敏。综合成本与风险，选 `authorization`。

**前缀分流**：服务端按前缀判断——`psa_` 走 AI 凭据校验，`pst_` 走设备令牌校验（现有路径）。二者语义不混用，避免「拿设备令牌当 AI 凭据」的模糊地带。

### 4.2 端到端流程

```text
mobile 构建期
  .env.mobile.local: VITE_PERSIST_AI_KEY=psa_xxxx
        │  Vite 内联进 bundle（仅 mobile 产物）
        ▼
owner 运行时（APK WebView）
  createHttpChatClient / report client
        │  Authorization: Bearer psa_xxxx
        ▼
Nginx :80  /api/chat · /api/report
        ▼
Fastify
  1. parseXxxRequest         → 400 invalid_request
  2. config.deepseekApiKey   → 503 ai_not_configured
  3. aiGuardAuthorize()      → 401 ai_unauthorized        ← 新增
  4. aiQuotaCheck()          → 429 ai_quota_exceeded      ← 新增（Step 2）
  5. IP rate limiter         → 429 rate_limited           ← 保留
  6. 调上游 → 结束写审计 + 累加用量                        ← 新增
```

顺序说明：**鉴权必须在限流之前**（无凭据者不应消耗限流额度），但**必须在 `ai_not_configured` 之后**（未配 Key 的部署不应对任何人返回 401，否则会把「没配好」误报成「凭据错」）。

### 4.3 服务端校验模块

新增 `server/src/ai/ai-guard.ts`，导出：

- `parseAiKeys(raw: string | undefined): Map<string, string>` — 解析 `keyId:sha256hex` 逗号列表，非法项丢弃（与 `parseAllowedOrigins` 的容错风格一致）。
- `authorizeAiRequest(keys, header): { keyId: string } | null` — 读 Bearer、校验 `psa_` 前缀、`sha256` 后与表内哈希做 **`crypto.timingSafeEqual`** 比对。空表返回 `null`（fail-closed）。
- 失败统一 401 `ai_unauthorized`，消息固定「AI 接口需要有效凭据。」，**不区分**「未携带 / 前缀错 / 哈希不匹配 / 已轮换」。

配置项加在 `server/src/config.ts`：

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `PERSIST_AI_GATE` | `off` | `off` / `warn` / `enforce`，见 §4.4 |
| `PERSIST_AI_KEYS` | 空 | `keyId:sha256hex,keyId:sha256hex` |
| `PERSIST_AI_DAILY_REQUESTS` | `300` | 单 key 每日请求上限 |
| `PERSIST_AI_DAILY_TOKENS` | `200000` | 单 key 每日 token 上限（Step 3 生效） |

`PERSIST_AI_KEYS` 为空时：`enforce` 状态下**所有 AI 请求 401**（fail-closed）；`off` / `warn` 状态不受影响。这一点必须在部署文档里写明，避免「配好了代码忘了配 key」导致自己用不了。

### 4.4 三段式开关（本方案的关键工程约束）

| 状态 | 行为 | 用途 |
| --- | --- | --- |
| `off`（默认） | 完全不校验，行为与现在一致 | 现状、以及**回滚锚点** |
| `warn` | 校验并结算，但**不拒绝**；把结果（`ok` / `missing` / `mismatch`）写进审计 | 过渡期：验证新 APK 是否真的带对了 key |
| `enforce` | 校验失败即 401 | 终态 |

上线顺序（不可颠倒）：

1. 服务端配置 `PERSIST_AI_KEYS`，`PERSIST_AI_GATE=warn`，重启 `persist-server`。
2. 构建并安装带 key 的新 APK。
3. 真机跑一次对话 + 一次报告，查审计表出现 `key_id` 且 `result=ok`。
4. 切 `enforce`，再跑一次验证；用 `curl` 无凭据验证返回 401。

**为什么必须有 `warn`**：旧 APK 不带 `Authorization`，直接 `enforce` 会让作者自己的真机立刻失去真实 AI，且没有远程补丁手段，只能重新装包。`warn` 把「验证凭据是否正确」和「开始拒绝」拆成两次部署，消除了这个自锁窗口。

### 4.5 配额

**Step 2（按请求次数，不依赖 usage）**：进入时读 `ai_usage(key_id, 今天)` 的 `requests`，`>= PERSIST_AI_DAILY_REQUESTS` 则 429；通过则计数器 +1（在事务内）。

**Step 3（token 配额）**：需要上游 usage，分两处改动：
- `server/src/ai/deepseek.ts` 的流式请求增加 `stream_options: { include_usage: true }`，并在流末尾读取 usage 帧；`AiClient.streamChat` 增加**可选**回调 `onUsage?: (usage) => void`——不改现有签名，不影响 `analysis` 与每日简报的调用点。
- 结束时按实际 `prompt_tokens + completion_tokens` 累加到当日记录；超限只影响**后续**请求。

并发说明：当前检查与扣减在同一事务内，但两个并发请求仍可能同时通过边界检查，形成轻微超额。这是**已知且接受**的取舍——单用户场景下不值得为严格配额引入锁或排队。文档不把它写成「已精确」。

日界：以服务器本地日期为准（生产为 CST），与备份 timer 的 03:00 CST 口径一致；不使用 UTC，避免「晚上 8 点后算第二天」的困惑。

### 4.6 审计

原则沿用 `app.ts:38` 的既有约定：**请求体与响应正文永不落盘**。

每条调用写一行 `ai_calls`：`key_id`、`route`（`chat` / `report`）、`model`、`result`、`http_status`、`prompt_tokens`、`completion_tokens`、`latency_ms`、`ip_hash`、`created_at`。

- `ip_hash` = `sha256(ip + 当日盐)`，用于「同一来源是否在刷」的判断，但不存明文 IP。
- `result` 取值：`ok` / `upstream_failed` / `timeout` / `client_closed` / `quota_exceeded` / `unauthorized` / `missing_credential` / `bad_credential`。
- `client_closed` 必须记录：SSE 客户端提前断开是当前代码路径之一（`chat.ts:63-66`），漏记会让审计与账单对不上。

### 4.7 表结构（migration v3）

在 `server/src/db/migrations.ts` 追加 `version: 3`（现有最高为 2），只新增表，不改既有表，向后兼容：

```sql
CREATE TABLE ai_usage (
  key_id            TEXT    NOT NULL,
  day               TEXT    NOT NULL,
  requests          INTEGER NOT NULL DEFAULT 0,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (key_id, day)
);

CREATE TABLE ai_calls (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id            TEXT    NOT NULL,
  route             TEXT    NOT NULL,
  model             TEXT,
  result            TEXT    NOT NULL,
  http_status       INTEGER NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  latency_ms        INTEGER,
  ip_hash           TEXT,
  created_at        INTEGER NOT NULL
);

CREATE INDEX idx_ai_calls_created_at ON ai_calls(created_at);
CREATE INDEX idx_ai_calls_key_created ON ai_calls(key_id, created_at);
```

注意：`ai_usage` 与 `ai_calls` **不参与账号删除清理**。它们是服务端运维事实，不属于用户业务数据；若将来纳入，须在 `server/src/account/delete-account.ts` 单独说明理由，当前不做。

### 4.8 契约变更

按工程约定铁律，契约变更需同步 `shared/` 与 `server/src/contract.ts`。

- **新增错误码**：`ai_unauthorized`（401）、`ai_quota_exceeded`（429）。二者属于 `server/src/contract.ts` 的 chat/report 契约范围（该契约仍暂在该文件，未迁入 `shared/`）。
- **新增请求头语义**：`Authorization: Bearer psa_*`。在 `contract.ts` 的文档注释里写明，不新增 TS 类型（header 不进请求体）。
- **不改变**任何请求体 / 响应体结构。这意味着 `shared/` 下的 `report.ts` / `analysis.ts` 等**无需改动**——本次契约变更面比常规小。

### 4.9 客户端改动

| 文件 | 改动 |
| --- | --- |
| `app/src/lib/ai-credential.ts`（新增） | 读 `import.meta.env.VITE_PERSIST_AI_KEY`，仅当 `import.meta.env.MODE === 'mobile'` 且值以 `psa_` 开头时返回，否则 `null`。web 构建返回 `null`（构建期就没有该变量） |
| `app/src/lib/ai-chat-client.ts` | `HttpChatOptions` 增加可选 `credential?: string \| null`；存在时加 `authorization` 头 |
| `app/src/lib/ai-report-client.ts` | 同上 |
| `app/src/main.tsx` | 组装时把 `aiCredential()` 结果传入（该文件已负责 `surface` 与 `baseUrl` 的注入） |
| `app/.env.mobile.example` | 增加 `VITE_PERSIST_AI_KEY=psa_<由服务端生成>` 占位与说明（不含真实值） |

**不改**：运行模式判定、IndexedDB 隔离、`analysis-client`（它走设备令牌，与本文无关）、任何页面组件与样式。

因为不涉及页面文案 / 结构 / 样式，按交接文档口径**不需要重跑 `visual:check`**；但改动 `ai-chat-client` / `ai-report-client` 属于 AI 主链路，需重跑 `app test` 与相关 E2E。

### 4.10 密钥生成与轮换

生成（在服务器上执行，明文只出现一次，立即填入 `.env.mobile.local` 并写入服务端哈希）：

```bash
node -e "const c=require('crypto');const k='psa_'+c.randomBytes(32).toString('base64url');console.log('明文:',k);console.log('哈希: k1:'+c.createHash('sha256').update(k).digest('hex'))"
```

轮换流程（支持多 key 并行，无停机）：

1. 服务端 `PERSIST_AI_KEYS` 追加 `k2:<hash>`，保留 `k1`，重启。
2. 用新 key 构建并安装 APK。
3. 审计确认 `k2` 有 `ok` 记录、`k1` 只剩旧调用。
4. 移除 `k1`，重启。

**轮换必须发版**——这是 PSK 的固有成本，设计上不试图隐藏。

### 4.11 来源限制的定位

明确写：`Origin` 校验**只作为附加信号，不作为门**。原因：该头可被任意客户端伪造，把它当门会造成「看起来有防线」的错觉。

真正挡浏览器跨站的是现有 CORS preflight（`app.ts:76-78` 对非白名单 origin 的 OPTIONS 返回 403），它挡不住 curl。在 PSK 到位后，来源限制的边际价值进一步下降，故本方案**不新增**来源限制，只保留现有 CORS 行为。若后续需要在 Nginx 层做纵深防御（限制 method、body 大小、路径），另案处理。

---

## 5. 失败语义与前端回退

现有前端已有一套「失败即明确降级 + 如实标注」的约定（`ai-report-client.ts` 顶部注释、`REPORT_FALLBACK_NOTE`）。新增两个错误码必须落进同一套语义，不得引入新的静默失败：

| 服务端响应 | 前端行为 |
| --- | --- |
| `401 ai_unauthorized` | 回退本地 Mock，提示「真实模型连接凭据无效，本次已回退」；**不重试**（重试无意义） |
| `429 ai_quota_exceeded` | 回退本地 Mock，提示「今日 AI 额度已用完」；不重试 |
| `429 rate_limited` | 现状不变 |
| `503 ai_not_configured` | 现状不变 |
| `502/504` | 现状不变 |

**不允许**的行为：把 401 当成「服务端不可用」笼统处理。凭据失效与上游故障是不同问题，混在一起会让排查失去依据——这与项目一贯的诚实性约束一致。

---

## 6. 安全分析：残余风险

| 风险 | 严重度 | 说明与缓解 |
| --- | --- | --- |
| APK 被反编译提取 `psa_` | 中 | PSK 固有。缓解：key 可轮换（§4.10）、按 key 配额限量、审计可发现异常调用；无法根除 |
| 提取者用你的 key 调用 | 中 | 与上一条同源。配额是实际止损手段，不是防御 |
| 内存限流重启清零 | 低 | 配额在 SQLite，不受重启影响；IP 限流清零可接受 |
| 单个 key 被轮换前的泄露窗口 | 低 | 多 key 并行 + 审计观察期，窗口可控 |
| `enforce` 下漏配 key 导致全站 AI 不可用 | 中 | fail-closed 是刻意选择（宁可自己用不了，也不放行匿名）；用 `warn` 阶段先验证可消除 |
| 本文**不能**解决：生成式 AI 备案与内容安全 | 高 | 属 P1，本方案只缩小暴露面，不替代合规 |

**必须写进文档的诚实结论**：本方案把攻击门槛从「零」提升到「需要拿到 APK 并逆向」，不是「不可攻破」。若将来要真正对外开放（非个人自用），PSK 必须替换为账号体系 + 短期令牌，届时本文的配额与审计数据结构（`key_id` 维度）可直接复用，不需重写。

---

## 7. 实施步骤

每步独立可验收、独立提交，**一次只做一步，做完停下等确认**。

### Step 1：凭据门（关闭公网裸露）

改动文件：

- 新增 `server/src/ai/ai-guard.ts`
- 改 `server/src/config.ts`（`aiGate` / `aiKeysMap`）
- 改 `server/src/routes/chat.ts`、`server/src/routes/report.ts`（插入 §4.2 第 3 步）
- 改 `server/src/contract.ts`（新增 `ai_unauthorized` 注释与常量）
- 新增 `app/src/lib/ai-credential.ts`
- 改 `app/src/lib/ai-chat-client.ts`、`ai-report-client.ts`、`app/src/main.tsx`
- 改 `app/.env.mobile.example`

验收标准：

1. `PERSIST_AI_GATE=enforce` + 有效 key → 200。
2. `enforce` + 无 header / 错前缀 / 错哈希 → 401 `ai_unauthorized`，三种情况响应体完全一致。
3. `off` → 行为与改动前完全一致（回归）。
4. `warn` + 错 key → 放行但记录 `bad_credential`。
5. web 构建产物中**搜不到** `psa_` 字符串。
6. `server test` / `app test` / `app run build` / `build:mobile` 全绿。

**不做**：配额、审计表、usage 采集。（Step 1 只验证「门是否成立」，不引入新表，减少回滚面。）

#### Step 1 实施记录（2026-11-17，已完成本机验收）

实际改动与上面清单有三处偏差，均为实施中发现更优解，记录如下：

1. **`app/src/main.tsx` 未改动**。设计原本要把 `credential` 从 `main.tsx` 一路穿到各处调用点，但 `createHttpChatClient` / `requestAiReport` 的调用点分散在多个页面，穿透容易漏。改为在 `app/src/lib/ai-credential.ts` 提供模块级默认值（`aiCredential()`），两个客户端在「调用方未显式传 `credential`」时回落到它。单测用显式传值覆盖，行为可控；生产无需改任何页面。
2. **新增 `server/src/routes/guards.ts` 的 `enforceAiGate()`**。设计与 `requireDevice` / `enforceRateLimit` 并列，避免两个路由各抄一遍「判定 + 401 + 日志」。
3. **新增 `app/vite.config.ts` 构建期硬拦截**（设计文档原先只在 §3.3 写「必须遵守的放置规则」）。实施时确认：`psa_` 前缀常量本身会内联进 web 产物（已核实 `app/dist` 中唯一命中就是前缀比较代码，不是凭据），因此「产物里搜不到 `psa_`」不是有效判据；真正的风险是凭据被写进 `.env` / `.env.local` / `.env.production*` 后被打进公开产物。现在 `mode !== 'mobile'` 且检测到 `VITE_PERSIST_AI_KEY` 非空时构建直接失败，把约定变成机制。

本机验收结果：

| 项 | 结果 |
| --- | --- |
| `server run typecheck` | 通过 |
| `server test` | **28 文件 / 263 测试通过**（原 27 / 234，新增 `ai-guard.test.ts` 18 项 + 路由门用例 11 项） |
| `app run typecheck` | 通过 |
| `app test` | **32 文件 / 383 测试通过**（原 31 / 366，新增 `ai-credential.test.ts` 6 项 + 两个客户端凭据用例 11 项） |
| `app run lint` | 0 错 0 警告 |
| `app run build`（web） | 通过 |
| `app run build:mobile` | 通过 |
| web 产物含凭据 | 无（唯一 `psa_` 命中是前缀常量代码） |
| mobile 产物内联凭据 | 已验证：注入探针 `psa_probe_*` 后 `dist-mobile` 命中 1 处；重建干净产物后为 0 |
| 误放凭据的 web 构建 | 已被 vite 配置拦截，退出码 1，提示指明只允许 `.env.mobile.local` |

#### Step 1 生产部署记录（2026-11-17，已切 `enforce`）

部署过程与 `off → warn → enforce` 的实际执行：

1. 本机构建 `server/dist`（47 个 js，新增 `ai/ai-guard.js`），打包上传后在服务器解到 `dist.new`，再 `mv` 原子替换；旧版备份 `/root/backend-backup-20261117-110001/`，并留 `dist.old`。
2. `/etc/persist/server.env` 追加 `PERSIST_AI_GATE=warn` 与 `PERSIST_AI_KEYS=k1:<sha256>`，重启后启动日志确认为 `"aiGate":"warn/1"` —— 这一步只证明「代码上线 + 凭据解析成功」，**不拦截**。
3. `enforce` 的拒绝行为先在**独立端口 3999 的临时实例**上验证（同一份 dist、同一份生产 env、独立 `DB_PATH`），避免为了测试重启生产：无凭据 / 错凭据 / 设备令牌 `pst_` 三种请求均返回 `401 ai_unauthorized`，响应体完全一致。
4. 用户决定**先切 `enforce`**（手机暂无新包），改 env 后重启，启动日志 `"aiGate":"enforce/1"`，health `ok / schema 2`。
5. 公网入口复验：`/api/chat` 与 `/api/report` 无凭据均 `401 ai_unauthorized`；带 `pst_` 设备令牌同样 401；`/api/health` 与 `/app/?mode=demo` 仍 200。日志出现 3 条 `ai credential check did not pass`（即上述测试请求），证明 `warn`/`enforce` 的观测点可用。

**真机待补**：手机上的 APK 仍是 2026-11-13 版本，不含凭据，真实 AI 现降级为本地 Mock（界面明确标注）。本机此刻缺 Android SDK 且无 USB 设备，故 `cap sync` 之后的 `gradlew installDebug` 未执行。补好 SDK 后重装即可恢复，**服务端无需再改**。

### Step 2：审计 + 按请求次数配额

- 新增 migration v3（§4.7）
- 新增 `server/src/ai/ai-usage.ts`（读 / 累加 / 判限）
- 新增 `server/src/ai/ai-audit.ts`（写 `ai_calls`）
- 两个路由接入 §4.2 第 4 步与结束写审计
- 新增 `429 ai_quota_exceeded` 契约与前端文案

验收：日配额耗尽后 429 且**后续正常请求不受影响**（次日恢复需可测：注入 `now`）；审计中 `client_closed` 与 `ok` 可区分；请求体不出现在任何日志与表中。

### Step 3：token 配额

- `deepseek.ts` 加 `stream_options.include_usage` + 可选 `onUsage`
- `ai-usage.ts` 累加 token
- 配额判定加 tokens 维度

验收：一次对话后 `ai_usage` 的 token 数与上游 usage 一致（允许误差 0）；`analysis` 与每日简报**不触发** `onUsage` 也能正常工作（可选回调的可空性回归）。

---

## 8. 测试计划

| 层 | 用例 |
| --- | --- |
| `server/src/ai/ai-guard.test.ts`（新增） | 4 种失败形态同响应；`timingSafeEqual` 路径；空表 fail-closed；多 key 命中第二个；非法配置项被丢弃 |
| `server/src/routes/chat.test.ts` | 401 短路（不调上游、不耗限流）；`off` 回归；`warn` 放行且审计正确 |
| `server/src/routes/report.test.ts` | 同上 |
| `server/src/ai/ai-usage.test.ts`（Step 2） | 边界值（恰好等于上限 / 超 1）；并发两次都通过（记录为已知行为，不作精确断言） |
| `app/src/lib/ai-credential.test.ts`（新增） | web mode 返回 null；mobile + 合法值返回；mobile + 非法前缀返回 null |
| `app/src/lib/ai-chat-client.test.ts` | 有 credential 时 header 存在；无 credential 时 header **不存在**（不能是空字符串） |
| `app/src/lib/ai-report-client.test.ts` | 同上 + 401 分类为「凭据失效」而非「不可用」 |

E2E：现有 E2E 用不可达端口隔离真实后端（工程约定 §1），不触真实 API，**预期不受影响**；启动前需确认无断言依赖「无 Authorization 头」这一细节。

---

## 9. 部署顺序与回滚

部署前须获得用户明确授权，并遵守交接文档 §8.5 生产操作规则。

| 阶段 | 操作 | 验证 |
| --- | --- | --- |
| 1 | 本地全门禁 + 构建 web 与 mobile | 全绿；web 产物无 `psa_` |
| 2 | 备份生产 SQLite（`VACUUM INTO`）+ 记录当前 PID / health / `NRestarts` | 快照可读 |
| 3 | 部署 `server/dist` + `shared/dist` + 两个 `package.json`；`PERSIST_AI_KEYS` 已配；`PERSIST_AI_GATE=warn` | `health` 正常，schema 升到 `3`（Step 2 起） |
| 4 | 装新 APK，真机跑对话 + 报告 | 审计出现 `key_id` + `ok` |
| 5 | 切 `enforce`，重启 | 真机正常；`curl` 无凭据 401 |

回滚：

- **首选**：`PERSIST_AI_GATE=off` + 重启 → 立刻回到当前行为，**无需回滚代码、无需回滚 APK**。
- 回滚代码时注意 migration v3 已执行：新增表不影响旧代码（旧代码不读这两张表），因此不必回滚数据库。

---

## 10. 待确认问题

实施前需用户拍板，**未定项不阻塞 Step 1**：

1. **日配额数值**：默认 300 次 / 20 万 tokens 是否合适？按你的实际用量调整。
2. **日界时区**：本文取服务器本地日期（CST）。是否认可？
3. **审计保留期**：`ai_calls` 目前无限增长。是否设 90 天清理任务？（若设，需新增 job，属额外工作量）
4. **`analysis` 是否纳入同一套配额**：它现在有独立 `analysisRateLimitMax` 且走设备令牌。本方案**不纳入**，理由是它已有门。确认是否同意。
5. **是否在设置页暴露「AI 凭据状态」**：本文建议**不做**。暴露状态等于告诉使用者「这里有个密钥」，而凭据失效时前端已有明确降级提示。

---

## 11. 文档联动

实施完成后需同步更新：

- `docs/项目交接-2026-11-16.md` §10.1（P0 状态）、§9.1（路由鉴权列）、§11.1（合规风险）
- `docs/工程约定.md` §1 的 AI 行（「对外开放前仍须完成服务端 token 门」→ 更新为已完成及实现方式）
- `docs/部署与服务器现状.md`（新增环境变量、schema 3、上线顺序与回滚步骤）
- `server/.env.example`（新增 3 个变量，**不含真实值**）
- `HANDOFF.md`（按现有习惯在顶部加一条记录）

**注意**：本文是设计稿。在 Step 1 验收通过前，不得在交接文档里把 P0 写成「已完成」。
