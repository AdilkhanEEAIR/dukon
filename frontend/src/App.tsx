// Корень приложения: провайдеры, маршруты, оболочка с навигацией и офлайн-баннером.
// Экспортируем AppRoutes/Providers отдельно, чтобы тесты рендерили их с MemoryRouter.

import { WifiOff } from 'lucide-react'
import { Component, useCallback, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { DataProvider } from './app/data'
import { ModeProvider } from './app/mode'
import { NotificationsProvider } from './app/notifications'
import { SettingsProvider, useSettings } from './app/settings'
import { ShopsProvider, useShops } from './app/shops'
import { Rail, TabBar } from './components/Nav'
import { Skeleton, ErrorState } from './components/States'
import { ToastProvider } from './components/Toast'
import { useOnline } from './hooks/useOnline'
import { I18nProvider, useT, type Locale } from './i18n'
import { AgentPage } from './pages/Agent'
import { BranchesPage } from './pages/Branches'
import { HomePage } from './pages/Home'
import { ItemPage } from './pages/Item'
import { LandingPage } from './pages/Landing'
import { NotFoundPage } from './pages/NotFound'
import { NotificationsPage } from './pages/Notifications'
import { OnboardingPage } from './pages/Onboarding'
import { OrdersPage } from './pages/Orders'
import { ScanPage } from './pages/Scan'
import { SettingsPage } from './pages/Settings'
import { ShelvesPage } from './pages/Shelves'
import { SystemPage } from './pages/System'

function LocaleBridge({ children }: { children: ReactNode }) {
  const { settings, update } = useSettings()
  const setLocale = useCallback((l: Locale) => update({ locale: l }), [update])
  return (
    <I18nProvider locale={settings.locale} setLocale={setLocale}>
      {children}
    </I18nProvider>
  )
}

export function Providers({ children, poll = true }: { children: ReactNode; poll?: boolean }) {
  return (
    <SettingsProvider>
      <LocaleBridge>
        <ToastProvider>
          <ModeProvider poll={poll}>
            <ShopsProvider>
              <DataProvider>
                <NotificationsProvider>{children}</NotificationsProvider>
              </DataProvider>
            </ShopsProvider>
          </ModeProvider>
        </ToastProvider>
      </LocaleBridge>
    </SettingsProvider>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="state" role="alert">
          <h2 className="h3">Something broke on this screen</h2>
          <p className="state__text mono">{this.state.error.message}</p>
          <button type="button" className="btn btn--secondary" onClick={() => this.setState({ error: null })}>
            <span className="btn__content">Reload view</span>
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function OfflineBanner() {
  const online = useOnline()
  const t = useT()
  if (online) return null
  return (
    <div className="offline" role="status" data-testid="offline-banner">
      <WifiOff size={16} />
      {t('common.offline')}
    </div>
  )
}

/** Оболочка приложения: рейл на ПК, таббар на телефоне. Без магазина — в онбординг,
 *  кроме демо-просмотра (?demo=1): судья смотрит продукт без регистрации. */
export function AppShell() {
  const { status, shops, error, reload } = useShops()
  const { search } = useLocation()
  const demoView = new URLSearchParams(search).get('demo') === '1'

  if (status === 'loading' && !shops.length) return <ShellSplash />
  if (status === 'error' && !shops.length && !demoView) {
    return (
      <div className="app__main" style={{ maxWidth: 560, paddingTop: 64 }}>
        <ErrorState error={error} onRetry={() => void reload()} />
      </div>
    )
  }
  if (status === 'ready' && !shops.length && !demoView) return <Navigate to="/app/onboarding" replace />

  return (
    <div className="app">
      <Rail />
      <div className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <OfflineBanner />
        <main className="app__main">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <TabBar />
    </div>
  )
}

function ShellSplash() {
  return (
    <div className="app__main stack" style={{ maxWidth: 720, paddingTop: 48, gap: 16 }} data-testid="shell-splash" aria-busy="true">
      <Skeleton h={18} w={160} />
      <Skeleton h={40} w={260} />
      <Skeleton h={180} r={18} />
      <Skeleton h={120} r={18} />
    </div>
  )
}

function OnboardingGate() {
  const { status, shops } = useShops()
  if (status === 'loading' && !shops.length) return <ShellSplash />
  if (shops.length) return <Navigate to="/app" replace />
  return <OnboardingPage />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app/onboarding" element={<OnboardingGate />} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="shelves" element={<ShelvesPage />} />
        <Route path="shelves/:id" element={<ShelvesPage />} />
        <Route path="item/:sku" element={<ItemPage />} />
        <Route path="scan" element={<ScanPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="agent" element={<AgentPage />} />
        <Route path="branches" element={<BranchesPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Providers>
        <AppRoutes />
      </Providers>
    </BrowserRouter>
  )
}
