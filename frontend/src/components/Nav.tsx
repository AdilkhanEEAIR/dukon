// Навигация: таббар снизу (телефон, планшет) и рейл слева (ПК), переключатель магазина,
// пилюля режима, тема (светлая/тёмная) с круговым раскрытием и выбор языка.

import { Activity, Bell, Bot, Building2, FlaskConical, House, Info, Languages, MapPin, Moon, Package, PackageSearch, Plus, Radio, ScanLine, Settings, Store, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useMode } from '../app/mode'
import { useNotifications } from '../app/notifications'
import { useSettings } from '../app/settings'
import { useShops } from '../app/shops'
import { DICTS, LOCALES, useI18n, useT, type Locale } from '../i18n'
import { IconButton } from './Button'
import { Dropdown } from './Dropdown'
import { Pill } from './Pill'

export const REPO_URL = 'https://github.com/AdilkhanEEAIR/dukon'

export function ModePill({ compact }: { compact?: boolean }) {
  const t = useT()
  const { mode, reason, budget, status } = useMode()
  if (status === 'loading') return <Pill>…</Pill>
  if (mode === 'live') {
    return (
      <Pill tone="accent" icon={<Radio size={13} />}>
        {t('mode.live')}
        {!compact && budget ? <span className="c-3"> · {t('mode.liveHint', { n: budget.calls_left })}</span> : null}
      </Pill>
    )
  }
  return (
    <Pill tone="low" icon={<FlaskConical size={13} />}>
      {t('mode.demo')}
      {!compact && reason ? <span style={{ fontWeight: 500 }}> · {t(`mode.reasons.${reason}`)}</span> : null}
    </Pill>
  )
}

