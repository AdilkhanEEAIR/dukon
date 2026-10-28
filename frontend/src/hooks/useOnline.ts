// Слушаем сеть браузера: офлайн-баннер и честное объяснение, почему отправка недоступна.
import { useEffect, useState } from 'react'

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    // Сеть могла пропасть между первой отрисовкой и подпиской — событие тогда уже прошло мимо.
    // Сверяемся с браузером ещё раз сразу после подписки.
    if (!navigator.onLine) off()
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
