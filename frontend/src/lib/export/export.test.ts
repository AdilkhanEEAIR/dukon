import { diff, walk, walkBefore, demoOverview } from '../../test/fixtures'
import { KGS_PER_UNIT } from '../currency'
import { branchesTable, ordersTable, reportTable, type ExportContext } from './builders'
import { buildFile } from './index'
import { formatAmount, pdfDoc } from './pdf'
import { fileName, slug, toCsv } from './table'
import { columnLetter, moneyFormat, sheetData } from './xlsx'

const ctx = (over: Partial<ExportContext> = {}): ExportContext => ({
  locale: 'ru',
  currency: 'KGS',
  now: new Date('2026-10-28T15:00:00Z'),
  demo: false,
  shopName: 'Дүкөн на Чуй',
  shopAddress: 'Чуй 120',
  ...over,
})

describe('таблица отчёта обхода', () => {
  it('сначала то, что требует внимания; статусы словами; итоги по штукам и потерям', () => {
    const t = reportTable({ walk, diff }, ctx())
    expect(t.title).toBe('Отчёт обхода')
    expect(t.columns.map((c) => c.header)).toEqual(['Товар', 'Статус', 'Было', 'Стало', 'Продано', 'В день', 'Цена, KGS', 'Потери в день, KGS', 'Заказать'])
    expect(t.rows.map((r) => r.cells[0])).toEqual(['Молоко Эльвест 6% 1 л', 'Coca-Cola 1 л', 'Кукуруза консервированная', 'Масло сливочное 180 г'])
    expect(t.rows[0]).toMatchObject({ tone: 'out', cells: ['Молоко Эльвест 6% 1 л', 'Нет в наличии', 9, 0, 9, 4.5, 170, 765, 18] })
    expect(t.totals).toEqual(['Итого', null, 35, 16, 19, null, null, 765, 42])
    expect(t.meta).toEqual(['Дүкөн на Чуй · Чуй 120', expect.stringMatching(/28 окт/), '2 дня с прошлого обхода'])
    expect(t.summary.find((s) => s.label === 'Потери в день')?.value).toBe('765 сом')
    expect(fileName(t, 'pdf')).toBe('dukon-report-дүкөн-на-чуй-2026-10-28.pdf')
  })

  it('в долларах суммы пересчитаны по курсу, в заголовке — код валюты; демо помечено', () => {
    const t = reportTable({ walk, diff }, ctx({ currency: 'USD', locale: 'en', demo: true }))
    expect(t.columns[7].header).toBe('Loss per day, USD')
    expect(t.rows[0].cells[7]).toBeCloseTo(765 / KGS_PER_UNIT.USD, 2)
    expect(t.rows[0].cells[0]).toBe('Elvest milk 6% 1 L')
    expect(t.meta).toContain('Demo data')
  })

  it('первый обход — без «с прошлого обхода»; цена неизвестна — пустая клетка, а не ноль', () => {
    const first = { ...diff, walk_before_id: null, changes: [{ ...diff.changes[0], price_after: null, price_before: null }] }
    const t = reportTable({ walk: walkBefore, diff: first }, ctx())
    expect(t.meta).toContain('первый обход')
    expect(t.rows[0].cells[6]).toBeNull()
  })

  it('по-кыргызски: заголовки и статусы', () => {
    const t = reportTable({ walk, diff }, ctx({ locale: 'ky' }))
    expect(t.columns[0].header).toBe('Товар')
    expect(t.rows[0].cells[1]).toBe('Түгөндү')
    expect(t.totals?.[0]).toBe('Жыйынтык')
  })
})

describe('таблица заказа и филиалов', () => {
  it('заказ: только строки с количеством, сумма = количество × цена', () => {
    const lines = diff.changes.filter((c) => c.suggested_order > 0)
    const t = ordersTable(lines, { 'молоко': 48, 'coca cola 1 л': 0 }, ctx())
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0].cells).toEqual(['Молоко Эльвест 6% 1 л', 'Нет в наличии', 48, 170, 8160])
    expect(t.totals).toEqual(['Итого', null, 48, null, 8160])
    expect(t.summary.map((s) => s.value)).toEqual(['1', '48', expect.stringMatching(/^8\s160\sсом$/)])
    expect(t.fileBase).toBe('dukon-order-дүкөн-на-чуй-2026-10-28')
  })

  it('филиалы: самые дорогие потери сверху, итог по сети', () => {
    const t = branchesTable(demoOverview, ctx({ demo: true }))
    expect(t.rows.map((r) => r.cells[0])).toEqual(['Manas 47', 'Chuy 120', 'Osh Bazaar'])
    expect(t.rows[2].cells[1]).toBe('Адрес не указан')
    expect(t.totals?.[6]).toBe(2013)
    expect(t.summary.find((s) => s.label === 'Больше всего теряет')?.value).toBe('Manas 47')
    expect(t.meta).toContain('Демо-данные')
  })
})

