// Строка товара в списках: метка статуса слева тоном, числа было → стало справа.

import { ArrowRight } from 'lucide-react'
import { motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import type { ItemChange } from '../api/types'
import { useT } from '../i18n'
import { STATUS_TONE } from './Pill'

export function ItemRow({ change, index = 0, onOpen }: { change: ItemChange; index?: number; onOpen?: (change: ItemChange) => void }) {
  const t = useT()
  const navigate = useNavigate()
  const tone = STATUS_TONE[change.status]
  const open = () => (onOpen ? onOpen(change) : navigate(`/app/item/${encodeURIComponent(change.sku)}`))
  return (
    <motion.button
      type="button"
      className="item-row item-row--link"
      onClick={open}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1], delay: Math.min(index, 8) * 0.03 }}
      data-testid="item-row"
    >
      <span className={`mark c-${tone}`} aria-hidden />
      <span className="stack" style={{ gap: 1, minWidth: 0, textAlign: 'left' }}>
        <span className="item-row__name truncate">{change.name}</span>
        <span className={`item-row__meta c-${tone}`}>{t(`status.${change.status}`)}</span>
      </span>
      <span className="item-row__nums">
        {change.before !== null && (
          <>
            <span className="num-sm c-3">{change.before}</span>
            <ArrowRight size={12} className="c-3" aria-hidden />
          </>
        )}
        <span className={`num-md c-${tone}`}>{change.after}</span>
      </span>
    </motion.button>
  )
}
