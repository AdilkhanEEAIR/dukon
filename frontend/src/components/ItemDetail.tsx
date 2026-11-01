// Карточка товара: было → стало, факты, предложение агента. Используется и в шторке, и на странице.

import { Gauge, Hourglass, Package, PencilLine, Tag, Wallet } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, errorCode } from '../api/client'
import type { ItemChange, Walk } from '../api/types'
import { useLatest } from '../app/data'
import { useViewShop } from '../app/shops'
import { Button } from './Button'
import { NumberInput } from './Fields'
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
  const tagPrice = change.price_after ?? change.price_before
  const price = tagPrice ?? change.price_owner ?? null

  return (
    <div className="stack" style={{ gap: 20 }} data-testid="item-detail">
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <span ref={iconBox} className="item-detail__icon">
          <ProductIcon name={change.name} size={60} empty={change.status === 'out_of_stock'} />
        </span>
        <div className="stack stack--tight" style={{ minWidth: 0 }}>
          <h2 className="h2">{product(change.name)}</h2>
          <span className="small row row--wrap" style={{ gap: 6 }}>
            <Tag size={14} />
            {tagPrice !== null ? (
              <>
                {t('item.priceTag')}: <Money kgs={tagPrice} kind="price" />
              </>
            ) : price !== null ? (
              <>
                {t('item.yourPrice')}: <Money kgs={price} kind="price" />
              </>
            ) : (
              <span className="c-ink-2">{t('item.noPriceTag')}</span>
            )}
          </span>
        </div>
      </div>

      {tagPrice === null && <OwnerPrice change={change} />}

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

/** Ценника на полке нет (так в большинстве магазинов у дома): хозяин вводит цену один раз, Dukon её помнит
 *  для этого магазина и дальше считает потери и заказы в деньгах. Ценник, если появится, главнее. */
function OwnerPrice({ change }: { change: ItemChange }) {
  const { t } = useI18n()
  const { deviceId } = useSettings()
  const shop = useViewShop()
  const { reload } = useLatest()
  const toast = useToast()
  const [editing, setEditing] = useState(change.price_owner === null || change.price_owner === undefined)
  const [value, setValue] = useState(change.price_owner ?? 0)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (value <= 0) return
    setSaving(true)
    try {
      await api.setPrice(shop.id, change.sku, value, deviceId)
      toast('success', t('item.priceSaved'))
      setEditing(false)
      // Потери и заказы пересчитываются на сервере — перечитываем отчёт.
      void reload()
    } catch (err) {
      toast('danger', t(`errors.${errorCode(err).code}.title` as never))
    } finally {
      setSaving(false)
    }
  }
  if (!editing) {
    return (
      <button type="button" className="small row c-accent link-btn" style={{ gap: 6, fontWeight: 600 }} onClick={() => setEditing(true)} data-testid="price-edit">
        <PencilLine size={14} /> {t('item.changePrice')}
      </button>
    )
  }
  return (
    <form
      className="row row--wrap"
      style={{ gap: 8, alignItems: 'flex-end' }}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      data-testid="price-form"
    >
      <label className="field" style={{ flex: '1 1 140px' }}>
        <span className="field__label">{t('item.setPrice')}</span>
        <NumberInput value={value} onChange={setValue} min={0} max={1_000_000} decimals data-testid="price-input" />
      </label>
      <Button size="sm" type="submit" loading={saving} disabled={value <= 0} data-testid="price-save">
        {t('item.savePrice')}
      </Button>
    </form>
  )
}
