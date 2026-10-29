import type { AgentEvent, AgentRun, BranchSummary, DraftsResponse, Health, ItemChange, Order, Rules, Shop, Supplier, SupplierDraft, Walk, WalkDiff } from '../api/types'

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

// ---- агент, правила, поставщики, заказы (заход 1.7)

export const suppliers: Supplier[] = [
  { id: 'aksuu', name: 'Ак-Суу · напитки', categories: ['drinks'], contact: 'Бакыт', phone: '+996555000011', delivery_days: [1, 3, 5], min_order_kgs: 2000, pack_size: 12, discounts: [{ min_units: 72, pct: 5 }], out_of_stock: [] },
  { id: 'alatoo', name: 'Ала-Тоо · молочный дом', categories: ['dairy'], contact: 'Гульмира', phone: '+996555000022', delivery_days: [1, 4], min_order_kgs: 1500, pack_size: 10, discounts: [], out_of_stock: [] },
]

export const rules: Rules = { max_order_total_kgs: 15000, max_stock_days: 14, max_line_units: 120, no_dairy_on: [4], banned_suppliers: [], min_discount_for_upsize_pct: 7 }

const draftLine = (sku: string, name: string, qty: number, price: number, suggested: number, onHand: number, velocity: number, category: 'drinks' | 'dairy'): SupplierDraft['lines'][number] => ({
  sku,
  name,
  qty,
  unit_price: price,
  suggested,
  on_hand: onHand,
  velocity_per_day: velocity,
  category,
})

export const drafts: DraftsResponse = {
  walk_id: 'demo-tue',
  shop_id: 'demo-chuy',
  rules,
  total: 2280 + 3400,
  drafts: [
    { supplier_id: 'aksuu', supplier_name: 'Ак-Суу · напитки', lines: [draftLine('coca cola 1 л', 'Coca-Cola 1 л', 24, 95, 24, 2, 5, 'drinks')], total: 2280, delivery_day: 3, discount_pct: 0, notes: [] },
    { supplier_id: 'alatoo', supplier_name: 'Ала-Тоо · молочный дом', lines: [draftLine('молоко', 'Молоко Эльвест 6% 1 л', 20, 170, 18, 0, 4.5, 'dairy')], total: 3400, delivery_day: 1, discount_pct: 0, notes: [] },
  ],
}

const drinks = { supplier_id: 'aksuu', supplier_name: 'Ак-Суу · напитки', delivery_day: 3, delivery_day_name: 'четверг', discount_pct: 0, total: 2280, lines: [{ sku: 'coca cola 1 л', name: 'Coca-Cola 1 л', qty: 24, unit_price: 95, sum: 2280 }] }
const drinksGreedy = { ...drinks, total: 3420, lines: [{ sku: 'coca cola 1 л', name: 'Coca-Cola 1 л', qty: 36, unit_price: 95, sum: 3420 }] }
const dairyFri = { supplier_id: 'alatoo', supplier_name: 'Ала-Тоо · молочный дом', delivery_day: 4, delivery_day_name: 'пятница', discount_pct: 0, total: 3400, lines: [{ sku: 'молоко', name: 'Молоко Эльвест 6% 1 л', qty: 20, unit_price: 170, sum: 3400 }] }
const dairy = { ...dairyFri, delivery_day: 1, delivery_day_name: 'вторник' }
const ev = (step: number, kind: AgentEvent['kind'], text: string, supplier_id: string | null, data: AgentEvent['data'] = {}): AgentEvent => ({ step, kind, at: '2026-10-28T02:20:00Z', text, supplier_id, data })

