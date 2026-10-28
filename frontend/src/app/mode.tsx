// Режим работы решает сервер (/health): live — настоящие модели, demo — записанные обходы.
// Фронт только показывает режим и причину, опрашивая сервер раз в минуту и при возврате на вкладку.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, errorCode } from '../api/client'
import type { Budget, Health, Mode, ModeReason } from '../api/types'

export type ModeStatus = 'loading' | 'ready' | 'down'

interface ModeValue {
  status: ModeStatus
  health: Health | null
  mode: Mode
  reason: ModeReason | null
  budget: Budget | null
  /** Когда последний раз получили /health — для стабильных id уведомлений. */
  fetchedAt: string | null
  /** Пользователь сам выбрал демо, даже если live доступен. */
  forcedDemo: boolean
  setForcedDemo: (v: boolean) => void
  refresh: () => Promise<void>
}

const Ctx = createContext<ModeValue | null>(null)
const POLL_MS = 60_000

export function ModeProvider({ children, poll = true }: { children: ReactNode; poll?: boolean }) {
  const [status, setStatus] = useState<ModeStatus>('loading')
  const [health, setHealth] = useState<Health | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [forcedDemo, setForcedDemo] = useState(false)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const h = await api.health()
      if (!alive.current) return
      setHealth(h)
      setFetchedAt(new Date().toISOString())
      setStatus('ready')
    } catch (err) {
      if (!alive.current) return
      // Сервер лежит — это тоже причина работать в демо, но мы честно показываем «сервер недоступен».
      setStatus('down')
      void errorCode(err)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void refresh()
    if (!poll) return () => { alive.current = false }
    const id = setInterval(() => void refresh(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, poll])

  const value = useMemo<ModeValue>(() => {
    const serverMode: Mode = health?.mode ?? 'demo'
    const mode: Mode = forcedDemo ? 'demo' : serverMode
    const reason: ModeReason | null = status === 'down' ? 'network' : forcedDemo && serverMode === 'live' ? 'manual' : (health?.reason ?? (health ? null : 'unknown'))
    return { status, health, mode, reason, budget: health?.budget ?? null, fetchedAt, forcedDemo, setForcedDemo, refresh }
  }, [status, health, fetchedAt, forcedDemo, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMode(): ModeValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useMode вне ModeProvider')
  return ctx
}
