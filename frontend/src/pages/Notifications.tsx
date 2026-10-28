// Уведомления: список из данных, нажатие ведёт к товару или в «Систему» и помечает прочитанным.

import { BellOff, ChevronRight, CircleCheck, PackageSearch, Tag, TrendingDown, Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useNotifications, type Notification } from '../app/notifications'
import { Button } from '../components/Button'
import { PageActions } from '../components/Nav'
import { Pill } from '../components/Pill'
import { EmptyState } from '../components/States'
import { useI18n } from '../i18n'
import { formatShortDate, formatTime } from '../lib/format'

const ICON = {
  out_of_stock: { Icon: PackageSearch, cls: 'notif__icon--out' },
  low_stock: { Icon: TrendingDown, cls: 'notif__icon--low' },
  price_mismatch: { Icon: Tag, cls: 'notif__icon--price' },
  mode: { Icon: Zap, cls: '' },
  live: { Icon: CircleCheck, cls: 'notif__icon--ok' },
} as const

export function NotificationsPage() {
  const { t, locale, product } = useI18n()
  const { items, unread, markAll, markRead } = useNotifications()
  const navigate = useNavigate()

  const open = (n: Notification) => {
    markRead(n.id)
    if (n.to) navigate(n.to)
  }

  const text = (n: Notification) => {
    const p = { ...n.params }
    if (n.kind === 'mode') p.reason = t(`mode.reasons.${String(p.reason) as 'unknown'}`)
    if (typeof p.name === 'string') p.name = product(p.name)
    return t(`notifications.kinds.${n.kind}`, p)
  }

  return (
    <div className="page stagger" style={{ maxWidth: 720 }} data-testid="notifications">
      <header className="page-head">
        <div className="page-head__text">
          <span className="small">{unread ? t('notifications.unread', { n: unread }) : t('common.appName')}</span>
          <h1 className="h1">{t('notifications.title')}</h1>
        </div>
        <PageActions />
      </header>
      {unread > 0 && (
        <div>
          <Button size="sm" variant="secondary" onClick={markAll} data-testid="mark-all">
            {t('notifications.markAll')}
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon={BellOff} title={t('notifications.empty')} text={t('notifications.emptyBody')} />
      ) : (
        <div className="sheet" style={{ padding: '4px 16px' }}>
          <div className="rows">
            {items.map((n) => {
              const { Icon, cls } = ICON[n.kind]
              return (
                <button key={n.id} type="button" className={`notif${n.read ? ' notif--read' : ' notif--unread'}`} onClick={() => open(n)} data-testid="notif" data-read={n.read}>
                  <span className={`notif__icon ${cls}`}>
                    <Icon size={17} />
                  </span>
                  <span className="stack" style={{ gap: 3 }}>
                    <span style={{ fontWeight: n.read ? 500 : 700 }}>{text(n)}</span>
                    <span className="small">
                      {formatShortDate(n.at, locale)} · {formatTime(n.at, locale)}
                    </span>
                  </span>
                  <ChevronRight size={16} className="c-3" style={{ marginTop: 10 }} />
                </button>
              )
            })}
          </div>
        </div>
      )}
      {items.length > 0 && unread === 0 && <Pill tone="ok">{t('notifications.empty')}</Pill>}
    </div>
  )
}
