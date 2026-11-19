# P0 AI 接口服务端安全门设计方案

> 版本：v1.5（2026-11-18 17:3x 追加设备令牌凭据）
> **v1.5 变更（重要，覆盖 §0 第 2 条）**：项目已在 GitHub 开源，`psa_` 这种「构建期内联的长期密钥」不再成立——安装包会被反编译，轮换还要重新打包分发。现在 `/api/chat`、`/api/report` **优先接受设备令牌 `pst_`**：服务端按令牌换出 `userId`，额度与审计都归到账号（`user:<id>`），吊销设备即刻失效。`psa_` 仍被接受，仅作回滚锚点，新包不再注入该变量（`.env.mobile.local` 里的值已注释）。
> 当年「不能复用设备令牌」的两条理由现在都不成立：① 令牌属于账号而不属于「同步开关」——关闭同步只是不上传数据，令牌仍在；② `/api/v1/analysis/*` 本来就要求设备令牌，chat/report 才是例外。唯一的代价是「从未注册过账号的全新安装」不能用真实 AI（没有账号就没有额度归属）。
>
> 版本：v1.4（2026-11-17 补 Step 4 审计保留期）
> 状态：**Step 1（凭据门）、Step 2（次数配额 + 审计）、Step 3（token 配额）、Step 4（审计保留期）均已实施并通过门禁，全部已部署生产**（Step 1 完成真机闭环；Step 2 于 11:35、Step 3 于 15:59、Step 4 于 16:13 部署，见 §7）。§10 第 1、2、3、4 项已落地，仅第 5 项（设置页暴露凭据状态）按建议不做。
> 决策来源：2026-11-17 会话中用户选定**「PSK 一步到位」**路线（构建期预置凭据 + 配额 + 审计），并要求先出设计文档再动代码。
> 关系：本文是 P0（AI 接口服务端安全门）的展开与落地设计；与 `docs/工程约定.md` 冲突时以工程约定为准，与源码冲突时以源码为准。**P0 四步已全部实施并部署**（2026-11-17），本文的「实施步骤」章节保留作回滚参考，现状与待办见 [`HANDOFF.md`](../HANDOFF.md)。
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

**Step 2（按请求次数，不依赖 usage）**：进入时读 `ai_usage(key_id, 今天)` 的 `requests`，`>= PERSIST_AI_DAILY_LIMIT` 则 429；通过则计数器 +1（在事务内）。实际默认值 100，`0` 表示关闭配额。

**Step 3（token 配额）**：需要上游 usage，分两处改动：
- `server/src/ai/deepseek.ts` 的流式请求增加 `stream_options: { include_usage: true }`，并在流末尾读取 usage 帧；`AiClient.streamChat` 增加**可选**回调 `onUsage?: (usage) => void`——不改现有签名，不影响 `analysis` 与每日简报的调用点。
- 结束时按实际 `prompt_tokens + completion_tokens` 累加到当日记录；超限只影响**后续**请求。

**Step 3 的实际口径（与初稿的差别，已按实现改文）**：

token 与次数**不能同一种口径**。次数可以在进门时预占（+1 再放行，失败不退），token 不行——生成前根本不知道会长多少。所以实际实现是**进门判余 + 出门记账**：

1. 进门：读当日 `prompt_tokens + completion_tokens`，`>= PERSIST_AI_DAILY_TOKENS` 就 429，不打上游；
2. 出门：把这次实际用量**累加**进当日行（`addAiTokens`），无论成败都记——上游已经计费了。

由此带来三个必须写明的性质：

- **当天最后一次请求可以把总量顶过上限一截**，最多一次请求的量（输入受 `maxPromptChars = 12000` 约束、输出受 `max_tokens` 约束）。这是"少算不少拦"的取舍：宁可放过最后一口，也不要因为估算预留把正常使用挡在门外。
- **被 abort 的流拿不到 usage**（上游只在流末尾的 usage 帧里给），这次调用记 0 ——**少算，绝不多算**。
- 一次 `/api/chat` 会打两次模型（流式回复 + 结构化抽取），两次 usage **累加**成一条账。

两维可独立关闭：`PERSIST_AI_DAILY_LIMIT=0` 只关次数、`PERSIST_AI_DAILY_TOKENS=0` 只关 token，两个都为 0 时既不拦截也不写 `ai_usage`（回滚路径不留空行）。只关一维时仍然写行，"今天用了几次、花了多少 token" 本身是有用的观测数据。

