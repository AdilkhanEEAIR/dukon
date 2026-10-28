// Таблицы для выгрузки с трёх экранов: отчёт обхода, заказ, филиалы. Те же числа и подписи, что на экране:
// суммы — в выбранной валюте по курсу НБКР, названия товаров — на языке интерфейса, статусы — словами.

import type { BranchSummary, ItemChange, Status, Walk, WalkDiff } from '../../api/types'
import { translate, type Locale } from '../../i18n'
import { productName } from '../../i18n/products'
import { fromKgs, type Currency } from '../currency'
import { formatHours, formatMoney, formatWhen } from '../format'
import { slug, type ExportColumn, type ExportRow, type ExportTable, type Tone } from './table'

export interface ExportContext {
  locale: Locale
  currency: Currency
  /** Когда выгрузили — в подвал и в имя файла. */
  now: Date
  /** Демо-данные помечаем в файле честно: такую таблицу не перепутать с настоящей. */
  demo: boolean
  shopName: string
  shopAddress?: string
}

const STATUS_ORDER: Status[] = ['out_of_stock', 'low_stock', 'price_mismatch', 'new_item', 'ok']
const TONE: Record<Status, Tone> = { out_of_stock: 'out', low_stock: 'low', price_mismatch: 'price', new_item: 'new', ok: 'ok' }

const day = (d: Date) => d.toISOString().slice(0, 10)
const round2 = (v: number) => Math.round(v * 100) / 100

function money(valueKgs: number, currency: Currency): number {
  return round2(fromKgs(valueKgs, currency))
}

/** Цена с ценника: нынешняя, а если товара уже нет на полке — прежняя; неизвестна — пустая клетка, не ноль. */
function priceOf(c: ItemChange, cur: Currency): number | null {
  const price = c.price_after ?? c.price_before
  return price === null || price === undefined ? null : money(price, cur)
}

function base(ctx: ExportContext) {
  const t = (key: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate(ctx.locale, key, p)
  const meta = [[ctx.shopName, ctx.shopAddress].filter(Boolean).join(' · ')]
  if (ctx.demo) meta.push(t('mode.switch.demoOn'))
  return { t, meta, footer: t('export.generated', { t: formatWhen(ctx.now, ctx.locale) }) }
}

function sum(rows: ExportRow[], col: number): number {
  return round2(rows.reduce((a, r) => a + (typeof r.cells[col] === 'number' ? (r.cells[col] as number) : 0), 0))
}

/** Отчёт обхода: все позиции, сначала то, что требует внимания, внутри — по потерям. */
export function reportTable(report: { walk: Walk; diff: WalkDiff }, ctx: ExportContext): ExportTable {
  const { t, meta, footer } = base(ctx)
  const { walk, diff } = report
  const fmt = (v: number) => formatMoney(v, ctx.locale, ctx.currency)
  const cur = ctx.currency
  const columns: ExportColumn[] = [
    { header: t('charts.product'), kind: 'text', width: 30 },
    { header: t('export.colStatus'), kind: 'status', width: 18 },
    { header: t('export.colBefore'), kind: 'int', width: 8 },
    { header: t('export.colAfter'), kind: 'int', width: 8 },
    { header: t('export.colSold'), kind: 'int', width: 9 },
    { header: t('export.colVelocity'), kind: 'number', width: 9 },
    { header: `${t('export.colPrice')}, ${cur}`, kind: 'money', width: 12 },
    { header: `${t('export.colLoss')}, ${cur}`, kind: 'money', width: 14 },
    { header: t('export.colOrder'), kind: 'int', width: 10 },
  ]
  const sorted = [...diff.changes].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.loss_per_day - a.loss_per_day || a.name.localeCompare(b.name))
  const rows: ExportRow[] = sorted.map((c) => ({
    tone: TONE[c.status],
    cells: [
      productName(c.name, ctx.locale),
      t(`status.${c.status}`),
      c.before,
      c.after,
      c.sold,
      round2(c.velocity_per_day),
      priceOf(c, cur),
      money(c.loss_per_day, cur),
      c.suggested_order,
    ],
  }))
  meta.push(formatWhen(walk.created_at, ctx.locale))
  meta.push(diff.walk_before_id ? t('shelves.sinceLast', { t: formatHours(diff.hours_between, (k, p) => t(k, p)) }) : t('shelves.firstWalk'))
  return {
    fileBase: `dukon-report-${slug(ctx.shopName)}-${day(new Date(walk.created_at))}`,
    sheet: t('export.sheetReport'),
    title: t('shelves.report'),
    meta,
    summary: [
      { label: t('export.sumCounted'), value: String(diff.total_items) },
      { label: t('export.sumChanged'), value: String(diff.changed) },
      { label: t('export.sumLoss'), value: fmt(diff.loss_per_day) },
      { label: t('export.sumMonth'), value: `≈ ${fmt(diff.loss_per_day * 30)}` },
      { label: t('status.out_of_stock'), value: String(diff.out_of_stock) },
      { label: t('status.low_stock'), value: String(diff.low_stock) },
      { label: t('status.price_mismatch'), value: String(diff.price_mismatch) },
    ],
    columns,
    rows,
    totals: [t('export.total'), null, sum(rows, 2), sum(rows, 3), sum(rows, 4), null, null, sum(rows, 7), sum(rows, 8)],
    currency: cur,
    locale: ctx.locale,
    footer,
  }
}

