// Запасной демо-набор на случай, когда сервер недоступен. Снимок собирает backend/scripts/export_demo_snapshot.py
// из тех же данных, что сервер сеет при запуске, поэтому офлайн-демо выглядит ровно как настоящее.
// Грузим его лениво, отдельным файлом: пока сервер жив, браузер этот кусок не скачивает вовсе.
// Агент, правила и заказы в офлайне тоже работают: прогон записан заранее, правила и заказы живут в памяти вкладки.

import type { AgentRun, BranchSummary, ChatMessage, ChatOut, DraftsResponse, Order, Rules, Shop, Supplier, SupplierDraft, Walk, WalkDiff } from '../api/types'

export interface Snapshot {
  generated_at: string
  shops: Shop[]
  overview: BranchSummary[]
  walks: Record<string, Walk[]>
  by_id: Record<string, Walk>
  diffs: Record<string, WalkDiff>
  suppliers?: Supplier[]
  rules?: Rules
  drafts?: Record<string, DraftsResponse>
  /** Записанные прогоны агента по обходу и языку: en и ru, остальные языки берут английский. */
  agent_runs?: Record<string, Record<string, AgentRun>>
}

type Route =
  | { kind: 'walks'; shopId: string | null }
  | { kind: 'walk'; id: string }
  | { kind: 'diff'; id: string }
  | { kind: 'shops' }
  | { kind: 'overview' }
  | { kind: 'suppliers' }
  | { kind: 'rules'; shopId: string | null; method: 'GET' | 'PUT' }
  | { kind: 'drafts'; walkId: string }
  | { kind: 'run_start'; walkId: string; lang: string }
  | { kind: 'run'; id: string }
  | { kind: 'run_latest'; walkId: string }
  | { kind: 'chat' }
  | { kind: 'approve' }
  | { kind: 'orders'; shopId: string | null; walkId: string | null }
  | { kind: 'sent'; id: string }

const DEMO_ID = /^demo-[\w-]+$/
const OFFLINE_RUN = /^offline-run-/

/** Какой демо-запрос это был. Всё, что не про демо (свои магазины, анализ фото, голос), офлайн не подменяем. */
export function demoRoute(path: string, method = 'GET'): Route | null {
  const [p, q = ''] = path.split('?')
  const params = new URLSearchParams(q)
  const demoShop = (id: string | null) => id === null || DEMO_ID.test(id)
  if (method === 'GET') {
    if (p === '/walks') return params.get('source') === 'demo' ? { kind: 'walks', shopId: params.get('shop_id') } : null
    if (p === '/shops/demo') return { kind: 'shops' }
    if (p === '/branches/overview') return params.get('scope') === 'demo' ? { kind: 'overview' } : null
    if (p === '/suppliers') return { kind: 'suppliers' }
    if (p === '/rules') return demoShop(params.get('shop_id')) ? { kind: 'rules', shopId: params.get('shop_id'), method: 'GET' } : null
    if (p === '/orders/drafts') return DEMO_ID.test(params.get('walk_id') ?? '') ? { kind: 'drafts', walkId: params.get('walk_id')! } : null
    if (p === '/agent/runs/latest') return DEMO_ID.test(params.get('walk_id') ?? '') ? { kind: 'run_latest', walkId: params.get('walk_id')! } : null
    if (p === '/orders') return demoShop(params.get('shop_id')) ? { kind: 'orders', shopId: params.get('shop_id'), walkId: params.get('walk_id') } : null
    const run = /^\/agent\/runs\/([^/]+)$/.exec(p)
    if (run) return OFFLINE_RUN.test(decodeURIComponent(run[1])) ? { kind: 'run', id: decodeURIComponent(run[1]) } : null
    const m = /^\/walks\/([^/]+)(\/diff)?$/.exec(p)
    if (!m) return null
    const id = decodeURIComponent(m[1])
    if (!DEMO_ID.test(id)) return null
    return m[2] ? { kind: 'diff', id } : { kind: 'walk', id }
  }
  if (method === 'PUT' && p === '/rules') return demoShop(params.get('shop_id')) ? { kind: 'rules', shopId: params.get('shop_id'), method: 'PUT' } : null
  if (method === 'POST') {
    if (p === '/agent/run') return DEMO_ID.test(params.get('walk_id') ?? '') ? { kind: 'run_start', walkId: params.get('walk_id')!, lang: params.get('lang') ?? 'en' } : null
    if (p === '/agent/chat') return { kind: 'chat' }
    if (p === '/orders/approve') return { kind: 'approve' }
    const sent = /^\/orders\/([^/]+)\/sent$/.exec(p)
    if (sent && /^offline-ord-/.test(decodeURIComponent(sent[1]))) return { kind: 'sent', id: decodeURIComponent(sent[1]) }
  }
  return null
}

