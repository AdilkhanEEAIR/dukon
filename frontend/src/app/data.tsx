// Последний обход магазина на экране и его сравнение — нужны главной, полкам, уведомлениям и заказам.
// Грузим на уровне приложения и делимся через контекст, чтобы не дёргать сервер с каждой страницы.
// Живой режим — только свои обходы (нет обходов — честное «пока пусто»); демо — обходы демо-филиала.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { Mode, Walk, WalkDiff } from '../api/types'
import { useMode } from './mode'
import { useShops, useViewShop } from './shops'

export { DEMO_SHOP_ID } from './shops'

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

/** Обходы магазина в выбранном режиме. Демо в живой режим не подмешиваем: там только настоящее. */
export async function loadLatest(view: Mode, shopId: string | null): Promise<Latest | null> {
  if (!shopId) return null
  const walks = await api.walks(view === 'live' ? 'live' : 'demo', shopId)
  if (!walks.length) return null
  const walk = walks[walks.length - 1]
  const diff = await api.diff(walk.id)
  return { walk, diff, walks }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { status: shopsStatus } = useShops()
  const { mode, status: modeStatus } = useMode()
  const { id: shopId } = useViewShop()
  const [latest, setLatest] = useState<LatestState>({ status: 'idle' })
  const runId = useRef(0)

  const reload = useCallback(async () => {
    const id = ++runId.current
    setLatest({ status: 'loading' })
    try {
      const data = await loadLatest(mode, shopId)
      if (id === runId.current) setLatest({ status: 'success', data })
    } catch (error) {
      if (id === runId.current) setLatest({ status: 'error', error })
    }
  }, [mode, shopId])

  // Ждём, пока станет ясно, какой режим и какой магазин: иначе сначала мелькнёт одно, через секунду — другое.
  const settled = modeStatus !== 'loading' && (mode === 'demo' || shopsStatus !== 'loading')
  useEffect(() => {
    if (settled) void reload()
  }, [reload, settled])

  const value = useMemo(() => ({ latest, reload }), [latest, reload])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLatest(): DataValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useLatest вне DataProvider')
  return ctx
}
