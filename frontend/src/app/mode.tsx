// Какие данные показывать: живые (свои магазины, свои обходы, ни слова «демо») или демо-сеть.
// Решают двое. Сервер (/health) говорит, есть ли ключ, кредиты и бюджет на модели. Владелец может
// сам переключиться кнопкой в углу (settings.dataMode). Если сервер не отвечает — всегда демо из
// встроенного снимка, а не экран ошибки; как только сервер вернётся, приложение вернётся к живым данным.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, onServerFailure, setServerDown } from '../api/client'
import type { Budget, Health, Mode, ModeReason } from '../api/types'
import { useSettings } from './settings'

export type ModeStatus = 'loading' | 'ready' | 'down'

interface ModeValue {
  status: ModeStatus
  health: Health | null
  /** Что показываем. live — только свои данные; demo — демо-сеть (по выбору, без кредитов или без сервера). */
  mode: Mode
  /** Почему демо; в живом режиме без кредитов — почему новые обходы на паузе. */
  reason: ModeReason | null
  budget: Budget | null
  /** Когда последний раз получили /health — для стабильных id уведомлений и подписи «обновлено». */
  fetchedAt: string | null
  /** Сервер отвечает: свои данные посмотреть можно всегда, даже когда кредиты кончились. */
  reachable: boolean
  /** Сервер отвечает и модели доступны: можно делать новые обходы. */
  liveReady: boolean
  /** Кнопка в углу: показать демо или вернуться к своим данным. */
  setView: (view: Mode) => void
  refresh: () => Promise<void>
}

const Ctx = createContext<ModeValue | null>(null)
const POLL_MS = 60_000
// Пока сервер лежит, проверяем чаще: вернулся — сразу снова живые данные.
const POLL_DOWN_MS = 15_000

export function ModeProvider({ children, poll = true }: { children: ReactNode; poll?: boolean }) {
  const { settings, update } = useSettings()
  const [status, setStatus] = useState<ModeStatus>('loading')
  const [health, setHealth] = useState<Health | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const alive = useRef(true)
  const inflight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(() => {
    // Несколько упавших запросов подряд не должны устраивать шквал проверок — одна на всех.
    inflight.current ??= (async () => {
      try {
        const h = await api.health()
        if (!alive.current) return
        setHealth(h)
        setFetchedAt(new Date().toISOString())
        setStatus('ready')
      } catch {
        if (!alive.current) return
        setStatus('down')
      } finally {
        inflight.current = null
      }
    })()
    return inflight.current
  }, [])

  // Клиент API должен знать о падении раньше страниц: демо-запросы сразу идут в снимок, без ожидания таймаута.
  useEffect(() => {
    setServerDown(status === 'down')
  }, [status])

  useEffect(() => {
    alive.current = true
    void refresh()
    const off = onServerFailure(() => void refresh())
    return () => {
      alive.current = false
      off()
      setServerDown(false)
    }
  }, [refresh])

  useEffect(() => {
    if (!poll) return
    const id = setInterval(() => void refresh(), status === 'down' ? POLL_DOWN_MS : POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    const onOnline = () => void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [refresh, poll, status])

  const reachable = status === 'ready'
  const liveReady = reachable && health?.mode === 'live'
  const dataMode = settings.dataMode

  const setView = useCallback(
    (view: Mode) => {
      // «Вернуть мои данные» при живом сервере — снова автоматический режим: кончатся кредиты — само уйдёт в демо.
      // Без кредитов — явный выбор «свои», чтобы смотреть уже сделанные обходы.
      if (view === 'demo') update({ dataMode: 'demo' })
      else update({ dataMode: liveReady ? 'auto' : 'live' })
    },
    [update, liveReady],
  )

  const value = useMemo<ModeValue>(() => {
    const mode: Mode = !reachable || dataMode === 'demo' ? 'demo' : dataMode === 'live' || liveReady ? 'live' : 'demo'
    const reason: ModeReason | null =
      status === 'down' ? 'network' : dataMode === 'demo' && status === 'ready' ? 'manual' : (health?.reason ?? (liveReady || status === 'loading' ? null : 'unknown'))
    return { status, health, mode, reason, budget: health?.budget ?? null, fetchedAt, reachable, liveReady, setView, refresh }
  }, [status, health, fetchedAt, reachable, liveReady, dataMode, setView, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMode(): ModeValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useMode вне ModeProvider')
  return ctx
}
