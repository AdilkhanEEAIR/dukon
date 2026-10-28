// Филиалы: ответ на вопрос «у меня два магазина и больше — где я теряю». Сводка по каждой точке,
// график потерь по филиалам и быстрый переход. Живой режим — только свои магазины, демо — демо-сеть.

import { Building2, CheckCircle2, ChevronRight, Clock, MapPin, MapPinned, Plus } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { BranchSummary } from '../api/types'
import { useMode } from '../app/mode'
import { useSettings } from '../app/settings'
import { useShops } from '../app/shops'
import { Button, IconButton } from '../components/Button'
import { BranchesChart } from '../components/charts/Charts'
import { Donut, type DonutSlice } from '../components/charts/Donut'
import { useChartColors } from '../components/charts/theme'
import { PageActions } from '../components/Nav'
import { Pill } from '../components/Pill'
import { ErrorState, ReportSkeleton } from '../components/States'
import { ExportMenu } from '../components/ExportMenu'
import { branchesTable } from '../lib/export'
import { BranchesMap, type MapPin as MapPinData } from '../components/map/GeoMap'
import { hasPoint } from '../lib/geo'
import { useAsync } from '../hooks/useAsync'
import { useI18n } from '../i18n'
import { formatMoney, formatWhen } from '../lib/format'
import { Money } from '../components/Money'

interface Overview {
  rows: BranchSummary[]
  demo: boolean
}

export function BranchesPage() {
  const { t } = useI18n()
  const { deviceId } = useSettings()
  const { mode } = useMode()
  const { state, refetch } = useAsync<Overview>(async () => {
    if (mode === 'demo') return { rows: await api.overview('demo'), demo: true }
    return { rows: await api.overview('mine', deviceId), demo: false }
  }, [deviceId, mode])

  return (
    <div className="page stagger" data-testid="branches">
      <header className="page-head">
        <div className="page-head__text">
          <h1 className="h1">{t('branches.title')}</h1>
          <p className="page-head__sub">{t('branches.subtitle')}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {mode === 'live' && (
            <Button size="sm" variant="secondary" to="/app/settings#shops" icon={<Plus size={14} />} className="hide-mobile">
              {t('shops.add')}
            </Button>
          )}
          {state.status === 'success' && <ExportMenu build={(ctx) => branchesTable(state.data.rows, ctx)} testId="export-branches" />}
          <PageActions />
        </div>
      </header>

      {state.status === 'loading' || state.status === 'idle' ? (
        <ReportSkeleton />
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={refetch} />
      ) : (
        <BranchesBody overview={state.data} />
      )}
    </div>
  )
}

