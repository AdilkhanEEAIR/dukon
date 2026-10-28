// Агент: честное состояние «ещё не подключён» плюс правила и принцип «модель предлагает — код проверяет».
// Лента решений появится в заходе 4.

import { Bot, ShieldCheck } from 'lucide-react'
import { PageActions } from '../components/Nav'
import { Button } from '../components/Button'
import { EmptyState } from '../components/States'
import { useI18n } from '../i18n'

export function AgentPage() {
  const { t, list } = useI18n()
  const rules = list<string>('agent.rules')
  return (
    <div className="page stagger" style={{ maxWidth: 760 }} data-testid="agent">
      <header className="page-head">
        <div className="page-head__text">
          <h1 className="h1">{t('agent.title')}</h1>
          <p className="page-head__sub">{t('agent.subtitle')}</p>
        </div>
        <PageActions />
      </header>

      <div className="two-col" style={{ alignItems: 'start' }}>
        <div className="sheet">
          <EmptyState icon={Bot} title={t('agent.empty')} text={t('agent.emptyBody')} action={<Button variant="secondary" to="/app">{t('common.home')}</Button>} />
        </div>
        <div className="stack" style={{ gap: 14 }}>
          <div className="sheet sheet--pad stack" style={{ gap: 10 }}>
            <div className="row">
              <ShieldCheck size={18} className="c-accent" />
              <span className="h3">{t('agent.rulesTitle')}</span>
            </div>
            <ol className="stack stack--tight" style={{ margin: 0, paddingLeft: 20 }}>
              {rules.map((r) => (
                <li key={r} className="body-2">{r}</li>
              ))}
            </ol>
          </div>
          <div className="sheet sheet--soft sheet--pad stack stack--tight">
            <span className="h3">{t('agent.howTitle')}</span>
            <p className="body-2">{t('agent.howBody')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
