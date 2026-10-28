import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'

// ECharts рисует в настоящем браузере; в jsdom подменяем инициализацию и проверяем, что ему передали.
// Массив вызовов лежит на globalThis: тесты читают его через chartOptions() из fixtures.
const { chartCalls, fakeInit } = vi.hoisted(() => {
  const calls: { option: unknown }[] = []
  ;(globalThis as unknown as { __chartCalls: typeof calls }).__chartCalls = calls
  const fakeInit = () => {
    // Обработчики событий графика складываем рядом с опциями: тест может «кликнуть» по сектору кольца.
    const handlers: Record<string, (p: unknown) => void> = {}
    ;((globalThis as unknown as { __chartHandlers: Record<string, (p: unknown) => void>[] }).__chartHandlers ??= []).push(handlers)
    return {
      setOption: (option: unknown) => calls.push({ option }),
      resize: () => {},
      dispose: () => {},
      on: (ev: string, fn: (p: unknown) => void) => {
        handlers[ev] = fn
      },
      dispatchAction: () => {},
    }
  }
  return { chartCalls: calls, fakeInit }
})
vi.mock('../components/charts/echarts', () => ({ init: fakeInit }))
vi.mock('../components/charts/load', () => ({ loadECharts: async () => ({ init: fakeInit }) }))
// Карта (MapLibre) в jsdom не рисуется — WebGL нет. Подменяем лёгкими классами: булавки — настоящие DOM-элементы
// внутри контейнера, а вызовы (перелёты, рамки, смена стиля) записываются, чтобы тесты их проверяли.
vi.mock('../components/map/maplib', () => {
  type Handler = (e?: unknown) => void
  class FakeMap {
    container: HTMLElement
    handlers: Record<string, Handler[]> = {}
    zoom: number
    style: unknown
    styles: unknown[] = []
    flights: unknown[] = []
    fits: unknown[] = []
    constructor(opts: { container: HTMLElement; zoom: number; style: unknown }) {
      this.container = opts.container
      this.zoom = opts.zoom
      this.style = opts.style
      this.styles.push(opts.style)
      ;((globalThis as unknown as { __maps: FakeMap[] }).__maps ??= []).push(this)
      // __mapNoLoad: тест сам решает, загрузилась подложка или нет (для запасного стиля и ошибок).
      if (!(globalThis as unknown as { __mapNoLoad?: boolean }).__mapNoLoad) queueMicrotask(() => this.fire('load'))
    }
    on(ev: string, fn: Handler) {
      ;(this.handlers[ev] ??= []).push(fn)
      return this
    }
    off(ev: string, fn: Handler) {
      this.handlers[ev] = (this.handlers[ev] ?? []).filter((f) => f !== fn)
      return this
    }
    fire(ev: string, payload?: unknown) {
      ;(this.handlers[ev] ?? []).forEach((f) => f(payload))
    }
    addControl() {
      return this
    }
    remove() {}
    isStyleLoaded() {
      return true
    }
    setStyle(style: unknown) {
      this.style = style
      this.styles.push(style)
    }
    flyTo(o: unknown) {
      this.flights.push(o)
    }
    fitBounds(b: unknown) {
      this.fits.push(b)
    }
    getZoom() {
      return this.zoom
    }
  }
  class FakeMarker {
    el: HTMLElement
    ll: [number, number] = [0, 0]
    handlers: Record<string, Handler> = {}
    constructor(o: { element: HTMLElement }) {
      this.el = o.element
    }
    setLngLat(ll: [number, number]) {
      this.ll = ll
      return this
    }
    addTo(map: FakeMap) {
      map.container.appendChild(this.el)
      return this
    }
    remove() {
      this.el.remove()
    }
    getElement() {
      return this.el
    }
    getLngLat() {
      return { lng: this.ll[0], lat: this.ll[1] }
    }
    on(ev: string, fn: Handler) {
      this.handlers[ev] = fn
      return this
    }
  }
  class LngLatBounds {
    points: unknown[] = []
    extend(p: unknown) {
      this.points.push(p)
      return this
    }
  }
  class Control {}
  return { Map: FakeMap, Marker: FakeMarker, LngLatBounds, NavigationControl: Control, AttributionControl: Control }
})

import { cleanup, configure } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'

// В jsdom нет кадров анимации: переходы страниц (AnimatePresence mode="wait") ждали бы конца ухода вечно.
// skipAnimations завершает любую анимацию motion сразу — тесты проверяют логику, а не тайминги.
MotionGlobalConfig.skipAnimations = true
// Тесты страниц идут параллельно в нескольких процессах: под нагрузкой секунды на findBy* не всегда хватает.
configure({ asyncUtilTimeout: 3000 })
// jsdom не прокручивает окно и громко ругается на scrollTo — после смены страницы мы прокручиваем наверх.
window.scrollTo = (() => {}) as typeof window.scrollTo

Object.defineProperty(navigator, 'languages', { value: ['ru-RU'], configurable: true })

beforeEach(() => {
  chartCalls.length = 0
  ;(globalThis as unknown as { __chartHandlers: unknown[] }).__chartHandlers = []
  localStorage.clear()
  document.documentElement.dataset.theme = ''
  delete document.documentElement.dataset.motion
  ;(globalThis as unknown as { __maps: unknown[] }).__maps = []
  ;(globalThis as unknown as { __mapNoLoad?: boolean }).__mapNoLoad = false
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// jsdom не умеет createObjectURL — превью фото на тестах не нужны.
Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test', writable: true })
Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true })

// matchMedia нет в jsdom: по умолчанию светлая тема, широкий экран — нет, reduced-motion — да (анимации мгновенные).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
})

// motion использует ResizeObserver/IntersectionObserver для layout-анимаций.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', { writable: true, value: NoopObserver })
Object.defineProperty(window, 'IntersectionObserver', { writable: true, value: NoopObserver })
Object.defineProperty(Element.prototype, 'scrollIntoView', { writable: true, value: () => {} })
Object.defineProperty(Element.prototype, 'animate', { writable: true, value: () => ({ finished: Promise.resolve(), cancel() {} }) })

Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } })
