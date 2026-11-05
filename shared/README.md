# Shared

Web（`app/`）、服务端（`server/`）以及将来的移动端共用的**纯 TypeScript** 类型、常量与校验函数。

共享层不得依赖浏览器 DOM、数据库、Node API 或任何 UI 框架，否则会被迫在某一端做 polyfill。

## 目录

```
src/
├─ index.ts               入口（目前只转出 sync 契约）
└─ contract/
   ├─ sync.ts             账号与增量同步的请求 / 响应契约与校验（唯一一份）
   ├─ entities.ts         同步实体信封：ENTITY_KINDS / EntityCandidate / SINGLE_ROW_KINDS
   └─ parse.ts            ParseResult<T>（ok/value 或 ok:false/message）
```

## 谁在用

| 使用方           | 入口                                              | 说明                                                                 |
| ---------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| 服务端           | `import ... from '@persist/shared/contract/sync'` | 路由校验入参、组装响应；`server/src/db/entities.ts` 只做转出         |
| 前端             | `app/src/lib/sync-contract.ts`                    | 前端唯一入口，12d 的 `sync-client` / `sync-queue` 经由它取类型与校验 |
| 移动端（未开始） | 预留                                              | 同一包名与子路径                                                     |

## 构建与消费

`shared/` 是一个独立的 TS 项目，通过 `package.json` 的 `exports` 暴露 `dist/` 产物：

- `app` 与 `server` 各自在 `package.json` 里以 `"@persist/shared": "file:../shared"` 引用（`npm install` 建立链接）。
- 编译：`npm run shared:build`（在 `app/` 或 `server/` 下执行，两者都会 `tsc -p ../shared/tsconfig.json`）；
  `server` 的 `prebuild` / `pretest` / `typecheck` 与 `app` 的 `predev` / `prebuild` / `pretypecheck` / `pretest` / `pretest:e2e` 已自动先编译。
- 产物在 `shared/dist/`，**已 gitignore**，不进仓库；改完契约后重新编译即可。
- 部署：`server` 运行时要能解析 `@persist/shared`，因此服务器上 `shared/`（含 `dist/`）必须与 `server/` 同机放好，详见 `docs/部署与服务器现状.md`。

## 版本与兼容

契约字段只增不改；上限常量（如 `MAX_PUSH_ENTITIES`）改动会同时影响前后端，必须同步发布。
旧的 `server/src/contract.ts`（chat / report）暂未迁移，属于另一笔债，见 `docs/P4-数据层与AI综合分析设计方案.md` §17。
