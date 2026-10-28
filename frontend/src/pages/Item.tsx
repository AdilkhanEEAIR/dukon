// Карточка товара: было → стало, скорость продаж, когда закончится, предложение заказа.

import { useNavigate, useParams } from 'react-router-dom'
import type { ItemChange } from '../api/types'
import { Button } from '../components/Button'
import { STATUS_COLOR, StatusChip } from '../components/Chip'
import { Icon } from '../components/Icon'
import { EmptyState, ErrorState, Skeleton } from '../components/States'
import { useAsync } from '../hooks/useAsync'
import { formatPrice, formatSom } from '../lib/format'
import { loadLatest } from '../api/latest'

async function loadItem(sku: string): Promise<ItemChange | null> {
  const latest = await loadLatest()
  if (!latest) return null
  return latest.diff.changes.find((c) => c.sku === sku) ?? null
}

export function ItemPage() {
  const { sku = '' } = useParams()
  const navigate = useNavigate()
  const { state, refetch } = useAsync(() => loadItem(decodeURIComponent(sku)), [sku])

  return (
    <div className="page">
      <header className="page-head">
        <button className="icon-btn" aria-label="Назад" onClick={() => navigate(-1)}>
          <Icon name="back" size={18} />
        </button>
        <div className="page-head__text" style={{ flex: 1 }}>
          {state.status === 'success' && state.data ? (
            <>
              <h1 className="h2" style={{ margin: 0 }}>
                {state.data.name}
              </h1>
              <span className="caption">Ценник: {formatPrice(state.data.price_after ?? state.data.price_before)}</span>
            </>
          ) : (
            <Skeleton w={180} h={24} />
          )}
        </div>
      </header>

      {state.status === 'loading' || state.status === 'idle' ? (
        <div className="stack">
          <div className="card stack"><Skeleton h={60} /><Skeleton h={12} /></div>
          <div className="card stack"><Skeleton h={14} /><Skeleton h={14} /><Skeleton h={14} /></div>
        </div>
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={refetch} />
      ) : state.data === null ? (
        <EmptyState icon="tag" title="Товар не найден" text="В последнем обходе такой позиции нет." action={<Button variant="secondary" onClick={() => navigate('/report')}>К отчёту</Button>} />
      ) : (
        <ItemBody change={state.data} />
      )}
    </div>
  )
}

function ItemBody({ change }: { change: ItemChange }) {
  const navigate = useNavigate()
  const color = STATUS_COLOR[change.status]
  const beforeW = change.before ? 100 : 0
  const afterW = change.before ? Math.min(100, (change.after / change.before) * 100) : 100
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card card--elevated stack" style={{ gap: 14 }}>
        <div className="row row--between" style={{ alignItems: 'flex-end' }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="label">Прошлый обход</span>
            <span className="num-xl muted">{change.before ?? '—'}</span>
          </div>
          <Icon name="arrowRight" size={22} className="faint" />
          <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
            <span className="label">Сейчас</span>
            <span className="num-xl" style={{ color }} data-testid="after-count">
              {change.after}
            </span>
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <div className="bar"><div className="bar__fill" style={{ width: `${beforeW}%`, background: 'var(--text-tertiary)' }} /></div>
          <div className="bar"><div className="bar__fill" style={{ width: `${afterW}%`, background: color }} /></div>
        </div>
        <div className="row row--between">
          <StatusChip status={change.status} />
          <span className="caption">{change.reason}</span>
        </div>
      </section>

      <section className="card stack" style={{ gap: 0, paddingTop: 4, paddingBottom: 4 }}>
        <Fact k="Продано с прошлого обхода" v={`${change.sold} шт`} />
        <Fact k="Скорость продаж" v={change.velocity_per_day > 0 ? `${change.velocity_per_day} в день` : 'нет данных'} />
        <Fact k="Хватит примерно на" v={change.days_left !== null ? `${change.days_left} дн.` : '—'} />
        <Fact k="Потери в день" v={change.loss_per_day > 0 ? formatSom(change.loss_per_day) : '—'} danger={change.loss_per_day > 0} />
        <Fact
          k="Ценник"
          v={
            change.price_before !== null && change.price_after !== null && change.price_before !== change.price_after
              ? `${formatPrice(change.price_before)} → ${formatPrice(change.price_after)}`
              : formatPrice(change.price_after ?? change.price_before)
          }
          last
        />
      </section>

      {change.suggested_order > 0 && (
        <section className="card stack" style={{ background: 'var(--violet-soft)', gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <Icon name="sparkle" size={14} className="c-info" />
            <span className="label" style={{ color: 'var(--violet)' }}>
              Агент предлагает
            </span>
          </div>
          <div className="row row--between">
            <div className="stack" style={{ gap: 2 }}>
              <span className="h2">Заказать {change.suggested_order}</span>
              <span className="caption">Хватит на две недели при текущих продажах</span>
            </div>
          </div>
        </section>
      )}

      <Button block onClick={() => navigate('/orders')} icon={<Icon name="package" size={18} />}>
        В черновик заказа
      </Button>
    </div>
  )
}

function Fact({ k, v, danger, last }: { k: string; v: string; danger?: boolean; last?: boolean }) {
  return (
    <>
      <div className="row row--between" style={{ padding: '12px 0' }}>
        <span className="caption">{k}</span>
        <span style={{ fontWeight: 500, color: danger ? 'var(--danger)' : undefined }}>{v}</span>
      </div>
      {!last && <div className="divider" style={{ margin: 0 }} />}
    </>
  )
}
