// Пояснение «почему такой статус» собираем на клиенте из чисел, а не берём готовую фразу с сервера:
// сервер пишет по-русски, а интерфейс говорит на шести языках.

import type { ItemChange } from '../api/types'
import type { Locale, TKey } from '../i18n'
import { formatDays, formatNumber, formatPrice } from './format'
import type { Currency } from './currency'

type T = (key: TKey, params?: Record<string, string | number>) => string

export function reasonOf(c: ItemChange, t: T, locale: Locale, currency: Currency): string {
  switch (c.status) {
    case 'out_of_stock':
      return c.before ? t('item.reasons.out', { n: c.before }) : t('item.reasons.outNone')
    case 'low_stock':
      return c.days_left !== null && c.days_left > 0
        ? t('item.reasons.lowDays', { before: c.before ?? '—', after: c.after, days: formatDays(c.days_left, t) })
        : t('item.reasons.low', { before: c.before ?? '—', after: c.after })
    case 'price_mismatch':
      return t('item.reasons.price', { from: formatPrice(c.price_before, locale, currency), to: formatPrice(c.price_after, locale, currency) })
    case 'new_item':
      return t('item.reasons.new')
    default:
      return c.velocity_per_day > 0.05 ? t('item.reasons.selling', { v: formatNumber(c.velocity_per_day, locale, 1) }) : t('item.reasons.same')
  }
}
