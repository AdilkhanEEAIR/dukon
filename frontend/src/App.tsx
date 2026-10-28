// Корень приложения: провайдеры, маршруты, оболочка с навигацией и офлайн-баннером.
// Экспортируем AppRoutes/Providers отдельно, чтобы тесты рендерили их с MemoryRouter.

import { WifiOff } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion, useIsPresent, type Transition } from 'motion/react'
import { Component, useCallback, useState, type ErrorInfo, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useOutlet } from 'react-router-dom'
import { DataProvider } from './app/data'
import { ModeProvider } from './app/mode'
import { NotificationsProvider } from './app/notifications'
import { SettingsProvider, useSettings } from './app/settings'
import { ShopsProvider, useShops } from './app/shops'
import { Rail, TabBar } from './components/Nav'
import { Skeleton, ErrorState } from './components/States'
import { ToastProvider } from './components/Toast'
import { useOnline } from './hooks/useOnline'
import { useRipple } from './hooks/useRipple'
import { TopLoader } from './components/TopLoader'
import { useScrollReveal } from './hooks/useScrollReveal'
import { useSpotlight } from './hooks/useSpotlight'
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

/** Движение на всё приложение: motion слушается нашей настройки (а не только системы),
 *  появление при прокрутке и «прожектор» под курсором подключаются один раз. */
function MotionLayer({ children }: { children: ReactNode }) {
  const { resolvedMotion } = useSettings()
  useScrollReveal()
  useSpotlight()
  useRipple()
  return <MotionConfig reducedMotion={resolvedMotion === 'calm' ? 'always' : 'never'}>{children}</MotionConfig>
}

export function Providers({ children, poll = true }: { children: ReactNode; poll?: boolean }) {
  return (
    <SettingsProvider>
      <MotionLayer>
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
      </MotionLayer>
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
            <AnimatedOutlet />
          </ErrorBoundary>
        </main>
      </div>
      <TabBar />
    </div>
  )
}

// ---- переходы между страницами
// Старая страница коротко растворяется вверх, новая выплывает снизу из лёгкого размытия;
// её блоки затем идут каскадом (.stagger). В спокойном режиме — только прозрачность.
// Медленно и мягко: по просьбе — примерно вдвое дольше прежнего, уход короче прихода, чтобы клик не «вяз».
const PAGE_IN: Transition = { duration: 1.3, ease: [0.16, 1, 0.3, 1] }
const PAGE_OUT: Transition = { duration: 0.34, ease: [0.45, 0, 0.55, 1] }

function scrollTop() {
  // instant: плавная прокрутка вверх во время смены страницы выглядит как рывок.
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
}

/** Ключ перехода. Обходы одного отчёта (/app/shelves/:id) — одна страница: при выборе дня
 *  в календаре меняется только содержимое (с полосой загрузки и скелетом), а не вся страница. */
export function transitionKey(pathname: string): string {
  return pathname.startsWith('/app/shelves') ? '/app/shelves' : pathname
}

/** Страница внутри оболочки. Ключ — путь: другая страница = выход старой и вход новой. */
function AnimatedOutlet() {
  const { pathname } = useLocation()
  return (
    <AnimatePresence mode="wait" initial={false} onExitComplete={scrollTop}>
      <PageMotion key={transitionKey(pathname)}>
        <FrozenOutlet />
      </PageMotion>
    </AnimatePresence>
  )
}

/** Пока страница на экране — живой outlet (меняются параметры адреса). Когда уходит — показывает
 *  себя такой, какой была при последнем адресе, а не новую страницу. */
function FrozenOutlet() {
  const outlet = useOutlet()
  const { pathname } = useLocation()
  const present = useIsPresent()
  const [snap, setSnap] = useState({ pathname, outlet })
  if (present && snap.pathname !== pathname) setSnap({ pathname, outlet })
  return present ? outlet : snap.outlet
}

function PageMotion({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="route"
      initial={{ opacity: 0, y: 14, filter: 'blur(10px)' }}
      // transitionEnd: после въезда снимаем filter совсем — иначе он ломает position: fixed у потомков.
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: PAGE_IN, transitionEnd: { filter: 'none' } }}
      exit={{ opacity: 0, y: -6, filter: 'blur(6px)', transition: PAGE_OUT }}
    >
      {children}
    </motion.div>
  )
}

/** Смена «зоны» (лендинг ↔ онбординг ↔ приложение) — только растворением: внутри зоны есть фиксированные панели. */
function AreaMotion({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 1, ease: [0.16, 1, 0.3, 1] } }} exit={{ opacity: 0, transition: { duration: 0.36 } }}>
      {children}
    </motion.div>
  )
}

function areaOf(pathname: string): string {
  if (pathname.startsWith('/app/onboarding')) return 'onboarding'
  if (pathname.startsWith('/app')) return 'app'
  return 'landing'
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
  const location = useLocation()
  return (
    <>
    <TopLoader />
    <AnimatePresence mode="wait" initial={false} onExitComplete={scrollTop}>
      <AreaMotion key={areaOf(location.pathname)}>
        <AreaRoutes />
      </AreaMotion>
    </AnimatePresence>
    </>
  )
}

/** Маршруты с замороженным location: уходящая зона дорисовывает свою страницу, а не новую. */
function AreaRoutes() {
  const current = useLocation()
  const [area] = useState(() => areaOf(current.pathname))
  const [kept, setKept] = useState(current)
  const inArea = areaOf(current.pathname) === area
  // Пока зона своя — помним последний адрес; когда зона уходит, дорисовываем его, а не новый.
  if (inArea && kept !== current) setKept(current)
  return (
    <Routes location={inArea ? current : kept}>
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
