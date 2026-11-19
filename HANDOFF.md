# Persist 项目现状与交接

> **本文是「现在是什么 + 下一步做什么」的唯一事实源。**
>
> 写作时实测（2026-11-19 16:30）：`HEAD = origin/main = 15fdb09`，工作区干净。
> 生产仍为 **IP 直连内部调试**——域名未解析、443 未开、**备案号未下发**。
>
> 其他文档分工：
> 部署与服务器 → [`docs/部署与服务器现状.md`](docs/部署与服务器现状.md)；
> 网站设计层重新设计 → [`docs/网站设计层交接-2026-11-19.md`](docs/网站设计层交接-2026-11-19.md)；
> 工程纪律与视觉基线 → [`docs/工程约定.md`](docs/工程约定.md)；
> 产品定位与长期规划 → [`docs/Persist-项目开发规划.md`](docs/Persist-项目开发规划.md)；
> 终态架构与数据模型 → [`docs/P4-数据层与AI综合分析设计方案.md`](docs/P4-数据层与AI综合分析设计方案.md)；
> AI 安全门设计 → [`docs/P0-AI接口服务端安全门设计方案.md`](docs/P0-AI接口服务端安全门设计方案.md)；
> 代码旁的操作手册 → `app/README.md`、`server/README.md`、`shared/README.md`、`app/android/README.md`。
>
> **本文档只保留：现行状态、铁律、待办、风险、开工流程。**历史实施流水、逐步骤记录、
> 已被取代的方案稿不在此重复——代码实现优先于任何文档。

---

## 1. 一句话现状

八个页面（今日 / 健身 / 饮食 / 学习 / 档案 / AI 报告 / 长期计划 / 设置）可完整点击的
本地优先产品 + 已部署生产的 AI 服务端与数据层 + 已闭环的同步与综合分析能力。

网页 `npm run build` 产物**只允许 `demo` / `guest`**（无参数默认 `guest`，解析层永远
进不了 `owner`）；完整产品只在作者自有移动端 `build:mobile` 包（默认 `owner`）。

**AI 接口已完全关闭公网裸奔**：`/api/chat` 与 `/api/report` 必须携带服务端签发的凭据
（PSK，`PERSIST_AI_GATE=enforce`），每日 100 次 + 20 万 token 双配额，`ai_calls` 审计保留
30 天，`audit_log` 落库留痕。

**仍不得宣称「已上线」**：域名 / 443 / 证书 / 页脚备案号等备案号下发；Android 仍是
debug 签名。

---

## 2. 当前状态（2026-11-19 16:30 实测）

### 2.1 自动化基线（本轮实跑）

| 层            | 结果                                             |
| ------------- | ------------------------------------------------ |
| server typecheck | 通过                                         |
| server test   | **35 文件 / 376 测试通过**                       |
| app typecheck | 通过                                             |
| app test      | **35 文件 / 452 测试通过**                       |
| app / server lint | 0 错 0 警告                                |
| E2E           | 13 个 spec 文件；上次全量 142/142               |
| 视觉基线      | `design/*.png` **141 张**                        |
| 主包体积      | **394 829 B**（已分包，**不再有 500 kB 警告**） |

### 2.2 生产实况（SSH 只读复核）

| 项          | 值                                                             |
| ----------- | -------------------------------------------------------------- |
| 服务        | `persist-server` active，PID `59660`，`NRestarts=0`            |
| Node        | `/opt/node22/bin/node` v22.19.0（系统 Node 20 未动）            |
| 数据库      | `/var/lib/persist/persist.sqlite` 348 160 B，**schema 5**       |
| 数据量      | `users=1` / `devices=1` / `ai_calls=20` / `ai_usage=4` / `audit_log=7` / `job_runs=7` |
| env         | `/etc/persist/server.env` **36 键**，`600 root:root`             |
| 备份        | `/var/lib/persist/backups` 2 份；`persist-backup.timer` active，每日 03:00 |
| dist        | 47 个 js                                                        |
| health      | `status=ok / ai=deepseek / db=ok / storage 13.8%`               |
| 公网入口    | `/` 200 / `/home.html` 200 / `/assets/og-card.png` 200 / `/app/` 200 |
| 443         | **不可达**（符合预期，备案号未下发）                             |
| web 产物    | 主包 `index-B3NNyoQi.js` + `index-CrPNl0GG.css`                 |

