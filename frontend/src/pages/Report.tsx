// Отчёт обхода: сравнение с прошлым, фильтр по статусу, группировка по полкам.

import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { ItemChange, Status, Walk, WalkDiff } from '../api/types'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { EmptyState, ErrorState, ReportSkeleton } from '../components/States'
import { useAsync } from '../hooks/useAsync'
import { formatHours, formatSom } from '../lib/format'
import { loadLatest } from '../api/latest'
import { AttentionRow } from './Home'

type Filter = 'all' | 'out_of_stock' | 'low_stock' | 'price_mismatch'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'out_of_stock', label: 'Нет' },
  { key: 'low_stock', label: 'Мало' },
  { key: 'price_mismatch', label: 'Ценник' },
]

async function loadReport(id?: string): Promise<{ walk: Walk; diff: WalkDiff } | null> {
  if (id) {
    const [walk, diff] = await Promise.all([api.walk(id), api.diff(id)])
    return { walk, diff }
  }
  return loadLatest()
}

export function ReportPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state, refetch } = useAsync(() => loadReport(id), [id])
  const [filter, setFilter] = useState<Filter>('all')

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__text">
          <span className="label">
            {state.status === 'success' && state.data
              ? state.data.diff.walk_before_id
                ? `${state.data.walk.label} · ${formatHours(state.data.diff.hours_between)} с прошлого`
                : `${state.data.walk.label} · первый обход`
              : 'Отчёт'}
          </span>
          <h1 className="h2" style={{ margin: 0 }}>
            Отчёт обхода
          </h1>
        </div>
        <button className="icon-btn" aria-label="Обновить" onClick={refetch}>
          <Icon name="refresh" size={18} />
        </button>
      </header>

      {state.status === 'loading' || state.status === 'idle' ? (
        <ReportSkeleton />
      ) : state.status === 'error' ? (
        <ErrorState
          error={state.error}
          onRetry={refetch}
          secondary={
            <Button variant="secondary" onClick={() => navigate('/')}>
              На главную
            </Button>
          }
        />
      ) : state.data === null ? (
        <EmptyState icon="scan" title="Нечего сравнивать" text="Сделайте первый обход." action={<Button onClick={() => navigate('/scan')}>Начать обход</Button>} />
      ) : (
        <ReportBody diff={state.data.diff} filter={filter} setFilter={setFilter} />
      )}
    </div>
  )
}

function ReportBody({ diff, filter, setFilter }: { diff: WalkDiff; filter: Filter; setFilter: (f: Filter) => void }) {
  const navigate = useNavigate()
  const counts: Record<Filter, number> = {
    all: diff.changes.filter((c) => c.status !== 'ok').length,
    out_of_stock: diff.out_of_stock,
    low_stock: diff.low_stock,
    price_mismatch: diff.price_mismatch,
  }
  const visible = useMemo(() => {
    if (filter === 'all') return diff.changes.filter((c) => c.status !== 'ok')
    return diff.changes.filter((c) => c.status === (filter as Status))
  }, [diff, filter])
  const ok = diff.changes.filter((c) => c.status === 'ok')

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="grid-3">
        <div className="card stack" style={{ gap: 2 }}>
          <span className="num-lg" data-testid="total-items">{diff.total_items}</span>
          <span className="caption">товаров посчитано</span>
        </div>
        <div className="card stack" style={{ gap: 2 }}>
          <span className="num-lg c-accent">{diff.changed}</span>
          <span className="caption">изменилось</span>
        </div>
        <div className="card stack" style={{ gap: 2 }}>
          <span className="num-lg c-danger">{formatSom(diff.loss_per_day)}</span>
          <span className="caption">теряете в день</span>
        </div>
      </div>

      <div className="seg" role="tablist" aria-label="Фильтр статусов">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            className={`seg__item${filter === f.key ? ' is-active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} {counts[f.key] > 0 && <span className="faint">{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState icon="check" title="Здесь пусто" text="По этому фильтру всё в порядке." />
        </div>
      ) : (
        <div className="card stack" style={{ gap: 2, paddingTop: 8, paddingBottom: 8 }} data-testid="changes-list">
          {visible.map((c: ItemChange) => (
            <AttentionRow key={c.sku} change={c} />
          ))}
        </div>
      )}

      {ok.length > 0 && filter === 'all' && (
        <details className="card" style={{ padding: 0 }}>
          <summary className="caption" style={{ padding: 14, cursor: 'pointer', listStyle: 'none' }}>
            Без изменений · {ok.length}
          </summary>
          <div className="stack" style={{ gap: 2, padding: '0 16px 8px' }}>
            {ok.map((c) => (
              <AttentionRow key={c.sku} change={c} />
            ))}
          </div>
        </details>
      )}

      <Button block variant="secondary" onClick={() => navigate('/orders')} icon={<Icon name="package" size={18} />}>
        Посмотреть черновики заказов
      </Button>
    </div>
  )
}
