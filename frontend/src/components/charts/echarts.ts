// Собираем ECharts из нужных кусков, а не целиком: столбцы, линии и кольца вместо всей библиотеки —
// в разы меньше кода, который грузит телефон. Модуль подгружается лениво, только когда есть график.

import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { LegacyGridContainLabel } from 'echarts/features'
import { SVGRenderer } from 'echarts/renderers'

// LegacyGridContainLabel: в ECharts 6 grid.containLabel работает только с этим модулем — без него длинные
// названия товаров на оси обрезались бы краем графика (в консоли было предупреждение).
echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, LegacyGridContainLabel, SVGRenderer])

export const init = echarts.init
export type { EChartsCoreOption as ChartOption } from 'echarts/core'
