// Тосты: въезжают снизу и уходят туда же (пространственная последовательность), живут 4 секунды.
// Вход — через @starting-style в CSS, выход — класс toast--out и удаление после transition.

import { Check, CircleAlert, Info } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Tone = 'success' | 'danger' | 'info'
interface Toast {
  id: number
  tone: Tone
  title: string
  text?: string
  leaving?: boolean
}

type Push = (tone: Tone, title: string, text?: string) => void
const Ctx = createContext<Push | null>(null)
const LIFETIME = 4000
const EXIT = 320

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const seq = useRef(0)

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), EXIT)
  }, [])

  const push = useCallback<Push>(
    (tone, title, text) => {
      const id = ++seq.current
      setItems((prev) => [...prev.slice(-2), { id, tone, title, text }])
      setTimeout(() => remove(id), LIFETIME)
    },
    [remove],
  )

  const icons = useMemo(() => ({ success: <Check size={16} />, danger: <CircleAlert size={16} />, info: <Info size={16} /> }), [])

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.leaving ? ' toast--out' : ''}`} role="status" onClick={() => remove(t.id)}>
            <span style={{ marginTop: 2 }}>{icons[t.tone]}</span>
            <div className="stack" style={{ gap: 1 }}>
              <span className="toast__title">{t.title}</span>
              {t.text && <span className="toast__text">{t.text}</span>}
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): Push {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast вне ToastProvider')
  return ctx
}
