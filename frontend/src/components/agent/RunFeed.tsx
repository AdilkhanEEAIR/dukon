// Журнал прогона агента: события появляются по одному. Главный кадр — блокировка правилом хозяина:
// её карточка крупнее, с щитом и пульсом, а следом — исправление. Поставщик отвечает «с другой стороны»,
// как собеседник в переписке. В конце — итог с заказами и кнопкой «Утвердить и отправить».

import { AnimatePresence, motion } from 'motion/react'
import { Bot, Check, CircleAlert, MessageSquareReply, Package, ShieldCheck, ShieldX, SkipForward, Sparkles } from 'lucide-react'
import { useMemo } from 'react'
import type { AgentEvent, AgentRun, Order, Supplier, SupplierDraft } from '../../api/types'
import { useSettings } from '../../app/settings'
import { useI18n } from '../../i18n'
import { productName } from '../../i18n/products'
import { intentLabel, replyText, supplierTitle, violationText, weekdayName } from '../../lib/agentText'
import { formatMoney } from '../../lib/format'
import { Button } from '../Button'
import { Money } from '../Money'
import { Pill } from '../Pill'
import { OrderCard } from './OrderCard'

interface Props {
  events: AgentEvent[]
  run: AgentRun | null
  suppliers: Supplier[]
  /** Заказы уже утверждены — вместо кнопки показываем их со ссылками в WhatsApp. */
  orders: Order[]
  approving: boolean
  onApprove: (drafts: SupplierDraft[]) => void
  onSent: (order: Order) => void
  testId?: string
}

const enter = { opacity: 0, y: 14, scale: 0.98 }
const shown = { opacity: 1, y: 0, scale: 1 }

export function RunFeed({ events, run, suppliers, orders, approving, onApprove, onSent, testId = 'run-feed' }: Props) {
  const { locale } = useI18n()
  const { settings, resolvedMotion } = useSettings()
  const calm = resolvedMotion === 'calm'
  const fmt = (kgs: number) => formatMoney(kgs, locale, settings.currency)
  const supplierName = (id: string | null | undefined) => {
    const s = suppliers.find((x) => x.id === id)
    return s ? supplierTitle(s, locale) : (id ?? '')
  }
  const minOrder = (id: string | null | undefined) => suppliers.find((s) => s.id === id)?.min_order_kgs
  const visible = useMemo(() => events.filter((e) => e.kind !== 'start'), [events])
  const finished = run && run.status !== 'running'

  return (
    <div className="feed" data-testid={testId} aria-live="polite">
      <AnimatePresence initial={!calm}>
        {visible.map((ev, i) => (
          <motion.div
            key={`${ev.step}-${ev.kind}-${i}`}
            initial={calm ? false : enter}
            animate={shown}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            layout={!calm}
            className={`feed__item feed__item--${ev.kind}`}
            data-testid={`event-${ev.kind}`}
          >
            <EventCard ev={ev} supplierName={supplierName} minOrder={minOrder} fmt={fmt} />
          </motion.div>
        ))}
      </AnimatePresence>

      {finished && run.result && (
        <motion.div initial={calm ? false : enter} animate={shown} transition={{ type: 'spring', stiffness: 260, damping: 24 }} className="feed__item feed__item--result" data-testid="run-result">
          <Result run={run} fmt={fmt} orders={orders} approving={approving} onApprove={onApprove} onSent={onSent} />
        </motion.div>
      )}
    </div>
  )
}

