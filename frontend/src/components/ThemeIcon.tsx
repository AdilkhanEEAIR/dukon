// Значки темы для выбора в настройках и онбординге — обычные Sun и Moon из lucide: те же линии, что у
// всех остальных иконок приложения, без самодельной геометрии. Сам переключатель в шапке — анимированный
// Expand из библиотеки toggles.dev (солнце сворачивается в месяц), он в Nav.tsx.

import { MoonStar, Sun } from 'lucide-react'

export function SunGlyph({ size = 16 }: { size?: number }) {
  return <Sun size={size} strokeWidth={1.9} aria-hidden className="glyph glyph--sun" />
}

export function MoonGlyph({ size = 16 }: { size?: number }) {
  return <MoonStar size={size} strokeWidth={1.9} aria-hidden className="glyph glyph--moon" />
}