/** Записанный прогон: две блокировки правилами (апсайз без скидки, молочка в пятницу), два заказа. */
export const agentEvents: AgentEvent[] = [
  ev(0, 'start', '', null, { drafts: drafts.drafts, rules }),
  ev(1, 'tool_call', 'Возьму Coca-Cola 1 л побольше — от 72 шт. скидка 5%.', 'aksuu', { tool: 'propose_order' }),
  ev(1, 'verifier_block', 'Coca-Cola 1 л: заказ 36 вместо нужных 24, а скидка всего 5% (нужно ≥ 7%)', 'aksuu', {
    tool: 'propose_order',
    status: 'blocked',
    draft: drinksGreedy,
    violations: [{ rule: 'min_discount_for_upsize', message: 'x', sku: 'coca cola 1 л', limit: 7, actual: 5, fix: 'Вернуться к 24 шт.' }],
  }),
  ev(2, 'tool_call', 'Скидка 5% не стоит лишнего товара. Возвращаю Coca-Cola 1 л: 24 шт.', 'aksuu', { tool: 'propose_order' }),
  ev(2, 'fix', 'Ак-Суу · напитки: 1 поз. 2 280 сом', 'aksuu', { tool: 'propose_order', status: 'ok', draft: drinks }),
  ev(3, 'tool_call', 'Спрашиваю Ак-Суу: наличие, скидка, день.', 'aksuu', { tool: 'ask_supplier' }),
  ev(3, 'supplier_reply', 'Всё есть. Привезём в четверг. От 72 шт. будет скидка 5%.', 'aksuu', {
    tool: 'ask_supplier',
    status: 'ok',
    reply: { message: 'x', accepted: [{ sku: 'coca cola 1 л', name: 'Coca-Cola 1 л', qty: 24 }], rejected: [], discount_pct: 0, delivery_day: 3, min_order_ok: true, offers: [{ min_units: 72, pct: 5 }] },
  }),
  ev(4, 'tool_call', 'Подтверждаю заказ Ак-Суу: 1 поз.', 'aksuu', { tool: 'confirm_order' }),
  ev(4, 'verifier_ok', 'Заказ Ак-Суу · напитки подтверждён: 2 280 сом', 'aksuu', { tool: 'confirm_order', status: 'ok', order: drinks }),
  ev(5, 'tool_call', 'Молочку удобнее всего на пятницу: ближайшая доставка.', 'alatoo', { tool: 'propose_order' }),
  ev(5, 'verifier_block', 'Молочку нельзя заказывать на пятницу', 'alatoo', {
    tool: 'propose_order',
    status: 'blocked',
    draft: dairyFri,
    violations: [{ rule: 'no_dairy_on', message: 'x', sku: null, limit: null, actual: 4, fix: 'Доступно: вторник' }],
  }),
  ev(6, 'tool_call', 'Правило хозяина: молочку не на пятницу. Переношу на вторник.', 'alatoo', { tool: 'propose_order' }),
  ev(6, 'fix', 'Ала-Тоо · молочный дом: 1 поз. 3 400 сом', 'alatoo', { tool: 'propose_order', status: 'ok', draft: dairy }),
  ev(7, 'tool_call', 'Спрашиваю Ала-Тоо.', 'alatoo', { tool: 'ask_supplier' }),
  ev(7, 'supplier_reply', 'Всё есть. Привезём во вторник.', 'alatoo', {
    tool: 'ask_supplier',
    status: 'ok',
    reply: { message: 'x', accepted: [{ sku: 'молоко', name: 'Молоко Эльвест 6% 1 л', qty: 20 }], rejected: [], discount_pct: 0, delivery_day: 1, min_order_ok: true, offers: [] },
  }),
  ev(8, 'tool_call', 'Подтверждаю заказ Ала-Тоо: 1 поз.', 'alatoo', { tool: 'confirm_order' }),
  ev(8, 'verifier_ok', 'Заказ Ала-Тоо подтверждён: 3 400 сом', 'alatoo', { tool: 'confirm_order', status: 'ok', order: dairy }),
  ev(9, 'final', 'Подтверждено 2 заказа на 5 680 сом. Правила хозяина сработали 2 раза — всё исправлено.', null, { tool: 'finish', status: 'ok' }),
]

