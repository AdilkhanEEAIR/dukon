import type { BranchSummary, Health, ItemChange, Shop, Walk, WalkDiff } from '../api/types'

export const health: Health = {
  status: 'ok',
  version: '0.1.0',
  provider: 'meta',
  live_enabled: true,
  mode: 'live',
  reason: null,
  live_calls_today: 2,
  live_calls_per_day_total: 60,
  budget: { calls_today: 2, calls_limit: 60, calls_left: 58, est_spend_usd: 0.24, errors_today: 0, last_error: null },
}

export const demoHealth: Health = {
  ...health,
  provider: 'mock',
  live_enabled: false,
  mode: 'demo',
  reason: 'no_api_key',
  live_calls_today: 0,
  budget: { calls_today: 0, calls_limit: 60, calls_left: 60, est_spend_usd: 0, errors_today: 0, last_error: null },
}

const item = (sku: string, name: string, count: number, price: number) => ({ sku, name, count, price, price_text: `${price} сом`, boxes: [], confidence: 0.9 })

export const walkBefore: Walk = {
  id: 'demo-sun',
  created_at: '2026-10-26T02:12:00Z',
  label: 'Воскресенье · 08:12',
  source: 'demo',
  shop_id: 'demo-chuy',
  photos: [
    {
      photo_id: 'p0',
      width: 1600,
      height: 1200,
      shelves: [{ index: 0, items: [item('coca cola 1 л', 'Coca-Cola 1 л', 12, 95), item('молоко', 'Молоко Эльвест 6% 1 л', 9, 170)], empty_slots: 0 }],
      model_calls: 0,
      notes: [],
    },
  ],
}

export const walk: Walk = {
  id: 'demo-tue',
  created_at: '2026-10-28T02:12:00Z',
  label: 'Сегодня · 08:12',
  source: 'demo',
  shop_id: 'demo-chuy',
  photos: [
    {
      photo_id: 'p1',
      width: 1600,
      height: 1200,
      shelves: [{ index: 0, items: [item('coca cola 1 л', 'Coca-Cola 1 л', 2, 95)], empty_slots: 3 }],
      model_calls: 0,
      notes: [],
    },
  ],
}

const change = (over: Partial<ItemChange>): ItemChange => ({
  sku: 'x',
  name: 'X',
  before: 10,
  after: 10,
  status: 'ok',
  sold: 0,
  velocity_per_day: 0,
  days_left: null,
  price_before: 50,
  price_after: 50,
  loss_per_day: 0,
  suggested_order: 0,
  reason: 'Без изменений',
  ...over,
})

export const diff: WalkDiff = {
  walk_before_id: 'demo-sun',
  walk_after_id: 'demo-tue',
  hours_between: 48,
  changes: [
    change({ sku: 'молоко', name: 'Молоко Эльвест 6% 1 л', before: 9, after: 0, status: 'out_of_stock', sold: 9, velocity_per_day: 4.5, days_left: 0, price_before: 170, price_after: null, loss_per_day: 765, suggested_order: 18, reason: 'Было 9, стало 0 — полка пустая' }),
    change({ sku: 'coca cola 1 л', name: 'Coca-Cola 1 л', before: 12, after: 2, status: 'low_stock', sold: 10, velocity_per_day: 5, days_left: 0.4, price_before: 95, price_after: 95, suggested_order: 24, reason: 'Было 12, осталось 2' }),
    change({ sku: 'кукуруза', name: 'Кукуруза консервированная', before: 8, after: 8, status: 'price_mismatch', price_before: 80, price_after: 85, reason: 'Ценник изменился: 80 → 85' }),
    change({ sku: 'масло', name: 'Масло сливочное 180 г', before: 6, after: 6, price_before: 82, price_after: 82 }),
  ],
  total_items: 16,
  changed: 3,
  out_of_stock: 1,
  low_stock: 1,
  price_mismatch: 1,
  loss_per_day: 765,
  empty_slots: 3,
}

export const DEVICE = 'device-test-0001'

export const shops: Shop[] = [
  { id: 'shop-1', name: 'Дүкөн на Чуй', address: 'Чуй 120', created_at: '2026-10-20T00:00:00Z', demo: false },
  { id: 'shop-2', name: 'Дүкөн Манас', address: '', created_at: '2026-10-21T00:00:00Z', demo: false },
]

const summary = (shop: Shop, over: Partial<BranchSummary> = {}): BranchSummary => ({
  shop,
  walks: 0,
  last_walk_id: null,
  last_walk_at: null,
  total_items: 0,
  out_of_stock: 0,
  low_stock: 0,
  price_mismatch: 0,
  loss_per_day: 0,
  ...over,
})

