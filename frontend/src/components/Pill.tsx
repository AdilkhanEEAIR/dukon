// Пилюли статусов и режима. Статус передаётся цветом текста и подложки, а не кричащей заливкой.

import type { ReactNode } from 'react'
import type { Status } from '../api/types'
import { useT } from '../i18n'

export type Tone = 'neutral' | 'accent' | 'out' | 'low' | 'price' | 'ok'

export const STATUS_TONE: Record<Status, Tone> = {
  out_of_stock: 'out',
  low_stock: 'low',
  price_mismatch: 'price',
  new_item: 'accent',
  ok: 'ok',
}

export function Pill({ tone = 'neutral', children, icon, className }: { tone?: Tone; children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <span className={['pill', tone !== 'neutral' && `pill--${tone}`, className].filter(Boolean).join(' ')}>
      {icon && <span className="pill__icon" aria-hidden>{icon}</span>}
      {children}
    </span>
  )
}

export function StatusPill({ status, short }: { status: Status; short?: boolean }) {
  const t = useT()
  return <Pill tone={STATUS_TONE[status]}>{short ? t(`status.short.${status}`) : t(`status.${status}`)}</Pill>
}
