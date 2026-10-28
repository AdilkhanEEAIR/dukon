// Система: режим, бюджет вызовов, ошибки моделей. Судьям видно, что деньги считаются.

import { RefreshCw, ShieldCheck } from 'lucide-react'
import { useMode } from '../app/mode'
import { Button } from '../components/Button'
import { TimeAgo } from '../components/Live'
import { ModePill, PageActions } from '../components/Nav'
import { EmptyState, Skeleton } from '../components/States'
import { useI18n } from '../i18n'
import { formatNumber } from '../lib/format'

export function SystemPage() {
  const { t, locale } = useI18n()
  const { status, health, budget, refresh, fetchedAt } = useMode()

  return (
    <div className="page stagger" style={{ maxWidth: 720 }} data-testid="system">
      <header className="page-head">
        <div className="page-head__text">
          <h1 className="h1">{t('system.title')}</h1>
          <p className="page-head__sub">
            {t('system.subtitle')}
            {fetchedAt && (
              <>
                {' · '}
                <TimeAgo at={fetchedAt} label={(ago) => t('home.updated', { t: ago })} />
              </>
            )}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" variant="secondary" onClick={() => void refresh()} icon={<RefreshCw size={14} />}>
            {t('system.refresh')}
          </Button>
          <PageActions />
        </div>
      </header>

      {status === 'loading' ? (
        <div className="stack">
          <Skeleton h={120} r={18} />
          <Skeleton h={200} r={18} />
        </div>
      ) : status === 'down' || !health ? (
        <EmptyState tone="out" title={t('system.serverDown')} text={t('errors.network.hint')} action={<Button variant="secondary" onClick={() => void refresh()}>{t('common.retry')}</Button>} />
      ) : (
        <div className="two-col" style={{ alignItems: 'start' }}>
          <div className="sheet" style={{ padding: '2px 18px' }}>
            <div className="rows">
              <div className="kv">
                <span className="kv__k">{t('system.mode')}</span>
                <ModePill />
              </div>
              <div className="kv">
                <span className="kv__k">{t('system.provider')}</span>
                <span className="kv__v mono">{health.provider}</span>
              </div>
              <div className="kv">
                <span className="kv__k">{t('system.version')}</span>
                <span className="kv__v mono">{health.version}</span>
              </div>
              <div className="kv">
                <span className="kv__k">{t('system.callsToday')}</span>
                <span className="kv__v" data-testid="calls-today">
                  {budget?.calls_today ?? 0} / {budget?.calls_limit ?? 0}
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">{t('system.callsLeft')}</span>
                <span className="kv__v">{budget?.calls_left ?? 0}</span>
              </div>
              <div className="kv">
                <span className="kv__k">{t('system.spend')}</span>
                <span className="kv__v">${formatNumber(budget?.est_spend_usd ?? 0, locale, 2)}</span>
              </div>
              <div className="kv">
                <span className="kv__k">{t('system.errors')}</span>
                <span className={`kv__v${budget?.errors_today ? ' c-out' : ''}`}>{budget?.errors_today ?? 0}</span>
              </div>
              <div className="kv">
                <span className="kv__k">{t('system.lastError')}</span>
                <span className="kv__v mono">{budget?.last_error ? t(`errors.${budget.last_error as 'unknown'}.title`) : t('system.none')}</span>
              </div>
            </div>
          </div>
          <div className="sheet sheet--soft sheet--pad stack stack--tight">
            <div className="row">
              <ShieldCheck size={18} className="c-accent" />
              <span className="h3">{t('system.protection')}</span>
            </div>
            <p className="body-2">{t('system.protectionBody')}</p>
            {budget && (
              <div className="bar" style={{ marginTop: 8 }}>
                <div className="bar__fill" style={{ width: `${Math.min(100, (budget.calls_today / Math.max(1, budget.calls_limit)) * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
