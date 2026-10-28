// Деньги везде одинаково: сумма набегает от нуля (или от прошлого значения), а если показаны сомы —
// рядом серым «≈ $8.56», чтобы судья и гость из-за границы сразу понимали масштаб.
// Пересчёт — по курсу НБКР из lib/currency; данные при этом остаются в сомах.

import { useSettings } from '../app/settings'
import { useCountUp } from '../hooks/useCountUp'
import { useI18n } from '../i18n'
import { formatMoney } from '../lib/format'

export interface MoneyProps {
  /** Сумма в сомах. null — цены нет (покажем «—»). */
  kgs: number | null | undefined
  className?: string
  testId?: string
  /** price — цена за штуку: сомы с копейками, если они есть на ценнике. */
  kind?: 'sum' | 'price'
  /** Подпись «≈ $» под суммой (для крупных чисел), а не рядом. */
  altBlock?: boolean
  /** Без подписи в долларах — там, где строка и так тесная (подписи графиков). */
  noAlt?: boolean
  animate?: boolean
}

export function Money({ kgs, className, testId, kind = 'sum', altBlock, noAlt, animate = true }: MoneyProps) {
  const { locale } = useI18n()
  const { settings } = useSettings()
  const target = kgs ?? 0
  const shown = useCountUp(target, animate ? 900 : 0)
  // Копейки на ценнике решаются по итоговой цене: пока число бежит, оно дробное, а формат не должен прыгать.
  const opts = kind === 'price' && settings.currency === 'KGS' && !Number.isInteger(target) ? { decimals: 2 } : {}
  const fmt = (v: number) => formatMoney(v, locale, settings.currency, opts)
  if (kgs === null || kgs === undefined) return <span className={className} data-testid={testId}>—</span>
  const showAlt = !noAlt && settings.currency === 'KGS' && kgs !== 0
  const alt = showAlt ? `≈ ${formatMoney(shown, locale, 'USD')}` : ''
  return (
    <span className={`money${altBlock ? ' money--block' : ''}${className ? ` ${className}` : ''}`} data-testid={testId} aria-label={showAlt ? `${fmt(kgs)} (≈ ${formatMoney(kgs, locale, 'USD')})` : fmt(kgs)}>
      <span className="money__main" aria-hidden>
        {fmt(shown)}
      </span>
      {showAlt && (
        <span className="money__alt" aria-hidden>
          {alt}
        </span>
      )}
    </span>
  )
}
