# Shared

Web（`app/`）、服务端（`server/`）以及将来的移动端共用的**纯 TypeScript** 类型、常量与校验函数。

共享层不得依赖浏览器 DOM、数据库、Node API 或任何 UI 框架，否则会被迫在某一端做 polyfill。

## 目录

```
src/
├─ index.ts               入口（转出 sync、analysis、backup、export 与 account 契约）
└─ contract/
   ├─ sync.ts             账号与增量同步的请求 / 响应契约与校验（唯一一份）
   ├─ entities.ts         同步实体信封：ENTITY_KINDS / EntityCandidate / SINGLE_ROW_KINDS
   ├─ analysis.ts         步骤 13：综合分析请求 / 事实包 v2 / 报告内容与响应契约（唯一一份）
   ├─ backup.ts           步骤 14：快照列表 / 手动创建 / 恢复请求与响应契约（唯一一份）
   ├─ export.ts           步骤 14c：账号导出信封 / 0.3.0 数据切片 / 下载文件名契约（唯一一份）
   ├─ account.ts          步骤 14d：账号删除请求 / 响应 / 逐表计数契约与 confirm 校验
   └─ parse.ts            ParseResult<T>（ok/value 或 ok:false/message）
```

`package.json` 的 `exports` 按子路径暴露：`.`、`./contract/sync`、`./contract/entities`、`./contract/parse`、`./contract/analysis`、`./contract/backup`、`./contract/export`、`./contract/account`。

## 谁在用

| 使用方           | 入口                                                    | 说明                                                                 |
| ---------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| 服务端           | `import ... from '@persist/shared/contract/sync'`       | 路由校验入参、组装响应；`server/src/db/entities.ts` 只做转出         |
| 服务端           | `import ... from '@persist/shared/contract/analysis'`   | 步骤 13：`/api/v1/analysis/*`、`/api/v1/reports*` 的入参校验与响应整形 |
| 服务端           | `import ... from '@persist/shared/contract/backup'`     | 步骤 14：`GET/POST /api/v1/backups` 与 `POST /api/v1/backups/:id/restore` 的列表 / 创建 / 恢复类型 |
| 服务端           | `import ... from '@persist/shared/contract/export'`     | 步骤 14c：`GET /api/v1/export` 的信封 / 数据切片 / 下载文件名契约 |
| 服务端           | `import ... from '@persist/shared/contract/account'`    | 步骤 14d：`DELETE /api/v1/account` 的 `confirm:true` 校验与删除计数响应 |
| 前端             | `app/src/lib/sync-contract.ts`                          | 前端唯一入口，12d 的 `sync-client` / `sync-queue` 经由它取类型与校验 |
| 前端             | `app/src/lib/analysis-contract.ts`                      | 步骤 13：`analysis-client` 与报告页/设置页经由它取类型与常量         |
| 移动端（未开始） | 预留                                                    | 同一包名与子路径                                                     |

## 响应形状约定（步骤 13 起，别再踩）

- **综合分析成功响应是平铺对象**（`AnalysisReportResponse` 直接带 `id / type / rangeDays / origin / cached / model / createdAt / content / metrics`），**没有 `{ report: ... }` 包裹层**。这是前后端共同的契约：改形状必须同时改 `shared/src/contract/analysis.ts`、服务端返回与前端解析。
- 与旧接口的差别要在代码里看清：`POST /api/report` 是 `{ report, model }` 包裹，`POST /api/v1/analysis/reports` 是平铺——历史教训见 `HANDOFF.md` §18.3（客户端曾按 `{ report }` 解包，导致整块显示不可用）。
- 列表接口是 `{ reports, nextCursor }`，详情接口是单个对象，404 走 `{ error: { code: 'not_found' } }`。
- 步骤 14c 的导出信封是 `{ app: 'Persist', version: '0.3.0', mode: 'server-export', schemaVersion: 2, exportedAt, data }`；`data` 必须与客户端 0.3.0 备份同构，客户端导入不得按 `mode` 拒收。
- 步骤 14d 的删除成功响应是平铺 `{ deleted: true, deletedAt, counts }`；`counts` 同时给出账号行、分析归档、任务、同步台账、设备与已清理备份文件数。失败使用统一 `{ error: { code, message } }`，其中缺失确认是 `422 confirmation_required`。
- 备份列表响应是平铺 `{ backups: BackupListItem[] }`，手动创建响应是 `{ backup: BackupListItem }`；列表项只含 `id / bytes / createdAt / reason / sha256`，`sha256` 可为 `null`，**绝不暴露服务端绝对路径**。

## 构建与消费

`shared/` 是一个独立的 TS 项目，通过 `package.json` 的 `exports` 暴露 `dist/` 产物：

- `app` 与 `server` 各自在 `package.json` 里以 `"@persist/shared": "file:../shared"` 引用（`npm install` 建立链接）。
- 编译：`npm run shared:build`（在 `app/` 或 `server/` 下执行，两者都会 `tsc -p ../shared/tsconfig.json`）；
  `server` 的 `prebuild` / `pretest` / `typecheck` 与 `app` 的 `predev` / `prebuild` / `pretypecheck` / `pretest` / `pretest:e2e` 已自动先编译。
- 产物在 `shared/dist/`，**已 gitignore**，不进仓库；改完契约后重新编译即可。
- 部署：`server` 运行时要能解析 `@persist/shared`，因此服务器上 `shared/`（含 `dist/`）必须与 `server/` 同机放好，详见 `docs/部署与服务器现状.md`。

## 版本与兼容

契约字段只增不改；上限常量（如 `MAX_PUSH_ENTITIES`、`ANALYSIS_CONTENT_LIMITS`、`ANALYSIS_RANGE_DAYS`）改动会同时影响前后端，必须同步发布。
步骤 13 新增的 `contract/analysis.ts` 把「内容长度上限、数字白名单口径、错误码、保留期 `DATA_RETENTION`、`DEFAULT_DAILY_BRIEF_AT`」也收进共享层，前后端与每日简报 job 用同一份常量，避免各写一套阈值。
旧的 `server/src/contract.ts`（chat / report）暂未迁移，属于另一笔债，见 `docs/P4-数据层与AI综合分析设计方案.md` §17。
