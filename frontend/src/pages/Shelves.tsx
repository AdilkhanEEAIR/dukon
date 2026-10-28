// Полки: список обходов и отчёт выбранного. Товар открывается в шторке (телефон) / панели (ПК).

import { ArrowLeftRight, Package, RefreshCw, ScanLine, Wallet } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ItemChange, Status, Walk, WalkDiff } from '../api/types'
import { DEMO_SHOP_ID, useLatest } from '../app/data'
import { Button } from '../components/Button'
import { CountUp } from '../components/CountUp'
import { Drawer } from '../components/Drawer'
import { ItemDetail, countHistory } from '../components/ItemDetail'
import { ItemRow } from '../components/ItemRow'
import { StockChart } from '../components/charts/Charts'
import { PageActions } from '../components/Nav'
import { Segmented } from '../components/Segmented'
import { EmptyState, ErrorState, ReportSkeleton } from '../components/States'
import { useAsync } from '../hooks/useAsync'
import { prefersReducedMotion } from '../hooks/useCountUp'
import { useI18n } from '../i18n'
import { formatHours, formatShortDate, formatTime } from '../lib/format'
import { Money } from '../components/Money'
import { WalkCalendar } from '../components/WalkCalendar'

type Filter = 'all' | 'out_of_stock' | 'low_stock' | 'price_mismatch'

const pause = (ms: number) => new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : r()))

interface Report {
  walk: Walk
  diff: WalkDiff
  walks: Walk[]
}

export function ShelvesPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { t } = useI18n()
  const { latest, reload } = useLatest()
  const wantDemo = params.get('demo') === '1'

  // Конкретный обход грузим отдельно; «последний» берём из общего контекста, чтобы не дублировать запрос.
  const specific = useAsync<Report>(
    async () => {
      // Небольшая пауза со скелетом при смене обхода: без неё отчёт подменяется мгновенно,
      // и кажется, что нажатие на день в календаре ничего не сделало.
      const [[walk, diff]] = await Promise.all([Promise.all([api.walk(id!), api.diff(id!)]), pause(prefersReducedMotion() ? 0 : 520)])
      // История — только этого же магазина: филиалы между собой не смешиваем.
      const walks = await api.walks(walk.source, walk.shop_id ?? undefined)
      return { walk, diff, walks }
    },
    [id],
    !!id,
  )
  const demo = useAsync<Report | null>(
    async () => {
      const walks = await api.walks('demo', DEMO_SHOP_ID)
      if (!walks.length) return null
      const walk = walks[walks.length - 1]
      return { walk, diff: await api.diff(walk.id), walks }
    },
    [wantDemo],
    wantDemo && !id,
  )

  const state = id ? specific.state : wantDemo ? demo.state : latest
  const refetch = id ? specific.refetch : wantDemo ? demo.refetch : reload

  return (
    <div className="page stagger" data-testid="shelves">
      <header className="page-head">
        <div className="page-head__text">
          <span className="small">{t('shelves.title')}</span>
          <h1 className="h1">{t('shelves.report')}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={() => void refetch()} icon={<RefreshCw size={14} />} className="hide-mobile">
            {t('shelves.refresh')}
          </Button>
          <PageActions />
        </div>
      </header>

      {state.status === 'loading' || state.status === 'idle' ? (
        <ReportSkeleton />
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => void refetch()} secondary={<Button variant="secondary" to="/app">{t('common.home')}</Button>} />
      ) : state.data === null ? (
        <EmptyState icon={ScanLine} title={t('shelves.nothingToCompare')} text={t('shelves.nothingToCompareBody')} action={<Button to="/app/scan">{t('shelves.startWalk')}</Button>} />
      ) : (
        <ReportBody report={state.data} />
      )}
    </div>
  )
}

