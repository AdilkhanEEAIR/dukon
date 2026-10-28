// Своя лёгкая локализация: типизированные ключи по эталонному словарю, плюрализация через Intl.
// Библиотека тут не нужна — пять словарей и один хук; зато ошибку в ключе ловит TypeScript.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { de } from './de'
import { en, type Dict, type Plural } from './en'
import { es } from './es'
import { fr } from './fr'
import { ky } from './ky'
import { ru } from './ru'

export type Locale = 'en' | 'ru' | 'ky' | 'es' | 'de' | 'fr'
// Порядок важен: так языки стоят в выпадающем списке. Английский первый — его видят судьи и гости.
export const LOCALES: Locale[] = ['en', 'ru', 'ky', 'es', 'de', 'fr']
export const DEFAULT_LOCALE: Locale = 'en'
export const DICTS: Record<Locale, Dict> = { en, ru, ky, es, de, fr }

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as string[]).includes(value)
}

// Путь к строковому листу словаря: 'home.lossTitle', 'errors.network.title' …
type Leaf = string | Plural | readonly unknown[]
type PathsOf<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : T[K] extends object ? PathsOf<T[K], `${P}${K}.`> : never
}[keyof T & string]
export type TKey = PathsOf<Dict>

type Params = Record<string, string | number>

function lookup(dict: Dict, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), dict)
}

function fill(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`))
}

export function translate(locale: Locale, key: TKey, params?: Params): string {
  const value = lookup(DICTS[locale], key) ?? lookup(en, key)
  if (typeof value === 'string') return fill(value, params)
  if (value && typeof value === 'object' && 'other' in (value as Plural)) {
    const n = Number(params?.n ?? 0)
    const plural = value as Plural
    // Дробные («2,5 дня») в русском идут с формой few; Intl для них отдаёт other.
    const form = (!Number.isInteger(n) && plural.few ? 'few' : new Intl.PluralRules(locale).select(n)) as keyof Plural
    const shown = Number.isInteger(n) ? n : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n)
    return fill(plural[form] ?? plural.other, { ...params, n: shown })
  }
  return key
}

/** Массивы (шаги лендинга, правила агента) — отдельным доступом, чтобы t() оставался строковым. */
export function translateList<T>(locale: Locale, key: TKey): T[] {
  const value = lookup(DICTS[locale], key) ?? lookup(en, key)
  return Array.isArray(value) ? (value as T[]) : []
}

interface I18nValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: TKey, params?: Params) => string
  list: <T>(key: TKey) => T[]
}

const I18nCtx = createContext<I18nValue | null>(null)

export function I18nProvider({ locale, setLocale, children }: { locale: Locale; setLocale: (l: Locale) => void; children: ReactNode }) {
  const t = useCallback((key: TKey, params?: Params) => translate(locale, key, params), [locale])
  const list = useCallback(<T,>(key: TKey) => translateList<T>(locale, key), [locale])
  const value = useMemo(() => ({ locale, setLocale, t, list }), [locale, setLocale, t, list])
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nCtx)
  if (!ctx) throw new Error('useI18n вне I18nProvider')
  return ctx
}

export function useT() {
  return useI18n().t
}
