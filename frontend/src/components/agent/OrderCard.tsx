// Утверждённый заказ: сумма, день доставки, кнопка «Отправить в WhatsApp» (готовое сообщение поставщику)
// и отметка «отправлено». Ссылка открывает WhatsApp на телефоне и WhatsApp Web на ПК.

import { Check, MessageCircle } from 'lucide-react'
import type { Order } from '../../api/types'
import { useI18n } from '../../i18n'
import { productName } from '../../i18n/products'
import { supplierTitle, weekdayName } from '../../lib/agentText'
import { Button } from '../Button'
import { Money } from '../Money'
import { Pill } from '../Pill'

export function OrderCard({ order, onSent }: { order: Order; onSent: (o: Order) => void }) {
  const { t, locale } = useI18n()
  const sent = order.status === 'sent'
  return (
    <div className={`order-card${sent ? ' is-sent' : ''}`} data-testid="order-card" data-status={order.status}>
      <div className="row row--between" style={{ gap: 8 }}>
        <div className="stack stack--tight grow">
          <span style={{ fontWeight: 600 }} className="truncate">{supplierTitle(order, locale)}</span>
          <span className="small">
            {order.lines.map((l) => `${productName(l.name, locale)} × ${l.qty}`).join(' · ')}
            {order.delivery_day !== null && ` · ${t('agent.feed.delivery', { day: weekdayName(order.delivery_day, locale) })}`}
          </span>
        </div>
        <Money kgs={order.total} className="num-md" noAlt animate={false} />
      </div>
      <div className="row row--wrap" style={{ gap: 8 }}>
        {sent ? (
          <Pill tone="ok" icon={<Check size={12} />}>
            {t('agent.result.sent')}
          </Pill>
        ) : (
          <>
            <a className="btn btn--primary btn--sm" href={order.whatsapp_url} target="_blank" rel="noreferrer noopener" data-testid="whatsapp-link">
              <span className="btn__content">
                <MessageCircle size={16} /> {t('agent.result.whatsapp')}
              </span>
            </a>
            <Button variant="quiet" size="sm" onClick={() => onSent(order)} data-testid="mark-sent">
              {t('agent.result.markSent')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