function ReportBody({ report }: { report: Report }) {
  const { t, rich, locale, product } = useI18n()
  const { walk, diff, walks } = report
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<ItemChange | null>(null)
  const close = useCallback(() => setOpen(null), [])

  const counts: Record<Filter, number> = {
    all: diff.changes.filter((c) => c.status !== 'ok').length,
    out_of_stock: diff.out_of_stock,
    low_stock: diff.low_stock,
    price_mismatch: diff.price_mismatch,
  }
  const visible = useMemo(() => (filter === 'all' ? diff.changes.filter((c) => c.status !== 'ok') : diff.changes.filter((c) => c.status === (filter as Status))), [diff, filter])
  const ok = diff.changes.filter((c) => c.status === 'ok')
  const since = diff.walk_before_id ? t('shelves.sinceLast', { t: formatHours(diff.hours_between, t) }) : t('shelves.firstWalk')

  return (
    <div className="two-col report" style={{ alignItems: 'start' }}>
      {/* Полоса «пересканирования» проходит по отчёту при каждом открытии обхода */}
      <span className="scan-sweep" aria-hidden key={walk.id} />
      <div className="stack" style={{ gap: 18 }}>
        <WalkCalendar walks={walks} current={walk} />
        <p className="small">{since}</p>

        <div className="metric-row">
          <div className="metric">
            <span className="metric__icon metric__icon--accent">
              <Package size={15} />
            </span>
            <CountUp value={diff.total_items} className="num-lg" testId="total-items" />
            <span className="metric__label">{t('shelves.counted')}</span>
          </div>
          <div className="metric">
            <span className="metric__icon">
              <ArrowLeftRight size={15} />
            </span>
            <CountUp value={diff.changed} className="num-lg" />
            <span className="metric__label">{t('shelves.changed')}</span>
          </div>
          <div className="metric">
            <span className="metric__icon metric__icon--out">
              <Wallet size={15} />
            </span>
            <Money kgs={diff.loss_per_day} className="num-lg metric__money c-out" altBlock />
            <span className="metric__label">{rich('shelves.losing')}</span>
          </div>
        </div>

        <Segmented<Filter>
          label={t('shelves.report')}
          value={filter}
          onChange={setFilter}
          items={[
            { key: 'all', label: t('common.all'), count: counts.all },
            { key: 'out_of_stock', label: t('status.short.out_of_stock'), count: counts.out_of_stock },
            { key: 'low_stock', label: t('status.short.low_stock'), count: counts.low_stock },
            { key: 'price_mismatch', label: t('status.short.price_mismatch'), count: counts.price_mismatch },
          ]}
        />

        <div className="sheet" style={{ padding: '4px 16px' }} data-testid="changes-list">
          {visible.length === 0 ? (
            <EmptyState title={t('shelves.nothingHere')} text={t('shelves.nothingHereBody')} />
          ) : (
            <div className="rows">
              {/* Смена фильтра: ушедшие строки уезжают влево, оставшиеся плавно съезжают на свои места,
                  новые въезжают каскадом (это делает общий наблюдатель появления). */}
              <AnimatePresence initial={false} mode="popLayout">
                {visible.map((c) => (
                  <motion.div key={c.sku} layout="position" initial={false} exit={{ opacity: 0, x: -18, scale: 0.98, transition: { duration: 0.22 } }} transition={{ layout: { type: 'spring', stiffness: 380, damping: 34 } }}>
                    <ItemRow change={c} onOpen={setOpen} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {ok.length > 0 && filter === 'all' && (
          <details className="sheet" style={{ padding: '0 16px' }}>
            <summary className="small" style={{ padding: '14px 0', cursor: 'pointer', listStyle: 'none', fontWeight: 600 }}>
              {t('shelves.unchanged')} · {ok.length}
            </summary>
            <div className="rows" style={{ paddingBottom: 6 }}>
              {ok.map((c) => (
                <ItemRow key={c.sku} change={c} onOpen={setOpen} />
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="stack" style={{ gap: 14 }}>
        <div className="sheet sheet--pad stack lift" style={{ gap: 12 }}>
          <span className="h3">
            {formatShortDate(walk.created_at, locale)} · {formatTime(walk.created_at, locale)}
          </span>
          <div className="rows">
            <div className="kv"><span className="kv__k">{t('common.photos', { n: walk.photos.length })}</span><span className="kv__v">{walk.photos.reduce((a, p) => a + p.model_calls, 0) > 0 ? `${walk.photos.reduce((a, p) => a + p.model_calls, 0)} × AI` : t('mode.demo')}</span></div>
            <div className="kv"><span className="kv__k row" style={{ gap: 8 }}><span className="swatch" style={{ background: 'var(--out)' }} />{t('status.out_of_stock')}</span><span className="kv__v">{diff.out_of_stock}</span></div>
            <div className="kv"><span className="kv__k row" style={{ gap: 8 }}><span className="swatch" style={{ background: 'var(--low)' }} />{t('status.low_stock')}</span><span className="kv__v">{diff.low_stock}</span></div>
            <div className="kv"><span className="kv__k row" style={{ gap: 8 }}><span className="swatch" style={{ background: 'var(--price)' }} />{t('status.price_mismatch')}</span><span className="kv__v">{diff.price_mismatch}</span></div>
            <div className="kv"><span className="kv__k row" style={{ gap: 8 }}><span className="swatch" style={{ background: 'var(--ok)' }} />{t('status.ok')}</span><span className="kv__v">{diff.changes.filter((c) => c.status === 'ok').length}</span></div>
          </div>
          <StatusBars diff={diff} />
        </div>
        <Button variant="secondary" block to="/app/orders" icon={<Package size={18} />}>
          {t('shelves.seeOrders')}
        </Button>
        <StockChart changes={diff.changes} />
      </div>

      <Drawer open={open !== null} onClose={close} label={open ? product(open.name) : ''}>
        {open && <ItemDetail change={open} history={countHistory(walks, open.sku)} />}
      </Drawer>
    </div>
  )
}

/** Доли статусов одной полоской: сколько позиций в порядке, сколько требуют внимания. */
function StatusBars({ diff }: { diff: WalkDiff }) {
  const total = Math.max(1, diff.changes.length)
  const parts: { key: Status; n: number; color: string }[] = [
    { key: 'out_of_stock', n: diff.out_of_stock, color: 'var(--out)' },
    { key: 'low_stock', n: diff.low_stock, color: 'var(--low)' },
    { key: 'price_mismatch', n: diff.price_mismatch, color: 'var(--price)' },
    { key: 'ok', n: diff.changes.filter((c) => c.status === 'ok').length, color: 'var(--ok)' },
  ]
  return (
    <div className="bar" style={{ display: 'flex', gap: 2, background: 'transparent' }} aria-hidden>
      {parts.map((p) => (p.n > 0 ? <span key={p.key} style={{ width: `${(p.n / total) * 100}%`, background: p.color, borderRadius: 3 }} /> : null))}
    </div>
  )
}