> health 接口 **2026-11-18 起不再返回 `version`（schema）与 `model`**——这两个字段对运维
> 无用。查 schema 请直连数据库（`SELECT MAX(version) FROM schema_migrations`）。

### 2.3 三种运行模式

| 模式     | 数据                              | AI                                         | 入口                        |
| -------- | --------------------------------- | ------------------------------------------ | --------------------------- |
| `demo`   | 完整预置演示数据，独立 IndexedDB  | **全部 AI 内容部署前真实生成并固化**，部署后只读、零 `/api/*` | `/app/?mode=demo`          |
| `guest`  | 空白开始，独立 IndexedDB          | **全部固定 Mock**，零 `/api/*`              | `/app/?mode=guest`         |
| `owner`  | 作者自己的数据，`persist-app` 库  | 完整真实 AI + 同步，失败时如实降级         | 移动端 `build:mobile` 默认 |

三者用独立 IndexedDB，查询参数写入 `sessionStorage`。**构建隔离是产品面边界，不是服务端
鉴权**——服务端接口另有凭据门与配额兜底。

---

## 3. 铁律（不可回退）

1. **一次只做一步**：做完写报告并停下等用户确认，不连做、不擅自扩大范围。
2. **前端视觉已冻结**：不改视觉、类名、布局，除非用户明确要求。改了任何页面
   文案 / 结构必须重跑 `visual:check` 并请用户桌面端 + 移动端重新验收。
3. **契约先行**：改 `ChatEvent` / `profilePatch` / `/api/report` 请求响应，必须同步
   `server/src/contract.ts` 与 `app/src/lib/*-types.ts`，并在报告中说明契约是否变化。
4. **无 Key 也能跑**：AI 不可用时回退本地规则 / Mock，并在界面**如实标注来源**，
   绝不把 Mock 伪装成 AI。
5. **不许编造数据**：提示词已禁止任何数值推算，报告数字只能由确定性代码生成；
   不得写过去日期。
6. **未授权模块对 AI 不可见**：只发送 `ProfileData.aiConsent` + `MockSettings.sources`
   允许的摘要，未授权模块在 `digest` 中为 `null`。
7. **公开仓库**：不得提交真实公网 IP（写作 `121.196.*.*`）、root 密码、API Key、
   `.env`、`*.local.md`、日志与构建产物。
8. **不得宣称已上线**：备案号下发前不得用域名对外服务，不得编造备案号，不得按经验值
   承诺上线日期（管局法定期限 20 个工作日）。
9. **不得把计划写成现状**：功能态一律写「已部署 / 已在生产启用」；「已上线」只在域名
   + 443 + 备案号三者齐备后才成立。
10. **生产变更先获授权**：任何后端、Nginx、systemd、env、安全组或静态包变更，先备份
    再改，改前不动手；不删任何回滚源。
11. **提交纪律**：提交前 `git diff --cached --name-only` 审计（排除 `node_modules/`、
    `app/dist/`、`test-results/`、`picture/`、`产品/`），推送后核对远端 `refs/heads/main`
    与本地 HEAD 一致。

---

## 4. 待办事项（现行）

| ID   | 事项                                | 状态         | 卡点 / 说明                                                              |
| ---- | ----------------------------------- | ------------ | ------------------------------------------------------------------------- |
| P2   | 域名解析 / 443 / 证书 / 页脚备案号  | ⛔ 等外部条件 | 等管局下发备案号。**当天执行顺序见 [`docs/部署与服务器现状.md`](docs/部署与服务器现状.md) §4.1，零对外影响的准备已全部做完** |
| P3   | Android 正式签名                    | ⏳ 可推进     | 需生成 keystore、配置 Gradle release signing、出 release APK 并验证。**密钥与密码的保管方式须由用户决定**（密码不进仓库；keystore 是否入库需拍板） |
| P4   | 网站设计层重新设计                  | 🟡 进行中     | 落地页 / 介绍首页 / OG 分享卡。交接见 [`docs/网站设计层交接-2026-11-19.md`](docs/网站设计层交接-2026-11-19.md)。待拍板：微信 1:1 裁切要不要改卡面 |
| P5   | `devices` 吊销行无清理任务          | 🟡 低优先     | 吊销行只置 `revoked_at` 不删，行数缓慢增长；量级很小，暂不单独做         |
| —    | 投诉 / 联系邮箱                     | ⏭ 可选       | 已从「备案前置」降级为可选；等用户愿意公开专用地址时再写               |

