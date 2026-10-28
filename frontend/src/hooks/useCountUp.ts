// Число «набегает» один раз при первом показе: редкое событие (открыли главную) — можно позволить
// 600 мс. При reduced-motion и в тестах показываем конечное значение сразу.

import { useEffect, useRef, useState } from 'react'

const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3)

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0))
  const from = useRef(0)

  useEffect(() => {
    if (prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
      setValue(target)
      return
    }
    const start = performance.now()
    const begin = from.current
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs)
      const v = begin + (target - begin) * EASE_OUT(p)
      setValue(v)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  return value
}
