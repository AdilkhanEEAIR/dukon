// Полки: список обходов и отчёт выбранного. Товар открывается в шторке (телефон) / панели (ПК).

import { ArrowLeftRight, Images, Package, RefreshCw, ScanLine, Wallet } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ItemChange, Status, Walk, WalkDiff } from '../api/types'
import { useLatest } from '../app/data'
import { Button } from '../components/Button'
import { CountUp } from '../components/CountUp'
import { Drawer } from '../components/Drawer'
import { ItemDetail, countHistory } from '../components/ItemDetail'
import { ItemRow } from '../components/ItemRow'
import { StockChart } from '../components/charts/Charts'
import { Donut, type DonutSlice } from '../components/charts/Donut'
import { useChartColors } from '../components/charts/theme'
import { PageActions } from '../components/Nav'
import { Segmented } from '../components/Segmented'
import { EmptyState, ErrorState, Notice, ReportSkeleton } from '../components/States'
import { ExportMenu } from '../components/ExportMenu'
import { reportTable } from '../lib/export'
import { useAsync } from '../hooks/useAsync'
import { prefersReducedMotion } from '../hooks/useCountUp'
import { useI18n } from '../i18n'
import { formatHours, formatWhen } from '../lib/format'
import { Money } from '../components/Money'
import { WalkCalendar } from '../components/WalkCalendar'

type Filter = 'all' | 'out_of_stock' | 'low_stock' | 'price_mismatch' | 'ok'

const pause = (ms: number) => new Promise<void>((r) => (ms > 0 ? setTimeout(r, ms) : r()))

interface Report {
  walk: Walk
  diff: WalkDiff
  walks: Walk[]
}

export function ShelvesPage() {
  const { id } = useParams()
  const { t } = useI18n()
  const { latest, reload } = useLatest()

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
  // Без id — последний обход магазина на экране: в живом режиме свой, в демо — демо-филиала.
  const state = id ? specific.state : latest
  const refetch = id ? specific.refetch : reload
  const report = state.status === 'success' ? state.data : null

  return (
    <div className="page stagger" data-testid="shelves">
      <header className="page-head">
        <div className="page-head__text">
          <h1 className="h1">{t('shelves.report')}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={() => void refetch()} icon={<RefreshCw size={14} />} className="hide-mobile">
            {t('shelves.refresh')}
          </Button>
          {report && (
            <Button variant="secondary" size="sm" to={`/app/shelves/${report.walk.id}/seen`} icon={<Images size={14} />} data-testid="to-seen">
              {t('shelves.seen')}
            </Button>
          )}
          {report && <ExportMenu build={(ctx) => reportTable(report, ctx)} testId="export-report" />}
          <PageActions />
        </div>
      </header>

      {state.status === 'loading' || state.status === 'idle' ? (
        <ReportSkeleton />
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => void refetch()} secondary={<Button variant="secondary" to="/app">{t('common.home')}</Button>} />
      ) : state.data === null ? (
        <EmptyState icon={ScanLine} title={t('shelves.nothingToCompare')} text={t('shelves.nothingToCompareBody')} action={<Button to="/app/scan">{t('shelves.startWalk')}</Button>} />
      ) : state.data.walk.photos.every((p) => p.shelves.every((s) => s.items.length === 0)) ? (
        // Честное «ничего не распознано»: раньше тут было «всё в порядке», хотя модель просто не нашла товаров.
        <EmptyState icon={ScanLine} title={t('shelves.nothingRecognized')} text={t('shelves.nothingRecognizedBody')} action={<Button to="/app/scan">{t('shelves.startWalk')}</Button>} tone="out" />
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

  const colors = useChartColors()
  const okCount = diff.changes.filter((c) => c.status === 'ok').length
  const counts: Record<Filter, number> = {
    all: diff.changes.filter((c) => c.status !== 'ok').length,
    out_of_stock: diff.out_of_stock,
    low_stock: diff.low_stock,
    price_mismatch: diff.price_mismatch,
    ok: okCount,
  }
  // Кольцо статусов: клик по сектору — тот же фильтр, что и вкладки над списком.
  const slices = useMemo<DonutSlice[]>(
    () =>
      (
        [
          ['out_of_stock', colors.out],
          ['low_stock', colors.low],
          ['price_mismatch', colors.price],
          ['ok', colors.ok],
        ] as const
      ).map(([key, color]) => ({ id: key, name: t(`status.${key}`), value: counts[key], color })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diff, colors, t],
  )
  const visible = useMemo(() => (filter === 'all' ? diff.changes.filter((c) => c.status !== 'ok') : diff.changes.filter((c) => c.status === (filter as Status))), [diff, filter])
  const pickSlice = useCallback((id: string | null) => setFilter((id as Filter | null) ?? 'all'), [])
  const ok = diff.changes.filter((c) => c.status === 'ok')
  const since = diff.walk_before_id ? t('shelves.sinceLast', { t: formatHours(diff.hours_between, t) }) : t('shelves.firstWalk')
  // Сколько раз обход действительно звал модели: 0 у демо и у живого обхода, целиком взятого из кэша.
  const modelCalls = walk.photos.reduce((a, p) => a + p.model_calls, 0)

  return (
    <div className="two-col report" style={{ alignItems: 'start' }}>
      {/* Полоса «пересканирования» проходит по отчёту при каждом открытии обхода */}
      <span className="scan-sweep" aria-hidden key={walk.id} />
      <div className="stack" style={{ gap: 18 }}>
        <WalkCalendar walks={walks} current={walk} />
        <p className="small">{since}</p>
        {diff.walk_before_id === null && (
          <Notice tone="ok" title={t('shelves.firstWalkTitle')} text={t('shelves.firstWalkBody')} action={<Button size="sm" variant="secondary" to={`/app/shelves/${walk.id}/seen`}>{t('shelves.seen')}</Button>} />
        )}

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
            {diff.too_soon && (
              <span className="small" data-testid="too-soon">
                {t('shelves.tooSoon', { t: formatHours(diff.hours_between, t) })}
              </span>
            )}
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
              {t('shelves.unchanged')} <span className="count-chip">{ok.length}</span>
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
            {formatWhen(walk.created_at, locale)}
          </span>
          <div className="kv" style={{ padding: 0 }}>
            <span className="kv__k">{t('common.photos', { n: walk.photos.length })}</span>
            <span className="kv__v">{modelCalls > 0 ? `${modelCalls} × AI` : walk.source === 'demo' ? t('mode.demo') : t('shelves.cached')}</span>
          </div>
          <Donut
            slices={slices}
            total={<CountUp value={diff.changes.length} />}
            caption={t('shelves.positions', { n: diff.changes.length })}
            selected={filter === 'all' ? null : filter}
            onSelect={pickSlice}
            label={t('shelves.statusShare')}
            testId="status-donut"
          />
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