/** Заказ: только строки, которые заказываем (количество больше нуля), с суммой по каждой. */
export function ordersTable(lines: ItemChange[], qty: Record<string, number>, ctx: ExportContext): ExportTable {
  const { t, meta, footer } = base(ctx)
  const cur = ctx.currency
  const fmt = (v: number) => formatMoney(v, ctx.locale, cur)
  const ordered = lines.filter((l) => (qty[l.sku] ?? 0) > 0)
  const rows: ExportRow[] = ordered.map((l) => {
    const price = l.price_after ?? l.price_before ?? 0
    const n = qty[l.sku] ?? 0
    return { tone: TONE[l.status], cells: [productName(l.name, ctx.locale), t(`status.${l.status}`), n, money(price, cur), money(n * price, cur)] }
  })
  const totalKgs = ordered.reduce((a, l) => a + (qty[l.sku] ?? 0) * (l.price_after ?? l.price_before ?? 0), 0)
  const units = ordered.reduce((a, l) => a + (qty[l.sku] ?? 0), 0)
  meta.push(formatWhen(ctx.now, ctx.locale))
  return {
    fileBase: `dukon-order-${slug(ctx.shopName)}-${day(ctx.now)}`,
    sheet: t('export.sheetOrders'),
    title: t('orders.title'),
    meta,
    summary: [
      { label: t('export.sumLines'), value: String(ordered.length) },
      { label: t('export.sumUnits'), value: String(units) },
      { label: t('export.sumTotal'), value: fmt(totalKgs) },
    ],
    columns: [
      { header: t('charts.product'), kind: 'text', width: 32 },
      { header: t('export.colStatus'), kind: 'status', width: 18 },
      { header: t('export.colQty'), kind: 'int', width: 12 },
      { header: `${t('export.colPrice')}, ${cur}`, kind: 'money', width: 14 },
      { header: `${t('export.colSum')}, ${cur}`, kind: 'money', width: 16 },
    ],
    rows,
    totals: [t('export.total'), null, units, null, sum(rows, 4)],
    currency: cur,
    locale: ctx.locale,
    footer,
  }
}

/** Филиалы: сравнение точек сети, самые дорогие потери — сверху. */
export function branchesTable(rows: BranchSummary[], ctx: ExportContext): ExportTable {
  const { t, footer } = base(ctx)
  const cur = ctx.currency
  const fmt = (v: number) => formatMoney(v, ctx.locale, cur)
  const sorted = [...rows].sort((a, b) => b.loss_per_day - a.loss_per_day || a.shop.name.localeCompare(b.shop.name))
  const out: ExportRow[] = sorted.map((r) => ({
    tone: r.loss_per_day > 0 ? 'out' : 'ok',
    cells: [r.shop.name, r.shop.address || t('shops.noAddress'), r.walks, r.out_of_stock, r.low_stock, r.price_mismatch, money(r.loss_per_day, cur), r.last_walk_at ? formatWhen(r.last_walk_at, ctx.locale) : t('branches.noWalks')],
  }))
  const total = rows.reduce((a, r) => a + r.loss_per_day, 0)
  const worst = sorted[0]
  const meta = [formatWhen(ctx.now, ctx.locale)]
  if (ctx.demo) meta.push(t('mode.switch.demoOn'))
  return {
    fileBase: `dukon-branches-${day(ctx.now)}`,
    sheet: t('export.sheetBranches'),
    title: t('branches.title'),
    meta,
    summary: [
      { label: t('export.sumBranches'), value: String(rows.length) },
      { label: t('export.sumLoss'), value: fmt(total) },
      { label: t('export.sumMonth'), value: `≈ ${fmt(total * 30)}` },
      ...(worst && worst.loss_per_day > 0 ? [{ label: t('export.sumWorst'), value: worst.shop.name }] : []),
    ],
    columns: [
      { header: t('export.colBranch'), kind: 'text', width: 22 },
      { header: t('export.colAddress'), kind: 'text', width: 28 },
      { header: t('export.colWalks'), kind: 'int', width: 9 },
      { header: t('export.colOut'), kind: 'int', width: 8 },
      { header: t('export.colLow'), kind: 'int', width: 8 },
      { header: t('export.colPriceTag'), kind: 'int', width: 9 },
      { header: `${t('export.colLoss')}, ${cur}`, kind: 'money', width: 15 },
      { header: t('export.colLastWalk'), kind: 'text', width: 18 },
    ],
    rows: out,
    totals: [t('export.total'), null, sum(out, 2), sum(out, 3), sum(out, 4), sum(out, 5), sum(out, 6), null],
    currency: cur,
    locale: ctx.locale,
    footer,
  }
}