并发说明：当前检查与扣减在同一事务内，但两个并发请求仍可能同时通过边界检查，形成轻微超额。这是**已知且接受**的取舍——单用户场景下不值得为严格配额引入锁或排队。文档不把它写成「已精确」。

日界：以服务器本地日期为准（生产为 CST），与备份 timer 的 03:00 CST 口径一致；不使用 UTC，避免「晚上 8 点后算第二天」的困惑。

### 4.6 审计

原则沿用 `app.ts:38` 的既有约定：**请求体与响应正文永不落盘**。

每条调用写一行 `ai_calls`：`key_id`、`route`（`chat` / `report`）、`model`、`result`、`http_status`、`prompt_tokens`、`completion_tokens`、`latency_ms`、`ip_hash`、`created_at`。

- `ip_hash` = `sha256(ip)` 前 16 位十六进制，用于「同一来源是否在刷」的判断，不存明文 IP。**不加盐**（原设计写的「当日盐」未实现）：加盐需要轮换与存储策略，而它的收益只是抬高穷举成本——IPv4 空间本来就小，这里如实写成「用于聚类，不承诺匿名」更诚实。
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
4. 用户决定**先切 `enforce`**（手机暂无新包），改 env 后重启，启动日志 `"aiGate":"enforce/1"`，health `ok`。
5. 公网入口复验：`/api/chat` 与 `/api/report` 无凭据均 `401 ai_unauthorized`；带 `pst_` 设备令牌同样 401；`/api/health` 与 `/app/?mode=demo` 仍 200。日志出现 3 条 `ai credential check did not pass`（即上述测试请求），证明 `warn`/`enforce` 的观测点可用。

**真机闭环（2026-11-17 11:15–11:22，已完成）**

6. 本机补装 Android SDK（cmdline-tools latest / platform-tools 37.0.1 / platforms android-36 / build-tools 36.0.0，装到 `local.properties` 已指向但缺失的路径，工程配置未改），`build:mobile` → `cap sync android` → `gradlew assembleDebug` 通过，产物 4,625,698 B。
7. 装机前校验包内凭据：从 APK `assets/public/assets/*` 取出内联值，**命中 1 个文件**，其 sha256 与生产 `PERSIST_AI_KEYS` 的 `k1` 逐字符相等 —— 先证明「包带对了 key」，再谈真机行为。
8. `adb install -r`（设备 RMX3800，`lastUpdateTime=2026-11-17 11:15:15`，覆盖安装保留应用数据与 IndexedDB）。
9. 真机真实使用后核对生产日志（11:15 至 11:22）：
   - `ai credential check did not pass` **0 条**（对比装机前 11:06 的 4 条旧包/测试请求）
   - 状态码分布 `200×24 / 201×1 / 204×12`，**无任何 4xx**
   - `POST /api/report` 11 次全部 200，耗时 2.1–5.6 s，符合真实上游生成时延
10. 同期用户开启同步：`users=1`、`devices=1`，`sync/push` 一批 `serverRev=31`，`profiles / fitness_sessions / diet_entries / water_logs / study_records / plan_items` 均有真实记录落库。

结论：`enforce` 在真机上不阻断正常调用，P0 的「公网不可匿名调用 + 真机可用」两端同时成立。

### Step 2：审计 + 按请求次数配额

- 新增 migration v3（§4.7）
- 新增 `server/src/ai/ai-usage.ts`（读 / 累加 / 判限）
- 新增 `server/src/ai/ai-audit.ts`（写 `ai_calls`）
- 两个路由接入 §4.2 第 4 步与结束写审计
- 新增 `429 ai_quota_exceeded` 契约与前端文案

验收：日配额耗尽后 429 且**后续正常请求不受影响**（次日恢复需可测：注入 `now`）；审计中 `client_closed` 与 `ok` 可区分；请求体不出现在任何日志与表中。

#### Step 2 实施记录（2026-11-17）

已实现，`PERSIST_AI_DAILY_LIMIT` 默认 **100**。

