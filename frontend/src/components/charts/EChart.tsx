// Обёртка над ECharts: ленивая загрузка, перерисовка при смене данных и темы, подгонка под ширину.
// SVG-рендер: чёткие линии и шрифты на любом экране, а цвета берутся из наших токенов.

import { useEffect, useRef, useState } from 'react'
import type { ChartOption } from './echarts'

type Chart = { setOption: (o: ChartOption, notMerge?: boolean) => void; resize: () => void; dispose: () => void }

export function EChart({ option, height = 260, label, testId }: { option: ChartOption; height?: number; label: string; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<Chart | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let disposed = false
    let ro: ResizeObserver | null = null
    void import('./echarts').then(({ init }) => {
      if (disposed || !ref.current) return
      chart.current = init(ref.current, undefined, { renderer: 'svg' }) as unknown as Chart
      ro = new ResizeObserver(() => chart.current?.resize())
      ro.observe(ref.current)
      setReady(true)
    })
    return () => {
      disposed = true
      ro?.disconnect()
      chart.current?.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    if (ready) chart.current?.setOption(option, true)
  }, [ready, option])

  return (
    <div className="chart" role="img" aria-label={label} data-testid={testId} data-ready={ready || undefined}>
      <div ref={ref} style={{ height }} />
      {!ready && <div className="chart__placeholder skeleton" style={{ height }} aria-hidden />}
    </div>
  )
}
