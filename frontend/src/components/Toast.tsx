// Тосты: подтверждение без захвата экрана. Контекст + хук, живут 4 секунды.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type ToastKind = 'info' | 'success' | 'danger'
interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  text?: string
}

const ToastCtx = createContext<{ push: (kind: ToastKind, title: string, text?: string) => void } | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((kind: ToastKind, title: string, text?: string) => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, kind, title, text }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])
  const value = useMemo(() => ({ push }), [push])
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-host" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} role="status">
            <span
              className="toast__dot"
              style={{ background: t.kind === 'danger' ? 'var(--danger)' : t.kind === 'success' ? 'var(--success)' : 'var(--accent)' }}
            />
            <div>
              <div style={{ fontWeight: 600 }}>{t.title}</div>
              {t.text && <div className="caption">{t.text}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast вне ToastProvider')
  return ctx.push
}
