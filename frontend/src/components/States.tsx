// Состояния экранов: скелетон, пусто, ошибка с причиной, предупреждение. Один вид на всё приложение.

import { CircleAlert, Inbox, RefreshCw, TriangleAlert, WifiOff, type LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { errorCode } from '../api/client'
import { useT } from '../i18n'
import { Button } from './Button'

export function Skeleton({ h = 16, w = '100%', r, style }: { h?: number | string; w?: number | string; r?: number; style?: CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r, ...style }} aria-hidden />
}

/** Скелетон главной/отчёта: повторяет будущую раскладку, чтобы контент не прыгал. */
export function ReportSkeleton() {
  return (
    <div className="stack" data-testid="skeleton" style={{ gap: 18 }}>
      <Skeleton h={120} w={240} r={10} />
      <div className="metric-row">
        <Skeleton h={48} w="70%" />
        <Skeleton h={48} w="70%" />
        <Skeleton h={48} w="70%" />
      </div>
      <Skeleton h={20} w={160} />
      <div className="sheet sheet--pad stack">
        <Skeleton h={44} />
        <Skeleton h={44} />
        <Skeleton h={44} />
      </div>
    </div>
  )
}

export function EmptyState({ icon: Icon = Inbox, title, text, action, tone }: { icon?: LucideIcon; title: string; text?: string; action?: ReactNode; tone?: 'out' }) {
  return (
    <div className="state" data-testid="empty-state">
      <span className={`state__icon${tone ? ` state__icon--${tone}` : ''}`}>
        <Icon size={22} />
      </span>
      <h2 className="h3">{title}</h2>
      {text && <p className="state__text">{text}</p>}
      {action && <div className="state__actions">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, secondary }: { error: unknown; onRetry?: () => void; secondary?: ReactNode }) {
  const t = useT()
  const { code, status, retryable } = errorCode(error)
  const Icon = code === 'network' ? WifiOff : CircleAlert
  return (
    <div className="state" role="alert" data-testid="error-state" data-code={code}>
      <span className="state__icon state__icon--out">
        <Icon size={22} />
      </span>
      <h2 className="h3">{t(`errors.${code}.title`)}</h2>
      <p className="state__text">
        {t(`errors.${code}.hint`)}
        {status ? <span className="c-3"> · {t('errors.code', { n: status })}</span> : null}
      </p>
      <div className="state__actions">
        {onRetry && (retryable || code === 'unknown') && (
          <Button variant="secondary" onClick={onRetry} icon={<RefreshCw size={16} />}>
            {t('common.retry')}
          </Button>
        )}
        {secondary}
      </div>
    </div>
  )
}

export function Notice({ tone = 'low', title, text, action }: { tone?: 'low' | 'out' | 'ok'; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role="status">
      <TriangleAlert size={18} className="notice__icon" />
      <div className="stack stack--tight grow">
        <span className="notice__title">{title}</span>
        {text && <span className="notice__text">{text}</span>}
      </div>
      {action}
    </div>
  )
}