**模块**
- `ai-usage.ts`：`localDayKey` / `nextLocalMidnight` / `reserveAiQuota` / `readAiUsage`。日界按服务器本地日期；「读→判→加一」在一个事务内，避免并发都把 99 读成可放行。`limit === 0` 直接放行且**不写库**。
- `ai-audit.ts`：`recordAiCall` / `hashIp` / `listRecentAiCalls`。写失败只回调 `onError`，绝不把一次正常调用变成 500；表里没有任何正文列。

**路由**
- 顺序固定为 `请求体 → Key 检查 → 凭据门 → IP 限流 → 日配额 → 上游`。配额放在 IP 限流之后，避免一个脚本先把当天额度刷光。
- `enforceAiGate` 返回值从 `boolean` 改为 `AiGateDecision | null`：配额与审计都要 `keyId`，原来只回放行与否拿不到归属。
- 新增 `enforceAiQuota`（`routes/guards.ts`），与被拒时写 `quota_exceeded` 审计放在一起——只看 `ai_usage` 计数分不清「自己在用」和「被盗刷」。

**两处与初稿不同，已改文档而非代码**
1. **`/api/chat` 与 `/api/report` 共用同一份额度**。初稿按路由各记一份，但两条路由花的是同一个 Key 的钱，分开计数会让人误以为各有 100 次。
2. **门设为 `off` 时仍然计数**（归到 `anonymous`）。初稿没写这条，实际实现成「配额独立于门开关」，否则回滚到 `off` 等于把止损一起关掉。

**验收（`server/test/ai-usage.test.ts` / `ai-audit.test.ts` / `ai-quota-route.test.ts`）**
- 第 100 次 200、第 101 次 `429 ai_quota_exceeded`，`retry-after` 指向次日零点（13:00 时为 39600 秒），文案含上限与「明天」。
- 跨日恢复用注入时钟验证，不需要真的等到 00:00。
- 超限不影响 `/api/health`；凭据不合法的 401 不消耗额度；`PERSIST_AI_DAILY_LIMIT=0` 时连续 5 次全放行。
- 审计区分 `ok` / `quota_exceeded` / `client_closed`（客户端提前断开，`http_status=499`）/ `ai_failed`，并断言表内不含请求正文（搜不到档案与动作名）。

**未做**
- token 配额（仍是 Step 3）；`ai_calls` 保留期清理（§10 待定，暂不删）；`analysis` 路由未纳入配额（它已有设备令牌门 + 6 次/5 分钟限流）。
- 前端**零改动**：两个客户端本来就优先展示服务端 `error.message`，新文案直接透出，不需要动 UI，也不触发视觉基线。

#### Step 2 生产部署（2026-11-17 11:35，已上线）

1. 先备份：`backup-cli.js --reason manual` 生成 `persist-20261117-113500-manual.sqlite`（`integrity: ok`），并归档旧 `dist` 与 `server.env` 到 `/root/backend-backup-20261117-113500/`。
2. `dist` 原子替换（47 → 49 个 js），`server.env` 追加 `PERSIST_AI_DAILY_LIMIT=100`，重启后 migration v3 自动执行：health `version=3`，启动日志 `"aiGate":"enforce/1"` / `"aiQuota":"100/day"`。
3. **验证时刻意不烧额度**：临时实例（3999 端口、同一份 dist 与 env、独立 `DB_PATH`）里预置「当日已用 1 次」+ 上限 1，请求得到 `429 ai_quota_exceeded`（文案含「1 次」「明天 00:00」，`retry-after: 44592`）；无凭据仍 `401`；日志 `{"aiQuota":{"used":1,"limit":1}}`；`ai_calls` 落两条 `quota_exceeded`。全程没有触发一次真实上游调用。
4. 生产库此刻 `ai_usage` 空、`ai_calls` 0 行——配额上线前的历史调用不会补记，属预期。

**踩到的坑（值得记）**：上一轮 `enforce` 验证时用 `kill %1` 停临时实例，在非交互 ssh 里作业控制不可用，进程实际没死，一直占着 3999 端口 35 分钟。这次新起的实例绑不上端口直接退出，`curl` 打到旧进程上，于是「明明配了正确凭据却返回 401」。**以后一律 `P=$!` 取 PID 再 `kill $P`，并在收尾时用 `ss -ltnp` 确认端口已释放**。

### Step 3：token 配额

