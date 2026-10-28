// Собираем ECharts из нужных кусков, а не целиком: три вида графиков вместо всей библиотеки —
// в разы меньше кода, который грузит телефон. Модуль подгружается лениво, только когда есть график.

import { BarChart, LineChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, SVGRenderer])

export const init = echarts.init
export type { EChartsCoreOption as ChartOption } from 'echarts/core'
