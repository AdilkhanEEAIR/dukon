// Excel: настоящая таблица, а не картинка. Шапка с названием и сводкой, заголовки колонок закреплены,
// суммы — числа с форматом валюты (их можно складывать дальше), а строка «Итого» — формулы SUM:
// поправил количество в Excel — итог пересчитался сам. Библиотека подгружается только при выгрузке.

import type { Currency } from '../currency'
import { BRAND, TONE_COLOR, type CellKind, type CellValue, type ExportTable } from './table'

/** Формат денег в Excel: число остаётся числом, знак валюты — только отображение. */
export function moneyFormat(currency: Currency): string {
  switch (currency) {
    case 'USD':
      return '[$$-409]#,##0.00'
    case 'EUR':
      return '#,##0.00 [$€-x-euro2]'
    case 'KZT':
      return '#,##0 "₸"'
    case 'RUB':
      return '#,##0.00 "₽"'
    default:
      return '#,##0.00 "сом"'
  }
}

/** Буква колонки Excel: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

type XCell = Record<string, unknown> | null

function numberFormat(kind: CellKind, currency: Currency): string | undefined {
  if (kind === 'money') return moneyFormat(currency)
  if (kind === 'int') return '#,##0'
  if (kind === 'number') return '0.0'
  return undefined
}

function valueCell(v: CellValue, kind: CellKind, currency: Currency, extra: Record<string, unknown> = {}): XCell {
  if (v === null || v === undefined) return { value: '', ...extra }
  if (typeof v === 'number') return { value: v, type: Number, format: numberFormat(kind, currency), align: 'right', ...extra }
  return { value: v, type: String, ...extra }
}

/** Листы в виде данных — отдельно от записи файла, чтобы проверять их в тестах без архива. */
export function sheetData(table: ExportTable): { data: XCell[][]; headerRow: number } {
  const n = table.columns.length
  const pad = (cells: XCell[]): XCell[] => [...cells, ...Array(Math.max(0, n - cells.length)).fill(null)]
  const data: XCell[][] = []
  data.push(pad([{ value: `Dukon · ${table.title}`, fontWeight: 'bold', fontSize: 16, textColor: BRAND.accent, columnSpan: n, height: 28 }]))
  for (const line of table.meta) data.push(pad([{ value: line, textColor: BRAND.ink2, columnSpan: n }]))
  data.push(pad([]))
  // сводка — парами «подпись: значение», по строке на пару, как в шапке бумажного отчёта
  for (const s of table.summary) data.push(pad([{ value: s.label, textColor: BRAND.ink3 }, { value: s.value, fontWeight: 'bold', columnSpan: Math.max(1, n - 1) }]))
  data.push(pad([]))

  const headerRow = data.length + 1 // номер строки в Excel (с единицы)
  data.push(
    table.columns.map((c) => ({
      value: c.header,
      fontWeight: 'bold',
      textColor: '#ffffff',
      backgroundColor: BRAND.accent,
      align: c.kind === 'text' || c.kind === 'status' ? 'left' : 'right',
      alignVertical: 'center',
      wrap: true,
      height: 30,
    })),
  )
  table.rows.forEach((row, i) => {
    const zebra = i % 2 === 1 ? { backgroundColor: BRAND.zebra } : {}
    data.push(
      row.cells.map((v, ci) => {
        const kind = table.columns[ci].kind
        const tone = kind === 'status' && row.tone ? { textColor: TONE_COLOR[row.tone], fontWeight: 'bold' } : {}
        return valueCell(v, kind, table.currency, { ...zebra, ...tone })
      }),
    )
  })
  if (table.totals) {
    const first = headerRow + 1
    const last = headerRow + table.rows.length
    data.push(
      table.totals.map((v, ci) => {
        const kind = table.columns[ci].kind
        const style = { fontWeight: 'bold', topBorderStyle: 'thin', topBorderColor: BRAND.ink, backgroundColor: BRAND.soft }
        // Итог по числовой колонке — формула: правка в любой строке сразу меняет сумму.
        if (typeof v === 'number' && table.rows.length > 0) {
          const col = columnLetter(ci)
          return { value: `SUM(${col}${first}:${col}${last})`, type: 'Formula', format: numberFormat(kind, table.currency), align: 'right', ...style }
        }
        return valueCell(v, kind, table.currency, style)
      }),
    )
  }
  data.push(pad([]))
  data.push(pad([{ value: table.footer, textColor: BRAND.ink3, fontStyle: 'italic', columnSpan: n }]))
  return { data, headerRow }
}

export async function toXlsx(table: ExportTable): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const { data, headerRow } = sheetData(table)
  return writeXlsxFile(data as never, {
    sheet: table.sheet.slice(0, 31),
    columns: table.columns.map((c) => ({ width: c.width })),
    stickyRowsCount: headerRow,
    fontFamily: 'Calibri',
    fontSize: 11,
  } as never).toBlob()
}
