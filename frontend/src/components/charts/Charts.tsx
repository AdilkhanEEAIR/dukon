// Три графика, и каждый отвечает на один вопрос владельца:
//  • StockChart     — «что продалось с прошлого обхода» (было → стало по товарам, тень + акцент);
//  • ForecastChart  — «когда закончится» (посчитанные точки + пунктир прогноза до нуля);
//  • BranchesChart  — «какой филиал теряет больше» (одна серия, по убыванию, красным: это деньги, которые уходят).
// Правила из dataviz: одна ось, тонкие столбцы со скруглённым концом, легенда только при 2+ сериях,
// подписи текстом темы, у каждого графика есть табличный вид.

import { useMemo, type ReactNode } from 'react'
import type { ItemChange } from '../../api/types'
import { useI18n } from '../../i18n'
import { EChart } from './EChart'
import type { ChartOption } from './echarts'
import { EASE, useChartColors, type ChartColors } from './theme'

function axisText(c: ChartColors) {
  return { color: c.ink3, fontFamily: c.font, fontSize: 12 }
}

function tooltipBase(c: ChartColors) {
  return {
    backgroundColor: c.surface,
    borderColor: c.line,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: c.ink, fontFamily: c.font, fontSize: 13 },
    extraCssText: 'border-radius:10px;box-shadow:0 12px 32px -12px rgba(0,0,0,.35);',
  }
}

/** Ширина подписей категорий: на телефоне уже, чтобы столбцам осталось место. */
function labelWidth(): number {
  return typeof window !== 'undefined' && window.innerWidth < 600 ? 92 : 150
}

export function ChartCard({ title, children, table }: { title: ReactNode; children: ReactNode; table: ReactNode }) {
  const { t } = useI18n()
  return (
    <section className="sheet sheet--pad chart-card stack" style={{ gap: 8 }}>
      <h3 className="h3">{title}</h3>
      {children}
      <details className="chart-table">
        <summary className="small">{t('charts.tableView')}</summary>
        {table}
      </details>
    </section>
  )
}

// ---- было → стало
export function StockChart({ changes, limit = 7 }: { changes: ItemChange[]; limit?: number }) {
  const { t } = useI18n()
  const c = useChartColors()
  const rows = useMemo(
    () =>
      changes
        .filter((x) => x.before !== null)
        .sort((a, b) => (b.before ?? 0) - b.after - ((a.before ?? 0) - a.after) || a.name.localeCompare(b.name))
        .slice(0, limit)
        .reverse(), // сверху — где ушло больше всего
    [changes, limit],
  )

  const option = useMemo<ChartOption>(
    () => ({
      animationDuration: 700,
      animationEasing: EASE,
      animationDelay: (i: number) => i * 40,
      aria: { enabled: true },
      grid: { left: 8, right: 36, top: 36, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8, textStyle: { ...axisText(c), color: c.ink2 } },
      tooltip: { ...tooltipBase(c), trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: c.line, opacity: 0.35 } } },
      xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: c.line } }, axisLabel: axisText(c) },
      yAxis: {
        type: 'category',
        data: rows.map((r) => r.name),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { ...axisText(c), color: c.ink2, width: labelWidth(), overflow: 'truncate' },
      },
      series: [
        {
          name: t('charts.before'),
          type: 'bar',
          data: rows.map((r) => r.before ?? 0),
          barWidth: 10,
          barGap: '30%',
          itemStyle: { color: c.muted, borderRadius: [0, 4, 4, 0] },
          emphasis: { focus: 'series' },
        },
        {
          name: t('charts.now'),
          type: 'bar',
          data: rows.map((r) => r.after),
          barWidth: 10,
          itemStyle: { color: c.accent, borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', color: c.ink, fontFamily: c.font, fontWeight: 600, fontSize: 12 },
          emphasis: { focus: 'series' },
        },
      ],
    }),
    [rows, c, t],
  )

  return (
    <ChartCard
      title={t('charts.stockTitle')}
      table={
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('charts.product')}</th>
              <th>{t('charts.before')}</th>
              <th>{t('charts.now')}</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.sku}>
                <td>{r.name}</td>
                <td>{r.before}</td>
                <td>{r.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <EChart option={option} height={Math.max(200, rows.length * 38 + 50)} label={t('charts.stockTitle')} testId="stock-chart" />
    </ChartCard>
  )
}

// ---- остаток и прогноз
export interface Point {
  at: string
  count: number
}

/** Прогноз: от последнего обхода линия падает со скоростью продаж до нуля. */
export function forecastPoints(history: Point[], velocityPerDay: number): Point[] {
  const last = history[history.length - 1]
  if (!last || last.count <= 0 || velocityPerDay <= 0) return []
  const days = last.count / velocityPerDay
  const end = new Date(new Date(last.at).getTime() + days * 86_400_000).toISOString()
  return [last, { at: end, count: 0 }]
}