describe('CSV', () => {
  it('BOM для Excel, числа с точкой, кавычки там, где запятая', () => {
    const csv = toCsv(reportTable({ walk, diff }, ctx()))
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).trim().split('\r\n')
    expect(lines[0]).toBe('Товар,Статус,Было,Стало,Продано,В день,"Цена, KGS","Потери в день, KGS",Заказать')
    expect(lines[1]).toBe('Молоко Эльвест 6% 1 л,Нет в наличии,9,0,9,4.5,170,765,18')
    expect(lines.at(-1)).toBe('Итого,,35,16,19,,,765,42')
  })

  it('имя файла без запрещённых символов, буквы любого алфавита остаются', () => {
    expect(slug('Магазин «На Чуй» / 2')).toBe('магазин-на-чуй-2')
    expect(slug('???')).toBe('dukon')
  })
})

describe('Excel', () => {
  it('шапка, закреплённые заголовки, итог формулами SUM по строкам данных', () => {
    const t = reportTable({ walk, diff }, ctx())
    const { data, headerRow } = sheetData(t)
    const header = data[headerRow - 1] as { value: string; backgroundColor: string }[]
    expect(header[0]).toMatchObject({ value: 'Товар', backgroundColor: '#0e5b3f' })
    const first = headerRow + 1
    const last = headerRow + t.rows.length
    const totals = data[headerRow + t.rows.length] as ({ value: unknown; type?: unknown } | null)[]
    expect(totals[2]).toMatchObject({ type: 'Formula', value: `SUM(C${first}:C${last})` })
    expect(totals[7]).toMatchObject({ type: 'Formula', value: `SUM(H${first}:H${last})` })
    // статус раскрашен цветом строки, деньги — числом с форматом валюты
    const milk = data[headerRow] as { value: unknown; textColor?: string; format?: string }[]
    expect(milk[1]).toMatchObject({ value: 'Нет в наличии', textColor: '#c2321f' })
    expect(milk[7]).toMatchObject({ value: 765, format: '#,##0.00 "сом"' })
  })

  it('формат валют и буквы колонок', () => {
    expect(moneyFormat('USD')).toBe('[$$-409]#,##0.00')
    expect(moneyFormat('KZT')).toBe('#,##0 "₸"')
    expect(columnLetter(0)).toBe('A')
    expect(columnLetter(25)).toBe('Z')
    expect(columnLetter(26)).toBe('AA')
  })

  it('собирается настоящий .xlsx (zip-архив)', async () => {
    const blob = await buildFile(ordersTable(diff.changes, { 'молоко': 2 }, ctx()), 'xlsx')
    // в jsdom у Blob нет arrayBuffer() — читаем по-старому, через FileReader
    const buf = await new Promise<ArrayBuffer>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as ArrayBuffer)
      r.readAsArrayBuffer(blob)
    })
    const head = new Uint8Array(buf).slice(0, 2)
    expect(String.fromCharCode(...head)).toBe('PK')
  })
})

describe('PDF', () => {
  it('широкая таблица — альбомный лист; заголовки на зелёном; статус цветом; итог жирным', () => {
    const doc = pdfDoc(reportTable({ walk, diff }, ctx()))
    expect(doc.pageOrientation).toBe('landscape')
    const table = (doc.content as { table?: { body: { text: string; color?: string; bold?: boolean }[][] } }[]).find((c) => c.table)!.table!
    expect(table.body[0][0]).toMatchObject({ text: 'Товар', color: '#ffffff', bold: true })
    expect(table.body[1][1]).toMatchObject({ text: 'Нет в наличии', color: '#c2321f' })
    expect(table.body[1][7].text).toBe('765 сом')
    expect(table.body.at(-1)?.[0]).toMatchObject({ text: 'Итого', bold: true })
  })

  it('узкая таблица заказа — книжный лист; суммы в валюте как на экране', () => {
    const t = ordersTable(diff.changes, { 'молоко': 2 }, ctx({ currency: 'USD', locale: 'en' }))
    expect(pdfDoc(t).pageOrientation).toBe('portrait')
    expect(formatAmount(3.89, t)).toBe('$3.89')
    expect(formatAmount(3.89, { ...t, locale: 'ru' })).toBe('3,89 $')
  })
})