const DATE_KEYS = new Set(['created_at', 'last_walk_at', 'at'])

/** Снимок сделан в какой-то день; сдвигаем все даты так, будто демо-обходы прошли только что,
 *  иначе «последний обход» через неделю после сборки выглядел бы заброшенным. */
export function shiftDates<T>(value: T, deltaMs: number): T {
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, deltaMs)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DATE_KEYS.has(k) && typeof v === 'string') {
        const t = Date.parse(v)
        out[k] = Number.isNaN(t) ? v : new Date(t + deltaMs).toISOString()
      } else out[k] = shiftDates(v, deltaMs)
    }
    return out as T
  }
  return value
}

let cache: Promise<Snapshot> | null = null

function load(): Promise<Snapshot> {
  cache ??= import('./snapshot.json').then((m) => {
    const raw = m.default as unknown as Snapshot
    const delta = Math.max(0, Date.now() - Date.parse(raw.generated_at))
    return shiftDates(raw, delta)
  })
  return cache
}

// Память вкладки: правила, прогоны и заказы, сделанные офлайн. Перезагрузка страницы их забывает — это честно:
// без сервера сохранять некуда, а демо должно выглядеть одинаково у каждого судьи.
const rulesByShop = new Map<string, Rules>()
const runs = new Map<string, AgentRun>()
const orders: Order[] = []
let seq = 0

export function resetOffline() {
  rulesByShop.clear()
  runs.clear()
  orders.length = 0
  seq = 0
}

const WEEKDAY_RU = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье']

function orderMessage(order: Order, shopName: string): string {
  const day = order.delivery_day !== null ? ` на ${WEEKDAY_RU[order.delivery_day]}` : ''
  const lines = order.lines.map((l) => `• ${l.name} — ${l.qty} шт.`).join('\n')
  const total = Math.round(order.total).toLocaleString('ru-RU').replace(/ /g, ' ')
  return `Здравствуйте! Магазин «${shopName}», заказ${day}:\n${lines}\nИтого примерно ${total} сом. Подтвердите, пожалуйста. Спасибо!`
}

