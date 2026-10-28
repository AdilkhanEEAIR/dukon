// Запасной демо-набор на случай, когда сервер недоступен. Снимок собирает backend/scripts/export_demo_snapshot.py
// из тех же данных, что сервер сеет при запуске, поэтому офлайн-демо выглядит ровно как настоящее.
// Грузим его лениво, отдельным файлом: пока сервер жив, браузер этот кусок не скачивает вовсе.

import type { BranchSummary, Shop, Walk, WalkDiff } from '../api/types'

export interface Snapshot {
  generated_at: string
  shops: Shop[]
  overview: BranchSummary[]
  walks: Record<string, Walk[]>
  by_id: Record<string, Walk>
  diffs: Record<string, WalkDiff>
}

type Route =
  | { kind: 'walks'; shopId: string | null }
  | { kind: 'walk'; id: string }
  | { kind: 'diff'; id: string }
  | { kind: 'shops' }
  | { kind: 'overview' }

const DEMO_ID = /^demo-[\w-]+$/

/** Какой демо-запрос это был. Всё, что не про демо (свои магазины, анализ фото), офлайн не подменяем. */
export function demoRoute(path: string): Route | null {
  const [p, q = ''] = path.split('?')
  const params = new URLSearchParams(q)
  if (p === '/walks') return params.get('source') === 'demo' ? { kind: 'walks', shopId: params.get('shop_id') } : null
  if (p === '/shops/demo') return { kind: 'shops' }
  if (p === '/branches/overview') return params.get('scope') === 'demo' ? { kind: 'overview' } : null
  const m = /^\/walks\/([^/]+)(\/diff)?$/.exec(p)
  if (!m) return null
  const id = decodeURIComponent(m[1])
  if (!DEMO_ID.test(id)) return null
  return m[2] ? { kind: 'diff', id } : { kind: 'walk', id }
}

const DATE_KEYS = new Set(['created_at', 'last_walk_at'])

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

/** Ответ из снимка или undefined, если такого демо-обхода в снимке нет. */
export async function offlineAnswer(route: Route): Promise<unknown> {
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
  }
}
