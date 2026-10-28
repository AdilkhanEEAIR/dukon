// Знак Dukon: строгая «D» на тёмной плитке, внутри — короткая планка акцентного цвета, как ценник на полке.
// Без яркой заливки и стоковой иконки магазина: знак должен выглядеть как бренд, а не как шаблон.
// Плитка — цвет текста темы, поэтому в тёмной теме знак сам становится светлым.

export function LogoMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={`logo-mark${className ? ` ${className}` : ''}`} aria-hidden focusable="false">
      <rect width="32" height="32" rx="9" className="logo-mark__tile" />
      <path d="M11 8.5v15M11 8.5h4.2a7.5 7.5 0 0 1 0 15H11" fill="none" className="logo-mark__d" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.6 13.6h3.8" className="logo-mark__bar" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}
