// Агент: разговор с хозяином (текст или голос) и прогон переговоров с поставщиками.
// Слева — лента: реплики, события прогона по одному, итог с утверждением. Справа — правила хозяина,
// которые проверяет код, и поставщики. Модель предлагает — код проверяет — хозяин утверждает.

import { Bot, Truck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, errorCode, streamRun } from '../api/client'
import type { AgentEvent, AgentRun, ChatMessage, Order, Rules, Supplier, SupplierDraft } from '../api/types'
import { useLatest } from '../app/data'
import { useMode } from '../app/mode'
import { useSettings } from '../app/settings'
import { useViewShop } from '../app/shops'
import { Composer } from '../components/agent/Composer'
import { RulesCard } from '../components/agent/RulesCard'
import { RunFeed } from '../components/agent/RunFeed'
import { Button } from '../components/Button'
import { Input } from '../components/Fields'
import { PageActions } from '../components/Nav'
import { Notice } from '../components/States'
import { useToast } from '../components/Toast'
import { useVoice } from '../hooks/useVoice'
import { useI18n, type TKey } from '../i18n'
import { supplierTitle, weekdayList } from '../lib/agentText'
import { formatMoney } from '../lib/format'
import { canSpeak, speak, stopSpeaking } from '../lib/speech'

type MsgItem = { kind: 'msg'; id: number; msg: ChatMessage }
type RunItem = { kind: 'run'; id: number; run: AgentRun; events: AgentEvent[] }
type Item = MsgItem | RunItem
type NewItem = Omit<MsgItem, 'id'> | Omit<RunItem, 'id'>

/** Пауза между событиями прогона: записанный прогон приходит целиком, а читать его надо по одному. */
const REVEAL_MS = 650
const REVEAL_CALM_MS = 120

