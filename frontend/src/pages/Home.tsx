// Главная: последний обход, потери в сомах, что требует внимания. Данные — demo, пока нет живых.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { loadLatest } from '../api/latest'
import type { ItemChange, Walk, WalkDiff } from '../api/types'
import { Button } from '../components/Button'
import { STATUS_COLOR, STATUS_META } from '../components/Chip'
import { Icon } from '../components/Icon'
import { EmptyState, ErrorState, ReportSkeleton } from '../components/States'
import { useAsync } from '../hooks/useAsync'
import { formatSom, formatWhen } from '../lib/format'

export function HomePage() {
  const navigate = useNavigate()
  const { state, refetch } = useAsync(loadLatest, [])
  const [today] = useState(() => formatWhen(new Date()))

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__text">
          <span className="label">{today}</span>
          <h1 className="h1" style={{ margin: 0 }}>
            Dukon
          </h1>
        </div>
        <button className="icon-btn" aria-label="Уведомления">
          <Icon name="bell" size={18} />
        </button>
      </header>

      {state.status === 'loading' || state.status === 'idle' ? (
        <ReportSkeleton />
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={refetch} />
      ) : state.data === null ? (
        <EmptyState
          icon="scan"
          title="Обходов пока нет"
          text="Пройдите вдоль полок с телефоном — Dukon посчитает товар и покажет, чего не хватает."
          action={<Button onClick={() => navigate('/scan')}>Первый обход</Button>}
        />
      ) : (
        <HomeContent walk={state.data.walk} diff={state.data.diff} />
      )}
    </div>
  )
}

function HomeContent({ walk, diff }: { walk: Walk; diff: WalkDiff }) {
  const navigate = useNavigate()
  const attention = diff.changes.filter((c) => c.status !== 'ok' && c.status !== 'new_item').slice(0, 6)
  return (
    <div className="bento">
      <div className="stack">
        <section className="card card--elevated stack" style={{ gap: 14 }}>
          <div className="row row--between">
            <span className="caption">{walk.label || 'Последний обход'}</span>
            <span className={`chip ${walk.source === 'demo' ? 'chip--violet' : 'chip--success'}`}>
              {walk.source === 'demo' ? 'Демо' : 'Живой обход'}
            </span>
          </div>
          <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
            <span className="num-xl" data-testid="total-items">
              {diff.total_items}
            </span>
            <div className="stack" style={{ gap: 0, paddingBottom: 8 }}>
              <span className="muted">товаров на полках</span>
              <span className="caption c-accent">{diff.changed} изменений с прошлого обхода</span>
            </div>
          </div>
          <div className="row" style={{ gap: 18 }}>
            <Stat n={diff.out_of_stock} label="нет" color="var(--danger)" />
            <Stat n={diff.low_stock} label="мало" color="var(--warning)" />
            <Stat n={diff.price_mismatch} label="ценник" color="var(--info)" />
          </div>
          <Button block onClick={() => navigate('/scan')} icon={<Icon name="scan" size={18} />}>
            Новый обход
          </Button>
        </section>

        <section className="loss" data-testid="loss-card">
          <span className="label">Теряете на пустых полках</span>
          <span className="loss__value">{formatSom(diff.loss_per_day)}</span>
          <span className="caption">в день · {diff.out_of_stock} позиций закончились, {diff.empty_slots} пустых мест</span>
        </section>
      </div>

      <div className="stack">
        <div className="row row--between" style={{ paddingTop: 4 }}>
          <span className="h3">Требует внимания</span>
          <Link to="/report" className="caption c-accent">
            Весь отчёт
          </Link>
        </div>
        {attention.length === 0 ? (
          <div className="card">
            <EmptyState icon="check" title="Всё на месте" text="Ни одной позиции без товара." />
          </div>
        ) : (
          <div className="card stack" style={{ gap: 2, paddingTop: 8, paddingBottom: 8 }}>
            {attention.map((c) => (
              <AttentionRow key={c.sku} change={c} />
            ))}
          </div>
        )}
        <Link to="/orders" className="card card--interactive row" style={{ background: 'var(--violet-soft)' }}>
          <Icon name="sparkle" size={20} className="c-info" />
          <div className="stack" style={{ gap: 1, flex: 1 }}>
            <span style={{ fontWeight: 600 }}>Черновики заказов готовы</span>
            <span className="caption">Агент отправит их поставщикам после вашего подтверждения</span>
          </div>
          <Icon name="chevron" size={18} className="muted" />
        </Link>
      </div>
    </div>
  )
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
      <span className="num-lg" style={{ color }}>
        {n}
      </span>
      <span className="caption">{label}</span>
    </div>
  )
}

export function AttentionRow({ change }: { change: ItemChange }) {
  const navigate = useNavigate()
  const meta = STATUS_META[change.status]
  return (
    <div
      className="item-row item-row--link"
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/item/${encodeURIComponent(change.sku)}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/item/${encodeURIComponent(change.sku)}`)}
    >
      <span className="item-row__bar" style={{ background: STATUS_COLOR[change.status] }} />
      <div className="stack" style={{ gap: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{change.name}</span>
        <span className="caption" style={{ color: STATUS_COLOR[change.status] }}>
          {meta.label}
        </span>
      </div>
      <div className="item-row__nums">
        {change.before !== null && <span className="num-sm faint">{change.before}</span>}
        {change.before !== null && <Icon name="arrowRight" size={12} className="faint" />}
        <span className="num-md" style={{ color: STATUS_COLOR[change.status] }}>
          {change.after}
        </span>
      </div>
    </div>
  )
}