- `deepseek.ts` 加 `stream_options.include_usage` + 可选 `onUsage`
- `ai-usage.ts` 累加 token
- 配额判定加 tokens 维度

验收：一次对话后 `ai_usage` 的 token 数与上游 usage 一致（允许误差 0）；`analysis` 与每日简报**不触发** `onUsage` 也能正常工作（可选回调的可空性回归）。

#### Step 3 实施记录（2026-11-17）

已实现，`PERSIST_AI_DAILY_TOKENS` 默认 **200000**（`0` 关闭这一维，上界 1e8）。

**模块**
- `deepseek.ts`：新增 `AiTokenUsage`、`readTokenUsage`（取不到就返回 `null`，**绝不猜**一个数字）、`AiStreamOptions`；`streamChat` / `completeJson` 都接受可选 `onUsage`。流式请求体加 `stream_options: { include_usage: true }`；SSE 解析改成 `{content} | {usage} | 'done'` 三态——usage 帧的 `choices` 是**空数组**，原来"没有 content 就丢弃"的逻辑会把它整帧吞掉，所以必须先判文本、再判 usage。
- `ai-usage.ts`：`reserveAiQuota` 增加 `tokenLimit` 维度与 `reason`（`requests` / `tokens`，次数先判）；新增 `addAiTokens`（累加、两项为 0 跳过、**永不抛错**）与 `isAiQuotaEnabled`。`limit` 参数改名为 `requestLimit`，避免两维都叫 limit。
- `ai-audit.ts`：`ai_calls` 的 `prompt_tokens` / `completion_tokens` 开始写入；缺 usage 时留 `NULL`，不用 0 冒充"上游说这次是 0"。
- `config.ts`：`PERSIST_AI_DAILY_TOKENS`（默认 200000，范围 0–100 000 000）；启动日志 `aiQuota` 从 `100/day` 变成 `100/day, 200k tokens/day`。
- `contract.ts`：新增 `aiTokenQuotaExceededBody` 与 `formatTokenLimit`（`200000` → `200,000`）。**共用 `ai_quota_exceeded` 码**：前端两种都回退本地 Mock，区别只在文案，多造一个码只会让前端多一条无用分支。

**路由**
- `chat.ts` / `report.ts`：`finally` 里先 `addAiTokens` 再 `recordAiCall`（审计行读的是本地变量，顺序不影响结果），并把两次数值同时写进审计。两维都关掉时跳过记账。

**验收（服务端 31 文件 / 313 测试，新增 20 条）**
- 真实上游（本机 `server/.env` 的真 Key 直连 DeepSeek，各打一次最小请求）：`streamChat` 回调 `{"promptTokens":10,"completionTokens":1}`，`completeJson` 回调 `{"promptTokens":44,"completionTokens":5}` —— 证明 `stream_options.include_usage` 被 DeepSeek 接受、usage 帧解析正确。这一步是必要的：单测只能证明"我按文档解析"，不能证明"上游真的这么发"。
- 路由级（`ai-quota-route.test.ts`）：上限 1000、每次 600 时，第 1、2 次 200（账面 0 → 600 → 1200），第 3 次 `429 ai_quota_exceeded`，文案含 `1,000` 与「明天」，`retry-after` 11 小时；`ai_usage` 记为 `requests=2 / prompt=1000 / completion=200`（被拒那次不预占、不调上游）。
- chat 两次模型调用累加：`usage_ai(300,50)` → `ai_usage` 600/100，审计行同时为 600/100。
- 只关 token 维度时仍按次数拦，文案必须说「次」而不提 token；两维都关时不写 `ai_usage`。
- 无 usage 帧 / usage 形状不对时不回调；正文不是合法 JSON 时**也先回调**（钱已经花了）。

**未做**
- `analysis` 路由仍未纳入配额与 token 账（它没有 `keyId`，只有设备令牌；纳入要先把"设备→计量归属"定下来，属另一项设计）。
- ~~`ai_calls` 保留期清理~~ → 见 Step 4。
- 前端零改动：两个客户端本来就优先展示服务端 `error.message`，token 文案直接透出，不触发视觉基线。

#### Step 3 生产部署（2026-11-17 15:59，已上线）

