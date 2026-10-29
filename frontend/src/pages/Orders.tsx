// Заказы: черновики по поставщикам с сервера (из дифа последнего обхода), количества — кнопками или
// с клавиатуры, кольцо «на что уходят деньги», утверждение одной кнопкой и готовые сообщения в WhatsApp.
// Если агент уже договорился по этому обходу, его количества, скидки и дни доставки подставляются сами.

import { Bot, Package, ShieldX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, errorCode } from '../api/client'
import type { AgentRun, DraftLine, DraftsResponse, Order, SupplierDraft, Violation } from '../api/types'
import { useLatest } from '../app/data'
import { useSettings } from '../app/settings'
import { useViewShop } from '../app/shops'
import { OrderCard } from '../components/agent/OrderCard'
import { Donut, type DonutSlice } from '../components/charts/Donut'
import { useChartColors } from '../components/charts/theme'
import { ExportMenu } from '../components/ExportMenu'
import { ordersTable } from '../lib/export'
import { formatMoney } from '../lib/format'
import { Button } from '../components/Button'
import { PageActions } from '../components/Nav'
import { Pill } from '../components/Pill'
import { EmptyState, ErrorState, Notice, ReportSkeleton } from '../components/States'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useI18n, type TKey } from '../i18n'
import { ProductIcon } from '../components/ProductIcon'
import { Money } from '../components/Money'
import { QtyStepper } from '../components/QtyStepper'
import { Ticker } from '../components/Ticker'
import { supplierTitle, violationText, weekdayName } from '../lib/agentText'

export function OrdersPage() {
  const { t } = useI18n()
  const { latest, reload } = useLatest()
  const { deviceId } = useSettings()
  const shop = useViewShop()
  const walk = latest.status === 'success' ? latest.data?.walk : undefined
  const dev = shop.demo ? undefined : deviceId

  const { state, refetch } = useAsync(
    async () => {
      if (!walk) return null
      const [drafts, run, orders] = await Promise.all([api.drafts(walk.id, dev), api.latestRun(walk.id).catch(() => null), api.orders(walk.shop_id, walk.id, dev).catch(() => [] as Order[])])
      return { drafts, run, orders }
    },
    [walk?.id, dev],
    latest.status === 'success',
  )

  return (
    <div className="page stagger" style={{ maxWidth: 760 }} data-testid="orders">
      <header className="page-head">
        <div className="page-head__text">
          <h1 className="h1">{t('orders.title')}</h1>
          <p className="page-head__sub">{t('orders.subtitle')}</p>
        </div>
        <PageActions />
      </header>

      {latest.status === 'loading' || latest.status === 'idle' || state.status === 'loading' || (state.status === 'idle' && latest.status === 'success' && walk) ? (
        <ReportSkeleton />
      ) : latest.status === 'error' ? (
        <ErrorState error={latest.error} onRetry={reload} />
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={refetch} />
      ) : !walk || state.status !== 'success' || !state.data ? (
        <EmptyState icon={Package} title={t('orders.empty')} text={t('orders.emptyBody')} action={<Button variant="secondary" to="/app/shelves">{t('orders.toReport')}</Button>} />
      ) : (
        // Ключ — обход и прогон: другой обход или новый прогон агента — заново берём количества.
        <Drafts key={`${walk.id}:${state.data.run?.id ?? ''}`} walkId={walk.id} data={state.data.drafts} run={state.data.run} initialOrders={state.data.orders} dev={dev} />
      )}
    </div>
  )
}

/** Сколько отдельных секторов в кольце: остальное — одним серым «Другое», иначе кольцо рассыпается на крошки. */
const SHARE_TOP = 5
const OTHER = '__other'

interface Group {
  draft: SupplierDraft
  /** Количества агента по этому поставщику (если он уже договорился) — sku → qty. */
  agent: Record<string, number> | null
  delivery_day: number | null
  discount_pct: number
}

