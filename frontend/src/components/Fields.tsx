// Поля форм: подпись, подсказка, ошибка — одной структурой, чтобы онбординг и настройки совпадали.

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useEffect, useId, useState } from 'react'

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <span className="field__error" role="alert">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={['input', className].filter(Boolean).join(' ')} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={['select', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />
}

export function ChoiceRow<K extends string>({ value, onChange, items, label }: { value: K; onChange: (k: K) => void; items: { key: K; label: string; icon?: ReactNode }[]; label: string }) {
  const id = useId()
  return (
    <div className="choice-row" role="radiogroup" aria-label={label} id={id}>
      {items.map((it) => (
        <button key={it.key} type="button" role="radio" aria-checked={value === it.key} className={`choice${value === it.key ? ' is-active' : ''}`} onClick={() => onChange(it.key)}>
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  )
}

/** Числовое поле, из которого можно стереть всё.

 * Обычный `value={число}` + `Number(e.target.value)` не даёт очистить поле: пустая строка тут же превращается в 0,
 * а «0» перед новой цифрой остаётся («0525»). Поэтому пока поле в фокусе, в нём живёт текст; число наружу уходит
 * на каждый правильный ввод (чтобы «Сохранить» появлялось сразу), а пустое или кривое поле при уходе из него
 * возвращает прежнее число — настройку нельзя потерять случайно.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  decimals = false,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'type' | 'step'> & {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  /** Разрешить дробные (проценты); иначе только целые. */
  decimals?: boolean
}) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)
  // Значение сменилось снаружи (загрузили правила, нажали «Отмена») — показываем его, если поле сейчас не редактируют.
  useEffect(() => {
    if (!focused) setText(String(value))
  }, [value, focused])
  const clamp = (n: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n))
  const parse = (s: string): number | null => {
    const cleaned = s.replace(',', '.').trim()
    if (!cleaned || !/^-?\d*(\.\d*)?$/.test(cleaned)) return null
    const n = Number(cleaned)
    if (!Number.isFinite(n)) return null
    return decimals ? n : Math.trunc(n)
  }
  return (
    <input
      type="number"
      inputMode={decimals ? 'decimal' : 'numeric'}
      min={min}
      max={max}
      // Без step="any" браузер сам отклоняет «525» при шаге 100 и не даёт отправить форму — шаг здесь только для стрелок.
      step="any"
      className={['input', className].filter(Boolean).join(' ')}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        // «0» перед новой цифрой — лишний: пользователь хотел «525», а не «0525».
        const next = e.target.value.replace(/^(-?)0+(?=\d)/, '$1')
        setText(next)
        const n = parse(next)
        if (n !== null && n === clamp(n)) onChange(n)
      }}
      onBlur={() => {
        setFocused(false)
        const n = parse(text)
        if (n === null) {
          setText(String(value))
          return
        }
        const fixed = clamp(n)
        setText(String(fixed))
        if (fixed !== value) onChange(fixed)
      }}
      {...rest}
    />
  )
}