1. 备份：`server-dist.tgz` + `server.env` → `/root/backend-backup-20261117-155928/`；库快照 `persist-20261117-155932-manual.sqlite`（`integrity: ok`，258048 B）。
2. `dist` 原子替换（49 js 不变，7 个文件内容更新），`server.env` 追加 `PERSIST_AI_DAILY_TOKENS=200000`（28 键，`600`）；重启后 PID 44617、`NRestarts=0`，health `version=3`，启动日志 `"aiQuota":"100/day, 200k tokens/day"`。
3. 验证（临时实例 + 真实凭据 + 真实上游，**不碰生产库**）：预置 `prompt 1100 / completion 120` + 上限 1000 → `429`（文案「（1,000）」，`retry-after: 28756`），`ai_usage` 不变、`ai_calls` 落 `quota_exceeded`；清空后发一次真实 `/api/chat` → 200 / 2.9 s，`ai_usage` 记 `requests=1 / 975 / 77`，`ai_calls` 同值。
4. 公网复核：`/api/health` 200，无凭据 `/api/report` 401（门未受影响）。
5. 回滚：`PERSIST_AI_DAILY_TOKENS=0` 只关 token 维度；整版回退用备份 tgz，migration 无变更（v3 已含 token 列，不需要新 migration）。

**一个值得记的细节**：备份 CLI 需要环境变量（`DB_PATH`），直接 `node dist/db/backup-cli.js` 会报「数据库文件不存在：data/persist.sqlite」。正确做法是先 `set -a; . /etc/persist/server.env; set +a`，再执行——否则你会以为备份成功了，其实只有 tar 那部分成功。

### Step 4：审计保留期清理（`ai_calls` 30 天）

**为什么值得单独一步**：`ai_calls` 是这张库里唯一**只增不减**的表——配额管的是「每天多少次」，不是「总共多少行」。不清就一直长，而它的价值随时间衰减：30 天前的调用记录对「额度被谁吃掉」「这个 key 是不是泄露了」已经没有信息量，剩下的是隐私负担（`ip_hash` + 调用节奏 + 路由分布）。同时隐私说明也没法写「审计保留 30 天」——`DATA_RETENTION.auditLogDays = 30` 这个常量从 P4 就在，只是一直没有任务去执行它。

**与 §10 第 3 项初稿的差异**：初稿问的是「要不要设 90 天」，实施取 **30 天**，理由是「与既有 `DATA_RETENTION.auditLogDays` 同源」——两处数字不一致会在隐私文案与代码之间制造新的漂移。想更长只改 `PERSIST_AI_AUDIT_KEEP_DAYS`，不动代码。

**模块**
- `ai-audit.ts`：新增 `pruneAiCalls(db, cutoff, batchSize = 500)`。用 `DELETE ... WHERE id IN (SELECT id ... WHERE created_at < ? ORDER BY id LIMIT ?)` 分批删，循环到删空——单条 `DELETE` 在攒了几万行后会长时间持写锁，把并发 AI 请求卡在 `SQLITE_BUSY`。不用 `DELETE ... LIMIT`（需要 `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` 编译选项，Node 自带的那份不保证开）。循环上限 1000 轮（50 万行/次）只为防御「cutoff 传错扫空全表」，剩下的下次继续。
- `jobs/ai-audit-prune.ts`：`runAiAuditPrune` + `startAiAuditPruneScheduler`。每天 **04:00 之后**跑一次（错开 03:00 的 `VACUUM INTO` 快照，避免同时抢写锁）；用 `job_runs` 的 `(name, run_key)` 去重，`run_key` 是本地日期——**重启不会当天重复删**，也留下一行可查的执行记录；删除失败记 `failed`，`claimJobRun` 允许 failed 当天重跑一次。删 0 行也写 `ok`：「今天跑过了」与「任务没启动」必须能区分。
- `config.ts`：`PERSIST_AI_AUDIT_KEEP_DAYS` 默认 `DATA_RETENTION.auditLogDays`（30），范围 0–3650；启动日志新增 `"aiAudit":"30d"`，关掉时是 `"off"`。
- `index.ts`：与每日简报**并列独立启动**（简报默认关闭，审计清理不能跟着它一起停），`shutdown` 先停定时器再关库。

