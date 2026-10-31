// Страница поставщика: открывается по ссылке из WhatsApp без входа и без оболочки приложения.
// Поставщик видит заказ и отвечает одной кнопкой («всё есть», «части нет», «другой день», «не можем»)
// или пишет текст. Пока агент ждёт — страница опрашивает сервер и показывает подтверждение, когда оно придёт.
// Ничего лишнего: это телефон торгового представителя, у которого на нас тридцать секунд.

import { Check, MessageCircle, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, errorCode } from '../api/client'
import type { SupplierReplyIn, SupplierThread } from '../api/types'
import { Button } from '../components/Button'
import { LogoMark } from '../components/Logo'
import { useI18n } from '../i18n'
import { productName } from '../i18n/products'
import { weekdayName } from '../lib/agentText'
import { formatMoney } from '../lib/format'

type Choice = NonNullable<SupplierReplyIn['choice']>
const DAYS = [0, 1, 2, 3, 4, 5, 6]
const POLL_MS = 3000

export function SupplierReplyPage() {
  const { token = '' } = useParams()
  const { t, locale } = useI18n()
  const [thread, setThread] = useState<SupplierThread | null>(null)
  const [error, setError] = useState<'notFound' | 'expired' | 'network' | null>(null)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [day, setDay] = useState<number | null>(null)
  const [out, setOut] = useState<string[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  // Поставщику — в сомах, как в сообщении агента: валюта в настройках выбрана хозяином для себя, а не для него.
  const fmt = useCallback((kgs: number) => formatMoney(kgs, locale, 'KGS'), [locale])

  const load = useCallback(async () => {
    try {
      const next = await api.thread(token)
      setThread(next)
      setError(next.status === 'expired' ? 'expired' : null)
    } catch (err) {
      const { status } = errorCode(err)
      setError(status === 404 ? 'notFound' : status === 410 ? 'expired' : 'network')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  // Пока разговор открыт или ждёт подтверждения агента — опрашиваем: подтверждение придёт через несколько секунд.
  const polling = !!thread && (thread.status === 'waiting' || thread.status === 'answered')
  useEffect(() => {
    if (!polling) return
    const id = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(id)
  }, [polling, load])

  const canSend = !!choice || text.trim().length > 0
  const send = useCallback(async () => {
    if (!thread || !canSend || sending) return
    setSending(true)
    try {
      const body: SupplierReplyIn = { text: text.trim(), choice, day: choice === 'other_day' ? day : null, rejected_skus: choice === 'out' ? out : [] }
      setThread(await api.replyThread(thread.token, body))
      setText('')
      setChoice(null)
    } catch (err) {
      const { status } = errorCode(err)
      setError(status === 410 ? 'expired' : status === 404 ? 'notFound' : 'network')
    } finally {
      setSending(false)
    }
  }, [thread, canSend, sending, text, choice, day, out])

  const title = useMemo(() => (thread ? t('supplierPage.title', { shop: thread.shop_name }) : ''), [thread, t])

  if (error === 'notFound' || error === 'expired' || (!thread && error)) {
    return (
      <Shell>
        <p className="h3" data-testid="sreply-error">{t(error === 'expired' ? 'supplierPage.expired' : error === 'notFound' ? 'supplierPage.notFound' : 'errors.network.title')}</p>
      </Shell>
    )
  }
  if (!thread) {
    return (
      <Shell>
        <p className="small">{t('common.loading')}</p>
      </Shell>
    )
  }

  const replied = thread.status !== 'waiting'
  const draft = thread.draft

  return (
    <Shell>
      <div className="stack stack--tight">
        <h1 className="h2" data-testid="sreply-title">{title}</h1>
        <p className="small">{t('supplierPage.intro', { shop: thread.shop_name })}</p>
      </div>

      <ul className="sreply__lines" data-testid="sreply-lines">
        {draft.lines.map((l) => (
          <li key={l.sku} className="sreply__line">
            {!replied && choice === 'out' ? (
              <label>
                <input type="checkbox" checked={out.includes(l.sku)} onChange={(e) => setOut((prev) => (e.target.checked ? [...prev, l.sku] : prev.filter((x) => x !== l.sku)))} data-testid={`sreply-out-${l.sku}`} />
                <span className="truncate">{productName(l.name, locale)}</span>
              </label>
            ) : (
              <span className="truncate">{productName(l.name, locale)}</span>
            )}
            <span className="num-sm">× {l.qty}</span>
          </li>
        ))}
      </ul>
      <div className="row row--between row--wrap small" style={{ gap: 8 }}>
        <span className="c-ink" style={{ fontWeight: 600 }}>{t('supplierPage.total', { sum: fmt(draft.total) })}</span>
        {draft.delivery_day !== null && <span>{t('supplierPage.delivery', { day: weekdayName(draft.delivery_day, locale) })}</span>}
      </div>

      {!replied ? (
        <>
          <div className="sreply__choices" role="group" aria-label={t('supplierPage.send')}>
            {(['confirm', 'out', 'other_day', 'decline'] as Choice[]).map((c) => (
              <Button key={c} variant={c === 'confirm' ? 'primary' : 'secondary'} className={choice === c ? 'is-on' : ''} aria-pressed={choice === c} onClick={() => setChoice((prev) => (prev === c ? null : c))} data-testid={`sreply-${c}`}>
                {c === 'confirm' && <Check size={16} />}
                {t(c === 'confirm' ? 'supplierPage.confirm' : c === 'out' ? 'supplierPage.out' : c === 'other_day' ? 'supplierPage.otherDay' : 'supplierPage.decline')}
              </Button>
            ))}
          </div>
          {choice === 'out' && <p className="small">{t('supplierPage.pickOut')}</p>}
          {choice === 'other_day' && (
            <div className="field">
              <span className="field__label">{t('supplierPage.pickDay')}</span>
              <div className="chips" role="group" aria-label={t('supplierPage.pickDay')}>
                {DAYS.map((d) => (
                  <button key={d} type="button" className={`chip${day === d ? ' is-on' : ''}`} aria-pressed={day === d} onClick={() => setDay(d)} data-testid={`sreply-day-${d}`}>
                    {weekdayName(d, locale, 'short')}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="field">
            <span className="field__label">{t('supplierPage.textLabel')}</span>
            <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('supplierPage.textPlaceholder')} maxLength={1000} data-testid="sreply-text" />
          </label>
          <Button size="lg" block icon={<Send size={16} />} loading={sending} disabled={!canSend} onClick={() => void send()} data-testid="sreply-send">
            {t('supplierPage.send')}
          </Button>
        </>
      ) : (
        <div className="stack stack--tight" data-testid="sreply-done">
          <span className="row" style={{ gap: 6, fontWeight: 600 }}>
            <Check size={16} className="c-ok" />
            {thread.status === 'closed' ? t('supplierPage.closed') : thread.status === 'simulated' ? t('supplierPage.simulated') : t('supplierPage.thanks')}
          </span>
          {thread.status === 'answered' && <span className="small">{t('supplierPage.waitingConfirm')}</span>}
        </div>
      )}

      <div className="stack stack--tight">
        <span className="small" style={{ fontWeight: 600 }}>{t('supplierPage.conversation')}</span>
        <div className="sreply__msgs" data-testid="sreply-msgs">
          {thread.messages.map((m, i) => (
            <div key={i} className={`sreply__msg sreply__msg--${m.sender}`}>
              {m.sender !== 'system' && <span className="small c-ink-2">{m.sender === 'agent' ? t('supplierPage.agent') : t('supplierPage.you')} · </span>}
              {m.text}
            </div>
          ))}
        </div>
      </div>
      {thread.whatsapp_url && !replied && (
        <a className="small row" style={{ gap: 6 }} href={thread.whatsapp_url} target="_blank" rel="noreferrer">
          <MessageCircle size={14} /> WhatsApp
        </a>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <main className="sreply" data-testid="supplier-page">
      <div className="sreply__card">
        <span className="row" style={{ gap: 8 }}><LogoMark size={28} /><span className="h3">Dukon</span></span>
        {children}
      </div>
      <p className="sreply__foot">{t('supplierPage.poweredBy')}</p>
    </main>
  )
}
