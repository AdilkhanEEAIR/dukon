import type { Status } from '../api/types'

export type Tone = 'danger' | 'warning' | 'success' | 'info' | 'neutral' | 'violet'

export const STATUS_META: Record<Status, { tone: Tone; label: string; short: string }> = {
  out_of_stock: { tone: 'danger', label: 'Нет в наличии', short: 'Нет' },
  low_stock: { tone: 'warning', label: 'Мало', short: 'Мало' },
  price_mismatch: { tone: 'info', label: 'Ценник не совпадает', short: 'Ценник' },
  new_item: { tone: 'violet', label: 'Новое', short: 'Новое' },
  ok: { tone: 'neutral', label: 'Без изменений', short: 'Ок' },
}

export const STATUS_COLOR: Record<Status, string> = {
  out_of_stock: 'var(--danger)',
  low_stock: 'var(--warning)',
  price_mismatch: 'var(--info)',
  new_item: 'var(--violet)',
  ok: 'var(--text-tertiary)',
}

export function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`chip chip--${tone}`}>{children}</span>
}

export function StatusChip({ status, short }: { status: Status; short?: boolean }) {
  const meta = STATUS_META[status]
  return <Chip tone={meta.tone}>{short ? meta.short : meta.label}</Chip>
}
