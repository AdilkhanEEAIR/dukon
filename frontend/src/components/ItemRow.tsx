// Строка товара в списках: рисунок товара слева, название и статус тоном, числа было → стало справа.
// Появление строки делает общий наблюдатель прокрутки — своей анимации входа у неё нет, чтобы не было двойной.

import { ArrowRight, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ItemChange } from '../api/types'
import { useI18n } from '../i18n'
import { STATUS_TONE } from './Pill'
import { ProductIcon } from './ProductIcon'

export function ItemRow({ change, onOpen }: { change: ItemChange; onOpen?: (change: ItemChange) => void }) {
  const { t, product } = useI18n()
  const navigate = useNavigate()
  const tone = STATUS_TONE[change.status]
  const open = () => (onOpen ? onOpen(change) : navigate(`/app/item/${encodeURIComponent(change.sku)}`))
  return (
    <button type="button" className="item-row item-row--link" onClick={open} data-testid="item-row" data-tone={tone}>
      <ProductIcon name={change.name} empty={change.status === 'out_of_stock'} />
      <span className="stack" style={{ gap: 1, minWidth: 0, textAlign: 'left' }}>
        <span className="item-row__name truncate">{product(change.name)}</span>
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
        <ChevronRight size={16} className="item-row__go" aria-hidden />
      </span>
    </button>
  )
}