### 4.1 已完成且有证据（不再重复跟踪）

P0 凭据门 / 日配额 / token 配额 / 审计保留期 · P1 隐私表述复核 · P4 生产恢复演练 ·
P5 墓碑与 `sync_ops` 30 天清理 · 数据库级 `audit_log` · 路由分包 · 设置页 401/429
差异化文案 · guest 重进语义 · 同步徽标与失败态一致 · 视觉基线可复现 · 移动端真实 AI
对话 · 探针覆盖对话链路 · 恢复码手动重置 · 徽标区分「待办」与「故障」 ·
P0 专门备案决策（本版不做，见 §6.3）· 备案号下发前全部零对外准备。

---

## 5. 已知风险与限制

### 5.1 安全

- 凭据是**静态 PSK 内联在 APK**：包被提取即可复用。当前靠「100 次/天 + IP 限流 +
  可轮换」兜底，**不是强身份**。
- **生产 `PERSIST_AI_KEYS` 当前为空**（2026-11-18 攻击面收敛时清空）——即旧 APK 里的
  `psa_` 一律 401。**要恢复 AI 调用必须先重新配 key**（本机 `server/.env` 与生产
  `/etc/persist/server.env` 同步写入 `k1:<sha256>`，明文只在 `app/.env.mobile.local`）。
  轮换必须多 key 并行。
- CORS 只约束浏览器，从来不是鉴权；真正的门是 `PERSIST_AI_GATE`。
- `/api/v1/*` 用设备令牌，**没有用户密码体系**（产品决定，不是缺陷）。
- **注册已关闭**：生产 `PERSIST_REGISTRATION_MAX_ACCOUNTS=1` 且 `users=1`，新注册返回
  `409 registration_closed`（公网实测）。换机只剩恢复码这一条路
  （`/api/v1/devices/restore`），另有 2026-11-19 新增的恢复码手动重置端点兜底。
- **`TRUST_PROXY=loopback`**（生产）：后端只信本机代理的 `X-Forwarded-For`。曾因
  `TRUST_PROXY=1` 叠加 Nginx 的 `$proxy_add_x_forwarded_for`（追加而非覆盖）导致
  `request.ip` 取到客户端自己填的值——**每次伪造即换一个限流桶，按 IP 的限流等于失效**。
  Nginx 已改为 `proxy_set_header X-Forwarded-For $remote_addr;`。

### 5.2 数据

- **同步副本不是备份**；整库快照不能按账号裁剪，多账号同库时删除账号会被 409 保护
  挡住；恢复对象是整个 SQLite 文件。
- 恢复前**必须核验快照内容**（历史上出现过对应空库的快照）。
- `ai_calls` 只留 30 天：**30 天前的调用无法事后追查**。要长期留证就调大
  `PERSIST_AI_AUDIT_KEEP_DAYS`，别在出事后才发现已经删了。
- **保留期是「收敛」不是「保证」**：设备水位只保证「墓碑产生后那台设备联系过服务端
  一次」，不保证它拉完了全部分页。超期未同步的设备回来后，已清掉的墓碑对应的本地
  记录会残留成幽灵行，只能靠客户端重新 bootstrap 或手动删除。
- `sync_ops` 清掉后若客户端重放 30 天前的 op，会被当成新 op 再应用一次（幂等，但多推
  一个 rev）。

### 5.3 合规与发布

- 备案号未下发 ⇒ 不得用域名对外提供服务，不得宣称「已上线」。
- **生成式 AI 专门备案：本版决定不做**（2026-11-17 用户决策）。依据是可验证的事实链：
  `app/src/lib/runtime-mode.ts` 的 `resolveRuntimeMode` 在 `surface: 'web'` 下**任何输入
  都不会返回 `owner`**；`demo` / `guest` 的四项 AI 能力（`report` / `chat` /
  `morningBrief` / `serverAnalysis`）全为 `false` 且不请求 `/api/*`；真实 AI 只存在于
  `build:mobile` 产物，由作者本人在 debug APK 上使用。定性上属**个人自用**，不构成
  「向境内公众提供生成式 AI 服务」。
