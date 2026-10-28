// Поле «где магазин» для форм: свёрнуто в одну кнопку, раскрывается в карту с булавкой.
// Карта тяжёлая — грузим её, только когда человек сам захотел отметить точку.

import { MapPinned } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { GeoPoint } from '../../api/types'
import { useI18n } from '../../i18n'
import { Button } from '../Button'
import { LocationPicker } from './GeoMap'

export function LocationField({
  point,
  address,
  onPoint,
  onAddress,
  defaultOpen = false,
}: {
  point: GeoPoint | null
  address: string
  onPoint: (p: GeoPoint | null) => void
  onAddress: (a: string) => void
  defaultOpen?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="loc-field">
      <Button size="sm" variant={point ? 'secondary' : 'quiet'} icon={<MapPinned size={15} />} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="toggle-map">
        {open ? t('map.hideMap') : point ? t('map.location') : t('map.setOnMap')}
      </Button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="picker"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ paddingTop: 10 }}>
              <LocationPicker value={point} address={address} onChange={onPoint} onAddress={onAddress} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
