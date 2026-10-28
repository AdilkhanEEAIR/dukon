// Число «набегает»: при первом показе — от нуля, при изменении — от того, что сейчас на экране
// (сумма заказа после «+» плавно доезжает до нового итога, без скачка). В спокойном режиме и в тестах
// показываем конечное значение сразу.

import { useEffect, useRef, useState } from 'react'

const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 4)

/** Режим из настроек (атрибут data-motion на <html>), а пока его нет — системная настройка. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  const chosen = document.documentElement.dataset.motion
  if (chosen) return chosen === 'calm'
  return !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0))
  // Текущее показанное значение: новая анимация стартует отсюда, а не с конца прошлой.
  const shown = useRef(value)

  useEffect(() => {
    if (prefersReducedMotion() || typeof requestAnimationFrame === 'undefined' || durationMs <= 0) {
      shown.current = target
      setValue(target)
      return
    }
    const begin = shown.current
    if (begin === target) return
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs)
      const v = begin + (target - begin) * EASE_OUT(p)
      shown.current = v
      setValue(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  return value
}
