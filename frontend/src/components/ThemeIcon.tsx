// Знаки темы — тонкие одноцветные линии в цвет текста, как у системных переключателей.
// Прошлая версия (жёлтое солнце, сиреневая луна) выглядела по-детски: цвет тут только мешает.

export function SunGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden focusable="false" className="glyph glyph--sun">
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.2v1.9M12 18.9v1.9M3.2 12h1.9M18.9 12h1.9M5.8 5.8l1.35 1.35M16.85 16.85l1.35 1.35M5.8 18.2l1.35-1.35M16.85 7.15l1.35-1.35" />
    </svg>
  )
}

export function MoonGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden focusable="false" className="glyph glyph--moon">
      <path d="M19.4 14.7A7.6 7.6 0 0 1 9.3 4.6a7.6 7.6 0 1 0 10.1 10.1z" />
    </svg>
  )
}
