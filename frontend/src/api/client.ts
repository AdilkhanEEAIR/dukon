// Обращения к серверу. Каждая ошибка превращается в ApiError с кодом и человеческим текстом:
// страницы показывают причину, а не «что-то пошло не так».
// Если сервер лежит, демо-запросы отвечаются из встроенного снимка: сайт не превращается в страницу ошибки.

import type { BranchSummary, Health, Shop, Walk, WalkDiff, WalkSource } from './types'
import { demoRoute, offlineAnswer } from '../demo/offline'
import { beginActivity, endActivity } from '../lib/activity'

export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8000'

export type ErrorCode =
  | 'network'
  | 'timeout'
  | 'not_found'
  | 'demo_key_required'
  | 'live_disabled'
  | 'rate_limited'
  | 'daily_budget'
  | 'bad_image'
  | 'file_too_large'
  | 'too_many_photos'
  | 'auth'
  | 'billing'
  | 'bad_model_output'
  | 'api'
  | 'unknown'
  | 'device_required'
  | 'too_many_shops'
  | 'shop_not_found'
  | 'validation'

export class ApiError extends Error {
  code: ErrorCode
  status: number
  retryable: boolean
  constructor(code: ErrorCode, message: string, status = 0, retryable = false) {
    super(message)
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

export const ERROR_CODES: ErrorCode[] = [
  'network', 'timeout', 'not_found', 'demo_key_required', 'live_disabled', 'rate_limited', 'daily_budget',
  'bad_image', 'file_too_large', 'too_many_photos', 'auth', 'billing', 'bad_model_output', 'api', 'unknown',
  'device_required', 'too_many_shops', 'shop_not_found', 'validation',
]

const KNOWN_CODES = new Set<string>(ERROR_CODES)

// ---- запасной режим
// ModeProvider сообщает сюда, что /health не отвечает: тогда демо-запросы даже не пытаются достучаться
// до сервера (иначе каждый ждал бы таймаут), а сразу берут ответ из снимка.
let serverDown = false
export function setServerDown(down: boolean) {
  serverDown = down
}

// Подписчики на «запрос упал по сети»: ModeProvider тут же перепроверяет сервер и переключает приложение на демо,
// не дожидаясь очередного опроса раз в минуту.
const failureListeners = new Set<() => void>()
export function onServerFailure(cb: () => void): () => void {
  failureListeners.add(cb)
  return () => {
    failureListeners.delete(cb)
  }
}

/** Сервер не ответил вовсе или прокси хостинга сказал «сервиса нет» — это не ошибка данных, а падение. */
export function isServerDown(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'network' || err.code === 'timeout' || err.status === 502 || err.status === 504)
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 90_000): Promise<T> {
  const isHealth = path.startsWith('/health')
  const route = (init.method ?? 'GET').toUpperCase() === 'GET' ? demoRoute(path) : null
  if (route && serverDown) {
    const answer = await offlineAnswer(route)
    if (answer !== undefined) return answer as T
  }
  // Фоновую проверку /health в полосе загрузки не показываем: она идёт по таймеру и только мелькала бы.
  if (!isHealth) beginActivity()
  try {
    return await send<T>(path, init, timeoutMs)
  } catch (err) {
    // 503 сам сервер отдаёт только на живой анализ (POST). На демо-чтении 503 — это уже хостинг: сервис спит или упал.
    if (isServerDown(err) || (route && err instanceof ApiError && err.status === 503)) {
      if (!isHealth) failureListeners.forEach((cb) => cb())
      if (route) {
        const answer = await offlineAnswer(route)
        if (answer !== undefined) return answer as T
      }
    }
    throw err
  } finally {
    if (!isHealth) endActivity()
  }
}

async function send<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(API_BASE + path, { ...init, signal: controller.signal })
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error).name === 'AbortError') throw new ApiError('timeout', 'timeout', 0, true)
    throw new ApiError('network', 'network', 0, true)
  }
  clearTimeout(timer)
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as T
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* тело не JSON — ниже подставим код по статусу */
  }
  const detail = (body as { detail?: { code?: string; message?: string; retryable?: boolean } } | null)?.detail
  const rawCode = detail?.code ?? (res.status === 404 ? 'not_found' : 'unknown')
  const code: ErrorCode = KNOWN_CODES.has(rawCode) ? (rawCode as ErrorCode) : 'unknown'
  return new ApiError(code, detail?.message ?? code, res.status, detail?.retryable ?? res.status >= 500)
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const device = (id: string) => ({ 'x-device-id': id })

function query(params: Record<string, string | undefined>): string {
  const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string][]
  return q.length ? `?${new URLSearchParams(q).toString()}` : ''
}

export const api = {
  // Короткий таймаут: спящий хостинг не должен держать заставку — через 8 секунд покажем демо, а вернётся — живое.
  health: () => request<Health>('/health', {}, 8_000),
  walks: (source?: WalkSource, shopId?: string) => request<Walk[]>(`/walks${query({ source, shop_id: shopId })}`),
  walk: (id: string) => request<Walk>(`/walks/${encodeURIComponent(id)}`),
  diff: (id: string) => request<WalkDiff>(`/walks/${encodeURIComponent(id)}/diff`),
  seedDemo: () => request<{ seeded: string[] }>('/demo/seed', { method: 'POST' }),

  shops: (deviceId: string) => request<Shop[]>('/shops', { headers: device(deviceId) }),
  demoShops: () => request<Shop[]>('/shops/demo'),
  createShop: (deviceId: string, body: { name: string; address?: string; lat?: number | null; lng?: number | null }) => {
    const init = json(body)
    return request<Shop>('/shops', { ...init, method: 'POST', headers: { ...(init.headers as Record<string, string>), ...device(deviceId) } })
  },
  updateShop: (deviceId: string, id: string, body: { name?: string; address?: string; lat?: number | null; lng?: number | null }) => {
    const init = json(body)
    return request<Shop>(`/shops/${encodeURIComponent(id)}`, { ...init, method: 'PATCH', headers: { ...(init.headers as Record<string, string>), ...device(deviceId) } })
  },
  deleteShop: (deviceId: string, id: string) => request<{ deleted: string }>(`/shops/${encodeURIComponent(id)}`, { method: 'DELETE', headers: device(deviceId) }),
  overview: (scope: 'mine' | 'demo', deviceId?: string) =>
    request<BranchSummary[]>(`/branches/overview${query({ scope })}`, deviceId ? { headers: device(deviceId) } : {}),

  analyze: (files: File[], opts: { demoKey: string; label?: string; shopId?: string; deviceId?: string }) => {
    const form = new FormData()
    for (const f of files) form.append('photos', f, f.name)
    const headers: Record<string, string> = { 'x-demo-key': opts.demoKey }
    if (opts.deviceId) headers['x-device-id'] = opts.deviceId
    return request<Walk>(`/walks/analyze${query({ label: opts.label, shop_id: opts.shopId })}`, { method: 'POST', body: form, headers }, 180_000)
  },
}

/** Код ошибки для словаря: страницы берут заголовок и подсказку через t(`errors.${code}.title`). */
export function errorCode(err: unknown): { code: ErrorCode; status: number; retryable: boolean } {
  if (err instanceof ApiError) return { code: err.code, status: err.status, retryable: err.retryable }
  return { code: 'unknown', status: 0, retryable: true }
}
