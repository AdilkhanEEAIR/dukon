// Настройки устройства: язык, валюта, тема, анимации, источник данных, код доступа и код устройства. Хранятся в localStorage,
// потому что аккаунтов нет — владелец магазина открыл ссылку и работает. Магазины живут на сервере
// и привязаны к коду устройства.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_LOCALE, isLocale, type Locale } from '../i18n'
import { DEFAULT_CURRENCY, isCurrency, type Currency } from '../lib/currency'

export type Theme = 'light' | 'dark'
/** auto — как просит система (Windows «Эффекты анимации», iOS «Уменьшение движения»), full — всё, calm — только проявления. */
export type MotionPref = 'auto' | 'full' | 'calm'
export type Motion = 'full' | 'calm'
/** Какие данные показывать. auto — свои, пока у сервера есть кредиты на модели, иначе демо;
 *  live — всегда свои (смотреть их можно и без кредитов, на паузе только новые обходы); demo — всегда демо-сеть. */
export type DataMode = 'auto' | 'live' | 'demo'
export { CURRENCIES, type Currency } from '../lib/currency'

export interface Settings {
  locale: Locale
  currency: Currency
  theme: Theme
  motion: MotionPref
  dataMode: DataMode
  demoKey: string
}

const KEY = 'dukon.settings'
const DEVICE_KEY = 'dukon.device'
export const DEVICE_CODE = /^[A-Za-z0-9_-]{8,64}$/

function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

export function systemReducesMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(REDUCE_QUERY).matches
}

function defaults(): Settings {
  // Первый запуск: английский (его читают судьи и гости), доллар, тема и анимации — как в системе.
  return { locale: DEFAULT_LOCALE, currency: DEFAULT_CURRENCY, theme: systemTheme(), motion: 'auto', dataMode: 'auto', demoKey: '' }
}

const isMotionPref = (v: unknown): v is MotionPref => v === 'auto' || v === 'full' || v === 'calm'
const isDataMode = (v: unknown): v is DataMode => v === 'auto' || v === 'live' || v === 'demo'

function load(): Settings {
  const base = defaults()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const p = JSON.parse(raw) as Record<string, unknown>
    // Старые версии хранили theme: 'system' и могли хранить неизвестный язык — чиним на лету.
    return {
      locale: isLocale(p.locale) ? p.locale : base.locale,
      currency: isCurrency(p.currency) ? p.currency : base.currency,
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : base.theme,
      motion: isMotionPref(p.motion) ? p.motion : base.motion,
      dataMode: isDataMode(p.dataMode) ? p.dataMode : base.dataMode,
      demoKey: typeof p.demoKey === 'string' ? p.demoKey : '',
    }
  } catch {
    return base
  }
}

function persist(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* приватный режим: работаем без памяти между сессиями */
  }
}

function newDeviceId(): string {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c) return c.randomUUID()
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Код устройства создаётся один раз и переживает перезагрузки: по нему сервер отдаёт «мои» магазины. */
export function loadDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing && DEVICE_CODE.test(existing)) return existing
    const id = newDeviceId()
    localStorage.setItem(DEVICE_KEY, id)
    return id
  } catch {
    return newDeviceId()
  }
}

interface SettingsValue {
  settings: Settings
  update: (patch: Partial<Settings>) => void
  reset: () => void
  resolvedTheme: Theme
  /** Что реально показываем: настройка «как в системе» уже развёрнута в full или calm. */
  resolvedMotion: Motion
  systemCalm: boolean
  deviceId: string
  setDeviceId: (id: string) => void
}

const Ctx = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)
  const [deviceId, setDeviceIdState] = useState<string>(loadDeviceId)
  const [systemCalm, setSystemCalm] = useState<boolean>(systemReducesMotion)

  // Пользователь может переключить системную настройку, не закрывая вкладку.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(REDUCE_QUERY)
    const on = () => setSystemCalm(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])

  const resolvedMotion: Motion = settings.motion === 'auto' ? (systemCalm ? 'calm' : 'full') : settings.motion

  // Атрибут на <html>: CSS и наблюдатель прокрутки читают его, не дёргая React.
  useEffect(() => {
    document.documentElement.dataset.motion = resolvedMotion
  }, [resolvedMotion])

  // Тема живёт на <html>: CSS-переменные переключаются одним атрибутом, без перерисовки React.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.lang = settings.locale
    document.documentElement.style.colorScheme = settings.theme
  }, [settings.theme, settings.locale])

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      persist(next)
      return next
    })
  }, [])

  const setDeviceId = useCallback((id: string) => {
    try {
      localStorage.setItem(DEVICE_KEY, id)
    } catch {
      /* ничего */
    }
    setDeviceIdState(id)
  }, [])

  const reset = useCallback(() => {
    try {
      for (const k of [KEY, DEVICE_KEY, 'dukon.readNotifications', 'dukon.currentShop']) localStorage.removeItem(k)
    } catch {
      /* ничего */
    }
    setSettings(defaults())
    setDeviceIdState(loadDeviceId())
  }, [])

  const value = useMemo(
    () => ({ settings, update, reset, resolvedTheme: settings.theme, resolvedMotion, systemCalm, deviceId, setDeviceId }),
    [settings, update, reset, resolvedMotion, systemCalm, deviceId, setDeviceId],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSettings вне SettingsProvider')
  return ctx
}
