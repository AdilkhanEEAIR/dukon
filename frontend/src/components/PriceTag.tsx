// Ценник потерь — главный объект главной: бумажная бирка висит на крючке и чуть качается при появлении,
// а под курсором тянется к нему, будто её задели рукой (на телефоне и в спокойном режиме — не двигается).
// Сумма в выбранной валюте; в сомах — с подписью «≈ $», в другой валюте — с сомами «по ценникам»; и прикидка на месяц.

import type { PointerEvent, ReactNode } from 'react'
import { useSettings } from '../app/settings'
import { useCountUp } from '../hooks/useCountUp'
import { useI18n } from '../i18n'
import { formatMoney, formatSom } from '../lib/format'

export function LossTag({ valueKgs, label, unit, note, animate = true }: { valueKgs: number; label: ReactNode; unit: string; note?: string; animate?: boolean }) {
  const { t, locale } = useI18n()
  const { settings } = useSettings()
  const shown = useCountUp(valueKgs, animate ? 1200 : 0)
  const fmt = (v: number) => formatMoney(v, locale, settings.currency)
  // Наклон пишем прямо в CSS-переменную, без состояния React: движение мыши не должно перерисовывать бирку.
  const sway = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || document.documentElement.dataset.motion === 'calm') return
    const r = e.currentTarget.getBoundingClientRect()
    const dx = (e.clientX - r.left) / r.width - 0.5
    e.currentTarget.style.setProperty('--sway', `${(-dx * 5).toFixed(2)}deg`)
  }
  const rest = (e: PointerEvent<HTMLDivElement>) => e.currentTarget.style.setProperty('--sway', '0deg')
  return (
    <div className={`tag tag--loss${animate ? ' tag--enter' : ''}`} data-testid="loss-tag" onPointerMove={sway} onPointerLeave={rest}>
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
      {note && <span className="tag__note">{note}</span>}
      <span className="tag__foot">
        <span>
          ≈ {fmt(valueKgs * 30)} {t('common.perMonth')}
        </span>
        {settings.currency !== 'KGS' && <span>{t('home.originalSom', { v: formatSom(valueKgs, locale) })}</span>}
      </span>
    </div>
  )
}
