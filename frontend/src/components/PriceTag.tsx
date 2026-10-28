// Ценник потерь — главный объект главной: бумажная бирка висит на крючке и чуть качается при появлении.
// Сумма в выбранной валюте; в сомах — с подписью «≈ $», в другой валюте — с сомами «по ценникам»; и прикидка на месяц.

import type { ReactNode } from 'react'
import { useSettings } from '../app/settings'
import { useCountUp } from '../hooks/useCountUp'
import { useI18n } from '../i18n'
import { formatMoney, formatSom } from '../lib/format'

export function LossTag({ valueKgs, label, unit, animate = true }: { valueKgs: number; label: ReactNode; unit: string; animate?: boolean }) {
  const { t, locale } = useI18n()
  const { settings } = useSettings()
  const shown = useCountUp(valueKgs, animate ? 1200 : 0)
  const fmt = (v: number) => formatMoney(v, locale, settings.currency)
  return (
    <div className={`tag tag--loss${animate ? ' tag--enter' : ''}`} data-testid="loss-tag">
      <span className="tag__hook" aria-hidden />
      <span className="tag__label">{label}</span>
      <span className="tag__value" aria-label={fmt(valueKgs)}>
        <span aria-hidden>{fmt(shown)}</span>
      </span>
      {settings.currency === 'KGS' && valueKgs > 0 && (
        <span className="tag__alt" data-testid="loss-tag-usd">
          ≈ {formatMoney(shown, locale, 'USD')}
        </span>
      )}
      <span className="tag__unit">{unit}</span>
      <span className="tag__foot">
        <span>
          ≈ {fmt(valueKgs * 30)} {t('common.perMonth')}
        </span>
        {settings.currency !== 'KGS' && <span>{t('home.originalSom', { v: formatSom(valueKgs, locale) })}</span>}
      </span>
    </div>
  )
}
