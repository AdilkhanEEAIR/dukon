import type { Health, ItemChange, Walk, WalkDiff } from '../api/types'

export const health: Health = {
  status: 'ok',
  version: '0.1.0',
  provider: 'meta',
  live_enabled: true,
  live_calls_today: 0,
  live_calls_per_day_total: 60,
}

export const walk: Walk = {
  id: 'demo-tue',
  created_at: '2026-10-28T02:12:00Z',
  label: 'Сегодня · 08:12',
  source: 'demo',
  photos: [{ photo_id: 'p1', width: 1600, height: 1200, shelves: [], model_calls: 0, notes: [] }],
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
    change({ sku: 'coca cola 1 л', name: 'Coca-Cola 1 л', before: 12, after: 2, status: 'low_stock', sold: 10, velocity_per_day: 5, days_left: 0.4, price_before: 95, price_after: 95, suggested_order: 24, reason: 'Было 12, осталось 2' }),
    change({ sku: 'молоко', name: 'Молоко Эльвест 6% 1 л', before: 9, after: 0, status: 'out_of_stock', sold: 9, velocity_per_day: 4.5, days_left: 0, price_before: 170, price_after: null, loss_per_day: 765, suggested_order: 18, reason: 'Было 9, стало 0 — полка пустая' }),
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

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Подменяет fetch: по пути возвращает заготовленный ответ. */
export function mockFetch(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const key = Object.keys(routes).find((k) => path === k || path.startsWith(k))
    if (!key) return jsonResponse({ detail: { code: 'not_found', message: 'нет такого пути' } }, 404)
    return routes[key](init)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