export const mineOverview: BranchSummary[] = shops.map((s) => summary(s))
export const demoOverview: BranchSummary[] = [
  summary({ id: 'demo-chuy', name: 'Chuy 120', address: 'Chuy Ave 120', created_at: '', demo: true, lat: 42.8766, lng: 74.6046 }, { walks: 2, last_walk_id: 'demo-tue', last_walk_at: '2026-10-28T02:12:00Z', loss_per_day: 765, out_of_stock: 1, low_stock: 1 }),
  summary({ id: 'demo-manas', name: 'Manas 47', address: 'Manas Ave 47', created_at: '', demo: true, lat: 42.8665, lng: 74.5873 }, { walks: 2, last_walk_id: 'demo-manas-2', last_walk_at: '2026-10-28T01:00:00Z', loss_per_day: 1248, out_of_stock: 2, low_stock: 2 }),
  summary({ id: 'demo-osh', name: 'Osh Bazaar', address: '', created_at: '', demo: true, lat: 42.8748, lng: 74.5694 }, { walks: 2, last_walk_id: 'demo-osh-2', last_walk_at: '2026-10-28T01:30:00Z' }),
]

/** Настройки устройства для тестов: русский и сомы, чтобы суммы в проверках читались как «765 сом». */
export const SETTINGS = { locale: 'ru', currency: 'KGS', theme: 'light', demoKey: '' }

export function seedSettings(over: Partial<typeof SETTINGS> & { dataMode?: 'auto' | 'live' | 'demo'; motion?: string } = {}, opts: { currentShop?: string } = {}) {
  localStorage.setItem('dukon.settings', JSON.stringify({ ...SETTINGS, ...over }))
  localStorage.setItem('dukon.device', DEVICE)
  if (opts.currentShop) localStorage.setItem('dukon.currentShop', JSON.stringify(opts.currentShop))
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export type Routes = Record<string, (init?: RequestInit) => Response | Promise<Response>>

export const demoShops: Shop[] = demoOverview.map((r) => r.shop)

/** Сервер без ключа моделей: приложение показывает демо-сеть. На этом наборе держится большинство тестов страниц. */
export const happyRoutes: Routes = {
  '/health': () => jsonResponse(demoHealth),
  '/shops/demo': () => jsonResponse(demoShops),
  '/shops': (init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { name: string; address?: string }
      return jsonResponse({ id: 'shop-new', name: body.name, address: body.address ?? '', created_at: '2026-10-28T00:00:00Z', demo: false }, 201)
    }
    return jsonResponse(shops)
  },
  '/branches/overview?scope=mine': () => jsonResponse(mineOverview),
  '/branches/overview?scope=demo': () => jsonResponse(demoOverview),
  '/walks?source=live': () => jsonResponse([]),
  '/walks?source=demo': () => jsonResponse([walkBefore, walk]),
  '/walks/demo-tue/diff': () => jsonResponse(diff),
  '/walks/demo-tue': () => jsonResponse(walk),
  '/walks/demo-sun/diff': () => jsonResponse({ ...diff, walk_before_id: null, walk_after_id: 'demo-sun', changes: [], changed: 0, out_of_stock: 0, low_stock: 0, price_mismatch: 0, loss_per_day: 0 }),
  '/walks/demo-sun': () => jsonResponse(walkBefore),
}

/** Подменяет fetch: по пути (точное совпадение приоритетнее префикса) возвращает заготовленный ответ. */
export function mockFetch(routes: Routes) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const exact = routes[path]
    if (exact) return exact(init)
    const key = Object.keys(routes)
      .filter((k) => path.startsWith(k))
      .sort((a, b) => b.length - a.length)[0]
    if (!key) return jsonResponse({ detail: { code: 'not_found', message: 'нет такого пути' } }, 404)
    return routes[key](init)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** Опции, которые страницы передали в ECharts (в тестах график не рисуется, но данные проверяем). */
export function chartOptions(): Record<string, unknown>[] {
  return ((globalThis as unknown as { __chartCalls?: { option: unknown }[] }).__chartCalls ?? []).map((c) => c.option as Record<string, unknown>)
}

/** Сервер с ключом и кредитами: живой режим, только свои данные. */
export const liveRoutes: Routes = { ...happyRoutes, '/health': () => jsonResponse(health) }

/** Обработчики событий каждого созданного графика — чтобы «кликнуть» по сектору кольца в тесте. */
export function chartHandlers(): Record<string, (p: unknown) => void>[] {
  return (globalThis as unknown as { __chartHandlers?: Record<string, (p: unknown) => void>[] }).__chartHandlers ?? []
}
