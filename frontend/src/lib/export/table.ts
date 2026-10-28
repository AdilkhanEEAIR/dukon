// Одна модель выгрузки на все форматы. Страница собирает таблицу (заголовок, сводку, колонки, строки, итог),
// а PDF, Excel и CSV лишь по-разному её рисуют. Так в трёх файлах никогда не разъедутся числа и подписи.

import type { Locale } from '../../i18n'
import type { Currency } from '../currency'

export type ExportFormat = 'pdf' | 'xlsx' | 'csv'
export const EXPORT_FORMATS: ExportFormat[] = ['pdf', 'xlsx', 'csv']

/** text — строка; int — штуки; number — дробное (скорость продаж); money — сумма в выбранной валюте;
 *  status — подпись статуса, раскрашивается по tone строки. */
export type CellKind = 'text' | 'int' | 'number' | 'money' | 'status'
export type Tone = 'out' | 'low' | 'price' | 'ok' | 'new'
export type CellValue = string | number | null

export interface ExportColumn {
  header: string
  kind: CellKind
  /** Ширина в символах — для Excel; в PDF — доля ширины страницы. */
  width: number
}

export interface ExportRow {
  cells: CellValue[]
  tone?: Tone
}

export interface ExportTable {
  /** Имя файла без расширения. */
  fileBase: string
  /** Название листа Excel (до 31 символа). */
  sheet: string
  title: string
  /** Строки под заголовком: магазин, дата, источник данных. */
  meta: string[]
  /** Главные числа — уже отформатированные строки, как на экране. */
  summary: { label: string; value: string }[]
  columns: ExportColumn[]
  rows: ExportRow[]
  /** Итог по колонкам: подпись в первой, суммы в денежных и штучных; null — пусто. */
  totals?: CellValue[]
  currency: Currency
  locale: Locale
  /** Подвал: «Dukon · выгружено 28 окт., 20:47». */
  footer: string
}

/** Цвета статусов в файлах — те же, что в светлой теме приложения: файлы печатают на белой бумаге. */
export const TONE_COLOR: Record<Tone, string> = {
  out: '#c2321f',
  low: '#9a6400',
  price: '#2c4f8f',
  ok: '#2f6b3a',
  new: '#0e5b3f',
}

export const BRAND = { accent: '#0e5b3f', ink: '#101512', ink2: '#4b544d', ink3: '#7b847d', line: '#dfe3da', zebra: '#f7f8f5', soft: '#dcefe4' }

/** Имя файла без запрещённых символов Windows; буквы любого алфавита остаются — «магазин-на-чуй» читается. */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'dukon'
  )
}

export function fileName(table: ExportTable, format: ExportFormat): string {
  return `${table.fileBase}.${format}`
}

const csvCell = (v: CellValue): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** CSV — для учётных программ: только таблица, числа с точкой, без пробелов-разделителей и валютных знаков.
 *  BOM в начале, чтобы Excel открыл кириллицу без «кракозябр». */
export function toCsv(table: ExportTable): string {
  const lines = [table.columns.map((c) => csvCell(c.header)).join(',')]
  for (const r of table.rows) lines.push(r.cells.map(csvCell).join(','))
  if (table.totals) lines.push(table.totals.map(csvCell).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}
