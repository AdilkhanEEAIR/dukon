// Знак Dukon — рисованный магазинчик у дома: полосатый козырёк, витрина с товарами, дверь.
// Тот же «наклеечный» стиль, что у иконок товаров, — знак и содержимое приложения говорят одним языком.
// Буква или абстрактный символ здесь не работают: «дүкөн» — это и есть маленький магазин.

export function LogoMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={`logo-mark${className ? ` ${className}` : ''}`} aria-hidden focusable="false">
      <rect width="48" height="48" rx="13" fill="#e9efe6" />
      <rect x=".75" y=".75" width="46.5" height="46.5" rx="12.25" fill="none" stroke="#0e5b3f" strokeOpacity=".12" strokeWidth="1.5" />
      {/* стена и тротуар */}
      <rect x="9" y="20" width="30" height="20" rx="2" fill="#f7f3ea" />
      <rect x="9" y="38" width="30" height="3" rx="1" fill="#c9bfa8" />
      {/* козырёк: зелёные и кремовые полосы, волнистый край */}
      <path d="M7 13.5h34l-1.6 7.5H8.6z" fill="#0e5b3f" />
      <path d="M12.8 13.5h5.4l-1 7.5h-5.4z M23.6 13.5h5.4l-.2 7.5h-5.4z M34.4 13.5h5.2l-.8 7.5h-5.2z" fill="#f4ecd8" />
      <path d="M8.6 21c1.5 1.7 4 1.7 5.4 0 1.5 1.7 4 1.7 5.4 0 1.5 1.7 4 1.7 5.4 0 1.5 1.7 4 1.7 5.4 0 1.5 1.7 4 1.7 5.4 0 1.5 1.7 4 1.7 4.4 0" fill="none" stroke="#0e5b3f" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="6" y="11" width="36" height="3.2" rx="1.6" fill="#0a4430" />
      {/* витрина с товарами */}
      <rect x="12" y="26" width="13" height="10" rx="1.4" fill="#cfe3ea" />
      <rect x="13.5" y="30.5" width="2.4" height="4" rx=".6" fill="#e2683c" />
      <rect x="16.6" y="29.5" width="2.4" height="5" rx=".6" fill="#2f7fd1" />
      <rect x="19.7" y="31" width="3.2" height="3.5" rx=".6" fill="#f2c230" />
      <rect x="12" y="34.6" width="13" height="1.4" fill="#b9cfd6" />
      {/* дверь */}
      <rect x="28.5" y="25.5" width="7" height="12.5" rx="1.2" fill="#0e5b3f" />
      <circle cx="33.6" cy="32" r=".8" fill="#f4ecd8" />
    </svg>
  )
}