- **但这是会被行为推翻的结论，不是一种状态**。以下任一发生，定性立即翻转、备案与
  安全评估回到硬门槛：把 owner 包给第二个人（发 APK、代装）、把 AI 凭据 `k1` 给别人、
  网页端以任何形式开放 owner 或真实 AI 入口、对外宣传「网页上能用 AI」。
  翻转前先改代码与文案，再谈合规——不要靠记忆守这条。
- 另一个**不是备案、但更近**的问题：当前 IP 直连 + cleartext，客户端把 AI 凭据放在
  `authorization: Bearer` 头里明文发送，同网段可嗅探。只有作者一人使用时可接受；一旦
  要给第二个人用，**HTTPS 必须先于备案完成**。

### 5.4 运维

- 2C2G，**不在服务器构建前端**（会 OOM）。
- SQLite WAL，需持续观察磁盘与锁；当前 13.8%。
- Node 内置 SQLite 仍打印实验性警告，属预期。
- `audit_log` 只记写动作不记读（「谁什么时候读过我的报告」答不了）；
  `export.read` 在 UI 上**不可达**（前端「导出 JSON」是纯本地 `Blob` 下载，不调 API）。
- **「关闭同步」不产生任何服务端痕迹**：`SyncEngine.disable()` 只改本地 `meta` 与定时器，
  不发请求。审计与 `devices.last_seen_at` 无法区分「关了同步」与「关机了」。
- 恢复演练有三条边界，别把一次演练当全覆盖：① 验的是「恢复到 12 秒前的快照」，**跨盘 /
  跨机恢复未验**；② 恢复中途失败的**自动回滚**只有单测覆盖；③ 恢复是**整库替换**，
  一旦出现第二个账号会互相覆盖。
- 分包后 E2E 出现过偶发失败（单独复跑都通过）。**再遇到不要直接当 flaky 放过**：先看
  `test-results/*/error-context.md` 的页面快照，确认是不是停在「正在载入…」占位上。

---

## 6. 责任与流程

### 6.1 汇报格式（固定 8 段，中文）

1. 做了什么　2. 为什么　3. 改了哪些文件　4. 验证结果　5. 实际数字
6. 风险与限制　7. 遗留项　8. 建议下一步（只给一个推荐动作，不擅自连做）

### 6.2 开工核对与复跑基线

```powershell
& $Git log --oneline -3
& $Git status --short
& $Git rev-parse HEAD origin/main      # 两者应一致

npm --prefix server run typecheck; npm --prefix server test    # 35 / 376
npm --prefix app run typecheck;    npm --prefix app test       # 35 / 452
```

视觉基线要跑两样东西，别混：

```powershell
cd app; npm run dev:mobile -- --port 4173     # owner 模式，另一窗口
npm run visual:check                          # 结构门禁：overflow / console error / 缺元素 / hidden 断言
npm run visual:diff -- ../design <备份目录>   # 像素门禁：真比对基线，输出差异像素与差异图
```

`visual:check` 全量会重写 141 张（日期进标题），**跑前先备份、跑完只留有意变更的那几张**，
其余从备份还原；`visual:diff` 才是判断「改了没有」的依据。

### 6.3 生产操作规则

1. 变更前先备份并验证可读；**先获用户明确授权**再动手。
2. 不在服务器构建前端（2C2G 容易 OOM）。
3. 后端部署必须同时包含 `server/dist`、`server/package.json`、`shared/dist`、
   `shared/package.json`。
4. 不重启 `persist-server`，除非改动要求或健康检查异常。
5. 不删除任何回滚源。当前锚点（SSH 核实仍存在）：
   `/opt/persist-next/server/dist.old`、`/opt/persist/server`、
   `/root/backend-backup-2026111{1,3,7}-*`（多个）、`/root/frontend-backup-*`（多个）。
6. 不输出真实公网 IP（仓库只写 `121.196.*.*`）。
7. **不要用 `kill %1`**：非交互 ssh 没有作业控制，会杀不掉进程并占端口，导致「配了正确
   凭据却 401」。用 `P=$!`，收尾 `ss -ltnp` 确认端口释放。

### 6.4 三层回滚（代价从小到大）

1. **只关配额**：`PERSIST_AI_DAILY_LIMIT=0` 或 `PERSIST_AI_DAILY_TOKENS=0` → 重启，
   凭据门仍生效。
2. **只关凭据门**：`PERSIST_AI_GATE=off` → 重启，回到无门行为，不必回滚代码或 APK。
3. **停止审计清理**：`PERSIST_AI_AUDIT_KEEP_DAYS=0` → 重启。历史行原样保留（`0` 是
   「不删」，不是「全删」）。
