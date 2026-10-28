// Обёртка над ECharts: ленивая загрузка, перерисовка при смене данных и темы, подгонка под ширину.
// SVG-рендер: чёткие линии и шрифты на любом экране, а цвета берутся из наших токенов.
// События графика (клик по сектору, наведение) — через onEvents; сам экземпляр можно получить через chartRef,
// чтобы, например, подсветить сектор кольца при наведении на строку легенды.

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { ChartOption } from './echarts'
import { loadECharts } from './load'

export type ChartEvent = { dataIndex?: number; seriesIndex?: number; name?: string; data?: unknown }
export type ChartApi = {
  setOption: (o: ChartOption, notMerge?: boolean) => void
  resize: () => void
  dispose: () => void
  on?: (event: string, handler: (p: ChartEvent) => void) => void
  dispatchAction?: (action: Record<string, unknown>) => void
}

const EVENTS = ['click', 'mouseover', 'mouseout'] as const
type EventName = (typeof EVENTS)[number]

export function EChart({
  option,
  height = 260,
  label,
  testId,
  onEvents,
  chartRef,
}: {
  option: ChartOption
  height?: number
  label: string
  testId?: string
  onEvents?: Partial<Record<EventName, (p: ChartEvent) => void>>
  chartRef?: MutableRefObject<ChartApi | null>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<ChartApi | null>(null)
  const [ready, setReady] = useState(false)
  // Обработчики меняются при каждой перерисовке страницы — держим последние в ref, а на график вешаем один раз.
  const handlers = useRef(onEvents)
  useEffect(() => {
    handlers.current = onEvents
  }, [onEvents])

  useEffect(() => {
    let disposed = false
    let ro: ResizeObserver | null = null
    void loadECharts().then(({ init }) => {
      if (disposed || !ref.current) return
      chart.current = init(ref.current, undefined, { renderer: 'svg' }) as unknown as ChartApi
      for (const ev of EVENTS) chart.current.on?.(ev, (p) => handlers.current?.[ev]?.(p))
      if (chartRef) chartRef.current = chart.current
      ro = new ResizeObserver(() => chart.current?.resize())
      ro.observe(ref.current)
      setReady(true)
    })
    return () => {
      disposed = true
      ro?.disconnect()
      chart.current?.dispose()
      chart.current = null
      if (chartRef) chartRef.current = null
    }
  }, [chartRef])

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
