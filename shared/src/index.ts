/**
 * 共享层入口：Web、服务端（以及将来的移动端）都从这里取纯 TS 契约。
 *
 * 约定：不得依赖 DOM、Node API、数据库或 UI 框架；只放类型、常量与纯校验函数。
 */
export * from './contract/sync.js'
export * from './contract/analysis.js'