export function ForecastChart({ history, change, caption }: { history: Point[]; change: ItemChange; caption: string }) {
  const { t, locale } = useI18n()
  const c = useChartColors()
  const forecast = useMemo(() => forecastPoints(history, change.velocity_per_day), [history, change.velocity_per_day])

  const option = useMemo<ChartOption>(() => {
    const fmt = new Intl.DateTimeFormat(locale === 'ky' ? 'ru' : locale, { day: 'numeric', month: 'short' })
    const series: unknown[] = [
      {
        name: t('charts.history'),
        type: 'line',
        data: history.map((p) => [p.at, p.count]),
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 9,
        lineStyle: { width: 2, color: c.accent },
        itemStyle: { color: c.accent, borderColor: c.surface, borderWidth: 2 },
        areaStyle: { color: c.accent, opacity: 0.1 },
        emphasis: { scale: 1.3 },
        z: 3,
      },
    ]
    if (forecast.length) {
      series.push({
        name: t('charts.forecast'),
        type: 'line',
        data: forecast.map((p) => [p.at, p.count]),
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: { width: 2, type: [6, 5], color: c.out },
        itemStyle: { color: c.out, borderColor: c.surface, borderWidth: 2 },
        z: 2,
      })
    }
    return {
      animationDuration: 800,
      animationEasing: EASE,
      aria: { enabled: true },
      grid: { left: 4, right: 16, top: forecast.length ? 36 : 12, bottom: 4, containLabel: true },
      legend: forecast.length ? { top: 0, left: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 4, textStyle: { ...axisText(c), color: c.ink2 } } : undefined,
      tooltip: {
        ...tooltipBase(c),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: c.ink3 } },
        valueFormatter: (v: number) => `${Math.round(v)} ${t('item.pcs')}`,
      },
      xAxis: {
        type: 'time',
        minInterval: 86_400_000,
        splitNumber: 3,
        axisLabel: { ...axisText(c), formatter: (v: number) => fmt.format(new Date(v)), hideOverlap: true },
        axisLine: { lineStyle: { color: c.line } },
        splitLine: { show: false },
      },
      yAxis: { type: 'value', min: 0, minInterval: 1, splitLine: { lineStyle: { color: c.line } }, axisLabel: axisText(c) },
      series,
    }
  }, [history, forecast, c, t, locale])

  return (
    <ChartCard
      title={t('charts.forecastTitle')}
      table={
        <table className="data-table">
          <tbody>
            {history.map((p) => (
              <tr key={p.at}>
                <td>{new Date(p.at).toLocaleDateString(locale === 'ky' ? 'ru' : locale)}</td>
                <td>{p.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <p className="small" data-testid="forecast-caption">{caption}</p>
      <EChart option={option} height={200} label={t('charts.forecastTitle')} testId="forecast-chart" />
    </ChartCard>
  )
}

// ---- филиалы
export function BranchesChart({ rows, format }: { rows: { id: string; name: string; value: number }[]; format: (v: number) => string }) {
  const { t, rich } = useI18n()
  const c = useChartColors()
  const sorted = useMemo(() => [...rows].sort((a, b) => a.value - b.value), [rows])

  const option = useMemo<ChartOption>(
    () => ({
      animationDuration: 800,
      animationEasing: EASE,
      animationDelay: (i: number) => i * 60,
      aria: { enabled: true },
      grid: { left: 8, right: 96, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...tooltipBase(c), trigger: 'item', valueFormatter: (v: number) => format(v) },
      // У каждого столбца своя подпись на конце — ось с делениями тут только шумит.
      xAxis: { type: 'value', splitLine: { show: false }, axisLabel: { show: false } },
      yAxis: { type: 'category', data: sorted.map((r) => r.name), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { ...axisText(c), color: c.ink2, width: labelWidth(), overflow: 'truncate' } },
      series: [
        {
          name: t('branches.chartTitle'),
          type: 'bar',
          // Ноль — не потеря: подпись серая, чтобы красным горело только то, что реально уходит.
          data: sorted.map((r) => (r.value > 0 ? r.value : { value: r.value, label: { color: c.ink3, fontWeight: 600 } })),
          barWidth: 16,
          // Потери — статусный красный, а не зелёный акцент: зелёный читается как «в плюсе».
          // Подложка-дорожка показывает «сколько могло бы быть» и делает короткие столбцы заметнее.
          itemStyle: { color: c.loss, borderRadius: [0, 6, 6, 0] },
          showBackground: true,
          backgroundStyle: { color: c.line, opacity: 0.45, borderRadius: [0, 6, 6, 0] },
          label: {
            show: true,
            position: 'right',
            color: c.out,
            fontFamily: c.font,
            fontWeight: 800,
            fontSize: 13,
            formatter: (p: { value: number }) => format(p.value),
          },
          emphasis: { itemStyle: { color: c.lossHover } },
        },
      ],
    }),
    [sorted, c, t, format],
  )

  return (
    <ChartCard
      title={rich('branches.chartTitle')}
      table={
        <table className="data-table">
          <tbody>
            {[...sorted].reverse().map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{format(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <EChart option={option} height={Math.max(160, sorted.length * 48 + 24)} label={t('branches.chartTitle')} testId="branches-chart" />
    </ChartCard>
  )
}
