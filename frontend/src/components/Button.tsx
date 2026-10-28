import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  block?: boolean
  size?: 'md' | 'sm'
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', block, size = 'md', loading, icon, className, children, disabled, ...rest }: Props) {
  const classes = ['btn', `btn--${variant}`, block && 'btn--block', size === 'sm' && 'btn--sm', loading && 'btn--loading', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {icon}
      {children}
      {loading && (
        <span className="btn__spinner" role="status" aria-label="Загрузка">
          <span className="spinner" />
        </span>
      )}
    </button>
  )
}
