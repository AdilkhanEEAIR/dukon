// Поля форм: подпись, подсказка, ошибка — одной структурой, чтобы онбординг и настройки совпадали.

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useId } from 'react'

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
