// Кнопка: одна для всех вариантов, со спиннером поверх размытого содержимого при loading
// и сжатием на нажатие — так интерфейс отвечает на каждое касание.

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant
  size?: Size
  block?: boolean
  loading?: boolean
  icon?: ReactNode
  children?: ReactNode
  /** Если задано — рендерим ссылку роутера в виде кнопки. */
  to?: string
}

export function Button({ variant = 'primary', size = 'md', block, loading, icon, children, to, className, disabled, ...rest }: Props) {
  const cls = ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className].filter(Boolean).join(' ')
  const content = (
    <>
      <span className="btn__content">
        {icon}
        {children}
      </span>
      {loading && <span className="btn__spinner" role="status" aria-label="loading" />}
    </>
  )
  if (to && !disabled && !loading) {
    return (
      <Link to={to} className={cls} data-variant={variant}>
        {content}
      </Link>
    )
  }
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} data-variant={variant} {...rest}>
      {content}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  outline?: boolean
  badge?: number
  to?: string
}

export function IconButton({ label, outline, badge, to, className, children, ...rest }: IconButtonProps) {
  const cls = ['icon-btn', outline && 'icon-btn--outline', className].filter(Boolean).join(' ')
  const inner = (
    <>
      {children}
      {badge ? <span className="badge-dot" aria-hidden>{badge > 99 ? '99+' : badge}</span> : null}
    </>
  )
  if (to) {
    return (
      <Link to={to} className={cls} aria-label={label} title={label}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" className={cls} aria-label={label} title={label} {...rest}>
      {inner}
    </button>
  )
}
