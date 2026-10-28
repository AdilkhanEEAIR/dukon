// Один хук на все загрузки: idle → loading → success | error, с повтором.
// Страницы не плодят useState на каждый запрос и везде показывают состояния одинаково.

import { useCallback, useEffect, useRef, useState } from 'react'

export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: unknown }

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'idle' })
  const fnRef = useRef(fn)
  fnRef.current = fn
  const runId = useRef(0)

  const run = useCallback(async () => {
    const id = ++runId.current
    setState({ status: 'loading' })
    try {
      const data = await fnRef.current()
      if (id === runId.current) setState({ status: 'success', data })
    } catch (error) {
      if (id === runId.current) setState({ status: 'error', error })
    }
  }, [])

  useEffect(() => {
    if (enabled) void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps])

  return { state, refetch: run }
}
