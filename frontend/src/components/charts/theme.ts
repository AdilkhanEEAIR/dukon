// Цвета графиков берём из CSS-переменных темы: график сам перекрашивается со светлой на тёмную.

import { useMemo } from 'react'
import { useSettings } from '../../app/settings'

export interface ChartColors {
  accent: string
  muted: string
  loss: string
  lossHover: string
  ink: string
  ink2: string
  ink3: string
  line: string
  surface: string
  out: string
  low: string
  price: string
  ok: string
  /** Ступени для колец: потери — от тёмно-красного к охре, деньги заказа — от бутылочного к мятному. */
  lossRamp: string[]
  accentRamp: string[]
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
    loss: cssVar('--chart-loss', '#d03b3b'),
    lossHover: cssVar('--chart-loss-hover', '#b52f2f'),
    ink: cssVar('--ink', '#101512'),
    ink2: cssVar('--ink-2', '#4b544d'),
    ink3: cssVar('--ink-3', '#7b847d'),
    line: cssVar('--line', '#dfe3da'),
    surface: cssVar('--surface', '#ffffff'),
    out: cssVar('--out', '#c2321f'),
    low: cssVar('--low', '#9a6400'),
    price: cssVar('--price', '#2c4f8f'),
    ok: cssVar('--ok', '#2f6b3a'),
    lossRamp: [1, 2, 3, 4, 5].map((i) => cssVar(`--ramp-loss-${i}`, ['#b3261e', '#d9583a', '#ea8a4b', '#f1b562', '#c7cdc1'][i - 1])),
    accentRamp: [1, 2, 3, 4, 5, 6].map((i) => cssVar(`--ramp-accent-${i}`, ['#0e5b3f', '#2f7d57', '#56a074', '#86c09a', '#b8dcc3', '#c7cdc1'][i - 1])),
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