function BranchesBody({ overview }: { overview: Overview }) {
  const { t, rich, locale } = useI18n()
  const { settings } = useSettings()
  const { current, select } = useShops()
  const navigate = useNavigate()
  const { rows, demo } = overview
  const fmt = useCallback((v: number) => formatMoney(v, locale, settings.currency), [locale, settings.currency])
  const usd = useCallback((v: number) => formatMoney(v, locale, 'USD'), [locale])
  const total = rows.reduce((a, r) => a + r.loss_per_day, 0)
  const worst = [...rows].sort((a, b) => b.loss_per_day - a.loss_per_day)[0]
  const [focus, setFocus] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const colors = useChartColors()

  // Кольцо «где уходят деньги»: только филиалы с потерями, самый дорогой — самым тёмным красным.
  const share = useMemo<DonutSlice[]>(
    () =>
      [...rows]
        .filter((r) => r.loss_per_day > 0)
        .sort((a, b) => b.loss_per_day - a.loss_per_day)
        .map((r, i) => ({ id: r.shop.id, name: r.shop.name, value: r.loss_per_day, color: colors.lossRamp[Math.min(i, colors.lossRamp.length - 2)], display: fmt(r.loss_per_day) })),
    [rows, colors, fmt],
  )

  // Булавки: бирка «название — потери в день». Без потерь — спокойный тон, с потерями — красный.
  const pins = useMemo<MapPinData[]>(
    () =>
      rows
        .filter((r) => hasPoint(r.shop))
        .map((r) => ({
          id: r.shop.id,
          point: { lat: r.shop.lat as number, lng: r.shop.lng as number },
          title: r.shop.name,
          caption: r.walks > 0 ? `${fmt(r.loss_per_day)} ${t('common.perDay')}` : t('branches.noWalks'),
          tone: r.loss_per_day > 0 ? 'out' : 'ok',
        })),
    [rows, fmt, t],
  )

  // Нажали на булавку или сектор кольца — строка филиала подсвечивается и приезжает в поле зрения.
  const focusFromMap = useCallback((id: string) => {
    setFocus(id)
    const row = list.current?.querySelector<HTMLElement>(`[data-shop="${id}"]`)
    row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [setFocus])
  const focusFromDonut = useCallback((id: string | null) => (id ? focusFromMap(id) : setFocus(null)), [focusFromMap, setFocus])

  return (
    <div className="stack stagger" style={{ gap: 22 }}>
      {demo && (
        <p className="demo-line" role="status">
          <span className="demo-line__tag">{t('mode.demo')}</span>
          {t('branches.demoNotice')}
        </p>
      )}

      {pins.length > 0 ? (
        <BranchesMap pins={pins} focus={focus} onFocus={focusFromMap} />
      ) : (
        <div className="map-empty sheet sheet--pad" data-testid="map-empty">
          <span className="map-empty__icon" aria-hidden>
            <MapPinned size={22} />
          </span>
          <div className="stack stack--tight grow">
            <span className="h3">{t('map.noPoints')}</span>
            <span className="body-2">{t('map.noPointsBody')}</span>
          </div>
          <Button variant="secondary" to="/app/settings#shops" icon={<MapPin size={16} />}>
            {t('map.toSettings')}
          </Button>
        </div>
      )}

      <div className="two-col" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 18 }}>
          <div className="branch-total">
            <span className="loss-label" data-testid="branches-total-label">{rich('branches.total')}</span>
            <Money kgs={total} className="num-xl c-out" altBlock testId="branches-total" />
            <span className="small">{t('common.perDay')}</span>
            <span className="small">
              ≈ {fmt(total * 30)} {t('common.perMonth')}
            </span>
            {worst && worst.loss_per_day > 0 && (
              <span className="body-2" data-testid="branches-worst">
                {rich('branches.worst', { name: worst.shop.name })}
              </span>
            )}
          </div>
          {share.length > 0 && (
            <section className="sheet sheet--pad stack" style={{ gap: 14 }} data-testid="branches-share">
              <h3 className="h3">{rich('branches.shareTitle')}</h3>
              <Donut slices={share} total={fmt(total)} caption={t('common.perDay')} selected={focus} onSelect={focusFromDonut} label={t('branches.shareTitle')} testId="branches-donut" />
            </section>
          )}
          <BranchesChart rows={rows.map((r) => ({ id: r.shop.id, name: r.shop.name, value: r.loss_per_day }))} format={fmt} alt={settings.currency === 'KGS' ? usd : undefined} />
        </div>

        <div className="sheet" style={{ padding: '2px 18px' }}>
          <div className="rows" data-testid="branch-list" ref={list}>
            {rows.map((r) => {
              const isCurrent = !demo && current?.id === r.shop.id
              const onMap = hasPoint(r.shop)
              return (
                <div key={r.shop.id} data-shop={r.shop.id} className={`branch-row${isCurrent ? ' is-current' : ''}${focus === r.shop.id ? ' is-focus' : ''}`} data-testid="branch-row">
                  <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                    <span className="row" style={{ gap: 8 }}>
                      <Building2 size={16} className="c-3" />
                      <span className="branch-row__name truncate" style={{ fontWeight: 700 }}>
                        {r.shop.name}
                      </span>
                      {isCurrent && <Pill tone="accent" icon={<CheckCircle2 size={13} />}>{t('nav.home')}</Pill>}
                    </span>
                    <span className="small row" style={{ gap: 6 }}>
                      <MapPin size={13} />
                      <span className="truncate">{r.shop.address || t('shops.noAddress')}</span>
                    </span>
                    {r.walks > 0 ? (
                      <span className="branch-row__stats">
                        <span>
                          <Money kgs={r.loss_per_day} className={r.loss_per_day > 0 ? 'branch-loss c-out' : 'branch-loss'} /> {t('common.perDay')}
                        </span>
                        <span>
                          <b>{r.out_of_stock}</b> {t('branches.out')}
                        </span>
                        <span>
                          <b>{r.low_stock}</b> {t('branches.low')}
                        </span>
                        <span className="row" style={{ gap: 4 }}>
                          <Clock size={12} />
                          {r.last_walk_at ? formatWhen(r.last_walk_at, locale) : ''}
                        </span>
                      </span>
                    ) : (
                      <span className="small">{t('branches.noWalks')}</span>
                    )}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {!demo && !isCurrent && (
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => {
                          select(r.shop.id)
                          navigate('/app')
                        }}
                      >
                        {t('branches.makeCurrent')}
                      </Button>
                    )}
                    {onMap && (
                      <IconButton label={`${t('map.showOnMap')}: ${r.shop.name}`} onClick={() => setFocus(r.shop.id)} data-testid="focus-on-map">
                        <MapPinned size={17} />
                      </IconButton>
                    )}
                    {r.last_walk_id && (
                      <Link to={`/app/shelves/${r.last_walk_id}`} className="icon-btn icon-btn--outline nudge" aria-label={`${t('branches.open')}: ${r.shop.name}`}>
                        <ChevronRight size={18} />
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
