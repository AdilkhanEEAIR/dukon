// Выпадающий список вместо системного <select>: тот же смысл (listbox), но с нашей типографикой,
// плавной подсветкой, которая переезжает между пунктами, и раскрытием от кнопки (origin-aware).
// Клавиатура как у системного: стрелки, Home/End, Enter/пробел, Escape, Tab.

import { Check, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface DropdownOption<V extends string> {
  value: V
  label: string
  hint?: string
  icon?: ReactNode
  /** Короткая подпись в закрытом состоянии (например, «EN» вместо «English»). */
  short?: string
}

interface Props<V extends string> {
  value: V
  options: DropdownOption<V>[]
  onChange: (value: V) => void
  label: string
  /** Показывать подпись поля над кнопкой (для форм). */
  visibleLabel?: boolean
  compact?: boolean
  block?: boolean
  align?: 'start' | 'end'
  icon?: ReactNode
  footer?: (close: () => void) => ReactNode
  testId?: string
  id?: string
  renderTrigger?: (selected: DropdownOption<V> | undefined) => ReactNode
}

const MENU_MAX = 320

export function Dropdown<V extends string>({ value, options, onChange, label, visibleLabel, compact, block, align = 'start', icon, footer, testId, id, renderTrigger }: Props<V>) {
  const uid = useId()
  const listId = `${uid}-list`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)))
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const selected = options.find((o) => o.value === value)

  const close = useCallback((focusTrigger = true) => {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }, [])

  // Отдельная функция для подвала меню: действие внизу закрывает меню, не возвращая фокус на кнопку.
  const closeQuiet = useCallback(() => setOpen(false), [])

  const openMenu = useCallback(() => {
    // Открываемся туда, где больше места: в рейле снизу экрана меню уходит вверх.
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect && typeof window !== 'undefined') {
      const below = window.innerHeight - rect.bottom
      setPlacement(below < MENU_MAX && rect.top > below ? 'top' : 'bottom')
    }
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }, [options, value])

  // Клик мимо меню закрывает его, не забирая фокус у того, куда кликнули.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, close])

  useLayoutEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  const choose = (i: number) => {
    const opt = options[i]
    if (!opt) return
    onChange(opt.value)
    close()
  }

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      openMenu()
    }
  }

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((a) => (a >= last ? 0 : a + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((a) => (a <= 0 ? last : a - 1))
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(last)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(active)
        break
      case 'Escape':
        e.preventDefault()
        close()
        break
      case 'Tab':
        close(false)
        break
    }
  }

  const fromTop = placement === 'top'

  return (
    <div ref={wrapRef} className={`dd${block ? ' dd--block' : ''}${compact ? ' dd--compact' : ''}`} data-open={open || undefined}>
      {visibleLabel && (
        <label className="field__label" htmlFor={id ?? `${uid}-trigger`}>
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        id={id ?? `${uid}-trigger`}
        type="button"
        className="dd__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={visibleLabel ? undefined : label}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
        data-testid={testId}
      >
        {renderTrigger ? (
          renderTrigger(selected)
        ) : (
          <>
            {icon ?? selected?.icon}
            <span className="dd__value">{compact && selected?.short ? selected.short : (selected?.label ?? '')}</span>
          </>
        )}
        <ChevronDown size={16} className="dd__chevron" aria-hidden />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className={`dd__menu dd__menu--${placement} dd__menu--${align}`}
            initial={{ opacity: 0, scale: 0.96, y: fromTop ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: fromTop ? 4 : -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: `${align === 'end' ? 'right' : 'left'} ${fromTop ? 'bottom' : 'top'}` }}
          >
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={label}
              aria-activedescendant={`${uid}-opt-${active}`}
              tabIndex={-1}
              className="dd__list"
              onKeyDown={onListKey}
            >
              {options.map((o, i) => {
                const isSel = o.value === value
                return (
                  <li
                    key={o.value}
                    id={`${uid}-opt-${i}`}
                    role="option"
                    aria-selected={isSel}
                    className={`dd__option${i === active ? ' is-active' : ''}${isSel ? ' is-selected' : ''}`}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => choose(i)}
                  >
                    {i === active && <motion.span layoutId={`${uid}-hl`} className="dd__hl" transition={{ type: 'spring', duration: 0.25, bounce: 0 }} />}
                    {o.icon && <span className="dd__icon">{o.icon}</span>}
                    <span className="dd__text">
                      <span className="dd__label">{o.label}</span>
                      {o.hint && <span className="dd__hint">{o.hint}</span>}
                    </span>
                    {isSel && <Check size={16} className="dd__check" aria-hidden />}
                  </li>
                )
              })}
            </ul>
            {footer && <div className="dd__footer">{footer(closeQuiet)}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
