// Цвета графиков берём из CSS-переменных темы: график сам перекрашивается со светлой на тёмную.

import { useMemo } from 'react'
import { useSettings } from '../../app/settings'

export interface ChartColors {
  accent: string
  muted: string
  ink: string
  ink2: string
  ink3: string
  line: string
  surface: string
  out: string
  font: string
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function readChartColors(): ChartColors {
  return {
    accent: cssVar('--chart-accent', '#0e5b3f'),
    muted: cssVar('--chart-muted', '#c3cabd'),
    ink: cssVar('--ink', '#101512'),
    ink2: cssVar('--ink-2', '#4b544d'),
    ink3: cssVar('--ink-3', '#7b847d'),
    line: cssVar('--line', '#dfe3da'),
    surface: cssVar('--surface', '#ffffff'),
    out: cssVar('--out', '#c2321f'),
    font: cssVar('--font-ui', 'Manrope, system-ui, sans-serif'),
  }
}

/** Пересчитываем цвета при смене темы: зависимость от resolvedTheme, а не от DOM. */
export function useChartColors(): ChartColors {
  const { resolvedTheme } = useSettings()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readChartColors(), [resolvedTheme])
}

export const EASE = 'cubicOut'