/** Светлая ↔ тёмная. Круговое раскрытие из кнопки через View Transitions; без поддержки — просто меняется. */
export function ThemeToggle({ outline }: { outline?: boolean }) {
  const t = useT()
  const { update, resolvedTheme } = useSettings()
  const next = resolvedTheme === 'dark' ? 'light' : 'dark'
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
    if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update({ theme: next })
      return
    }
    const x = e.clientX || window.innerWidth / 2
    const y = e.clientY || window.innerHeight / 2
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const transition = doc.startViewTransition(() => flushSync(() => update({ theme: next })))
    void transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 450, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
  }
  return (
    <IconButton label={t('theme.toggle')} outline={outline} className="theme-btn" data-theme={resolvedTheme} data-testid="theme-toggle" onClick={onClick}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={resolvedTheme}
          className="theme-btn__icon"
          initial={{ rotate: -90, scale: 0.6, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0.6, opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
        >
          {resolvedTheme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
        </motion.span>
      </AnimatePresence>
    </IconButton>
  )
}

export function LangSwitch({ compact, block, align }: { compact?: boolean; block?: boolean; align?: 'start' | 'end' }) {
  const { locale, setLocale } = useI18n()
  const t = useT()
  return (
    <Dropdown<Locale>
      label={t('settings.language')}
      value={locale}
      onChange={setLocale}
      compact={compact}
      block={block}
      align={align}
      icon={<Languages size={16} className="c-3" />}
      testId="lang-switch"
      options={LOCALES.map((l) => ({ value: l, label: DICTS[l].locale.name, short: l.toUpperCase() }))}
    />
  )
}

/** Переключатель магазина: все филиалы владельца + «Добавить филиал». */
export function ShopSwitcher({ variant = 'rail' }: { variant?: 'rail' | 'title' }) {
  const t = useT()
  const navigate = useNavigate()
  const { shops, current, select } = useShops()
  if (!current) return null
  return (
    <Dropdown<string>
      label={t('shops.switchLabel')}
      value={current.id}
      onChange={select}
      block={variant === 'rail'}
      testId={`shop-switcher-${variant}`}
      renderTrigger={() =>
        variant === 'rail' ? (
          <span className="shop-trigger">
            <span className="logo">
              <Store size={18} />
            </span>
            <span className="stack" style={{ gap: 0, minWidth: 0, textAlign: 'left' }}>
              <span className="h3 truncate">{current.name}</span>
              <span className="small truncate">{current.address || t('common.appName')}</span>
            </span>
          </span>
        ) : (
          <span className="h1 truncate shop-title">{current.name}</span>
        )
      }
      options={shops.map((s) => ({ value: s.id, label: s.name, hint: s.address || t('shops.noAddress'), icon: <MapPin size={15} /> }))}
      footer={(close) => (
        <>
          <button
            type="button"
            className="dd__action"
            onClick={() => {
              close()
              navigate('/app/branches')
            }}
          >
            <Building2 size={15} />
            {t('branches.subtitle')}
          </button>
          <button
            type="button"
            className="dd__action"
            onClick={() => {
              close()
              navigate('/app/settings#shops')
            }}
          >
            <Plus size={15} />
            {t('shops.add')}
          </button>
        </>
      )}
    />
  )
}

// На телефоне пять мест: агент важнее филиалов — до филиалов можно дойти из переключателя магазина.
const TABS = [
  { to: '/app', key: 'home', icon: House, end: true },
  { to: '/app/shelves', key: 'shelves', icon: PackageSearch },
  { to: '/app/scan', key: 'scan', icon: ScanLine },
  { to: '/app/orders', key: 'orders', icon: Package },
  { to: '/app/agent', key: 'agent', icon: Bot },
] as const

export function TabBar() {
  const t = useT()
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => {
        const Icon = tab.icon
        if (tab.key === 'scan') {
          return (
            <NavLink key={tab.key} to={tab.to} className="tab tab--scan" aria-label={t('nav.scan')}>
              <span className="tab__bump">
                <Icon size={24} />
              </span>
            </NavLink>
          )
        }
        return (
          <NavLink key={tab.key} to={tab.to} end={'end' in tab && tab.end} className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="tab-indicator" className="tab__indicator" transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }} />}
                <Icon size={22} />
                <span>{t(`nav.${tab.key}`)}</span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}

const RAIL = [
  { to: '/app', key: 'home', icon: House, end: true },
  { to: '/app/shelves', key: 'shelves', icon: PackageSearch },
  { to: '/app/orders', key: 'orders', icon: Package },
  { to: '/app/branches', key: 'branches', icon: Building2 },
  { to: '/app/agent', key: 'agent', icon: Bot },
  { to: '/app/notifications', key: 'notifications', icon: Bell },
  { to: '/app/system', key: 'system', icon: Activity },
  { to: '/app/settings', key: 'settings', icon: Settings },
] as const

export function Rail() {
  const t = useT()
  const { unread } = useNotifications()
  return (
    <aside className="rail">
      <div className="rail__brand">
        <ShopSwitcher variant="rail" />
      </div>
      <nav className="rail__nav" aria-label="Main">
        {RAIL.map((item) => {
          const Icon = item.icon
          return (
            <NavLink key={item.key} to={item.to} end={'end' in item && item.end} className={({ isActive }) => `rail-link${isActive ? ' is-active' : ''}`}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="rail-indicator" className="rail-link__bg" transition={{ type: 'spring', duration: 0.35, bounce: 0.12 }} />}
                  <Icon size={18} className="rail-link__icon" />
                  <span className="rail-link__text">{t(`nav.${item.key}`)}</span>
                  {item.key === 'notifications' && unread > 0 ? (
                    <span className="rail-link__badge">
                      <Pill tone="out">{unread}</Pill>
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>
      <div className="rail__foot">
        <RailMode />
        <div className="row row--between">
          <LangSwitch compact />
          <ThemeToggle outline />
        </div>
        <NavLink to="/app/scan" className="btn btn--primary btn--block">
          <span className="btn__content">
            <ScanLine size={18} />
            {t('nav.scan')}
          </span>
        </NavLink>
        <AuthorLine />
      </div>
    </aside>
  )
}

function RailMode() {
  const t = useT()
  const { mode, reason, budget, status } = useMode()
  return (
    <div className="rail__mode">
      <div>
        <ModePill compact />
      </div>
      {status !== 'loading' && <span className="small">{mode === 'live' ? t('mode.liveHint', { n: budget?.calls_left ?? 0 }) : reason ? t(`mode.reasons.${reason}`) : ''}</span>}
    </div>
  )
}

/** Подпись автора: в рейле, в настройках и на лендинге. Ссылка — на открытый репозиторий проекта. */
export function AuthorLine({ withAbout = true }: { withAbout?: boolean }) {
  const t = useT()
  return (
    <div className="author" data-testid="author">
      <a href={REPO_URL} target="_blank" rel="noreferrer" className="author__name">
        {t('common.madeBy')}
      </a>
      {withAbout && (
        <Link to="/" className="author__link">
          <Info size={13} />
          {t('common.about')}
        </Link>
      )}
    </div>
  )
}

/** Шапка страницы на телефоне: тема, колокольчик с бейджем, настройки. На ПК всё это в рейле. */
export function PageActions() {
  const t = useT()
  const { unread } = useNotifications()
  const { pathname } = useLocation()
  return (
    <div className="page-head__actions hide-desktop">
      <ThemeToggle outline />
      {pathname !== '/app/notifications' && (
        <IconButton label={t('nav.notifications')} outline badge={unread} to="/app/notifications">
          <Bell size={18} />
        </IconButton>
      )}
      {pathname !== '/app/settings' && (
        <IconButton label={t('nav.settings')} outline to="/app/settings">
          <Settings size={18} />
        </IconButton>
      )}
    </div>
  )
}