export const agentRun: AgentRun = {
  id: 'run-1',
  created_at: '2026-10-28T02:20:00Z',
  walk_id: 'demo-tue',
  shop_id: 'demo-chuy',
  source: 'demo',
  status: 'done',
  model: 'script',
  steps: 9,
  events: agentEvents,
  result: {
    orders: [
      { supplier_id: 'aksuu', supplier_name: 'Ак-Суу · напитки', lines: [draftLine('coca cola 1 л', 'Coca-Cola 1 л', 24, 95, 24, 2, 5, 'drinks')], total: 2280, delivery_day: 3, discount_pct: 0, notes: [] },
      { supplier_id: 'alatoo', supplier_name: 'Ала-Тоо · молочный дом', lines: [draftLine('молоко', 'Молоко Эльвест 6% 1 л', 20, 170, 18, 0, 4.5, 'dairy')], total: 3400, delivery_day: 1, discount_pct: 0, notes: [] },
    ],
    skipped: [],
    total: 5680,
    summary: 'Подтверждено 2 заказа на 5 680 сом. Правила хозяина сработали 2 раза — всё исправлено.',
    blocks: 2,
    fixes: 2,
  },
  error: null,
}

/** Тело потока событий (text/event-stream) из прогона: так его отдаёт сервер. */
export function sseBody(run: AgentRun): string {
  const frames = run.events.map((e) => `event: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`)
  const { events: _events, ...rest } = run
  void _events
  frames.push(`event: done\ndata: ${JSON.stringify(rest)}\n\n`)
  return frames.join('')
}

export const approvedOrders: Order[] = agentRun.result!.orders.map((o, i) => ({
  id: `ord-${i + 1}`,
  created_at: '2026-10-28T02:30:00Z',
  shop_id: 'demo-chuy',
  walk_id: 'demo-tue',
  run_id: 'run-1',
  supplier_id: o.supplier_id,
  supplier_name: o.supplier_name,
  lines: o.lines,
  total: o.total,
  delivery_day: o.delivery_day,
  status: 'approved',
  message: `Здравствуйте! Магазин «Chuy 120», заказ: ${o.lines.map((l) => `${l.name} — ${l.qty} шт.`).join(', ')}`,
  whatsapp_url: `https://wa.me/${suppliers.find((s) => s.id === o.supplier_id)!.phone.replace('+', '')}?text=hello`,
}))

/** Обращения агента: прогон, поток, разговор, правила, утверждение. Сами по себе и в happyRoutes. */
export const agentRoutes: Routes = {
  '/suppliers': () => jsonResponse(suppliers),
  '/rules?shop_id=demo-chuy': (init) => jsonResponse(init?.method === 'PUT' ? JSON.parse(String(init.body)) : rules),
  '/orders/drafts?walk_id=demo-tue': () => jsonResponse(drafts),
  '/agent/runs/latest?walk_id=demo-tue': () => jsonResponse(null),
  '/agent/run?walk_id=demo-tue': () => jsonResponse({ ...agentRun, status: 'running', events: [], result: null }, 201),
  '/agent/runs/run-1/events': () => new Response(sseBody(agentRun), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
  '/agent/runs/run-1': () => jsonResponse(agentRun),
  '/agent/chat': (init) => {
    const body = JSON.parse(String(init?.body)) as { message: string }
    const m = body.message.toLowerCase()
    if (/закаж|order/.test(m)) return jsonResponse({ reply: { role: 'agent', text: 'Запускаю агента.', at: '2026-10-28T02:21:00Z', action: { type: 'start_run' } }, rules: null })
    if (/пятниц|friday/.test(m)) return jsonResponse({ reply: { role: 'agent', text: 'Записал: молочку не заказывать на пятницу.', at: '2026-10-28T02:21:00Z', action: { type: 'update_rules', rules: { ...rules, no_dairy_on: [4] } } }, rules: { ...rules, no_dairy_on: [4] } })
    return jsonResponse({ reply: { role: 'agent', text: 'Сегодня полка теряет 765 сом в день.', at: '2026-10-28T02:21:00Z', action: null }, rules: null })
  },
  '/orders?shop_id=demo-chuy&walk_id=demo-tue': () => jsonResponse([]),
  '/orders/approve': () => jsonResponse(approvedOrders, 201),
  '/orders/ord-1/sent': () => jsonResponse({ ...approvedOrders[0], status: 'sent' }),
}

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
  ...agentRoutes,
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