**语义坑（写在代码注释里，这里再记一次）**：这个 `0` 与配额的两个 `0` **意思相反**。配额 `= 0` 是「关掉限制」（放行），保留期 `= 0` 是「关掉清理」（不删）。保留期是删数据的动作，默认必须保守，所以「关」绝不能等于「全删」。

**验收（`server/test/ai-audit-prune.test.ts` 12 条 + `config.test.ts` 1 条；服务端 32 文件 / 326 测试）**
- 只删 `created_at < cutoff`：40 天前删、30 天前**恰好等于 cutoff 不删**（严格小于）、1 天前留。
- 1200 行旧数据 + 批大小 100 → 返回 1200（验证「循环删空」而不是删一批就收工）。
- 不碰 `ai_usage`：按天汇总是历史成本曲线，不属于审计明细。
- `keepDays = 0` 跳过且**不写 `job_runs`**（不留「跑过了但什么都没做」的噪声行）；04:00 之前 `not-due`。
- 同日第二次 `already-ran`；隔天再跑一次，`job_runs` 两行。
- 删表（模拟表缺失）→ `failed` 且 `job_runs.error` 有值，进程不抛。
- 本机真实进程（临时库 `:memory:` 之外的 `DB_PATH`）：启动日志 `"aiAudit":"30d"` + `{"deleted":0,"keepDays":30,"msg":"ai audit pruned"}`，`job_runs` 落 `ai_audit_prune / 2026-11-17 / ok`。

#### Step 4 生产部署（2026-11-17 16:13，已上线）

1. 备份：`server-dist.tgz` + `server.env` → `/root/backend-backup-20261117-161330/`；库快照 `persist-20261117-161334-manual.sqlite`（`integrity: ok`，258048 B，sha256 `6979cb29…`）。
2. `dist` 原子替换（49 → **50** js，新增 `jobs/ai-audit-prune.js`），`server.env` 追加 `PERSIST_AI_AUDIT_KEEP_DAYS=30`（**29 键**，`600`）；重启后 PID **45265**、`NRestarts=0`，health `version=3`，启动日志 `"aiAudit":"30d"` + `ai audit pruned deleted:0`（生产 `ai_calls` 本来为空）。
3. **在生产库上验证真的会删**（不是只看代码）：插入一条 40 天前、一条 3 天前的标记行 → 用生产 `dist` 里的 `pruneAiCalls` 跑一次 → `deleted=1`，留下的是 3 天前那条 → 再删掉标记行，`ai_calls` 回到 0。`job_runs` 有 `ai_audit_prune / 2026-11-17 / ok`。
4. 公网复核：`/api/health` 200；无凭据 `POST /api/report`、`/api/chat`（完整合法请求体）均 `401 ai_unauthorized`——清理任务没有碰到门。
5. 回滚：`PERSIST_AI_AUDIT_KEEP_DAYS=0` → 重启即停止清理（历史行原样保留，不删）；整版回退用备份 tgz，无 migration 变更（没加索引，见下）。

**刻意没加索引**：`ai_calls(created_at)` 的索引在单用户量级（100 次/天上限 → 30 天 ≈ 3000 行）收益为零，却要多一次 migration（schema 4）。真要长到十万行再加，那时才有意义。

---

## 8. 测试计划

| 层 | 用例 |
| --- | --- |
| `server/src/ai/ai-guard.test.ts`（新增） | 4 种失败形态同响应；`timingSafeEqual` 路径；空表 fail-closed；多 key 命中第二个；非法配置项被丢弃 |
| `server/src/routes/chat.test.ts` | 401 短路（不调上游、不耗限流）；`off` 回归；`warn` 放行且审计正确 |
| `server/src/routes/report.test.ts` | 同上 |
| `server/src/ai/ai-usage.test.ts`（Step 2） | 边界值（恰好等于上限 / 超 1）；并发两次都通过（记录为已知行为，不作精确断言） |
| `server/test/ai-usage.test.ts`（Step 3） | token 用满按 `tokens` 拒；token 未满放行；只开 token 维度仍按次计数；累加不覆盖次数；两项为 0 / 负数 / 小数 / 跨日 / `anonymous` |
| `server/test/deepseek.test.ts`（Step 3） | 流末尾 usage 帧回调且不进正文；请求体带 `stream_options.include_usage`；无 usage 不回调；正文不合规也先回调 |
| `server/test/ai-audit-prune.test.ts`（Step 4） | 只删 `created_at < cutoff`（等于不删）；1200 行 + 批 100 循环删空；不碰 `ai_usage`；`keepDays=0` 跳过且不写 `job_runs`；04:00 前 `not-due`；同日 `already-ran` / 隔天再跑；删表记 `failed` 不抛 |
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
- 配额按维关：`PERSIST_AI_DAILY_LIMIT=0`（只关次数）/ `PERSIST_AI_DAILY_TOKENS=0`（只关 token）。
- 保留期清理：`PERSIST_AI_AUDIT_KEEP_DAYS=0` + 重启 → 停止清理（**历史行原样保留**，这个 0 是「不删」不是「全删」）。
- 回滚代码时注意 migration v3 已执行：新增表不影响旧代码（旧代码不读这两张表），因此不必回滚数据库；Step 4 没有 migration。

