// Корень приложения: провайдеры, маршруты, оболочка с навигацией и офлайн-баннером.
// Экспортируем AppRoutes/Providers отдельно, чтобы тесты рендерили их с MemoryRouter.

import { WifiOff } from 'lucide-react'
import { AnimatePresence, MotionConfig, motion, useIsPresent, type Transition } from 'motion/react'
import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { DataProvider, useLatest } from './app/data'
import { ModeProvider, useMode } from './app/mode'
import { NotificationsProvider } from './app/notifications'
import { SettingsProvider, useSettings } from './app/settings'
import { ShopsProvider, useShops } from './app/shops'
import { DataModeSwitch } from './components/DataModeSwitch'
import { Rail, TabBar } from './components/Nav'
import { Skeleton, ErrorState } from './components/States'
import { ToastProvider, useToast } from './components/Toast'
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
import { SeenPage } from './pages/Seen'
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

/** Ссылка вида /app/shelves?demo=1 (из README, с лендинга) включает демо-данные и убирает параметр из адреса.
 *  Явный выбор «демо» запоминаем, только если иначе были бы живые данные: без кредитов демо и так включено,
 *  а запомненный выбор держал бы демо и после того, как кредиты появятся. */
function useDemoLink() {
  const { search, pathname } = useLocation()
  const navigate = useNavigate()
  const { mode, status, setView } = useMode()
  const wantDemo = new URLSearchParams(search).get('demo') === '1'
  useEffect(() => {
    if (!wantDemo || status === 'loading') return
    if (mode === 'live') setView('demo')
    navigate(pathname, { replace: true })
  }, [wantDemo, status, mode, setView, navigate, pathname])
  return wantDemo
}

/** Ссылка-пропуск для судей: /app?judge=КОД сохраняет код доступа в настройки и убирает его из адреса.
 *  Судье не нужно ничего вводить — он нажал ссылку из описания проекта и сразу работает вживую. */
function useJudgeLink() {
  const { search, pathname } = useLocation()
  const navigate = useNavigate()
  const { update } = useSettings()
  const toast = useToast()
  const t = useT()
  const judge = new URLSearchParams(search).get('judge')
  // Один код — одно уведомление: эффект может сработать дважды (строгий режим, смена оболочки).
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (!judge || applied.current === judge) return
    applied.current = judge
    update({ demoKey: judge })
    toast('success', t('judge.enabled'), t('judge.enabledBody'))
    const rest = new URLSearchParams(search)
    rest.delete('judge')
    const tail = rest.toString()
    navigate(pathname + (tail ? `?${tail}` : ''), { replace: true })
  }, [judge, update, toast, t, navigate, pathname, search])
}

/** Оболочка приложения: рейл на ПК, таббар на телефоне, кнопка «живые ↔ демо» в углу.
 *  Живой режим без магазина — в онбординг. В демо магазин не нужен: показываем демо-сеть,
 *  в том числе когда сервер лежит — вместо страницы ошибки. */
export function AppShell() {
  const { status, shops, error, reload } = useShops()
  const { mode, status: modeStatus } = useMode()
  const { latest } = useLatest()
  const wantDemo = useDemoLink()
  useJudgeLink()
  const live = mode === 'live' && !wantDemo
  // Своих обходов ещё нет — кнопки «Новый обход» мягко пульсируют, приглашая начать.
  const invite = live && latest.status === 'success' && latest.data === null

  if (modeStatus === 'loading' || (live && status === 'loading' && !shops.length)) return <ShellSplash />
  if (live && status === 'error' && !shops.length) {
    return (
      <div className="app__main" style={{ maxWidth: 560, paddingTop: 64 }}>
        <ErrorState error={error} onRetry={() => void reload()} />
      </div>
    )
  }
  if (live && status === 'ready' && !shops.length) return <Navigate to="/app/onboarding" replace />

  return (
    <div className="app" data-view={mode} data-invite={invite || undefined}>
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
      <DataModeSwitch />
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
  // «Что я увидел» — отдельная страница: переход отчёт ↔ фото должен быть виден.
  if (pathname.endsWith('/seen')) return pathname
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
        <Route path="shelves/:id/seen" element={<SeenPage />} />
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