function waUrl(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

/** Записанные события прогона, если он офлайновый; null — прогон настоящий, читаем поток с сервера. */
export async function offlineRunEvents(runId: string): Promise<AgentRun | null> {
  if (!OFFLINE_RUN.test(runId)) return null
  const run = runs.get(runId)
  return run ? { ...run, status: 'done' } : null
}

const CHAT: Record<string, Record<string, string>> = {
  loss: {
    ru: 'Сегодня полка теряет {loss} сом в день. Нет в наличии: {out}. Заканчивается: {low}.',
    en: 'The shelf is losing {loss} KGS a day. Out of stock: {out}. Running low: {low}.',
  },
  order: {
    ru: 'Запускаю агента: он соберёт заказ по {n} позициям и договорится с поставщиками по вашим правилам.',
    en: 'Starting the agent: it will build an order for {n} items and negotiate with suppliers by your rules.',
  },
  fallback: {
    ru: 'Могу сказать, сколько теряете, что заказать, или изменить правило. Спросите, например: «что заказать?»',
    en: 'I can tell you what you’re losing, what to order, or change a rule. Try: “what should I order?”',
  },
}

function chatAnswer(message: string, lang: string, diff: WalkDiff | undefined): ChatMessage {
  const m = message.toLowerCase()
  const t = (key: string, p: Record<string, string | number>) => (CHAT[key][lang] ?? CHAT[key].en).replace(/\{(\w+)\}/g, (_, k: string) => String(p[k] ?? ''))
  const at = new Date().toISOString()
  if (diff && /закаж|заказ|order|supplier|поставщик|буйрут/.test(m)) {
    return { role: 'agent', text: t('order', { n: diff.changes.filter((c) => c.suggested_order > 0).length }), at, action: { type: 'start_run' } }
  }
  if (diff && /потер|теря|loss|losing|lost|деньг|money|жогот|закончил|out of stock|missing/.test(m)) {
    const names = (status: string) => diff.changes.filter((c) => c.status === status).map((c) => c.name).join(', ') || '—'
    return { role: 'agent', text: t('loss', { loss: Math.round(diff.loss_per_day).toLocaleString('ru-RU'), out: names('out_of_stock'), low: names('low_stock') }), at }
  }
  return { role: 'agent', text: t('fallback', {}), at }
}

/** Ответ из снимка или undefined, если такого демо-обхода в снимке нет. */
export async function offlineAnswer(route: Route, body?: unknown): Promise<unknown> {
  const s = await load()
  switch (route.kind) {
    case 'walks':
      if (route.shopId) return s.walks[route.shopId] ?? []
      return Object.values(s.walks)
        .flat()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    case 'walk':
      return s.by_id[route.id]
    case 'diff':
      return s.diffs[route.id]
    case 'shops':
      return s.shops
    case 'overview':
      return s.overview
    case 'suppliers':
      return s.suppliers ?? []
    case 'rules': {
      const key = route.shopId ?? ''
      if (route.method === 'PUT' && body) rulesByShop.set(key, body as Rules)
      return rulesByShop.get(key) ?? s.rules
    }
    case 'drafts': {
      const d = s.drafts?.[route.walkId]
      if (!d) return undefined
      return { ...d, rules: rulesByShop.get(d.shop_id ?? '') ?? d.rules }
    }
    case 'run_start': {
      const recorded = s.agent_runs?.[route.walkId]
      if (!recorded) return undefined
      const base = recorded[route.lang] ?? recorded.en ?? Object.values(recorded)[0]
      const id = `offline-run-${++seq}`
      const run: AgentRun = { ...base, id, created_at: new Date().toISOString(), status: 'done' }
      runs.set(id, run)
      return { ...run, status: 'running', events: [], result: null }
    }
    case 'run':
      return runs.get(route.id)
    case 'run_latest': {
      const list = [...runs.values()].filter((r) => r.walk_id === route.walkId)
      return list.length ? list[list.length - 1] : null
    }
    case 'chat': {
      const b = (body ?? {}) as { message?: string; walk_id?: string | null; lang?: string }
      const diff = b.walk_id ? s.diffs[b.walk_id] : undefined
      const out: ChatOut = { reply: chatAnswer(b.message ?? '', b.lang ?? 'en', diff), rules: null }
      return out
    }
    case 'approve': {
      const b = body as { walk_id: string; run_id?: string | null; drafts: SupplierDraft[] }
      const walk = s.by_id[b.walk_id]
      const shopName = s.shops.find((x) => x.id === walk?.shop_id)?.name ?? 'Dukon'
      const created: Order[] = []
      for (const d of b.drafts) {
        const lines = d.lines.filter((l) => l.qty > 0)
        if (!lines.length) continue
        const supplier = s.suppliers?.find((x) => x.id === d.supplier_id)
        const order: Order = {
          id: `offline-ord-${++seq}`,
          created_at: new Date().toISOString(),
          shop_id: walk?.shop_id ?? null,
          walk_id: b.walk_id,
          run_id: b.run_id ?? null,
          supplier_id: d.supplier_id,
          supplier_name: d.supplier_name,
          lines,
          total: d.total,
          delivery_day: d.delivery_day,
          status: 'approved',
          message: '',
          whatsapp_url: '',
        }
        order.message = orderMessage(order, shopName)
        order.whatsapp_url = waUrl(supplier?.phone ?? '', order.message)
        orders.unshift(order)
        created.push(order)
      }
      return created
    }
    case 'orders':
      return orders.filter((o) => (!route.shopId || o.shop_id === route.shopId) && (!route.walkId || o.walk_id === route.walkId))
    case 'sent': {
      const o = orders.find((x) => x.id === route.id)
      if (o) o.status = 'sent'
      return o
    }
  }
}
