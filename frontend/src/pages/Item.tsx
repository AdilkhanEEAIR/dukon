// Страница товара для прямых ссылок (из уведомлений). Данные — из последнего обхода.

import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLatest } from '../app/data'
import { IconButton } from '../components/Button'
import { ItemDetail, countHistory } from '../components/ItemDetail'
import { PageActions } from '../components/Nav'
import { EmptyState, ErrorState, ReportSkeleton } from '../components/States'
import { Button } from '../components/Button'
import { useI18n } from '../i18n'

export function ItemPage() {
  const { sku = '' } = useParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  const { latest, reload } = useLatest()
  const decoded = decodeURIComponent(sku)

  return (
    <div className="page stagger" style={{ maxWidth: 640 }} data-testid="item-page">
      <header className="page-head">
        <div className="row">
          <IconButton label={t('common.back')} outline onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/app/shelves'))}>
            <ArrowLeft size={18} />
          </IconButton>
          <span className="small">{t('nav.shelves')}</span>
        </div>
        <PageActions />
      </header>

      {latest.status === 'loading' || latest.status === 'idle' ? (
        <ReportSkeleton />
      ) : latest.status === 'error' ? (
        <ErrorState error={latest.error} onRetry={reload} />
      ) : (
        (() => {
          const change = latest.data?.diff.changes.find((c) => c.sku === decoded)
          if (!latest.data || !change) {
            return <EmptyState title={t('item.notFound')} text={t('item.notFoundBody')} action={<Button variant="secondary" to="/app/shelves">{t('nav.shelves')}</Button>} />
          }
          return <ItemDetail change={change} history={countHistory(latest.data.walks, change.sku)} />
        })()
      )}
    </div>
  )
}
