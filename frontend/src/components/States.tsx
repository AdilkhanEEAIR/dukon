// Пустые, ошибочные и загрузочные состояния. Одинаковые на всех страницах.

import { describeError } from '../api/client'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'

export function EmptyState({ icon = 'shelf', title, text, action }: { icon?: IconName; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="state" data-testid="empty-state">
      <div className="state__icon">
        <Icon name={icon} size={24} />
      </div>
      <div className="h3">{title}</div>
      {text && <p className="caption">{text}</p>}
      {action && <div className="state__actions">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, secondary }: { error: unknown; onRetry?: () => void; secondary?: React.ReactNode }) {
  const info = describeError(error)
  const offline = info.code === 'network'
  return (
    <div className="state" role="alert" data-testid="error-state" data-code={info.code}>
      <div className={`state__icon ${offline ? 'state__icon--warning' : 'state__icon--danger'}`}>
        <Icon name={offline ? 'wifiOff' : 'alert'} size={24} />
      </div>
      <div className="h3">{info.title}</div>
      <p className="caption">{info.hint}</p>
      <div className="state__actions">
        {onRetry && (
          <Button variant="primary" onClick={onRetry} icon={<Icon name="refresh" size={16} />}>
            Повторить
          </Button>
        )}
        {secondary}
      </div>
    </div>
  )
}

export function Skeleton({ w = '100%', h = 14, r = 8, style }: { w?: string | number; h?: number; r?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />
}

export function ReportSkeleton() {
  return (
    <div className="stack" data-testid="skeleton">
      <div className="card stack">
        <Skeleton w={120} h={11} />
        <Skeleton w={160} h={40} />
        <Skeleton w="70%" h={12} />
      </div>
      <div className="grid-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card stack">
            <Skeleton w={48} h={28} />
            <Skeleton w={90} h={11} />
          </div>
        ))}
      </div>
      <div className="card stack">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="row">
            <Skeleton w={3} h={28} r={2} />
            <div className="stack" style={{ flex: 1, gap: 6 }}>
              <Skeleton w="55%" h={13} />
              <Skeleton w="35%" h={11} />
            </div>
            <Skeleton w={60} h={16} />
          </div>
        ))}
      </div>
    </div>
  )
}
