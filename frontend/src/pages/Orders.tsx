// Черновики заказов: пока без сервера — строки из рекомендаций последнего обхода, со степпером количества.
// Группировка по поставщикам и утверждение приходят в заходе 3.

import { Minus, Package, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ItemChange } from '../api/types'
import { useLatest } from '../app/data'
import { useSettings } from '../app/settings'
import { Button } from '../components/Button'
import { PageActions } from '../components/Nav'
import { Pill } from '../components/Pill'
import { EmptyState, ErrorState, ReportSkeleton } from '../components/States'
import { useI18n } from '../i18n'
import { formatMoney, formatPrice } from '../lib/format'
import { ProductIcon } from '../components/ProductIcon'

export function OrdersPage() {
  const { t } = useI18n()
  const { latest, reload } = useLatest()

  return (
    <div className="page stagger" style={{ maxWidth: 760 }} data-testid="orders">
      <header className="page-head">
        <div className="page-head__text">
          <span className="small">{t('orders.subtitle')}</span>
          <h1 className="h1">{t('orders.title')}</h1>
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
  const { t, locale } = useI18n()
  const { settings } = useSettings()
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.sku, l.suggested_order])))
  const total = useMemo(() => lines.reduce((sum, l) => sum + (qty[l.sku] ?? 0) * (l.price_after ?? l.price_before ?? 0), 0), [lines, qty])

  if (lines.length === 0) {
    return <EmptyState icon={Package} title={t('orders.empty')} text={t('orders.emptyBody')} action={<Button variant="secondary" to="/app/shelves">{t('orders.toReport')}</Button>} />
  }

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
            return (
              <div key={l.sku} className="row order-line" style={{ padding: '12px 0', gap: 14 }} data-testid="order-line">
                <ProductIcon name={l.name} size={38} />
                <div className="stack grow" style={{ gap: 2 }}>
                  <span style={{ fontWeight: 600 }} className="truncate">{l.name}</span>
                  <span className="small">
                    {formatPrice(price, locale, settings.currency)} · {t(`status.${l.status}`)}
                  </span>
                </div>
                <div className="stepper" aria-label={l.name}>
                  <button type="button" aria-label="−" onClick={() => setQty((q) => ({ ...q, [l.sku]: Math.max(0, n - 1) }))}>
                    <Minus size={14} />
                  </button>
                  <span className="stepper__n" data-testid="qty">{n}</span>
                  <button type="button" aria-label="+" onClick={() => setQty((q) => ({ ...q, [l.sku]: n + 1 }))}>
                    <Plus size={14} />
                  </button>
                </div>
                <span className="num-md" style={{ minWidth: 86, textAlign: 'right' }}>
                  {formatMoney(n * price, locale, settings.currency)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="row row--between" style={{ padding: '0 4px' }}>
        <span className="h3">{t('orders.total')}</span>
        <span className="num-lg" data-testid="order-total">{formatMoney(total, locale, settings.currency)}</span>
      </div>
      <Button size="lg" block disabled icon={<Package size={18} />}>
        {t('orders.approveSoon')}
      </Button>
    </div>
  )
}
