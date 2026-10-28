// PDF: отчёт для печати и отправки поставщику или бухгалтеру. Шапка с названием магазина, сводка крупными
// числами, таблица с зелёной строкой заголовков и «зеброй», статусы своими цветами, итог жирным, номера страниц.
// Шрифт Roboto из pdfmake: в нём есть кириллица вместе с кыргызскими ң, ө, ү.
// pdfmake тяжёлый (около мегабайта со шрифтами), поэтому грузится только по нажатию «Экспорт → PDF».

import type { Content, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces'
import { formatMoney } from '../format'
import { BRAND, TONE_COLOR, type CellKind, type CellValue, type ExportTable } from './table'

function text(v: CellValue, kind: CellKind, table: ExportTable): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (kind === 'money') return formatAmount(v, table)
  if (kind === 'number') return new Intl.NumberFormat(numberLocale(table), { maximumFractionDigits: 1 }).format(v)
  return new Intl.NumberFormat(numberLocale(table)).format(v)
}

function numberLocale(table: ExportTable): string {
  return table.locale === 'ky' ? 'ru' : table.locale
}

/** Сумма в таблице уже пересчитана в выбранную валюту, поэтому здесь только вид — тот же, что на экране
 *  («749 сом», «$8.57», «8,57 €»). formatMoney пересчитывает из сомов, так что для сомов зовём его, а остальные пишем сами. */
export function formatAmount(value: number, table: ExportTable): string {
  if (table.currency === 'KGS') return formatMoney(value, table.locale, 'KGS')
  const decimals = table.currency === 'USD' || table.currency === 'EUR' ? 2 : 0
  const n = new Intl.NumberFormat(numberLocale(table), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)
  const symbol = { USD: '$', EUR: '€', KZT: '₸', RUB: '₽' }[table.currency]
  return table.locale === 'en' ? `${symbol}${n}` : `${n} ${symbol}`
}

const isNumeric = (kind: CellKind) => kind === 'int' || kind === 'number' || kind === 'money'

/** Описание документа отдельно от сборки файла — его проверяют тесты без тяжёлой библиотеки. */
export function pdfDoc(table: ExportTable): TDocumentDefinitions {
  const wide = table.columns.length > 6
  const total = table.columns.reduce((a, c) => a + c.width, 0)
  const header: TableCell[] = table.columns.map((c) => ({
    text: c.header,
    bold: true,
    color: '#ffffff',
    fontSize: 8.5,
    alignment: isNumeric(c.kind) ? 'right' : 'left',
  }))
  const body: TableCell[][] = [header]
  for (const row of table.rows) {
    body.push(
      row.cells.map((v, ci) => {
        const kind = table.columns[ci].kind
        const cell: TableCell = { text: text(v, kind, table), alignment: isNumeric(kind) ? 'right' : 'left' }
        if (kind === 'status' && row.tone) Object.assign(cell, { color: TONE_COLOR[row.tone], bold: true })
        return cell
      }),
    )
  }
  if (table.totals) {
    body.push(table.totals.map((v, ci) => ({ text: text(v, table.columns[ci].kind, table), bold: true, alignment: isNumeric(table.columns[ci].kind) ? 'right' : 'left', fillColor: BRAND.soft })))
  }
  const lastRow = body.length - 1

  // Сводка — карточками по четыре в ряд: подпись мелко серым, число крупно.
  const kpis: Content[] = []
  for (let i = 0; i < table.summary.length; i += 4) {
    kpis.push({
      columns: table.summary.slice(i, i + 4).map((s) => ({
        stack: [
          { text: s.label, fontSize: 8, color: BRAND.ink3 },
          { text: s.value, fontSize: 13, bold: true, color: BRAND.ink, margin: [0, 2, 0, 0] },
        ],
      })),
      columnGap: 14,
      margin: [0, 0, 0, 10],
    })
  }

  return {
    pageSize: 'A4',
    pageOrientation: wide ? 'landscape' : 'portrait',
    pageMargins: [36, 40, 36, 44],
    info: { title: `Dukon — ${table.title}`, author: 'Dukon', creator: 'Dukon', subject: table.meta.join(' · ') },
    defaultStyle: { font: 'Roboto', fontSize: 9, color: BRAND.ink, lineHeight: 1.15 },
    footer: (current: number, count: number) => ({
      columns: [
        { text: table.footer, color: BRAND.ink3, fontSize: 7.5 },
        { text: `${current} / ${count}`, alignment: 'right', color: BRAND.ink3, fontSize: 7.5 },
      ],
      margin: [36, 14, 36, 0],
    }),
    content: [
      {
        columns: [
          // знак Dukon: зелёный квадрат-витрина с белой дверью — узнаётся и в чёрно-белой печати
          {
            width: 22,
            canvas: [
              { type: 'rect', x: 0, y: 0, w: 22, h: 22, r: 5, color: BRAND.accent },
              { type: 'rect', x: 4, y: 5, w: 14, h: 4, color: '#ffffff' },
              { type: 'rect', x: 9, y: 12, w: 5, h: 10, color: '#ffffff' },
            ],
          },
          { text: [{ text: 'Dukon', bold: true, color: BRAND.accent }, { text: `   ${table.sheet}`, color: BRAND.ink3 }], fontSize: 11, margin: [8, 4, 0, 0] },
        ],
      },
      { text: table.title, fontSize: 20, bold: true, margin: [0, 12, 0, 2] },
      { text: table.meta.join('   ·   '), color: BRAND.ink2, margin: [0, 0, 0, 14] },
      ...kpis,
      {
        table: {
          headerRows: 1,
          widths: table.columns.map((c) => (c.kind === 'text' ? '*' : `${Math.round((c.width / total) * 100)}%`)),
          body,
        },
        layout: {
          fillColor: (i: number) => (i === 0 ? BRAND.accent : i !== lastRow && i % 2 === 0 ? BRAND.zebra : null),
          hLineWidth: (i: number) => (table.totals && i === lastRow ? 1 : i === 0 || i === body.length ? 0 : 0.5),
          vLineWidth: () => 0,
          hLineColor: (i: number) => (table.totals && i === lastRow ? BRAND.ink : BRAND.line),
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
        margin: [0, 6, 0, 0],
      },
    ],
  }
}

export async function toPdf(table: ExportTable): Promise<Blob> {
  const [pdfMake, vfs] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')])
  const lib = ((pdfMake as unknown as { default?: unknown }).default ?? pdfMake) as typeof import('pdfmake/build/pdfmake')
  const fonts = ((vfs as unknown as { default?: unknown }).default ?? vfs) as Record<string, string>
  lib.addVirtualFileSystem(fonts)
  return lib.createPdf(pdfDoc(table)).getBlob()
}
