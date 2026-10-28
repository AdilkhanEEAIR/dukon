// «Прожектор» под курсором: карточки и строки подсвечиваются мягким пятном там, где мышь.
// Один слушатель на документ; координаты кладём в CSS-переменные, рисует всё CSS (::after).
// На тач-экранах не включаемся — там нет курсора, а лишний слушатель только тратит батарею.

import { useEffect } from 'react'

export const SPOT_TARGETS = '.lift, .step-card, .item-row--link, .notif, .branch-row, .model, .shop-card, .order-line'

export function useSpotlight() {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia?.('(hover: hover)').matches) return
    let frame = 0
    let last: PointerEvent | null = null
    const apply = () => {
      frame = 0
      const e = last
      if (!e || !(e.target instanceof Element)) return
      const el = e.target.closest<HTMLElement>(SPOT_TARGETS)
      if (!el) return
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      last = e
      if (!frame) frame = requestAnimationFrame(apply)
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
}
