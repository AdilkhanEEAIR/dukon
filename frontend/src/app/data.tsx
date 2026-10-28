// Последний обход текущего магазина и его сравнение — нужны главной, полкам, уведомлениям и заказам.
// Грузим на уровне приложения и делимся через контекст, чтобы не дёргать сервер с каждой страницы.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { Walk, WalkDiff } from '../api/types'
import { useShops } from './shops'

export interface Latest {
  walk: Walk
  diff: WalkDiff
  walks: Walk[]
}

export type LatestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: Latest | null }
  | { status: 'error'; error: unknown }

interface DataValue {
  latest: LatestState
  reload: () => Promise<void>
}

const Ctx = createContext<DataValue | null>(null)

/** Демо-сеть: первый филиал показываем, пока у магазина нет своих обходов. */
export const DEMO_SHOP_ID = 'demo-chuy'

/** Свои обходы магазина важнее демо: если владелец уже прошёл полки, показываем его данные. */
export async function loadLatest(shopId: string | null): Promise<Latest | null> {
  const own = shopId ? await api.walks('live', shopId) : []
  const walks = own.length ? own : await api.walks('demo', DEMO_SHOP_ID)
  if (!walks.length) return null
  const walk = walks[walks.length - 1]
  const diff = await api.diff(walk.id)
  return { walk, diff, walks }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { current, status: shopsStatus } = useShops()
  const shopId = current?.id ?? null
  const [latest, setLatest] = useState<LatestState>({ status: 'idle' })
  const runId = useRef(0)

  const reload = useCallback(async () => {
    const id = ++runId.current
    setLatest({ status: 'loading' })
    try {
      const data = await loadLatest(shopId)
      if (id === runId.current) setLatest({ status: 'success', data })
    } catch (error) {
      if (id === runId.current) setLatest({ status: 'error', error })
    }
  }, [shopId])

  // Ждём список магазинов: иначе сначала покажем демо, а через секунду — свой обход (мигание).
  useEffect(() => {
    if (shopsStatus !== 'loading') void reload()
  }, [reload, shopsStatus])

  const value = useMemo(() => ({ latest, reload }), [latest, reload])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLatest(): DataValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useLatest вне DataProvider')
  return ctx
}
