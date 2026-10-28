// Сегментированный фильтр: индикатор переезжает за выбранным пунктом (layout-анимация motion),
// а не прыгает — пользователь видит, откуда и куда ушёл выбор.

import { motion } from 'motion/react'
import { useId } from 'react'
import { Ticker } from './Ticker'

export interface Segment<K extends string> {
  key: K
  label: string
  count?: number
}

export function Segmented<K extends string>({ value, onChange, items, label }: { value: K; onChange: (k: K) => void; items: Segment<K>[]; label: string }) {
  const group = useId()
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {items.map((it) => {
        const active = it.key === value
        return (
          <button key={it.key} type="button" role="tab" aria-selected={active} className={`seg__item${active ? ' is-active' : ''}`} onClick={() => onChange(it.key)}>
            {active && <motion.span layoutId={`seg-${group}`} className="seg__thumb" transition={{ type: 'spring', duration: 0.32, bounce: 0.1 }} />}
            <span style={{ position: 'relative', zIndex: 1 }}>
              {it.label}
              {it.count ? <Ticker value={it.count} className="seg__count" /> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
