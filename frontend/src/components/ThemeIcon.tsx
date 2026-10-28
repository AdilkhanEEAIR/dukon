// Иконка темы: одно солнце, которое превращается в луну. Лучи сворачиваются и уходят вращением,
// диск растёт, а маска «откусывает» серп; в тёмной теме рядом загораются две звезды.
// Рисуем сами, потому что две отдельные иконки при смене просто подменяют друг друга — тут видно превращение.

import { motion } from 'motion/react'
import { useId } from 'react'

const EASE = [0.22, 1, 0.36, 1] as const
const RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4
  const p = (r: number) => [12 + r * Math.cos(a), 12 + r * Math.sin(a)].map((v) => +v.toFixed(2))
  const [x1, y1] = p(7.3)
  const [x2, y2] = p(9.7)
  return { x1, y1, x2, y2 }
})

export function ThemeIcon({ dark, size = 20, animate = true }: { dark: boolean; size?: number; animate?: boolean }) {
  const mask = `theme-mask-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const t = (delay = 0) => (animate ? { duration: 0.6, ease: EASE, delay } : { duration: 0 })
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={`theme-icon theme-icon--${dark ? 'moon' : 'sun'}`} aria-hidden focusable="false">
      <defs>
        <mask id={mask}>
          <rect width="24" height="24" fill="#fff" />
          {/* «Укус»: в светлой теме тень спрятана за краем, в тёмной наезжает на диск и делает серп */}
          <motion.circle r="6.4" fill="#000" initial={false} animate={dark ? { cx: 16.8, cy: 7.2 } : { cx: 31, cy: -7 }} transition={t()} />
        </mask>
      </defs>
      <motion.g
        initial={false}
        animate={dark ? { rotate: 60, scale: 0.3, opacity: 0 } : { rotate: 0, scale: 1, opacity: 1 }}
        transition={t(dark ? 0 : 0.12)}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      >
        {RAYS.map((r, i) => (
          <line key={i} {...r} />
        ))}
      </motion.g>
      <motion.circle cx="12" cy="12" fill="currentColor" mask={`url(#${mask})`} initial={false} animate={{ r: dark ? 8.6 : 4.8 }} transition={t()} />
      <motion.g initial={false} animate={dark ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.2 }} transition={t(dark ? 0.25 : 0)} fill="currentColor">
        <path d="M18.9 3.6l.55 1.4 1.4.55-1.4.55-.55 1.4-.55-1.4-1.4-.55 1.4-.55z" />
        <circle cx="21.4" cy="10.4" r=".8" />
      </motion.g>
    </svg>
  )
}