---

## 10. 待确认问题

实施前需用户拍板，**未定项不阻塞实施**：

1. ~~**日配额数值**~~ **已定（2026-11-17）：100 次/天 + 200000 token/天**。两维可独立关闭（`PERSIST_AI_DAILY_LIMIT=0` / `PERSIST_AI_DAILY_TOKENS=0`）。选 200000 的依据：正常一天约十几轮对话 + 两三份报告 ≈ 2–5 万 token，留 4–10 倍余量；按 deepseek-chat 价格跑满一天也只是几毛到一两块钱。
2. ~~**日界时区**~~ **已定：服务器本地日期（CST）**，与备份 timer 的 03:00 CST 口径一致。
3. ~~**审计保留期**~~ **已定（2026-11-17）：30 天**，`PERSIST_AI_AUDIT_KEEP_DAYS` 可调（`0` = 不清理）。取 30 而非初稿的 90，是为了与 `DATA_RETENTION.auditLogDays` 同源，隐私文案与代码不打架。实现与生产验证见 §7 Step 4。
4. ~~**`analysis` 是否纳入同一套配额**~~ **已定：不纳入**——它已有设备令牌门 + 6 次/5 分钟限流。
5. **是否在设置页暴露「AI 凭据状态」**：本文建议**不做**。暴露状态等于告诉使用者「这里有个密钥」，而凭据失效时前端已有明确降级提示。

---

## 11. 文档联动

Step 1–4 实施时的联动清单（**已全部落地，2026-11-17**）：

- `docs/工程约定.md` §1 的 AI 行（「对外开放前仍须完成服务端 token 门」→ 更新为已完成及实现方式）
- `docs/部署与服务器现状.md`（新增环境变量、schema 版本、上线顺序与回滚步骤）
- `server/.env.example`（新增 3 个变量，**不含真实值**）
- `HANDOFF.md`（现状、铁律、待办、风险与操作边界）

**注意**：本文是设计稿。Step 1 验收通过前，不得在交接文档里把 P0 写成「已完成」。

### 11.1 联动执行结果（2026-11-17）

Step 1 与 Step 2 都已验收并部署，文档按下表实际落地（与上面清单有一处调整）：

| 文档 | 实际处理 |
| --- | --- |
| `docs/工程约定.md` | §1 AI 行改为「已具备 AI 调用边界」，服务端行补 11-17 部署与 PID |
| `docs/部署与服务器现状.md` | 顶部三条 11-17 部署记录（凭据门 / Step 2 / Step 3）；§6.1 生产现状已更新为当前实测（schema 5 / dist 47 js / PID 59660 / 36 键 env） |
| `README.md` | 规模数字、当前阶段标题、AI 边界段落、P0 变量说明、文档地图入口 |
| `HANDOFF.md` | 顶部加 11-17 入口记录，并把 11-16 段落标注为历史 |
| `server/.env.example` | Step 1–4 共加 5 个变量（空值或安全默认 + 注释），未含真实值 |

> **2026-11-19 补充**：原 `docs/项目交接-2026-11-16.md` 与 `docs/项目交接-2026-11-17.md`
> 两份临时交接稿已删除，其内容（生产实况、鉴权表、任务看板、已知风险与操作边界）已并入
> [`HANDOFF.md`](../HANDOFF.md)。这两份文稿是按「一次性会话交接」写的，含大量逐步骤流水，
> 长期保留会与源码脱节。
