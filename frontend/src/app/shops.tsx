// Магазины и филиалы владельца. Хранятся на сервере (SQLite) и привязаны к коду устройства;
// здесь — копия на устройстве, чтобы название магазина было видно даже без сети.
// В демо-режиме переключатель магазина показывает демо-сеть (три филиала), а свои магазины не трогаются:
// их по-прежнему видно и можно править в настройках.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { GeoPoint, Shop } from '../api/types'
import { useMode } from './mode'
import { useSettings } from './settings'

/** Демо-сеть: этот филиал открыт по умолчанию. */
export const DEMO_SHOP_ID = 'demo-chuy'

/** Изменения магазина: lat/lng = null убирает точку с карты. */
export type ShopPatch = { name?: string; address?: string; lat?: number | null; lng?: number | null }

export type ShopsStatus = 'loading' | 'ready' | 'error'

interface ShopsValue {
  status: ShopsStatus
  error: unknown
  shops: Shop[]
  current: Shop | null
  select: (id: string) => void
  create: (name: string, address?: string, point?: GeoPoint | null) => Promise<Shop>
  update: (id: string, patch: ShopPatch) => Promise<Shop>
  remove: (id: string) => Promise<void>
  reload: () => Promise<void>
  /** Филиалы демо-сети и выбранный из них — для демо-режима. */
  demoShops: Shop[]
  demoId: string
  selectDemo: (id: string) => void
}

const Ctx = createContext<ShopsValue | null>(null)
const CACHE = 'dukon.shopsCache'
const CURRENT = 'dukon.currentShop'
const DEMO_CURRENT = 'dukon.demoShop'
const LEGACY = 'dukon.settings'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* без памяти */
  }
}

/** Прошлая версия хранила название магазина только на устройстве — переносим его на сервер один раз. */
function legacyShopName(): string | null {
  const s = read<Record<string, unknown>>(LEGACY, {})
  return s.onboarded && typeof s.shopName === 'string' && s.shopName.trim() ? s.shopName.trim() : null
}

function forgetLegacyName() {
  const s = read<Record<string, unknown>>(LEGACY, {})
  delete s.shopName
  delete s.onboarded
  write(LEGACY, s)
}

export function ShopsProvider({ children }: { children: ReactNode }) {
  const { deviceId } = useSettings()
  const { mode, status: modeStatus } = useMode()
  const [status, setStatus] = useState<ShopsStatus>('loading')
  const [error, setError] = useState<unknown>(null)
  const [shops, setShops] = useState<Shop[]>(() => read<Shop[]>(CACHE, []))
  const [currentId, setCurrentId] = useState<string | null>(() => read<string | null>(CURRENT, null))
  const runId = useRef(0)

  const remember = useCallback((list: Shop[]) => {
    setShops(list)
    write(CACHE, list)
  }, [])

  const reload = useCallback(async () => {
    const id = ++runId.current
    setStatus('loading')
    try {
      let list = await api.shops(deviceId)
      const legacy = legacyShopName()
      if (!list.length && legacy) {
        list = [await api.createShop(deviceId, { name: legacy })]
      }
      if (legacy) forgetLegacyName()
      if (id !== runId.current) return
      remember(list)
      setError(null)
      setStatus('ready')
    } catch (err) {
      if (id !== runId.current) return
      setError(err)
      setStatus('error')
    }
  }, [deviceId, remember])

  useEffect(() => {
    void reload()
  }, [reload])

  // Сервер вернулся после падения — свои магазины перечитываем, иначе живой режим остался бы без них.
  const wasDown = useRef(false)
  useEffect(() => {
    if (modeStatus === 'down') wasDown.current = true
    else if (modeStatus === 'ready' && wasDown.current) {
      wasDown.current = false
      void reload()
    }
  }, [modeStatus, reload])

  // Демо-сеть грузим, только когда она нужна; без сервера её отдаст встроенный снимок.
  const [demoShops, setDemoShops] = useState<Shop[]>([])
  const [demoId, setDemoId] = useState<string>(() => read<string>(DEMO_CURRENT, DEMO_SHOP_ID))
  const demoLoaded = useRef(false)
  useEffect(() => {
    if (mode !== 'demo' || modeStatus === 'loading' || demoLoaded.current) return
    demoLoaded.current = true
    api.demoShops().then(
      (list) => setDemoShops(list),
      () => {
        demoLoaded.current = false
      },
    )
  }, [mode, modeStatus])

  const selectDemo = useCallback((id: string) => {
    setDemoId(id)
    write(DEMO_CURRENT, id)
  }, [])

  const current = useMemo(() => shops.find((s) => s.id === currentId) ?? shops[0] ?? null, [shops, currentId])

  const select = useCallback((id: string) => {
    setCurrentId(id)
    write(CURRENT, id)
  }, [])

  const create = useCallback(
    async (name: string, address = '', point: GeoPoint | null = null) => {
      const shop = await api.createShop(deviceId, point ? { name, address, lat: point.lat, lng: point.lng } : { name, address })
      setShops((prev) => {
        const next = [...prev, shop]
        write(CACHE, next)
        return next
      })
      select(shop.id)
      setStatus('ready')
      return shop
    },
    [deviceId, select],
  )

  const update = useCallback(
    async (id: string, patch: ShopPatch) => {
      const shop = await api.updateShop(deviceId, id, patch)
      setShops((prev) => {
        const next = prev.map((s) => (s.id === id ? shop : s))
        write(CACHE, next)
        return next
      })
      return shop
    },
    [deviceId],
  )

  const remove = useCallback(
    async (id: string) => {
      await api.deleteShop(deviceId, id)
      setShops((prev) => {
        const next = prev.filter((s) => s.id !== id)
        write(CACHE, next)
        return next
      })
    },
    [deviceId],
  )

  const value = useMemo(
    () => ({ status, error, shops, current, select, create, update, remove, reload, demoShops, demoId, selectDemo }),
    [status, error, shops, current, select, create, update, remove, reload, demoShops, demoId, selectDemo],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Свои магазины владельца: настройки, онбординг, новый обход. */
export function useShops(): ShopsValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useShops вне ShopsProvider')
  return ctx
}

export interface ViewShop {
  /** Магазины, между которыми переключается шапка: свои в живом режиме, демо-сеть в демо. */
  shops: Shop[]
  current: Shop | null
  /** Чьи обходы грузить: id есть даже до того, как пришёл список демо-филиалов. */
  id: string | null
  select: (id: string) => void
  demo: boolean
}

/** Магазин, данные которого сейчас на экране. */
export function useViewShop(): ViewShop {
  const { shops, current, select, demoShops, demoId, selectDemo } = useShops()
  const { mode } = useMode()
  return useMemo(() => {
    if (mode === 'demo') {
      const id = demoShops.some((s) => s.id === demoId) || !demoShops.length ? demoId : demoShops[0].id
      return { shops: demoShops, current: demoShops.find((s) => s.id === id) ?? null, id, select: selectDemo, demo: true }
    }
    return { shops, current, id: current?.id ?? null, select, demo: false }
  }, [mode, shops, current, select, demoShops, demoId, selectDemo])
}
