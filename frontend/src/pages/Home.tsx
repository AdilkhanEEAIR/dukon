// Главная: ценник потерь, метрики с иконками, график «было → стало», что требует внимания, обходы.
// Движение — один раз при открытии (каскад, набегание чисел, качнувшийся ценник); дальше всё спокойно.

import { ArrowRight, Building2, ChevronRight, Package, PackageX, ScanLine, Sparkles, TrendingDown } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLatest, type Latest } from '../app/data'
import { useShops } from '../app/shops'
import { Button } from '../components/Button'
import { StockChart } from '../components/charts/Charts'
import { CountUp } from '../components/CountUp'
import { ItemRow } from '../components/ItemRow'
import { ModePill, PageActions, ShopSwitcher } from '../components/Nav'
import { Pill } from '../components/Pill'
import { LossTag } from '../components/PriceTag'
import { EmptyState, ErrorState, ReportSkeleton } from '../components/States'
import { useI18n } from '../i18n'
import { capitalize, formatDate, formatShortDate, formatTime } from '../lib/format'

export function HomePage() {
  const { t, locale } = useI18n()
  const { current } = useShops()
  const { latest, reload } = useLatest()
  const [today] = useState(() => new Date())

  return (
    <div className="page stagger" data-testid="home">
      <header className="page-head">
        <div className="page-head__text">
          <span className="small">{capitalize(formatDate(today, locale))}</span>
          <div className="hide-desktop">
            <ShopSwitcher variant="title" />
          </div>
          <h1 className="h1 hide-mobile" data-testid="shop-name">
            {current?.name ?? t('common.appName')}
          </h1>
        </div>
        <PageActions />
      </header>

      {latest.status === 'loading' || latest.status === 'idle' ? (
        <ReportSkeleton />
      ) : latest.status === 'error' ? (
        <ErrorState error={latest.error} onRetry={reload} />
      ) : latest.data === null ? (
        <EmptyState icon={ScanLine} title={t('home.noWalks')} text={t('home.noWalksBody')} action={<Button to="/app/scan">{t('home.firstWalk')}</Button>} />
      ) : (
        <HomeContent data={latest.data} />
      )}
    </div>
  )
}

function HomeContent({ data }: { data: Latest }) {
  const { t, rich, locale } = useI18n()
  const { shops } = useShops()
  const { walk, diff, walks } = data
  const attention = diff.changes.filter((c) => c.status !== 'ok' && c.status !== 'new_item').slice(0, 6)

  return (
    <div className="two-col home-cols">
      <div className="stack stagger" style={{ gap: 22 }}>
        <div className="row row--wrap" style={{ gap: 8 }}>
          <Pill tone={walk.source === 'demo' ? 'neutral' : 'ok'}>{walk.source === 'demo' ? t('home.demoBadge') : t('home.liveBadge')}</Pill>
          <span className="small">
            {capitalize(formatShortDate(walk.created_at, locale))} · {formatTime(walk.created_at, locale)}
          </span>
          <span className="grow" />
          <ModePill compact />
        </div>

        <LossTag valueKgs={diff.loss_per_day} label={rich('home.lossTitle')} unit={`${t('common.perDay')} · ${t('home.lossBody', { out: diff.out_of_stock, slots: diff.empty_slots })}`} />

        <div className="metric-row">
          <div className="metric">
            <span className="metric__icon metric__icon--accent">
              <Package size={15} />
            </span>
            <CountUp value={diff.total_items} className="num-lg" testId="total-items" />
            <span className="metric__label">{t('home.onShelves')}</span>
          </div>
          <div className="metric">
            <span className="metric__icon metric__icon--out">
              <PackageX size={15} />
            </span>
            <CountUp value={diff.out_of_stock} className="num-lg c-out" />
            <span className="metric__label">{t('home.out')}</span>
          </div>
          <div className="metric">
            <span className="metric__icon metric__icon--low">
              <TrendingDown size={15} />
            </span>
            <CountUp value={diff.low_stock} className="num-lg c-low" />
            <span className="metric__label">{t('home.low')}</span>
          </div>
        </div>
        <p className="small">{t('home.changed', { n: diff.changed })}</p>

        <div className="row row--wrap home-actions" style={{ gap: 10 }}>
          <Button to="/app/scan" size="lg" icon={<ScanLine size={18} />}>
            {t('home.newWalk')}
          </Button>
          <Button to="/app/shelves" size="lg" variant="secondary" className="nudge" icon={<ArrowRight size={18} />}>
            {t('home.fullReport')}
          </Button>
        </div>

        <div className="home-chart">
          <StockChart changes={diff.changes} />
        </div>
      </div>

      <div className="stack stagger" style={{ gap: 14 }}>
        <div className="section__head">
          <h2 className="h2">{t('home.attention')}</h2>
          <Link to="/app/shelves" className="small c-accent nudge" style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            {t('home.fullReport')}
            <ChevronRight size={14} />
          </Link>
        </div>
        <div className="sheet" style={{ padding: '4px 16px' }}>
          {attention.length === 0 ? (
            <EmptyState title={t('home.allGood')} text={t('home.allGoodBody')} />
          ) : (
            <div className="rows">
              {attention.map((c) => (
                <ItemRow key={c.sku} change={c} />
              ))}
            </div>
          )}
        </div>

        <Link to="/app/orders" className="sheet sheet--soft row lift nudge" style={{ padding: 16 }} data-testid="orders-link">
          <span className="metric__icon metric__icon--accent" style={{ margin: 0, width: 38, height: 38, borderRadius: 12 }}>
            <Sparkles size={18} />
          </span>
          <span className="stack grow" style={{ gap: 1 }}>
            <span style={{ fontWeight: 700 }}>{t('home.ordersReady')}</span>
            <span className="small">{t('home.ordersReadyBody')}</span>
          </span>
          <ChevronRight size={18} className="c-3" />
        </Link>

        <Link to="/app/branches" className="sheet row lift nudge" style={{ padding: 16 }} data-testid="branches-link">
          <span className="metric__icon" style={{ margin: 0, width: 38, height: 38, borderRadius: 12 }}>
            <Building2 size={18} />
          </span>
          <span className="stack grow" style={{ gap: 1 }}>
            <span style={{ fontWeight: 700 }}>{t('branches.title')}</span>
            <span className="small">{t('shops.count', { n: shops.length })} · {t('branches.subtitle')}</span>
          </span>
          <ChevronRight size={18} className="c-3" />
        </Link>

        <section className="section">
          <div className="section__head">
            <h2 className="h3">{t('shelves.walks')}</h2>
            <span className="small">{walks.length}</span>
          </div>
          <div className="sheet" style={{ padding: '2px 16px' }}>
            <div className="rows">
              {[...walks]
                .reverse()
                .slice(0, 4)
                .map((w) => {
                  const items = w.photos.flatMap((p) => p.shelves).flatMap((s) => s.items).reduce((a, i) => a + i.count, 0)
                  return (
                    <Link key={w.id} to={`/app/shelves/${w.id}`} className="walk-row nudge" data-testid="walk-row">
                      <span className="stack" style={{ gap: 2 }}>
                        <span style={{ fontWeight: 600 }}>
                          {capitalize(formatShortDate(w.created_at, locale))} · {formatTime(w.created_at, locale)}
                        </span>
                        <span className="walk-row__meta">
                          {t('common.photos', { n: w.photos.length })} · {t('common.items', { n: items })}
                        </span>
                      </span>
                      <ChevronRight size={18} className="c-3" />
                    </Link>
                  )
                })}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
