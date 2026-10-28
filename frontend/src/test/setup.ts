import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'

// ECharts рисует в настоящем браузере; в jsdom подменяем инициализацию и проверяем, что ему передали.
// Массив вызовов лежит на globalThis: тесты читают его через chartOptions() из fixtures.
const { chartCalls } = vi.hoisted(() => {
  const calls: { option: unknown }[] = []
  ;(globalThis as unknown as { __chartCalls: typeof calls }).__chartCalls = calls
  return { chartCalls: calls }
})
vi.mock('../components/charts/echarts', () => ({
  init: () => ({
    setOption: (option: unknown) => chartCalls.push({ option }),
    resize: () => {},
    dispose: () => {},
  }),
}))
import { cleanup } from '@testing-library/react'
import { MotionGlobalConfig } from 'motion/react'

// В jsdom нет кадров анимации: переходы страниц (AnimatePresence mode="wait") ждали бы конца ухода вечно.
// skipAnimations завершает любую анимацию motion сразу — тесты проверяют логику, а не тайминги.
MotionGlobalConfig.skipAnimations = true
// jsdom не прокручивает окно и громко ругается на scrollTo — после смены страницы мы прокручиваем наверх.
window.scrollTo = (() => {}) as typeof window.scrollTo

Object.defineProperty(navigator, 'languages', { value: ['ru-RU'], configurable: true })

beforeEach(() => {
  chartCalls.length = 0
  localStorage.clear()
  document.documentElement.dataset.theme = ''
  delete document.documentElement.dataset.motion
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
