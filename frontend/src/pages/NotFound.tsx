import { SearchCheck } from 'lucide-react'
import { Button } from '../components/Button'
import { EmptyState } from '../components/States'
import { useI18n } from '../i18n'

export function NotFoundPage() {
  const { t } = useI18n()
  return (
    <div className="page stagger" data-testid="not-found">
      <EmptyState icon={SearchCheck} title={t('notFound.title')} text={t('notFound.body')} action={<Button to="/app">{t('common.home')}</Button>} />
    </div>
  )
}
