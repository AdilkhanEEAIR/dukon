// Шторка снизу на телефоне, панель справа на ПК. Пружина, свайп вниз закрывает, Escape закрывает.
// Пружина нужна, потому что жест можно прервать на полпути — CSS-переход сбросится, пружина продолжит.

import { AnimatePresence, motion, type PanInfo } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 1024px)').matches : false))
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = (e: MediaQueryListEvent) => setDesktop(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return desktop
}

export function Drawer({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const desktop = useIsDesktop()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 600) onClose()
  }

  const hidden = desktop ? { x: '100%' } : { y: '100%' }
  const shown = desktop ? { x: 0 } : { y: 0 }

  // Портал в body: .page анимирует transform и иначе стал бы containing block для fixed-шторки.
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.div
            key="drawer"
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            data-testid="drawer"
            initial={hidden}
            animate={shown}
            exit={hidden}
            transition={{ type: 'spring', duration: 0.42, bounce: 0 }}
            drag={desktop ? false : 'y'}
            dragConstraints={{ top: 0 }}
            dragElastic={0.08}
            onDragEnd={onDragEnd}
          >
            <div className="drawer__grip" aria-hidden />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