4. **回滚代码**：换回 `dist.old` 或备份包。migration 只需向前，旧代码忽略新表即可。

---

## 7. 关键契约与索引

| 主题       | 位置                                                       |
| ---------- | ---------------------------------------------------------- |
| 页面与功能 | [`docs/Persist-项目开发规划.md`](docs/Persist-项目开发规划.md) §4–5 |
| 终态数据模型 / DDL / 同步协议 | [`docs/P4-数据层与AI综合分析设计方案.md`](docs/P4-数据层与AI综合分析设计方案.md) |
| AI 安全门设计 | [`docs/P0-AI接口服务端安全门设计方案.md`](docs/P0-AI接口服务端安全门设计方案.md) |
| API 与鉴权 | `server/README.md`（逐路由含请求响应示例）               |
| 同步契约    | `shared/README.md` + `shared/src/contract/`                |
| 前端工程约定 | `app/README.md`                                             |
| Android 构建与 USB 安装 | `app/android/README.md`                          |
| 设计令牌 / 视觉基线 / 响应式 | [`docs/工程约定.md`](docs/工程约定.md) §2–4               |

### 7.1 API 鉴权速查

| 分组     | 路由                     | 鉴权                                              |
| -------- | ------------------------ | ------------------------------------------------- |
| health   | `GET /api/health`        | 无（**不返回 schema 与 model**）                |
| AI 对话  | `POST /api/chat`         | **AI 凭据 + IP 限流 20/300s + 日配额 100 次 / 20 万 token** |
| AI 报告  | `POST /api/report`       | 同上（与 chat **共用**额度）                     |
| 设备     | `/api/v1/devices*`       | 注册受账号上限限制（生产上限 1，已满 → 409）；恢复需恢复码 |
| 同步     | `/api/v1/sync/*`         | 设备令牌                                         |
| 综合分析 | `/api/v1/analysis/*`     | 设备令牌 + 6 次/5 分钟（**不占** AI 日配额）     |
| 报告归档 | `/api/v1/reports*`       | 设备令牌                                         |
| 导出     | `GET /api/v1/export`     | 设备令牌                                         |
| 删除账号 | `DELETE /api/v1/account` | 设备令牌 + `confirm:true`                        |

错误码 `ai_unauthorized`（401）、`ai_quota_exceeded`（429，带次日零点 `retry-after`）、
`registration_closed`（409），均已写进 `server/src/contract.ts`。

> **`/api/v1/backups*` 与 `/api/v1/backups/:id/restore` 已于 2026-11-18 从服务端删除**
> （公网探测返回 404）。原因：这两个端点只校验「任意有效设备令牌」，`listBackups` 返回整机
> 快照列表、`executeRestore` 直接换库，**没有管理员判断**——配上开放注册等于「任何注册者
> 都能整库回滚」。备份与恢复改由服务器本机的 `db/backup-cli.js` + `persist-backup.timer` 走，
> 不经 HTTP。**不要在没有管理员鉴权的前提下把这两个端点加回来。**

---

## 8. 术语

| 术语                 | 解释                                                     |
| -------------------- | -------------------------------------------------------- |
| 今日闭环             | 计划 → 记录 → 聚合 → 复盘构成完整一天                    |
| 本地优先             | 写入先落本地库，服务器不可用不影响使用                   |
| 结构化 AI 输出       | 固定 schema 的 JSON 返回，便于校验与用户确认             |
| 确认式修改           | AI 不能直接写数据，必须用户确认后落库                    |
| 软删除               | 保留 `deletedAt`，便于撤销、备份与同步                   |
| Outbox               | 本地待同步操作队列（`app/src/lib/sync-queue.ts`）        |
| 事实包（`ReportFactsV2`） | 服务端按 7/30/90 天窗口用 SQL 聚合出的事实集合，模型只读它写文字 |
| 数字白名单           | 模型正文出现的每个数字必须存在于事实包中，否则按 `invalid_response` 拒绝、不归档 |
| 规则降级             | 无 Key / 上游超时时返回 200 + `origin: "rules"` + `model: null`，界面须标注来源 |
| `dateKey`            | `YYYY-MM-DD` 本地日期键，按日聚合与边界判断用            |
| `schemaVersion`      | 本机数据结构版本号（当前 **3**），驱动迁移               |
