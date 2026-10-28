// Черновики заказов: пока без сервера — строки из рекомендаций последнего обхода, со степпером количества.
// Группировка по поставщикам и утверждение приходят в заходе 3.

import { Minus, Package, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ItemChange } from '../api/types'
import { useLatest } from '../app/data'
import { Button } from '../components/Button'
import { PageActions } from '../components/Nav'
import { Pill, STATUS_TONE } from '../components/Pill'
import { EmptyState, ErrorState, ReportSkeleton } from '../components/States'
import { useI18n } from '../i18n'
import { ProductIcon } from '../components/ProductIcon'
import { Money } from '../components/Money'
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
        <Drafts lines={(latest.data?.diff.changes ?? []).filter((c) => c.suggested_order > 0)} />
      )}
    </div>
  )
}

function Drafts({ lines }: { lines: ItemChange[] }) {
  const { t, product } = useI18n()
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.sku, l.suggested_order])))
  const total = useMemo(() => lines.reduce((sum, l) => sum + (qty[l.sku] ?? 0) * (l.price_after ?? l.price_before ?? 0), 0), [lines, qty])
  const units = Object.values(qty).reduce((a, n) => a + n, 0)

  if (lines.length === 0) {
    return <EmptyState icon={Package} title={t('orders.empty')} text={t('orders.emptyBody')} action={<Button variant="secondary" to="/app/shelves">{t('orders.toReport')}</Button>} />
  }

  const change = (sku: string, delta: number) => setQty((q) => ({ ...q, [sku]: Math.max(0, (q[sku] ?? 0) + delta) }))

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row row--between row--wrap">
        <div className="stack stack--tight">
          <span className="h3">{t('orders.suggested')}</span>
          <span className="small" style={{ maxWidth: '52ch' }}>{t('orders.suggestedBody')}</span>
        </div>
        <Pill>{t('orders.lines', { n: lines.length })}</Pill>
      </div>

      <div className="sheet" style={{ padding: '2px 18px' }}>
        <div className="rows">
          {lines.map((l) => {
            const price = l.price_after ?? l.price_before ?? 0
            const n = qty[l.sku] ?? 0
            const name = product(l.name)
            return (
              <div key={l.sku} className={`row order-line${n === 0 ? ' is-zero' : ''}`} style={{ gap: 14 }} data-testid="order-line">
                <ProductIcon name={l.name} size={38} />
                <div className="stack grow" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 600 }} className="truncate">{name}</span>
                  <span className="small row" style={{ gap: 10 }}>
                    <Money kgs={price} kind="price" noAlt />
                    <span className={`c-${STATUS_TONE[l.status]}`}>{t(`status.${l.status}`)}</span>
                  </span>
                </div>
                <div className="stepper" aria-label={name}>
                  <button type="button" aria-label="−" onClick={() => change(l.sku, -1)} disabled={n === 0}>
                    <Minus size={14} />
                  </button>
                  <Ticker value={n} className="stepper__n" testId="qty" />
                  <button type="button" aria-label="+" onClick={() => change(l.sku, 1)}>
                    <Plus size={14} />
                  </button>
                </div>
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
