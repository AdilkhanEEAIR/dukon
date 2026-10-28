// Карточка товара: было → стало, факты, предложение агента. Используется и в шторке, и на странице.

import { Gauge, Hourglass, Package, Tag, Wallet } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ItemChange, Walk } from '../api/types'
import { Button } from './Button'
import { ForecastChart, type Point } from './charts/Charts'
import { CountUp } from './CountUp'
import { Pill, STATUS_TONE } from './Pill'
import { ProductIcon } from './ProductIcon'
import { useToast } from './Toast'
import { useI18n } from '../i18n'
import { formatDays, formatNumber } from '../lib/format'
import { Money } from './Money'
import { reasonOf } from '../lib/reason'
import { flyToOrders } from '../lib/fly'
import { useSettings } from '../app/settings'

/** Количество товара в каждом обходе — точки графика «остаток и прогноз». */
export function countHistory(walks: Walk[], sku: string): Point[] {
  return walks.map((w) => ({
    at: w.created_at,
    count: w.photos.flatMap((p) => p.shelves).flatMap((s) => s.items).filter((i) => i.sku === sku).reduce((a, i) => a + i.count, 0),
  }))
}

export function ItemDetail({ change, history }: { change: ItemChange; history?: Point[] }) {
  const { t, rich, locale, product } = useI18n()
  const { settings } = useSettings()
  const toast = useToast()
  const [added, setAdded] = useState(false)
  const iconBox = useRef<HTMLSpanElement>(null)
  const tone = STATUS_TONE[change.status]
  const max = Math.max(change.before ?? 0, change.after, 1)
  const price = change.price_after ?? change.price_before

  return (
    <div className="stack" style={{ gap: 20 }} data-testid="item-detail">
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <span ref={iconBox} className="item-detail__icon">
          <ProductIcon name={change.name} size={60} empty={change.status === 'out_of_stock'} />
        </span>
        <div className="stack stack--tight" style={{ minWidth: 0 }}>
          <h2 className="h2">{product(change.name)}</h2>
          <span className="small row" style={{ gap: 6 }}>
            <Tag size={14} />
            {t('item.priceTag')}: <Money kgs={price} kind="price" />
          </span>
        </div>
      </div>

      <div className="sheet sheet--soft sheet--pad stack" style={{ gap: 14 }}>
        <div className="row row--between" style={{ alignItems: 'flex-end' }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="small">{t('item.previous')}</span>
            <span className="num-lg c-3">{change.before ?? '—'}</span>
          </div>
          <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
            <span className="small">{t('item.now')}</span>
            <CountUp value={change.after} className={`num-xl c-${tone}`} testId="after-count" />
          </div>
        </div>
        <div className="bar">
          <div className={`bar__fill${change.status === 'out_of_stock' ? ' bar__fill--out' : ''}`} style={{ width: `${(change.after / max) * 100}%` }} />
        </div>
        <div className="row row--wrap">
          <Pill tone={tone}>{t(`status.${change.status}`)}</Pill>
          <span className="small">{reasonOf(change, t, locale, settings.currency)}</span>
        </div>
      </div>

      {history && history.length > 0 && (
        <ForecastChart
          history={history}
          change={change}
          caption={
            change.after <= 0
              ? t('charts.alreadyOut')
              : change.velocity_per_day > 0
                ? t('charts.runsOut', { t: formatDays(change.after / change.velocity_per_day, t) })
                : t('charts.noForecast')
          }
        />
      )}

      <div className="sheet" style={{ padding: '2px 18px' }}>
        <div className="rows">
          <div className="kv">
            <span className="kv__k row" style={{ gap: 8 }}><Package size={15} className="c-3" />{t('item.sold')}</span>
            <span className="kv__v">
              {change.sold} {t('item.pcs')}
            </span>
          </div>
          <div className="kv">
            <span className="kv__k row" style={{ gap: 8 }}><Gauge size={15} className="c-3" />{t('item.velocity')}</span>
            <span className="kv__v">{t('item.velocityUnit', { n: formatNumber(change.velocity_per_day, locale, 1) })}</span>
          </div>
          <div className="kv">
            <span className="kv__k row" style={{ gap: 8 }}><Hourglass size={15} className="c-3" />{t('item.lasts')}</span>
            <span className="kv__v">{change.days_left === null ? '—' : change.days_left <= 0 ? t('charts.alreadyOut') : formatDays(change.days_left, t)}</span>
          </div>
          <div className="kv">
            <span className="kv__k row" style={{ gap: 8 }}><Wallet size={15} className="c-3" />{rich('item.loss')}</span>
            <Money kgs={change.loss_per_day} className={`kv__v${change.loss_per_day > 0 ? ' c-out' : ''}`} />
          </div>
        </div>
      </div>

      {change.suggested_order > 0 && (
        <div className="sheet sheet--pad stack" style={{ gap: 12, background: 'var(--accent-soft)', borderColor: 'transparent', color: 'var(--accent-soft-ink)' }}>
          <span className="small" style={{ color: 'inherit', opacity: 0.8 }}>{t('item.agentSuggests')}</span>
          <span className="h2">{t('item.order', { n: change.suggested_order })}</span>
          <span style={{ opacity: 0.85 }}>{t('item.orderBody')}</span>
          <Button
            variant={added ? 'secondary' : 'primary'}
            icon={<Package size={18} />}
            onClick={(e) => {
              setAdded(true)
              // Иконка товара улетает к «Заказам» — видно, куда ушло добавленное.
              flyToOrders(iconBox.current?.querySelector('.pi') ?? null, e.currentTarget)
              toast('success', t('item.addedToDraft'), product(change.name))
            }}
            disabled={added}
            data-testid="to-draft"
          >
            {added ? t('item.addedToDraft') : t('item.toDraft')}
          </Button>
        </div>
      )}
    </div>
  )
}
