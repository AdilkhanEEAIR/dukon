import { isValidElement, type ReactElement } from 'react'
import { DEFAULT_LOCALE, DICTS, LOCALES, isLocale, stripMarks, translate, translateList, translateRich } from './index'

function keysOf(obj: unknown, prefix = ''): string[] {
  if (Array.isArray(obj)) return [prefix]
  if (obj && typeof obj === 'object' && 'other' in (obj as Record<string, unknown>)) return [prefix]
  if (obj && typeof obj === 'object') {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k))
  }
  return [prefix]
}

describe('словари', () => {
  const reference = keysOf(DICTS.en).sort()

  it.each(LOCALES)('%s содержит ровно те же ключи, что и en', (locale) => {
    expect(keysOf(DICTS[locale]).sort()).toEqual(reference)
  })

  it.each(LOCALES)('%s: списки той же длины, что в en', (locale) => {
    expect(translateList(locale, 'landing.steps')).toHaveLength(4)
    expect(translateList(locale, 'scan.steps')).toHaveLength(4)
    expect(translateList(locale, 'agent.rules')).toHaveLength(4)
    expect(translateList(locale, 'landing.models')).toHaveLength(3)
  })

  it.each(LOCALES)('%s: ни одной пустой строки', (locale) => {
    const walk = (o: unknown): string[] =>
      Array.isArray(o) ? o.flatMap(walk) : o && typeof o === 'object' ? Object.values(o as Record<string, unknown>).flatMap(walk) : [String(o)]
    expect(walk(DICTS[locale]).filter((s) => !s.trim())).toEqual([])
  })

  it('раздел словаря не похож на форму множественного числа (ключ other только в склонениях)', () => {
    // Раздел с ключом other типы и тесты принимают за склонение — его ключи «пропадают» (так было с orders.other).
    const PLURAL = new Set(['zero', 'one', 'two', 'few', 'many', 'other'])
    const bad: string[] = []
    const walk = (o: unknown, path: string) => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return
      const keys = Object.keys(o as Record<string, unknown>)
      if (keys.includes('other') && keys.some((k) => !PLURAL.has(k))) bad.push(path)
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k)
    }
    for (const locale of LOCALES) walk(DICTS[locale], locale)
    expect(bad).toEqual([])
  })

  it('плейсхолдеры в переводах совпадают с английскими', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    const flat = (o: unknown, prefix = ''): [string, string][] =>
      Array.isArray(o)
        ? []
        : o && typeof o === 'object'
          ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k))
          : [[prefix, String(o)]]
    const en = new Map(flat(DICTS.en))
    for (const locale of LOCALES) {
      for (const [key, value] of flat(DICTS[locale])) {
        const ref = en.get(key)
        if (ref === undefined || key.endsWith('.few') || key.endsWith('.many')) continue
        expect(placeholders(value), `${locale}:${key}`).toBe(placeholders(ref))
      }
    }
  })
})

describe('translate', () => {
  it('подставляет параметры', () => {
    expect(translate('en', 'home.changed', { n: 3 })).toBe('3 changes since last walk')
    expect(translate('ru', 'home.changed', { n: 3 })).toBe('изменений с прошлого обхода: 3')
  })

  it('склоняет по правилам языка', () => {
    expect(translate('ru', 'common.items', { n: 1 })).toBe('1 товар')
    expect(translate('ru', 'common.items', { n: 3 })).toBe('3 товара')
    expect(translate('ru', 'common.items', { n: 11 })).toBe('11 товаров')
    expect(translate('en', 'common.items', { n: 1 })).toBe('1 item')
    expect(translate('en', 'common.items', { n: 2 })).toBe('2 items')
    expect(translate('fr', 'common.days', { n: 0 })).toBe('0 jour')
  })

  it('неизвестный параметр остаётся как есть, а не падает', () => {
    expect(translate('en', 'home.changed')).toBe('{n} changes since last walk')
  })

  it('вложенные ключи ошибок', () => {
    expect(translate('de', 'errors.billing.title')).toContain('Guthaben')
  })
})

describe('языки', () => {
  it('английский по умолчанию и первым, затем русский и кыргызский', () => {
    expect(DEFAULT_LOCALE).toBe('en')
    expect(LOCALES.slice(0, 3)).toEqual(['en', 'ru', 'ky'])
    expect(LOCALES).toHaveLength(6)
  })
  it('isLocale отсекает неизвестные значения', () => {
    expect(isLocale('ky')).toBe(true)
    expect(isLocale('kk')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })
  it('кыргызский словарь подставляет значения', () => {
    expect(translate('ky', 'home.changed', { n: 3 })).toBe('акыркы кыдыруудан бери өзгөрүүлөр: 3')
    expect(translate('ky', 'shops.count', { n: 2 })).toBe('2 дүкөн')
    expect(DICTS.ky.locale.name).toBe('Кыргызча')
  })
  it('у всех языков есть подпись автора и новые разделы', () => {
    for (const l of LOCALES) {
      expect(translate(l, 'common.madeBy')).toMatch(/Adilkhan|Адилхан/)
      expect(translate(l, 'branches.worst', { name: 'X' })).toContain('X')
    }
  })
})

describe('слова-потери', () => {
  const LOSS_KEYS = ['home.lossTitle', 'shelves.losing', 'item.loss', 'branches.chartTitle', 'branches.total', 'branches.worst'] as const

  it.each(LOCALES)('%s: в каждой строке о потерях отмечено слово', (locale) => {
    for (const key of LOSS_KEYS) {
      const raw = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], DICTS[locale])
      expect(raw, `${locale}:${key}`).toMatch(/\[\[.+?\]\]/)
    }
  })

  it('t() отдаёт чистый текст без скобок', () => {
    expect(translate('ru', 'branches.total')).toBe('Все филиалы теряют')
    expect(translate('en', 'branches.worst', { name: 'Manas 47' })).toBe('Biggest loss: Manas 47')
    expect(stripMarks('a [[b]] c [[d]]')).toBe('a b c d')
  })

  it('rich() выделяет слово в <strong class="loss-word">, остальной текст сохраняется', () => {
    const node = translateRich('ru', 'branches.worst', { name: 'Manas 47' }) as ReactElement<{ children: unknown[] }>
    expect(isValidElement(node)).toBe(true)
    const parts = node.props.children
    expect(parts[0]).toBe('Больше всего ')
    const strong = parts[1] as ReactElement<{ className: string; children: string }>
    expect(strong.type).toBe('strong')
    expect(strong.props.className).toBe('loss-word')
    expect(strong.props.children).toBe('теряет')
    expect(parts[2]).toBe(': Manas 47')
    // без отметок — просто строка
    expect(translateRich('ru', 'common.back')).toBe('Назад')
  })

  it('настройка анимаций переведена на все языки', () => {
    for (const l of LOCALES) {
      expect(translate(l, 'settings.motion')).not.toBe('settings.motion')
      expect(translate(l, 'settings.motionSystemCalm').length).toBeGreaterThan(20)
    }
  })
})
