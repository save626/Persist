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
- 现阶段使用内存 Mock 数据，不接入 IndexedDB、DeepSeek 或服务器。
- API Key 不得进入 Web 客户端或 Android 包，后续只能通过 `server/` 代理使用。
- 条件类名请使用 `cn()`（`src/lib/cn.ts`）或「完整字符串三元」，不要依赖条件拼接里的手写空格：`prettier-plugin-tailwindcss` 会把它压平成 `plan-itemdone` 这类错误类名，导致状态样式静默失效。
- 不要对整个仓库执行 `prettier --write`，只格式化本轮改动的文件。

## 当前页面（2026-11-03 复核）

```text
/          今日          /fitness  健身
/diet      饮食          /study    学习
/plans     长期计划      /profile  个人档案
/reports   AI 报告       /settings 设置
```

主导航固定五项：今日 / 健身 / 饮食 / 学习 / AI 报告。`/plans` 是二级页面，从档案页「AI 建档」、今日页计划区或 `/plans?onboard=1` 深链进入；该页的 AI 对话是本地规则式 Mock，页面标注「本地生成 · Mock 对话」。

测试现状（2026-11-03 复跑）：`npm test` 112 条单元测试（7 个文件），`npx playwright test` 46 用例 × 2 项目 = 92 次执行（0 跳过），`npm run visual:check` 15 状态 × 6 视口 = 91 张截图且全部通过（用户已在桌面端与移动端完成视觉验收）。验证细节与已知问题见仓库根目录 `HANDOFF.md`。

## 待办（按顺序）

1. 建立首个 Git 提交（当前仓库 0 commit），随后进入 Dexie / IndexedDB 持久化。完整计划见 `HANDOFF.md` §0.4。

已完成（2026-11-03）：

- `SettingsPage.exportMockData()` 已改调 `serializeMockBackup()`，导出 0.2.0 且含 `longTermPlans`，导入 toast 报记录数与计划数；round-trip 单测与导出/导入 E2E 已覆盖。
- `scripts/visual-check.mjs` 已纳入 `/plans` 五个状态，视口扩到 6 个（新增 421×926 真机参考），并新增「档案页必须可见 AI 建档」断言。
- 全站弹窗统一垂直居中；窄屏保留档案页「AI 建档」入口（`.profile-onboard-action`）。
