// Названия товаров приходят с ценников — по-русски. Для демо-товаров храним готовые переводы,
// для остальных переводим хотя бы единицы («1 л» → «1 L», «55 г» → «55 g»): бренд и так читается.
// Отдельно от словарей интерфейса — это данные, а не строки экранов, и ключи у них другие.

import type { Locale } from './index'

type Names = Partial<Record<Locale, string>>

// Ключ — название в нижнем регистре, как его пишет ценник; ё → е, пробелы схлопнуты.
const KNOWN: Record<string, Names> = {
  'вода легенда 0.5 л': { en: 'Legenda water 0.5 L', ky: 'Легенда суусу 0.5 л', es: 'Agua Legenda 0,5 L', de: 'Legenda Wasser 0,5 l', fr: 'Eau Legenda 0,5 L' },
  'молоко эльвест 6% 1 л': { en: 'Elvest milk 6% 1 L', ky: 'Эльвест сүтү 6% 1 л', es: 'Leche Elvest 6% 1 L', de: 'Elvest Milch 6 % 1 l', fr: 'Lait Elvest 6 % 1 L' },
  'кефир эльвест 0.5 л': { en: 'Elvest kefir 0.5 L', ky: 'Эльвест кефири 0.5 л', es: 'Kéfir Elvest 0,5 L', de: 'Elvest Kefir 0,5 l', fr: 'Kéfir Elvest 0,5 L' },
  'orbit мята': { en: 'Orbit mint', ky: 'Orbit жалбыз', es: 'Orbit menta', de: 'Orbit Minze', fr: 'Orbit menthe' },
  'масло сливочное 180 г': { en: 'Butter 180 g', ky: 'Сары май 180 г', es: 'Mantequilla 180 g', de: 'Butter 180 g', fr: 'Beurre 180 g' },
  'кукуруза консервированная': { en: 'Canned corn', ky: 'Консерваланган жүгөрү', es: 'Maíz en lata', de: 'Mais aus der Dose', fr: 'Maïs en conserve' },
  'хлеб нарезной': { en: 'Sliced bread', ky: 'Кесилген нан', es: 'Pan de molde', de: 'Toastbrot', fr: 'Pain de mie' },
  'хлеб белый': { en: 'White bread', ky: 'Ак нан', es: 'Pan blanco', de: 'Weißbrot', fr: 'Pain blanc' },
}

function keyOf(name: string): string {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

// Единицы после числа: «0.5 л», «55г», «1 кг». В немецком литр пишут строчной l, в остальных — L.
const UNITS: [RegExp, Record<'L' | 'other', string>][] = [
  [/(\d)\s?мл(?!\p{L})/gu, { L: '$1 ml', other: '$1 ml' }],
  [/(\d)\s?кг(?!\p{L})/gu, { L: '$1 kg', other: '$1 kg' }],
  [/(\d)\s?л(?!\p{L})/gu, { L: '$1 L', other: '$1 l' }],
  [/(\d)\s?г(?!\p{L})/gu, { L: '$1 g', other: '$1 g' }],
  [/(\d)\s?шт(?!\p{L})/gu, { L: '$1 pcs', other: '$1 Stk.' }],
]

/** Название товара на языке интерфейса. Русский и неизвестные кыргызские названия — как на ценнике. */
export function productName(name: string, locale: Locale): string {
  if (locale === 'ru') return name
  const known = KNOWN[keyOf(name)]?.[locale]
  if (known) return known
  if (locale === 'ky') return name
  let out = name
  for (const [re, by] of UNITS) out = out.replace(re, locale === 'de' ? by.other : by.L)
  return out
}
