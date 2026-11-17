import { Suspense, lazy, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { MockDataProvider } from './context/MockDataProvider'
import { RuntimeModeProvider } from './context/RuntimeModeProvider'
import { UIProvider } from './context/UIProvider'
import { resolveRuntimeMode, resolveRuntimeSurface } from './lib/runtime-mode'
import { TodayPage } from './pages/TodayPage'

/*
 * 除「今日」以外的页面按路由懒加载（P5-3）：主包原先 684 kB，已过 500 kB 警告线。
 * 首屏只需要「今日」，其余页面各自成一个 chunk，进入时才下载、之后由浏览器缓存。
 *
 * `TodayPage` 保持静态引入：它是 `/` 的首屏，拆出去只会多一次往返，
 * 而且分包加载会让首屏先出现占位再跳成真内容。
 *
 * 用 `lazy(() => import(...).then(m => ({ default: m.X })))` 而不是给页面加 default export：
 * 页面在单测里都按具名导出引用，改导出形态会牵动一堆无关改动。
 */
const FitnessPage = lazy(() =>
  import('./pages/FitnessPage').then((module) => ({ default: module.FitnessPage })),
)
const DietPage = lazy(() =>
  import('./pages/DietPage').then((module) => ({ default: module.DietPage })),
)
const StudyPage = lazy(() =>
  import('./pages/StudyPage').then((module) => ({ default: module.StudyPage })),
)
const PlansPage = lazy(() =>
  import('./pages/PlansPage').then((module) => ({ default: module.PlansPage })),
)
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })),
)
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)

/**
 * 分包加载时的占位。刻意只占位、不画骨架：这两个页面结构差异很大，
 * 猜错骨架反而会造成「先闪一个假布局再跳成真布局」的观感问题。
 * 保留 `role="status"`，读屏能听到「正在载入」，而不是面对一块静默空白。
 */
function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <span>正在载入…</span>
    </div>
  )
}

/**
 * 只把 Suspense 套在路由元素上，不套整个 `<Routes>`：
 * 后者会让外壳（侧边栏 / 顶栏）在分包下载期间一起卸载，切换页面时整页闪一下。
 */
function deferred(node: ReactNode) {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>
}

const routerBasename = import.meta.env.BASE_URL === '/app/' ? '/app' : '/'

export default function App() {
  const [runtimeMode] = useState(() =>
    resolveRuntimeMode(typeof window === 'undefined' ? '' : window.location.search, {
      surface: resolveRuntimeSurface(import.meta.env.MODE),
    }),
  )

  return (
    <RuntimeModeProvider mode={runtimeMode}>
      <BrowserRouter basename={routerBasename}>
        <UIProvider>
          <MockDataProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<TodayPage />} />
                <Route path="fitness" element={deferred(<FitnessPage />)} />
                <Route path="diet" element={deferred(<DietPage />)} />
                <Route path="study" element={deferred(<StudyPage />)} />
                <Route path="plans" element={deferred(<PlansPage />)} />
                <Route path="profile" element={deferred(<ProfilePage />)} />
                <Route path="reports" element={deferred(<ReportsPage />)} />
                <Route path="settings" element={deferred(<SettingsPage />)} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </MockDataProvider>
        </UIProvider>
      </BrowserRouter>
    </RuntimeModeProvider>
  )
}
