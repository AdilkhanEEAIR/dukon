import { DEFAULT_LOCALE, DICTS, LOCALES, isLocale, translate, translateList } from './index'

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
