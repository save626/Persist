import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { MockDataProvider } from './context/MockDataProvider'
import { RuntimeModeProvider } from './context/RuntimeModeProvider'
import { UIProvider } from './context/UIProvider'
import { resolveRuntimeMode, resolveRuntimeSurface } from './lib/runtime-mode'
import { DietPage } from './pages/DietPage'
import { FitnessPage } from './pages/FitnessPage'
import { PlansPage } from './pages/PlansPage'
import { ProfilePage } from './pages/ProfilePage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { StudyPage } from './pages/StudyPage'
import { TodayPage } from './pages/TodayPage'

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
                <Route path="fitness" element={<FitnessPage />} />
                <Route path="diet" element={<DietPage />} />
                <Route path="study" element={<StudyPage />} />
                <Route path="plans" element={<PlansPage />} />
                <Route path="profile" element={<ProfilePage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </MockDataProvider>
        </UIProvider>
      </BrowserRouter>
    </RuntimeModeProvider>
  )
}