function EventCard({ ev, supplierName, minOrder, fmt }: { ev: AgentEvent; supplierName: (id: string | null | undefined) => string; minOrder: (id: string | null | undefined) => number | undefined; fmt: (kgs: number) => string }) {
  const { t, locale, product } = useI18n()
  const name = supplierName(ev.supplier_id)
  switch (ev.kind) {
    case 'tool_call':
    case 'thought': {
      const label = ev.kind === 'tool_call' ? intentLabel(ev, t, name) : null
      return (
        <div className="bubble bubble--agent">
          <span className="bubble__who">
            <Bot size={14} /> {t('agent.bot')}
            {label && <span className="bubble__intent"> · {label}</span>}
          </span>
          <p className="bubble__text">{ev.text}</p>
        </div>
      )
    }
    case 'verifier_block': {
      const draft = ev.data.draft
      const violations = ev.data.violations ?? []
      return (
        <div className="rule-card rule-card--block" role="alert">
          <span className="rule-card__icon">
            <ShieldX size={20} />
          </span>
          <div className="stack stack--tight grow">
            <span className="rule-card__title">{t('agent.feed.blocked')}</span>
            {violations.map((v, i) => (
              <p key={i} className="rule-card__text" data-rule={v.rule}>
                {violationText(v, draft, locale, t, fmt)}
              </p>
            ))}
          </div>
        </div>
      )
    }
    case 'fix':
    case 'verifier_ok': {
      const payload = ev.data.order ?? ev.data.draft
      const confirmed = !!ev.data.order
      return (
        <div className={`rule-card rule-card--${confirmed ? 'confirmed' : 'ok'}`}>
          <span className="rule-card__icon">{confirmed ? <Package size={18} /> : ev.kind === 'fix' ? <Sparkles size={18} /> : <ShieldCheck size={18} />}</span>
          <div className="stack stack--tight grow">
            <span className="rule-card__title">{confirmed ? t('agent.feed.confirmed', { supplier: name }) : ev.kind === 'fix' ? t('agent.feed.fixed') : t('agent.feed.passed')}</span>
            {payload && (
              <span className="small row row--wrap" style={{ gap: '2px 10px' }}>
                <span>{payload.lines.map((l) => `${productName(l.name, locale)} × ${l.qty}`).join(' · ')}</span>
                <span className="c-ink">{fmt(payload.total)}</span>
                {payload.discount_pct ? <span>{t('agent.feed.discount', { pct: payload.discount_pct })}</span> : null}
                {payload.delivery_day !== null && <span>{t('agent.feed.delivery', { day: weekdayName(payload.delivery_day, locale) })}</span>}
              </span>
            )}
          </div>
        </div>
      )
    }
    case 'supplier_reply':
      return (
        <div className="bubble bubble--supplier">
          <span className="bubble__who">
            <MessageSquareReply size={14} /> {name || t('agent.supplier')}
          </span>
          <p className="bubble__text">{ev.data.reply ? replyText(ev.data.reply, locale, t, fmt, minOrder(ev.supplier_id)) : ev.text}</p>
        </div>
      )
    case 'skip':
      return (
        <div className="feed__skip">
          <SkipForward size={14} />
          <span>
            {ev.data.name ? `${product(String(ev.data.name))}: ` : ''}
            {ev.text}
          </span>
        </div>
      )
    case 'final':
      return (
        <div className="bubble bubble--agent bubble--final">
          <span className="bubble__who">
            <Bot size={14} /> {t('agent.bot')}
          </span>
          <p className="bubble__text">{ev.text}</p>
        </div>
      )
    case 'error':
      return (
        <div className="rule-card rule-card--error" role="alert">
          <span className="rule-card__icon">
            <CircleAlert size={18} />
          </span>
          <div className="stack stack--tight grow">
            <span className="rule-card__title">{t('agent.feed.error')}</span>
            <p className="rule-card__text">{ev.text}</p>
          </div>
        </div>
      )
    default:
      return null
  }
}

function Result({ run, fmt, orders, approving, onApprove, onSent }: { run: AgentRun; fmt: (kgs: number) => string; orders: Order[]; approving: boolean; onApprove: (d: SupplierDraft[]) => void; onSent: (o: Order) => void }) {
  const { t, locale } = useI18n()
  const result = run.result!
  const mine = orders.filter((o) => o.run_id === run.id)
  if (!result.orders.length) {
    return (
      <div className="result">
        <span className="h3">{t('agent.result.noOrders')}</span>
        {result.skipped.length > 0 && <p className="small">{result.skipped.map((s) => `${productName(s.name, locale)} — ${s.reason}`).join('; ')}</p>}
      </div>
    )
  }
  return (
    <div className="result stack" style={{ gap: 14 }}>
      <div className="row row--between row--wrap" style={{ gap: 8 }}>
        <div className="stack stack--tight">
          <span className="h3">{t('agent.result.title')}</span>
          <span className="small">{t('agent.result.summary', { n: result.orders.length, total: fmt(result.total) })}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {result.blocks > 0 && (
            <Pill tone="out" icon={<ShieldX size={12} />}>
              {t('agent.result.blocks', { n: result.blocks })}
            </Pill>
          )}
          {run.source === 'live' ? <Pill tone="ok">{t('agent.modelLine', { model: run.model })}</Pill> : <Pill>{t('agent.recordedLine')}</Pill>}
        </div>
      </div>

      <div className="result__orders">
        {result.orders.map((o) => (
          <div key={o.supplier_id} className="result__order" data-testid="result-order">
            <div className="row row--between" style={{ gap: 8 }}>
              <span style={{ fontWeight: 600 }} className="truncate">{supplierTitle(o, locale)}</span>
              <Money kgs={o.total} className="num-md" noAlt animate={false} />
            </div>
            <span className="small">
              {o.lines.map((l) => `${productName(l.name, locale)} × ${l.qty}`).join(' · ')}
              {o.delivery_day !== null && ` · ${t('agent.feed.delivery', { day: weekdayName(o.delivery_day, locale) })}`}
              {o.discount_pct ? ` · ${t('agent.feed.discount', { pct: o.discount_pct })}` : ''}
            </span>
          </div>
        ))}
      </div>
      {result.skipped.length > 0 && (
        <p className="small">
          <span className="c-ink">{t('agent.result.skipped')}: </span>
          {result.skipped.map((s) => productName(s.name, locale)).join(', ')}
        </p>
      )}

      {mine.length ? (
        <div className="stack" style={{ gap: 10 }} data-testid="approved-orders">
          <span className="row" style={{ gap: 6, fontWeight: 600 }}>
            <Check size={16} className="c-ok" /> {t('agent.result.approved')}
          </span>
          {mine.map((o) => (
            <OrderCard key={o.id} order={o} onSent={onSent} />
          ))}
        </div>
      ) : (
        <Button size="lg" block icon={<Package size={18} />} loading={approving} onClick={() => onApprove(result.orders)} data-testid="approve-all">
          {t('agent.result.approve')}
        </Button>
      )}
    </div>
  )
}
