// Количество в заказе: «−», поле и «+». Кнопки — для мелкой правки, поле — когда поставщик везёт ящиками
// и нужно сразу 48, а не сорок восемь нажатий. Пока человек печатает, число в заказе не прыгает:
// принимаем на Enter или при уходе из поля, Escape возвращает прежнее. Стрелки ↑/↓ — ±1, с Shift — ±10.

import { Minus, Plus } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'

export const QTY_MAX = 9999

/** Из того, что напечатали, — целое от 0 до QTY_MAX. Пусто или мусор — ноль, а не NaN в сумме заказа. */
export function parseQty(text: string): number {
  const digits = text.replace(/\D/g, '')
  if (!digits) return 0
  return Math.min(QTY_MAX, Number.parseInt(digits, 10))
}

const clamp = (n: number) => Math.max(0, Math.min(QTY_MAX, Math.round(n)))

export function QtyStepper({ value, onChange, label, inputLabel, testId = 'qty' }: { value: number; onChange: (n: number) => void; label: string; inputLabel: string; testId?: string }) {
  const input = useRef<HTMLInputElement>(null)
  // Черновик есть только во время набора; в остальное время поле показывает значение из заказа.
  // Копия в ref: Escape и уход из поля случаются в одном такте, и commit должен видеть уже сброшенный черновик.
  const [draft, setDraftState] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const setDraft = (v: string | null) => {
    draftRef.current = v
    setDraftState(v)
  }

  // Отклик на кнопки: новое число въезжает с той стороны, куда изменилось, и на миг увеличивается.
  const bump = (dir: 1 | -1) => {
    const el = input.current
    if (!el || typeof el.animate !== 'function' || document.documentElement.dataset.motion === 'calm') return
    el.animate(
      [
        { transform: `translateY(${dir * 45}%) scale(1)`, opacity: 0 },
        { transform: 'translateY(0) scale(1.35)', opacity: 1, offset: 0.55 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ],
      { duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    )
  }

  const step = (delta: number) => {
    const next = clamp(value + delta)
    if (next === value) return
    setDraft(null)
    onChange(next)
    bump(delta > 0 ? 1 : -1)
  }

  const commit = () => {
    const text = draftRef.current
    if (text === null) return
    const next = parseQty(text)
    setDraft(null)
    if (next !== value) onChange(next)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit()
      input.current?.blur()
    } else if (e.key === 'Escape') {
      setDraft(null)
      input.current?.blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const base = draftRef.current === null ? value : parseQty(draftRef.current)
      const next = clamp(base + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))
      setDraft(null)
      if (next !== value) onChange(next)
    }
  }

  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="−" onClick={() => step(-1)} disabled={value <= 0}>
        <Minus size={14} />
      </button>
      <input
        ref={input}
        className="stepper__input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        aria-label={inputLabel}
        data-testid={testId}
        value={draft ?? String(value)}
        // Фокус — выделяем число целиком: новое печатается поверх, не надо стирать старое.
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value.replace(/\D/g, '').slice(0, String(QTY_MAX).length))}
        onBlur={commit}
        onKeyDown={onKey}
      />
      <button type="button" aria-label="+" onClick={() => step(1)} disabled={value >= QTY_MAX}>
        <Plus size={14} />
      </button>
    </div>
  )
}
