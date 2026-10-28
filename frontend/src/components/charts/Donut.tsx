// Кольцо долей: «из чего складывается целое». Сектора въезжают по очереди с упругим отскоком, при наведении
// приподнимаются, выбранный — выдвигается из кольца. В центре — итог, а при выборе — доля выбранного.
// Рядом легенда-кнопки: та же информация текстом (значение и процент), нажатие делает то же, что клик по сектору.
// Пустое кольцо не рисуем пустотой: под секторами всегда лежит серая дорожка.

import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useRef, type ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useI18n } from '../../i18n'
import { EChart, type ChartApi, type ChartEvent } from './EChart'
import type { ChartOption } from './echarts'
import { useChartColors } from './theme'

export interface DonutSlice {
  id: string
  name: string
  value: number
  color: string
  /** Как показать значение (деньги, штуки); по умолчанию — само число. */
  display?: string
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)

/** Доля в процентах по правилам языка: «33 %», «33%». */
export function percent(part: number, total: number, locale: string): string {
  if (total <= 0) return new Intl.NumberFormat(locale === 'ky' ? 'ru' : locale, { style: 'percent' }).format(0)
  return new Intl.NumberFormat(locale === 'ky' ? 'ru' : locale, { style: 'percent', maximumFractionDigits: part / total < 0.1 ? 1 : 0 }).format(part / total)
}

export function Donut({
  slices,
  total,
  caption,
  selected = null,
  onSelect,
  label,
  testId,
  size = 220,
}: {
  slices: DonutSlice[]
  /** Что написать в центре, пока ничего не выбрано. */
  total: ReactNode
  caption: string
  selected?: string | null
  onSelect?: (id: string | null) => void
  label: string
  testId: string
  size?: number
}) {
  const { locale } = useI18n()
  const { resolvedMotion } = useSettings()
  const c = useChartColors()
  const chart = useRef<ChartApi | null>(null)
  const shown = useMemo(() => slices.filter((s) => s.value > 0), [slices])
  const sum = shown.reduce((a, s) => a + s.value, 0)
  const active = shown.find((s) => s.id === selected) ?? null

  const option = useMemo<ChartOption>(() => {
    const calm = resolvedMotion === 'calm'
    return {
      animation: !calm,
      // Первый показ: сектора по одному «выпрыгивают» из центра с упругим отскоком.
      animationDuration: 1500,
      animationEasing: 'elasticOut',
      animationDelay: (i: number) => i * 140,
      // Изменились числа (поменяли количество в заказе) — дуги плавно перетекают, без нового отскока.
      animationDurationUpdate: 850,
      animationEasingUpdate: 'cubicInOut',
      aria: { enabled: true },
      tooltip: {
        trigger: 'item',
        backgroundColor: c.surface,
        borderColor: c.line,
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: c.ink, fontFamily: c.font, fontSize: 13 },
        extraCssText: 'border-radius:10px;box-shadow:0 12px 32px -12px rgba(0,0,0,.35);',
        formatter: (p: { seriesIndex: number; dataIndex: number; marker: string }) => {
          const s = shown[p.dataIndex]
          if (p.seriesIndex !== 1 || !s) return ''
          return `${p.marker} ${esc(s.name)}<br/><b>${esc(s.display ?? String(s.value))}</b> · ${percent(s.value, sum, locale)}`
        },
      },
      series: [
        {
          // дорожка под кольцом: видно форму, даже когда долей нет
          type: 'pie',
          radius: ['56%', '76%'],
          silent: true,
          animation: false,
          label: { show: false },
          labelLine: { show: false },
          data: [{ value: 1, itemStyle: { color: c.line, opacity: 0.55 } }],
          z: 1,
        },
        {
          // Внешний радиус с запасом: выбранный сектор выдвигается и приподнимается, не упираясь в край.
          type: 'pie',
          radius: ['56%', '76%'],
          padAngle: shown.length > 1 ? 3 : 0,
          minAngle: 6,
          animationType: 'scale',
          animationTypeUpdate: 'transition',
          avoidLabelOverlap: false,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderRadius: 8 },
          emphasis: { scale: true, scaleSize: 7, itemStyle: { shadowBlur: 22, shadowColor: 'rgba(16, 21, 18, 0.28)' } },
          selectedMode: onSelect ? 'single' : false,
          selectedOffset: 10,
          data: shown.map((s) => ({ name: s.name, value: s.value, selected: s.id === selected, itemStyle: { color: s.color } })),
          z: 2,
        },
      ],
    }
  }, [shown, sum, selected, onSelect, c, locale, resolvedMotion])

  const pick = (id: string) => onSelect?.(selected === id ? null : id)
  const events = useMemo(
    () => ({
      click: (p: ChartEvent) => {
        if (p.seriesIndex !== 1 || p.dataIndex === undefined) return
        const s = shown[p.dataIndex]
        if (s) pick(s.id)
      },
    }),
    // pick зависит от selected/onSelect — пересобираем обработчик вместе с ними
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, selected, onSelect],
  )
  // Наведение на строку легенды подсвечивает свой сектор в кольце.
  const hover = (i: number, on: boolean) => chart.current?.dispatchAction?.({ type: on ? 'highlight' : 'downplay', seriesIndex: 1, dataIndex: i })

  return (
    <div className="donut" data-testid={testId}>
      <div className="donut__grid">
        <div className="donut__ring" style={{ width: size, height: size }}>
          <EChart option={option} height={size} label={label} testId={`${testId}-chart`} onEvents={events} chartRef={chart} />
          <div className="donut__center" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active?.id ?? 'total'}
                className="donut__center-inner"
                initial={{ opacity: 0, scale: 0.85, filter: 'blur(4px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.9, filter: 'blur(4px)', transition: { duration: 0.18 } }}
                transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                data-testid={`${testId}-center`}
              >
                <span className="donut__value">{active ? (active.display ?? active.value) : total}</span>
                <span className="donut__caption">{active ? active.name : caption}</span>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <ul className="donut__legend" data-testid={`${testId}-legend`}>
          {slices.map((s) => {
            const i = shown.indexOf(s)
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`donut__row${s.id === selected ? ' is-active' : ''}${s.value <= 0 ? ' is-empty' : ''}`}
                  aria-pressed={onSelect ? s.id === selected : undefined}
                  disabled={!onSelect || s.value <= 0}
                  onClick={() => pick(s.id)}
                  onMouseEnter={() => i >= 0 && hover(i, true)}
                  onMouseLeave={() => i >= 0 && hover(i, false)}
                  data-testid={`${testId}-row`}
                >
                  <span className="donut__swatch" style={{ background: s.color }} />
                  <span className="donut__name truncate">{s.name}</span>
                  <span className="donut__num">{s.display ?? s.value}</span>
                  <span className="donut__pct">{percent(Math.max(0, s.value), sum, locale)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
