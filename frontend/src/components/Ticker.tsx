// Число со «щелчком»: при изменении новое значение въезжает с той стороны, куда изменилось
// (больше — снизу вверх, меньше — сверху вниз), на мгновение увеличивается и возвращается.
// Так «+» в заказе ощущается как настоящая кнопка, а не смена текста.

import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

const variants = {
  enter: (dir: number) => ({ y: dir > 0 ? '70%' : '-70%', opacity: 0, scale: 1 }),
  show: { y: '0%', opacity: 1, scale: [1.45, 1], transition: { y: { type: 'spring' as const, stiffness: 520, damping: 28 }, opacity: { duration: 0.18 }, scale: { duration: 0.42, ease: [0.34, 1.56, 0.64, 1] as const } } },
  exit: (dir: number) => ({ y: dir > 0 ? '-70%' : '70%', opacity: 0, transition: { duration: 0.2 } }),
}

export function Ticker({ value, className, testId, format = String }: { value: number; className?: string; testId?: string; format?: (n: number) => string }) {
  const [last, setLast] = useState(value)
  const [dir, setDir] = useState(1)
  if (value !== last) {
    setDir(value > last ? 1 : -1)
    setLast(value)
  }
  return (
    <span className={`ticker${className ? ` ${className}` : ''}`} data-testid={testId} aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.span key={value} className="ticker__v" custom={dir} variants={variants} initial="enter" animate="show" exit="exit">
          {format(value)}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