export function AgentPage() {
  const { t, rich, locale } = useI18n()
  const { latest } = useLatest()
  const { settings, update, deviceId, resolvedMotion } = useSettings()
  const { mode, liveReady } = useMode()
  const shop = useViewShop()
  const toast = useToast()
  const walk = latest.status === 'success' ? latest.data?.walk : undefined
  const diff = latest.status === 'success' ? latest.data?.diff : undefined
  const shopId = walk?.shop_id ?? shop.id
  const dev = shop.demo ? undefined : deviceId
  const fmt = useCallback((kgs: number) => formatMoney(kgs, locale, settings.currency), [locale, settings.currency])

  const [items, setItems] = useState<Item[]>([])
  const [rules, setRules] = useState<Rules | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [approving, setApproving] = useState(false)
  const [savingRules, setSavingRules] = useState(false)
  const [speakOn, setSpeakOn] = useState(() => canSpeak())
  const [needKey, setNeedKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState(settings.demoKey)
  const seq = useRef(0)
  const scroller = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)
  const pending = useRef<AgentEvent[]>([])
  const revealTimer = useRef(0)

  // Правила, поставщики и уже утверждённые заказы — при смене магазина или обхода.
  useEffect(() => {
    let alive = true
    void api.suppliers().then((s) => alive && setSuppliers(s)).catch(() => {})
    void api.rules(shopId, dev).then((r) => alive && setRules(r)).catch(() => {})
    if (walk) void api.orders(shopId, walk.id, dev).then((o) => alive && setOrders(o)).catch(() => {})
    return () => {
      alive = false
    }
  }, [shopId, walk, dev])

  // Приветствие — локальное, от самого экрана: с цифрами из последнего обхода.
  const greeting = useMemo(
    () => (diff ? rich('agent.greeting', { shop: shop.current?.name ?? '', loss: fmt(diff.loss_per_day) }) : t('agent.greetingNoWalk')),
    [diff, shop.current?.name, rich, t, fmt],
  )

  // Новый магазин или обход — новый разговор: цифры в репликах относятся к конкретному обходу.
  useEffect(() => {
    setItems([])
    pending.current = []
    clearTimeout(revealTimer.current)
    abort.current?.abort()
    setRunning(false)
  }, [walk?.id, shopId])

  const push = useCallback((item: NewItem) => {
    setItems((prev) => [...prev, { ...item, id: ++seq.current } as Item])
  }, [])

  // Прокрутка к последнему событию — всегда, чтобы прогон читался как переписка.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    // Плавность задаёт CSS (scroll-behavior); здесь только позиция — так работает и там, где scrollTo нет.
    el.style.scrollBehavior = resolvedMotion === 'calm' ? 'auto' : 'smooth'
    el.scrollTop = el.scrollHeight
  }, [items, resolvedMotion])

  const say = useCallback(
    (text: string) => {
      if (speakOn) speak(text, locale)
    },
    [speakOn, locale],
  )

  // ---- прогон агента
  const appendEvent = useCallback((runId: string, ev: AgentEvent) => {
    setItems((prev) => prev.map((it) => (it.kind === 'run' && it.run.id === runId ? { ...it, events: [...it.events, ev] } : it)))
  }, [])

  // Очередь показа: что бы ни пришло пачкой, на экран события выходят по одному с паузой.
  const calmRef = useRef(resolvedMotion === 'calm')
  useEffect(() => {
    calmRef.current = resolvedMotion === 'calm'
  }, [resolvedMotion])
  const schedule = useCallback(
    (runId: string) => {
      if (revealTimer.current) return
      const tick = () => {
        revealTimer.current = 0
        const next = pending.current.shift()
        if (next) appendEvent(runId, next)
        if (pending.current.length) revealTimer.current = window.setTimeout(tick, calmRef.current ? REVEAL_CALM_MS : REVEAL_MS)
      }
      revealTimer.current = window.setTimeout(tick, calmRef.current ? REVEAL_CALM_MS : REVEAL_MS)
    },
    [appendEvent],
  )

  const startRun = useCallback(async () => {
    if (!walk || running) return
    if (mode === 'live' && liveReady && !settings.demoKey) {
      setNeedKey(true)
      return
    }
    setRunning(true)
    setNeedKey(false)
    try {
      const run = await api.runAgent(walk.id, { lang: locale, deviceId: dev, demoKey: settings.demoKey || undefined })
      push({ kind: 'run', run, events: [] })
      pending.current = []
      const controller = new AbortController()
      abort.current = controller
      const final = await streamRun(
        run,
        (ev) => {
          pending.current.push(ev)
          schedule(run.id)
        },
        controller.signal,
      )
      // Ждём, пока лента дочитает очередь, и только потом показываем итог — иначе он обгонит события.
      await new Promise<void>((resolve) => {
        const check = () => (pending.current.length || revealTimer.current ? window.setTimeout(check, 100) : resolve())
        check()
      })
      setItems((prev) => prev.map((it) => (it.kind === 'run' && it.run.id === run.id ? { ...it, run: { ...final, events: it.events } } : it)))
      if (final.result?.summary) say(final.result.summary)
      if (final.status === 'failed' && final.error) toast('danger', t('agent.feed.error'), final.error)
    } catch (err) {
      const { code } = errorCode(err)
      if (code === 'demo_key_required') setNeedKey(true)
      else toast('danger', t(`errors.${code}.title` as TKey), t(`errors.${code}.hint` as TKey))
    } finally {
      setRunning(false)
    }
  }, [walk, running, mode, liveReady, settings.demoKey, locale, dev, push, schedule, say, toast, t])

  // ---- разговор
  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return
      stopSpeaking()
      const history = items.filter((it): it is Extract<Item, { kind: 'msg' }> => it.kind === 'msg').map((it) => it.msg)
      push({ kind: 'msg', msg: { role: 'user', text, at: new Date().toISOString() } })
      setBusy(true)
      try {
        const out = await api.chat({ message: text, walk_id: walk?.id ?? null, shop_id: shopId, lang: locale, history: history.slice(-8) }, { deviceId: dev, demoKey: settings.demoKey || undefined })
        push({ kind: 'msg', msg: out.reply })
        if (out.reply.text) say(out.reply.text)
        if (out.rules) {
          setRules(out.rules)
          toast('success', t('agent.saved'))
        }
        if (out.reply.action?.type === 'start_run') void startRun()
      } catch (err) {
        const { code } = errorCode(err)
        if (code === 'demo_key_required') setNeedKey(true)
        push({ kind: 'msg', msg: { role: 'agent', text: t('agent.chatError', { reason: t(`errors.${code}.title` as TKey) }), at: new Date().toISOString() } })
      } finally {
        setBusy(false)
      }
    },
    [busy, items, push, walk, shopId, locale, dev, settings.demoKey, say, toast, t, startRun],
  )

  const keywords = useMemo(() => (diff ? diff.changes.map((c) => c.name).slice(0, 40) : []), [diff])
  const voice = useVoice(send, keywords)

  // ---- утверждение
  const approve = useCallback(
    async (drafts: SupplierDraft[]) => {
      if (!walk) return
      const runItem = [...items].reverse().find((it): it is Extract<Item, { kind: 'run' }> => it.kind === 'run')
      setApproving(true)
      try {
        const created = await api.approve({ walk_id: walk.id, run_id: runItem?.run.id ?? null, drafts }, dev)
        setOrders((prev) => [...created, ...prev])
        toast('success', t('agent.result.approved'), t('agent.result.summary', { n: created.length, total: fmt(created.reduce((a, o) => a + o.total, 0)) }))
      } catch (err) {
        const { code } = errorCode(err)
        toast('danger', t(`errors.${code}.title` as TKey), (err as Error).message)
      } finally {
        setApproving(false)
      }
    },
    [walk, items, dev, toast, t, fmt],
  )

  const markSent = useCallback(
    async (order: Order) => {
      try {
        const updated = await api.markSent(order.id, dev)
        setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
      } catch (err) {
        toast('danger', t(`errors.${errorCode(err).code}.title` as TKey))
      }
    },
    [dev, toast, t],
  )

  const saveRules = useCallback(
    async (next: Rules) => {
      setSavingRules(true)
      try {
        setRules(await api.saveRules(shopId, next, dev))
        toast('success', t('agent.saved'))
      } catch (err) {
        toast('danger', t(`errors.${errorCode(err).code}.title` as TKey))
      } finally {
        setSavingRules(false)
      }
    },
    [shopId, dev, toast, t],
  )

  useEffect(() => () => {
    abort.current?.abort()
    clearTimeout(revealTimer.current)
    stopSpeaking()
  }, [])

  const canRun = !!walk && !!diff && diff.changes.some((c) => c.suggested_order > 0)

  return (
    <div className="page stagger agent-page" data-testid="agent">
      <header className="page-head">
        <div className="page-head__text">
          <h1 className="h1">{t('agent.title')}</h1>
          <p className="page-head__sub">{t('agent.subtitle')}</p>
        </div>
        <PageActions />
      </header>

      <div className="agent-grid">
        <section className="sheet agent-chat" aria-label={t('agent.title')}>
          <div className="agent-chat__scroll" ref={scroller} data-testid="thread">
            <Bubble msg={{ role: 'agent', text: '', at: '' }}>{greeting}</Bubble>
            {items.map((it) =>
              it.kind === 'msg' ? (
                <Bubble key={it.id} msg={it.msg} />
              ) : (
                <RunFeed key={it.id} events={it.events} run={it.run} suppliers={suppliers} orders={orders} approving={approving} onApprove={approve} onSent={markSent} />
              ),
            )}
            {busy && (
              <div className="bubble bubble--agent bubble--typing" aria-label={t('common.loading')}>
                <span className="dots">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
          </div>
          {needKey && (
            <Notice
              tone="low"
              title={t('agent.needKey')}
              text={t('agent.needKeyBody')}
              action={
                <form
                  className="row"
                  style={{ gap: 6 }}
                  onSubmit={(e) => {
                    e.preventDefault()
                    update({ demoKey: keyDraft.trim() })
                    setNeedKey(false)
                  }}
                >
                  <Input value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder={t('agent.keyPlaceholder')} aria-label={t('agent.keyPlaceholder')} style={{ width: 140 }} data-testid="key-input" />
                  <Button size="sm" type="submit" data-testid="key-save">
                    {t('agent.keySave')}
                  </Button>
                </form>
              }
            />
          )}
          <Composer voice={voice} onSend={(text) => void send(text)} onRun={() => void startRun()} canRun={canRun} running={running} busy={busy} speakOn={speakOn} canSpeak={canSpeak()} onToggleSpeak={() =>
              setSpeakOn((v) => {
                // Выключили озвучку — диктор замолкает сразу, а не договаривает фразу.
                if (v) stopSpeaking()
                return !v
              })
            } />
        </section>

        <aside className="stack agent-side" style={{ gap: 14 }}>
          {rules && <RulesCard rules={rules} suppliers={suppliers} onSave={saveRules} saving={savingRules} />}
          <section className="sheet sheet--pad stack" style={{ gap: 10 }} data-testid="suppliers-card">
            <div className="row" style={{ gap: 8 }}>
              <Truck size={18} className="c-accent" />
              <span className="h3">{t('agent.suppliers')}</span>
            </div>
            <ul className="supplier-list">
              {suppliers.map((s) => (
                <li key={s.id} className="supplier-list__item">
                  <span style={{ fontWeight: 600 }}>{supplierTitle(s, locale)}</span>
                  <span className="small">
                    {t('agent.delivers', { days: weekdayList(s.delivery_days, locale) })}
                    {s.min_order_kgs > 0 && ` · ${t('agent.minOrder', { sum: fmt(s.min_order_kgs) })}`}
                    {` · ${t('agent.pack', { n: s.pack_size })}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <div className="sheet sheet--soft sheet--pad stack stack--tight">
            <span className="h3 row" style={{ gap: 8 }}>
              <Bot size={16} /> {t('agent.howTitle')}
            </span>
            <p className="body-2">{rich('agent.howBody')}</p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Bubble({ msg, children }: { msg: ChatMessage; children?: ReactNode }) {
  const { t } = useI18n()
  const mine = msg.role === 'user'
  return (
    <div className={`bubble bubble--${mine ? 'user' : 'agent'}`} data-testid={`msg-${msg.role}`}>
      {!mine && (
        <span className="bubble__who">
          <Bot size={14} /> {t('agent.bot')}
        </span>
      )}
      <p className="bubble__text">{children ?? msg.text}</p>
    </div>
  )
}
