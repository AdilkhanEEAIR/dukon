// Форматирование под язык и валюту пользователя. Все суммы приходят в сомах — пересчёт здесь,
// в одном месте, чтобы ни один экран не показал «$749» вместо «$8.57».

import type { Locale } from '../i18n'
import { decimalsFor, fromKgs, type Currency } from './currency'

const SOM: Record<Locale, string> = { en: 'som', ru: 'сом', ky: 'сом', es: 'som', de: 'Som', fr: 'som' }
const SYMBOL: Record<Exclude<Currency, 'KGS'>, string> = { USD: '$', EUR: '€', KZT: '₸', RUB: '₽' }

/** Intl понимает не все наши языки одинаково (ky в старых браузерах) — откатываемся на ru для чисел. */
function numberLocale(locale: Locale): string {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length ? locale : 'ru'
  } catch {
    return 'en'
  }
}

export function formatNumber(value: number, locale: Locale, maxFraction = 1, minFraction = 0): string {
  return new Intl.NumberFormat(numberLocale(locale), { minimumFractionDigits: minFraction, maximumFractionDigits: maxFraction }).format(value)
}

/** Сумма в сомах → строка в выбранной валюте. */
export function formatMoney(valueKgs: number, locale: Locale, currency: Currency, opts: { decimals?: number } = {}): string {
  const value = fromKgs(valueKgs, currency)
  const decimals = opts.decimals ?? decimalsFor(value, currency)
  const n = formatNumber(value, locale, decimals, decimals)
  if (currency === 'KGS') return `${n} ${SOM[locale]}`
  const symbol = SYMBOL[currency]
  return locale === 'en' ? `${symbol}${n}` : `${n} ${symbol}`
}

/** Та же сумма в сомах — подпись «по ценникам», когда выбрана другая валюта. */
export function formatSom(valueKgs: number, locale: Locale): string {
  return formatMoney(valueKgs, locale, 'KGS', { decimals: 0 })
}

export function formatPrice(valueKgs: number | null | undefined, locale: Locale, currency: Currency): string {
  if (valueKgs === null || valueKgs === undefined) return '—'
  return formatMoney(valueKgs, locale, currency, currency === 'KGS' && !Number.isInteger(valueKgs) ? { decimals: 2 } : {})
}

function dateLocale(locale: Locale): string {
  return numberLocale(locale)
}

export function formatDate(d: Date | string, locale: Locale): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(dateLocale(locale), { weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

export function formatShortDate(d: Date | string, locale: Locale): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(dateLocale(locale), { day: 'numeric', month: 'short' }).format(date)
}

export function formatTime(d: Date | string, locale: Locale): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(dateLocale(locale), { hour: '2-digit', minute: '2-digit' }).format(date)
}

/** Часы между обходами в человеческом виде; переводы берутся из словаря через колбэк. */
export function formatHours(hours: number, t: (key: 'common.hours' | 'common.days' | 'common.lessThanHour', p?: { n: number }) => string): string {
  if (hours < 1) return t('common.lessThanHour')
  if (hours < 48) return t('common.hours', { n: Math.round(hours) })
  const days = hours / 24
  return t('common.days', { n: Number.isInteger(days) ? days : Number(days.toFixed(1)) })
}

/** «Через сколько закончится» — из дней в часы или дни, для подписей прогноза. */
export function formatDays(days: number, t: (key: 'common.hours' | 'common.days' | 'common.lessThanHour', p?: { n: number }) => string): string {
  return formatHours(days * 24, t)
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
