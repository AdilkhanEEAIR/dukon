// Ценники на полках — в сомах, и все суммы на сервере тоже в сомах. Валюта в настройках — это
// только отображение: пересчитываем по официальному курсу Нацбанка КР и честно пишем дату курса.

export type Currency = 'USD' | 'KGS' | 'EUR' | 'KZT' | 'RUB'

// Порядок важен: так валюты стоят в выпадающем списке. Доллар первый — его понимают все судьи.
export const CURRENCIES: Currency[] = ['USD', 'KGS', 'EUR', 'KZT', 'RUB']
export const DEFAULT_CURRENCY: Currency = 'USD'

/** Сомов за единицу валюты, курс НБКР на 22.07.2026 (akchabar.kg). */
export const KGS_PER_UNIT: Record<Currency, number> = {
  KGS: 1,
  USD: 87.45,
  EUR: 99.8679,
  RUB: 1.1147,
  KZT: 0.1861,
}
export const RATES_DATE = '2026-07-22'

export const CURRENCY_LABEL: Record<Currency, string> = {
  USD: 'US dollar',
  KGS: 'Kyrgyz som',
  EUR: 'Euro',
  KZT: 'Kazakh tenge',
  RUB: 'Russian ruble',
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as string[]).includes(value)
}

export function fromKgs(valueKgs: number, currency: Currency): number {
  return valueKgs / KGS_PER_UNIT[currency]
}

/** Сколько знаков после запятой: доллар и евро с центами (иначе «$1» за бутылку воды врёт), остальные — целыми. */
export function decimalsFor(value: number, currency: Currency): number {
  if (currency === 'USD' || currency === 'EUR') return Math.abs(value) >= 1000 ? 0 : 2
  return 0
}
