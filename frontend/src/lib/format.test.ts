import { translate } from '../i18n'
import { CURRENCIES, DEFAULT_CURRENCY, KGS_PER_UNIT, decimalsFor, fromKgs, isCurrency } from './currency'
import { capitalize, clamp, formatDays, formatHours, formatMoney, formatNumber, formatPrice, formatShortDate, formatSom, formatTime } from './format'

const nb = (s: string) => s.replace(/[  ]/g, ' ')

describe('валюта', () => {
  it('доллар первый и по умолчанию', () => {
    expect(DEFAULT_CURRENCY).toBe('USD')
    expect(CURRENCIES[0]).toBe('USD')
    expect(CURRENCIES[1]).toBe('KGS')
    expect(isCurrency('KGS')).toBe(true)
    expect(isCurrency('JPY')).toBe(false)
  })
  it('пересчёт из сомов по курсу НБКР', () => {
    expect(fromKgs(KGS_PER_UNIT.USD * 10, 'USD')).toBeCloseTo(10)
    expect(fromKgs(100, 'KGS')).toBe(100)
  })
  it('доллар и евро с центами, крупные суммы и остальные валюты — целыми', () => {
    expect(decimalsFor(8.57, 'USD')).toBe(2)
    expect(decimalsFor(1200, 'EUR')).toBe(0)
    expect(decimalsFor(4000, 'KZT')).toBe(0)
  })
})

describe('formatMoney', () => {
  it('сомы без пересчёта', () => {
    expect(nb(formatMoney(749, 'ru', 'KGS'))).toBe('749 сом')
    expect(nb(formatMoney(12500, 'ru', 'KGS'))).toBe('12 500 сом')
    expect(formatMoney(749, 'en', 'KGS')).toBe('749 som')
    expect(nb(formatMoney(749, 'ky', 'KGS'))).toBe('749 сом')
  })
  it('сомы → доллары: символ впереди в английском, сзади в остальных', () => {
    expect(formatMoney(KGS_PER_UNIT.USD * 10, 'en', 'USD')).toBe('$10.00')
    expect(nb(formatMoney(KGS_PER_UNIT.USD * 10, 'ru', 'USD'))).toBe('10,00 $')
    expect(nb(formatMoney(KGS_PER_UNIT.EUR * 2000, 'de', 'EUR'))).toBe('2.000 €')
  })
  it('formatSom и formatPrice', () => {
    expect(nb(formatSom(749.4, 'ru'))).toBe('749 сом')
    expect(formatPrice(null, 'ru', 'KGS')).toBe('—')
    expect(formatPrice(82.5, 'en', 'KGS')).toBe('82.50 som')
    expect(formatPrice(KGS_PER_UNIT.USD, 'en', 'USD')).toBe('$1.00')
  })
  it('formatNumber ограничивает дроби', () => {
    expect(formatNumber(4.4444, 'en', 1)).toBe('4.4')
  })
})

describe('даты и часы', () => {
  const t = (key: 'common.hours' | 'common.days' | 'common.lessThanHour', p?: { n: number }) => translate('ru', key, p)
  it('formatHours через словарь', () => {
    expect(formatHours(0.5, t)).toBe('меньше часа')
    expect(formatHours(5, t)).toBe('5 часов')
    expect(formatHours(48, t)).toBe('2 дня')
    expect(formatHours(60, t)).toBe('2,5 дня')
  })
  it('formatDays переводит дни в понятный срок', () => {
    expect(formatDays(0.25, t)).toBe('6 часов')
    expect(formatDays(3, t)).toBe('3 дня')
  })
  it('короткая дата и время по локали', () => {
    expect(formatShortDate('2026-10-28T02:12:00Z', 'en')).toMatch(/Oct 2[78]/)
    expect(formatShortDate('2026-10-28T02:12:00Z', 'ky')).not.toBe('')
    expect(formatTime('bad', 'en')).toBe('')
  })
})

describe('мелочи', () => {
  it('capitalize и clamp', () => {
    expect(capitalize('среда')).toBe('Среда')
    expect(capitalize('')).toBe('')
    expect(clamp(5, 0, 3)).toBe(3)
  })
})
