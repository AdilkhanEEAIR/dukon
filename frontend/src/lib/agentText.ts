// Слова для журнала агента на языке интерфейса. Сервер отдаёт события со структурой (правило, товар,
// лимит, ответ поставщика по полям), а фразы собираем здесь — так один и тот же прогон читается
// по-английски у судьи и по-кыргызски у хозяина, а модель и логи остаются на русском.

import type { AgentEvent, DraftPayload, SupplierReplyPayload, Violation } from '../api/types'
import type { Locale, TKey } from '../i18n'
import { productName } from '../i18n/products'

export type T = (key: TKey, params?: Record<string, string | number>) => string

// Кыргызского в Intl у многих браузеров нет — дни недели задаём сами, чтобы не получить английские.
const KY_DAYS = ['дүйшөмбү', 'шейшемби', 'шаршемби', 'бейшемби', 'жума', 'ишемби', 'жекшемби']
const KY_SHORT = ['дш', 'шш', 'шр', 'бш', 'жм', 'иш', 'жк']

/** Название дня недели (0 — понедельник) на языке интерфейса. 2024-01-01 — понедельник. */
export function weekdayName(day: number | null | undefined, locale: Locale, form: 'long' | 'short' = 'long'): string {
  if (day === null || day === undefined) return '—'
  if (locale === 'ky') return (form === 'short' ? KY_SHORT : KY_DAYS)[day] ?? '—'
  const date = new Date(Date.UTC(2024, 0, 1 + day))
  return new Intl.DateTimeFormat(locale, { weekday: form, timeZone: 'UTC' }).format(date)
}

/** Название поставщика на языке интерфейса: по-русски и по-кыргызски — как есть, иначе английское, если оно есть. */
export function supplierTitle(obj: { supplier_name?: string; supplier_name_en?: string; name?: string; name_en?: string }, locale: Locale): string {
  const ru = obj.supplier_name ?? obj.name ?? ''
  const en = obj.supplier_name_en ?? obj.name_en ?? ''
  return locale === 'ru' || locale === 'ky' || !en ? ru : en
}

export function weekdayList(days: number[], locale: Locale): string {
  return days.map((d) => weekdayName(d, locale)).join(', ')
}

function lineName(sku: string | null, draft: DraftPayload | undefined, locale: Locale): string {
  const found = draft?.lines.find((l) => l.sku === sku)
  return found ? productName(found.name, locale) : (sku ?? '')
}

/** Текст нарушения правила. Цифры и имена — из структуры события; фраза — из словаря. */
export function violationText(v: Violation, draft: DraftPayload | undefined, locale: Locale, t: T, fmt: (kgs: number) => string): string {
  const name = lineName(v.sku, draft, locale)
  const line = draft?.lines.find((l) => l.sku === v.sku)
  switch (v.rule) {
    case 'max_stock_days':
      return t('agent.rule.max_stock_days', { name, qty: line?.qty ?? v.actual ?? 0, limit: v.limit ?? 0 })
    case 'min_discount_for_upsize':
      return t('agent.rule.min_discount_for_upsize', { name, qty: line?.qty ?? 0, pct: v.actual ?? 0, min: v.limit ?? 0 })
    case 'no_dairy_on':
      return t('agent.rule.no_dairy_on', { day: weekdayName(typeof v.actual === 'number' ? v.actual : null, locale) })
    case 'max_line_units':
      return t('agent.rule.max_line_units', { name, qty: v.actual ?? 0, limit: v.limit ?? 0 })
    case 'max_order_total':
      return t('agent.rule.max_order_total', { sum: fmt(v.actual ?? 0), limit: fmt(v.limit ?? 0) })
    case 'banned_supplier':
      return t('agent.rule.banned_supplier', { supplier: draft?.supplier_name ?? '' })
    default:
      return v.message
  }
}

/** Ответ поставщика по полям: чего нет, что есть, скидка, день, встречное предложение. */
export function replyText(reply: SupplierReplyPayload, locale: Locale, t: T, fmt: (kgs: number) => string, minOrderKgs?: number): string {
  const parts: string[] = []
  if (reply.rejected.length) parts.push(t('agent.reply.rejected', { names: reply.rejected.map((r) => productName(r.name, locale)).join(', ') }))
  if (!reply.min_order_ok) parts.push(t('agent.reply.minOrder', { sum: fmt(minOrderKgs ?? 0) }))
  if (reply.accepted.length && reply.min_order_ok) {
    let s = reply.rejected.length ? t('agent.reply.restInStock') : t('agent.reply.allInStock')
    if (reply.discount_pct) s += t('agent.reply.discount', { pct: reply.discount_pct })
    parts.push(s + '.')
  }
  if (reply.delivery_day !== null) parts.push(t('agent.reply.delivery', { day: weekdayName(reply.delivery_day, locale) }))
  if (reply.offers[0]) parts.push(t('agent.reply.offer', { n: reply.offers[0].min_units, pct: reply.offers[0].pct }))
  return parts.join(' ')
}

/** Короткая подпись намерения над репликой агента: «Предлагает Ак-Суу», «Спрашивает…», «Подтверждает…». */
export function intentLabel(ev: AgentEvent, t: T, supplierName: string): string | null {
  switch (ev.data.tool) {
    case 'propose_order':
      return t('agent.feed.propose', { supplier: supplierName })
    case 'ask_supplier':
      return t('agent.feed.ask', { supplier: supplierName })
    case 'confirm_order':
      return t('agent.feed.confirm', { supplier: supplierName })
    default:
      return null
  }
}
