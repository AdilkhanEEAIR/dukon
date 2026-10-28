// Полоса загрузки сверху: тонкая линия цвета акцента. Видна, пока идут запросы к серверу,
// и коротко пробегает при каждой смене страницы — человек видит, что нажатие сработало.
// Прогресс «честно-нечестный»: быстро до трети, потом медленно ползёт, а по готовности добегает до конца.

import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { subscribeActivity } from '../lib/activity'

const ROUTE_PULSE_MS = 520

export function TopLoader() {
  const bar = useRef<HTMLDivElement>(null)
  const [netBusy, setNetBusy] = useState(false)
  const [routeBusy, setRouteBusy] = useState(false)
  const { pathname } = useLocation()
  const busy = netBusy || routeBusy

  useEffect(() => subscribeActivity((n) => setNetBusy(n > 0)), [])

  // Смена страницы — короткий импульс, даже если данные уже были в памяти.
  const [seenPath, setSeenPath] = useState(pathname)
  if (seenPath !== pathname) {
    setSeenPath(pathname)
    setRouteBusy(true)
  }
  useEffect(() => {
    if (!routeBusy) return
    const id = window.setTimeout(() => setRouteBusy(false), ROUTE_PULSE_MS)
    return () => window.clearTimeout(id)
  }, [routeBusy, pathname])

  useEffect(() => {
    const el = bar.current
    if (!el || typeof el.animate !== 'function') return
    el.getAnimations?.().forEach((a) => a.cancel())
    if (busy) {
      el.animate(
        [
          { transform: 'scaleX(0)', opacity: 1, offset: 0 },
          { transform: 'scaleX(0.35)', opacity: 1, offset: 0.06 },
          { transform: 'scaleX(0.86)', opacity: 1, offset: 1 },
        ],
        { duration: 7000, easing: 'cubic-bezier(0.1, 0.6, 0.2, 1)', fill: 'forwards' },
      )
    } else {
      const from = getComputedStyle(el).transform
      el.animate(
        [
          { transform: from === 'none' ? 'scaleX(0)' : from, opacity: 1 },
          { transform: 'scaleX(1)', opacity: 1, offset: 0.55 },
          { transform: 'scaleX(1)', opacity: 0 },
        ],
        { duration: 520, easing: 'ease-out', fill: 'forwards' },
      )
    }
  }, [busy])

  return (
    <div className="top-loader" aria-hidden data-busy={busy || undefined} data-testid="top-loader">
      <div ref={bar} className="top-loader__bar" />
    </div>
  )
}
