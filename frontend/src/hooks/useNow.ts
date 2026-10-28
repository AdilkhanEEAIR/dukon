// Текущее время, которое само обновляется: живые счётчики, часы и «3 мин назад» перерисовываются
// без перезагрузки страницы. Один таймер на компонент; на скрытой вкладке браузер сам его притормаживает.

import { useEffect, useState } from 'react'

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
