import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { calculateProfileCompleteness } from '../data/profile'
import { useMockData } from '../context/mock-data-context'
import { useUI } from '../context/ui-context'
import { BrandMark } from './BrandMark'
import { Icon, IconSprite, type IconName } from './Icon'
import { QuickRecordSheet } from './QuickRecordSheet'
import { cn } from '../lib/cn'

const NAV_ITEMS: Array<{ to: string; label: string; icon: IconName; title: string }> = [
  { to: '/', label: '今日', icon: 'today', title: '今日' },
  { to: '/fitness', label: '健身', icon: 'fitness', title: '健身' },
  { to: '/diet', label: '饮食', icon: 'food', title: '饮食' },
  { to: '/study', label: '学习', icon: 'study', title: '学习' },
  { to: '/reports', label: 'AI 报告', icon: 'spark', title: 'AI 报告' },
]

const EXTRA_TITLES: Record<string, string> = {
  '/profile': '个人档案',
  '/plans': '长期计划',
  '/reports': 'AI 报告',
  '/settings': '设置',
}

export function AppShell() {
  const location = useLocation()
  const { openQuickRecord, toast } = useUI()
  const { profile, aiConsent } = useMockData()
  const completeness = calculateProfileCompleteness({ ...profile, aiConsent })

  useEffect(() => {
    const current = NAV_ITEMS.find((item) => item.to === location.pathname)?.title
    document.title = `${current ?? EXTRA_TITLES[location.pathname] ?? 'Persist'} · Persist`
  }, [location.pathname])

  return (
    <div className="shell">
      <IconSprite />

      <aside className="sidebar" aria-label="主导航">
        <Link className="brand" to="/">
          <BrandMark />
          <span className="brand-copy">
            <strong>Persist</strong>
            <span>长期主义记录</span>
          </span>
        </Link>

        <nav className="side-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              className={({ isActive }) => cn('nav', isActive && 'active')}
              end={item.to === '/'}
              key={item.to}
              to={item.to}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="side-space" />
        <div className="privacy">
          <Icon name="lock" className="icon-sm" />
          <span>本地优先。你的记录和档案只属于你。</span>
        </div>
        <div className="profile">
          <Link className="avatar" to="/profile" aria-label="打开个人档案">
            我
          </Link>
          <div className="profile-copy">
            <strong>个人档案</strong>
            <span>资料完整度 {completeness}%</span>
          </div>
          <Link className="icon-btn" to="/settings" aria-label="打开设置">
            <Icon name="settings" className="icon-sm" />
          </Link>
        </div>
      </aside>

      <div className="mobile-bar">
        <Link className="mobile-brand" to="/">
          <BrandMark />
          <strong>Persist</strong>
        </Link>
        <div className="mobile-bar-actions">
          <Link className="icon-btn" to="/settings" aria-label="打开设置">
            <Icon name="settings" className="icon-sm" />
          </Link>
          <Link className="icon-btn" to="/profile" aria-label="打开个人档案">
            <span className="avatar">我</span>
          </Link>
        </div>
      </div>

      <main className="main">
        <div className="page">
          <Outlet />
        </div>
      </main>

      <nav className="bottom-nav" aria-label="移动端主导航">
        {NAV_ITEMS.map((item) => (
          <NavLink
            className={({ isActive }) => cn('bottom-link', isActive && 'active')}
            end={item.to === '/'}
            key={item.to}
            to={item.to}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <button className="fab" type="button" aria-label="快速记录" onClick={openQuickRecord}>
        <Icon name="plus" />
      </button>

      <QuickRecordSheet />
      <div className={cn('toast', toast && 'show')} role="status" aria-live="polite">
        {toast?.message ?? ''}
      </div>
    </div>
  )
}
