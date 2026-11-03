# Persist App

Persist 的 React Web 客户端。

## 开发命令

```powershell
npm run dev          # 本地开发服务器
npm run lint         # Oxlint
npm run typecheck    # TypeScript 类型检查
npm test             # Vitest 单元测试
npm run test:e2e     # Playwright 端到端测试
npm run format       # Prettier 格式化
npm run build        # 生产构建
```

## 工程约定

- 页面路由与全局壳层放在 `src/`。
- 已验收的 v3 视觉样式位于 `src/styles/home-v3.css`，新增共享样式放在 `src/styles/persist.css`。
- 业务数据写入本机浏览器 IndexedDB（原生实现，无 Dexie）：`src/lib/persist-state.ts` 管记录结构与 `schemaVersion` 迁移，`src/lib/persist-storage.ts` 管 open / load / save 与降级；`MockDataProvider` 首挂载水合、200 ms 防抖落盘、`pagehide` / `visibilitychange` 补写，对外 Context 契约不变。仍未接入 DeepSeek 或服务器。
- 改 `MockDataProvider` 的状态切片时必须同步维护持久化记录（`schemaVersion` + 迁移），否则老数据会被判为损坏或丢失；未来版本记录只读不覆盖。
- API Key 不得进入 Web 客户端或 Android 包，后续只能通过 `server/` 代理使用。
- 条件类名请使用 `cn()`（`src/lib/cn.ts`）或「完整字符串三元」，不要依赖条件拼接里的手写空格。历史教训：`prettier-plugin-tailwindcss`（已于 2026-11-03 移除）会把它压平成 `plan-itemdone` 这类错误类名，导致状态样式静默失效。
- 批量格式化要单独成提交：`prettier --write` 后必须比对构建产物哈希并逐像素比对 `design/` 截图 —— Prettier 拆行会给 JSX 文本补 `{' '}` 子节点，可能挪动换行位置（`ReportsPage.tsx` 已踩过一次）。

## 当前页面（2026-11-03 复核）

```text
/          今日          /fitness  健身
/diet      饮食          /study    学习
/plans     长期计划      /profile  个人档案
/reports   AI 报告       /settings 设置
```

主导航固定五项：今日 / 健身 / 饮食 / 学习 / AI 报告。`/plans` 是二级页面，从档案页「AI 建档」、今日页计划区或 `/plans?onboard=1` 深链进入；该页的 AI 对话是本地规则式 Mock，页面标注「本地生成 · Mock 对话」。

测试现状（2026-11-03 步骤 6 后复跑）：`npm test` 123 条单元测试（8 个文件，新增 `src/lib/persist-state.test.ts` 11 条），`npx playwright test` 49 用例 × 2 项目 = 98 次执行（0 跳过，新增 `e2e/persistence.spec.ts` 3 条），`npm run visual:check` 15 状态 × 6 视口 = 91 张截图且全部通过（用户已在桌面端与移动端完成视觉验收）。验证细节与已知问题见仓库根目录 `HANDOFF.md`。

## 待办（按顺序）

1. 步骤 7（P3-0）：设置页「清空本机数据」入口——清 IndexedDB → 重置内存态 → 清 `snapshot`，保持 `hydrated`，补 1 条 E2E。
2. P3（步骤 8）：接入 `server/` 的 Fastify 代理与 DeepSeek，前端只请求相对 `/api/*`（保留失败降级与「本地生成」标注规则）。完整计划见 `HANDOFF.md` §0.4 / §13 P3，服务器与部署约束见 `docs/部署与服务器现状.md`。

已完成（2026-11-03）：

- 步骤 6 本机持久化：新增 `src/lib/persist-state.ts`、`src/lib/persist-storage.ts`，`MockDataProvider` 水合 + 防抖落盘，`mock-data-transfer.ts` 抽出 `parseMockBackupValue()` 共用校验；`e2e/persistence.spec.ts` 与 `persist-state.test.ts` 覆盖刷新恢复、版本迁移与损坏降级。文案同步改为「已保存在本机浏览器（IndexedDB）」。
- Git 提交链已全部推送（`github.com/save626/Persist`，公开仓库）：起于 `bd779eb`（262 文件 37.39 MB），后续为步骤 5/6 功能与文档提交、`d4c9696` 清理、`style:` 格式化及若干 `docs:` 同步；提交前删除了仓库根目录 `$null` 与 `app/$null` 两个误建文件。
- `SettingsPage.exportMockData()` 已改调 `serializeMockBackup()`，导出 0.2.0 且含 `longTermPlans`，导入 toast 报记录数与计划数；round-trip 单测与导出/导入 E2E 已覆盖。
- `scripts/visual-check.mjs` 已纳入 `/plans` 五个状态，视口扩到 6 个（新增 421×926 真机参考），并新增「档案页必须可见 AI 建档」断言。
- 全站弹窗统一垂直居中；窄屏保留档案页「AI 建档」入口（`.profile-onboard-action`）。
