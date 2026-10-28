// Черновики заказов: пока без сервера — строки из рекомендаций последнего обхода. Количество — кнопками
// или прямо с клавиатуры; кольцо показывает, на что уходят деньги заказа, и перетекает при каждой правке.
// Заказ выгружается в PDF, Excel или CSV — отправить поставщику. Группировка по поставщикам — в заходе 3.

import { Package } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { ItemChange } from '../api/types'
import { useLatest } from '../app/data'
import { useSettings } from '../app/settings'
import { Donut, type DonutSlice } from '../components/charts/Donut'
import { useChartColors } from '../components/charts/theme'
import { ExportMenu } from '../components/ExportMenu'
import { ordersTable } from '../lib/export'
import { formatMoney } from '../lib/format'
import { Button } from '../components/Button'
import { PageActions } from '../components/Nav'
import { Pill, STATUS_TONE } from '../components/Pill'
import { EmptyState, ErrorState, ReportSkeleton } from '../components/States'
import { useI18n } from '../i18n'
import { ProductIcon } from '../components/ProductIcon'
import { Money } from '../components/Money'
import { QtyStepper } from '../components/QtyStepper'
import { Ticker } from '../components/Ticker'

export function OrdersPage() {
  const { t } = useI18n()
  const { latest, reload } = useLatest()

  return (
    <div className="page stagger" style={{ maxWidth: 760 }} data-testid="orders">
      <header className="page-head">
        <div className="page-head__text">
          <h1 className="h1">{t('orders.title')}</h1>
          <p className="page-head__sub">{t('orders.subtitle')}</p>
        </div>
        <PageActions />
      </header>

      {latest.status === 'loading' || latest.status === 'idle' ? (
        <ReportSkeleton />
      ) : latest.status === 'error' ? (
        <ErrorState error={latest.error} onRetry={reload} />
      ) : (
        // Ключ — обход: другой обход (сменили магазин или демо ↔ свои данные) — заново берём рекомендованные количества.
        <Drafts key={latest.data?.walk.id ?? 'none'} lines={(latest.data?.diff.changes ?? []).filter((c) => c.suggested_order > 0)} />
      )}
    </div>
  )
}

/** Сколько отдельных секторов в кольце: остальное — одним серым «Другое», иначе кольцо рассыпается на крошки. */
const SHARE_TOP = 5
const OTHER = '__other'

function Drafts({ lines }: { lines: ItemChange[] }) {
  const { t, product, locale } = useI18n()
  const { settings } = useSettings()
  const colors = useChartColors()
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.sku, l.suggested_order])))
  const [focus, setFocus] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const priceOf = (l: ItemChange) => l.price_after ?? l.price_before ?? 0
  const total = useMemo(() => lines.reduce((sum, l) => sum + (qty[l.sku] ?? 0) * (l.price_after ?? l.price_before ?? 0), 0), [lines, qty])
  const units = Object.values(qty).reduce((a, n) => a + n, 0)
  const fmt = useCallback((v: number) => formatMoney(v, locale, settings.currency), [locale, settings.currency])

  // Кольцо «на что уходят деньги»: самые дорогие строки — отдельными секторами, остальное — «Другое».
  const share = useMemo<DonutSlice[]>(() => {
    const sums = lines.map((l) => ({ l, v: (qty[l.sku] ?? 0) * (l.price_after ?? l.price_before ?? 0) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)
    const top = sums.slice(0, SHARE_TOP).map((x, i) => ({ id: x.l.sku, name: product(x.l.name), value: x.v, color: colors.accentRamp[i], display: fmt(x.v) }))
    const rest = sums.slice(SHARE_TOP).reduce((a, x) => a + x.v, 0)
    if (rest > 0) top.push({ id: OTHER, name: t('orders.rest'), value: rest, color: colors.accentRamp[SHARE_TOP], display: fmt(rest) })
    return top
  }, [lines, qty, colors, product, fmt, t])

  // Сектор кольца → своя строка заказа подсвечивается и приезжает в поле зрения.
  const pick = useCallback((id: string | null) => {
    if (id === OTHER) return
    setFocus(id)
    if (id) list.current?.querySelector<HTMLElement>(`[data-sku="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  if (lines.length === 0) {
    return <EmptyState icon={Package} title={t('orders.empty')} text={t('orders.emptyBody')} action={<Button variant="secondary" to="/app/shelves">{t('orders.toReport')}</Button>} />
  }

  const set = (sku: string, n: number) => setQty((q) => ({ ...q, [sku]: n }))

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row row--between row--wrap" style={{ gap: 12 }}>
        <div className="stack stack--tight">
          <span className="h3">{t('orders.suggested')}</span>
          <span className="small" style={{ maxWidth: '52ch' }}>{t('orders.suggestedBody')}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Pill>{t('orders.lines', { n: lines.length })}</Pill>
          <ExportMenu build={(ctx) => ordersTable(lines, qty, ctx)} testId="export-orders" />
        </div>
      </div>

      {share.length > 0 && (
        <section className="sheet sheet--pad stack" style={{ gap: 14 }} data-testid="orders-share">
          <h3 className="h3">{t('orders.share')}</h3>
          <Donut slices={share} total={fmt(total)} caption={t('orders.total')} selected={focus} onSelect={pick} label={t('orders.share')} testId="orders-donut" />
        </section>
      )}

      <div className="sheet" style={{ padding: '2px 18px' }}>
        <div className="rows" ref={list}>
          {lines.map((l) => {
            const price = priceOf(l)
            const n = qty[l.sku] ?? 0
            const name = product(l.name)
            return (
              <div key={l.sku} data-sku={l.sku} className={`row order-line${n === 0 ? ' is-zero' : ''}${focus === l.sku ? ' is-focus' : ''}`} style={{ gap: 14 }} data-testid="order-line">
                <ProductIcon name={l.name} size={38} />
                <div className="stack grow" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 600 }} className="truncate">{name}</span>
                  <span className="small row" style={{ gap: 10 }}>
                    <Money kgs={price} kind="price" noAlt />
                    <span className={`c-${STATUS_TONE[l.status]}`}>{t(`status.${l.status}`)}</span>
                  </span>
                </div>
                <QtyStepper value={n} onChange={(v) => set(l.sku, v)} label={name} inputLabel={t('orders.qty', { name })} />
                <Money kgs={n * price} className="num-md order-line__sum" altBlock />
              </div>
            )
          })}
        </div>
      </div>

      <div className="order-total sheet sheet--pad">
        <div className="stack stack--tight">
          <span className="h3">{t('orders.total')}</span>
          <span className="small">
            <Ticker value={units} /> {t('item.pcs')}
          </span>
        </div>
        <Money kgs={total} className="num-lg" altBlock testId="order-total" />
      </div>
      <Button size="lg" block disabled icon={<Package size={18} />}>
        {t('orders.approveSoon')}
      </Button>
    </div>
  )
}
