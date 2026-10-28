// Уведомления выводятся из данных, а не хранятся на сервере: пустые полки и смена ценников — из последнего
// сравнения, режим — из /health. Прочитанность запоминаем на устройстве по стабильному id.
// В живом режиме слова «демо» здесь нет: либо «живой режим включён», либо «новые обходы на паузе».

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ModeReason } from '../api/types'
import { useLatest } from './data'
import { useMode } from './mode'

export type NotificationKind = 'out_of_stock' | 'low_stock' | 'price_mismatch' | 'mode' | 'live' | 'paused'

export interface Notification {
  id: string
  kind: NotificationKind
  at: string
  params: Record<string, string | number>
  /** Куда ведёт нажатие. */
  to?: string
  read: boolean
}

interface NotificationsValue {
  items: Notification[]
  unread: number
  markRead: (id: string) => void
  markAll: () => void
}

const Ctx = createContext<NotificationsValue | null>(null)
const KEY = 'dukon.readNotifications'

function loadRead(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { latest } = useLatest()
  const { mode, reason, budget, status, fetchedAt, liveReady } = useMode()
  const [read, setRead] = useState<Set<string>>(() => loadRead())

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...read]))
    } catch {
      /* без памяти */
    }
  }, [read])

  const items = useMemo<Notification[]>(() => {
    const list: Notification[] = []
    if (latest.status === 'success' && latest.data) {
      const { walk, diff } = latest.data
      for (const c of diff.changes) {
        if (c.status === 'out_of_stock' || c.status === 'low_stock' || c.status === 'price_mismatch') {
          list.push({
            id: `${walk.id}:${c.status}:${c.sku}`,
            kind: c.status,
            at: walk.created_at,
            params: { name: c.name, n: c.after, from: c.price_before ?? '—', to: c.price_after ?? '—' },
            to: `/app/item/${encodeURIComponent(c.sku)}`,
            read: false,
          })
        }
      }
    }
    if (status !== 'loading' && fetchedAt) {
      const day = fetchedAt.slice(0, 10)
      const why = (reason ?? 'unknown') as ModeReason
      if (mode === 'demo') {
        list.push({ id: `mode:demo:${why}:${day}`, kind: 'mode', at: fetchedAt, params: { reason: why }, to: '/app/system', read: false })
      } else if (liveReady) {
        list.push({ id: `mode:live:${day}`, kind: 'live', at: fetchedAt, params: { n: budget?.calls_left ?? 0 }, to: '/app/system', read: false })
      } else {
        list.push({ id: `mode:paused:${why}:${day}`, kind: 'paused', at: fetchedAt, params: { reason: why }, to: '/app/system', read: false })
      }
    }
    return list.map((n) => ({ ...n, read: read.has(n.id) }))
  }, [latest, mode, reason, budget, status, fetchedAt, liveReady, read])

  const markRead = useCallback((id: string) => setRead((prev) => new Set(prev).add(id)), [])
  const markAll = useCallback(() => setRead((prev) => new Set([...prev, ...items.map((n) => n.id)])), [items])
  const unread = items.filter((n) => !n.read).length

  const value = useMemo(() => ({ items, unread, markRead, markAll }), [items, unread, markRead, markAll])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useNotifications(): NotificationsValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNotifications вне NotificationsProvider')
  return ctx
}