function Drafts({ walkId, data, run, initialOrders, dev }: { walkId: string; data: DraftsResponse; run: AgentRun | null; initialOrders: Order[]; dev?: string }) {
  const { t, product, locale } = useI18n()
  const { settings } = useSettings()
  const colors = useChartColors()
  const toast = useToast()
  const negotiated = run?.status === 'done' && run.result ? run.result : null

  // Группы по поставщикам: черновик сервера плюс то, о чём договорился агент (его количества выигрывают).
  const groups = useMemo<Group[]>(
    () =>
      data.drafts.map((draft) => {
        const order = negotiated?.orders.find((o) => o.supplier_id === draft.supplier_id)
        return {
          draft,
          agent: order ? Object.fromEntries(order.lines.map((l) => [l.sku, l.qty])) : null,
          delivery_day: order?.delivery_day ?? draft.delivery_day,
          discount_pct: order?.discount_pct ?? draft.discount_pct,
        }
      }),
    [data.drafts, negotiated],
  )
  const lines = useMemo(() => groups.flatMap((g) => g.draft.lines), [groups])
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(groups.flatMap((g) => g.draft.lines.map((l) => [l.sku, g.agent ? (g.agent[l.sku] ?? 0) : l.qty]))),
  )
  const [orders, setOrders] = useState<Order[]>(initialOrders)
  const [approving, setApproving] = useState(false)
  const [violations, setViolations] = useState<Violation[]>([])
  const [focus, setFocus] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const fmt = useCallback((v: number) => formatMoney(v, locale, settings.currency), [locale, settings.currency])

  useEffect(() => setOrders(initialOrders), [initialOrders])

  const priceOf = (l: DraftLine) => l.unit_price ?? 0
  const groupTotal = (g: Group) => g.draft.lines.reduce((s, l) => s + (qty[l.sku] ?? 0) * priceOf(l), 0) * (1 - g.discount_pct / 100)
  const total = useMemo(() => groups.reduce((s, g) => s + groupTotal(g), 0), [groups, qty]) // eslint-disable-line react-hooks/exhaustive-deps
  const units = Object.values(qty).reduce((a, n) => a + n, 0)

  const share = useMemo<DonutSlice[]>(() => {
    const sums = lines.map((l) => ({ l, v: (qty[l.sku] ?? 0) * priceOf(l) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)
    const top = sums.slice(0, SHARE_TOP).map((x, i) => ({ id: x.l.sku, name: product(x.l.name), value: x.v, color: colors.accentRamp[i], display: fmt(x.v) }))
    const rest = sums.slice(SHARE_TOP).reduce((a, x) => a + x.v, 0)
    if (rest > 0) top.push({ id: OTHER, name: t('orders.rest'), value: rest, color: colors.accentRamp[SHARE_TOP], display: fmt(rest) })
    return top
  }, [lines, qty, colors, product, fmt, t])

  const pick = useCallback((id: string | null) => {
    if (id === OTHER) return
    setFocus(id)
    if (id) list.current?.querySelector<HTMLElement>(`[data-sku="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  const set = (sku: string, n: number) => {
    setViolations([])
    setQty((q) => ({ ...q, [sku]: n }))
  }

  const approve = async () => {
    const drafts: SupplierDraft[] = groups
      .map((g) => ({ ...g.draft, delivery_day: g.delivery_day, lines: g.draft.lines.map((l) => ({ ...l, qty: qty[l.sku] ?? 0})).filter((l) => l.qty > 0) }))
      .filter((d) => d.lines.length > 0)
    if (!drafts.length) return
    setApproving(true)
    setViolations([])
    try {
      const created = await api.approve({ walk_id: walkId, run_id: run?.id ?? null, drafts }, dev)
      setOrders((prev) => [...created, ...prev])
      toast('success', t('agent.result.approved'), t('agent.result.summary', { n: created.length, total: fmt(created.reduce((a, o) => a + o.total, 0)) }))
    } catch (err) {
      const { code } = errorCode(err)
      const detail = (err as { detail?: { violations?: Violation[] } }).detail
      if (code === 'rules_violation' && detail?.violations) setViolations(detail.violations)
      else toast('danger', t(`errors.${code}.title` as TKey), t(`errors.${code}.hint` as TKey))
    } finally {
      setApproving(false)
    }
  }

  const markSent = async (order: Order) => {
    try {
      const updated = await api.markSent(order.id, dev)
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
    } catch (err) {
      toast('danger', t(`errors.${errorCode(err).code}.title` as TKey))
    }
  }

  // Для выгрузки: те же строки, что на экране, в форме строк отчёта (статус позиции — «мало»/«нет» по остатку).
  const exportLines = useMemo(
    () =>
      lines.map((l) => ({
        sku: l.sku,
        name: l.name,
        before: null,
        after: l.on_hand,
        status: l.on_hand === 0 ? ('out_of_stock' as const) : ('low_stock' as const),
        sold: 0,
        velocity_per_day: l.velocity_per_day,
        days_left: null,
        price_before: null,
        price_after: l.unit_price,
        loss_per_day: 0,
        suggested_order: l.suggested,
        reason: '',
      })),
    [lines],
  )

  if (lines.length === 0 && orders.length === 0) {
    return <EmptyState icon={Package} title={t('orders.empty')} text={t('orders.emptyBody')} action={<Button variant="secondary" to="/app/shelves">{t('orders.toReport')}</Button>} />
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      {orders.length > 0 && (
        <section className="stack" style={{ gap: 10 }} data-testid="orders-approved">
          <span className="h3">{t('orders.approvedTitle')}</span>
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} onSent={(x) => void markSent(x)} />
          ))}
        </section>
      )}

      {lines.length > 0 && (
        <>
          <div className="row row--between row--wrap" style={{ gap: 12 }}>
            <div className="stack stack--tight">
              <span className="h3">{negotiated ? t('orders.negotiated') : t('orders.suggested')}</span>
              <span className="small" style={{ maxWidth: '52ch' }}>
                {negotiated ? t('orders.negotiatedBody', { n: negotiated.blocks }) : t('orders.suggestedBody')}
              </span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {negotiated && (
                <Pill tone="ok" icon={<Bot size={12} />}>
                  {t('orders.byAgent')}
                </Pill>
              )}
              <Pill>{t('orders.lines', { n: lines.length })}</Pill>
              <ExportMenu build={(ctx) => ordersTable(exportLines, qty, ctx)} testId="export-orders" />
            </div>
          </div>

          {share.length > 0 && (
            <section className="sheet sheet--pad stack" style={{ gap: 14 }} data-testid="orders-share">
              <h3 className="h3">{t('orders.share')}</h3>
              <Donut slices={share} total={fmt(total)} caption={t('orders.total')} selected={focus} onSelect={pick} label={t('orders.share')} testId="orders-donut" />
            </section>
          )}

          <div ref={list} className="stack" style={{ gap: 12 }}>
            {groups.map((g) => (
              <section key={g.draft.supplier_id} className="sheet supplier-group" data-testid="supplier-group" data-supplier={g.draft.supplier_id}>
                <header className="supplier-group__head">
                  <div className="stack stack--tight grow">
                    <span style={{ fontWeight: 600 }}>{supplierTitle(g.draft, locale)}</span>
                    <span className="small">
                      {g.delivery_day !== null && t('agent.feed.delivery', { day: weekdayName(g.delivery_day, locale) })}
                      {g.discount_pct ? ` · ${t('agent.feed.discount', { pct: g.discount_pct })}` : ''}
                    </span>
                  </div>
                  <Money kgs={groupTotal(g)} className="num-md" noAlt testId={`group-total-${g.draft.supplier_id}`} />
                </header>
                <div className="rows" style={{ padding: '0 18px' }}>
                  {g.draft.lines.map((l) => {
                    const price = priceOf(l)
                    const n = qty[l.sku] ?? 0
                    const name = product(l.name)
                    const skipped = g.agent && !(l.sku in g.agent)
                    return (
                      <div key={l.sku} data-sku={l.sku} className={`row order-line${n === 0 ? ' is-zero' : ''}${focus === l.sku ? ' is-focus' : ''}`} style={{ gap: 14 }} data-testid="order-line">
                        <ProductIcon name={l.name} size={38} />
                        <div className="stack grow" style={{ gap: 2 }}>
                          <span style={{ fontWeight: 600 }} className="truncate">{name}</span>
                          <span className="small row row--wrap" style={{ gap: '2px 10px' }}>
                            <Money kgs={price} kind="price" noAlt />
                            <span>{t('orders.onHand', { n: l.on_hand })}</span>
                            {skipped && <span className="c-low">{t('orders.skippedByAgent')}</span>}
                          </span>
                        </div>
                        <QtyStepper value={n} onChange={(v) => set(l.sku, v)} label={name} inputLabel={t('orders.qty', { name })} />
                        <Money kgs={n * price} className="num-md order-line__sum" altBlock />
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>

          {violations.length > 0 && (
            <div className="rule-card rule-card--block" role="alert" data-testid="approve-violation">
              <span className="rule-card__icon">
                <ShieldX size={20} />
              </span>
              <div className="stack stack--tight grow">
                <span className="rule-card__title">{t('agent.feed.blocked')}</span>
                {violations.map((v, i) => (
                  <p key={i} className="rule-card__text">
                    {violationText(v, undefined, locale, t, fmt)}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="order-total sheet sheet--pad">
            <div className="stack stack--tight">
              <span className="h3">{t('orders.total')}</span>
              <span className="small">
                <Ticker value={units} /> {t('item.pcs')}
              </span>
            </div>
            <Money kgs={total} className="num-lg" altBlock testId="order-total" />
          </div>
          {orders.length === 0 ? (
            <Button size="lg" block icon={<Package size={18} />} loading={approving} disabled={units === 0} onClick={() => void approve()} data-testid="approve-orders">
              {t('agent.result.approve')}
            </Button>
          ) : (
            <p className="small" style={{ textAlign: 'center' }} data-testid="already-approved">
              {t('orders.alreadyApproved')}
            </p>
          )}
          {!negotiated && (
            <Notice tone="ok" title={t('orders.agentHint')} action={<Button variant="secondary" size="sm" to="/app/agent" icon={<Bot size={14} />}>{t('nav.agent')}</Button>} />
          )}
        </>
      )}
    </div>
  )
}
