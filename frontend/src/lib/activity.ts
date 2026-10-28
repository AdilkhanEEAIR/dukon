// Счётчик запросов к серверу для полосы загрузки сверху. Отдельный модуль без React:
// клиент API отмечает начало и конец запроса, полоса подписывается и показывает, что идёт работа.

type Listener = (pending: number) => void

let pending = 0
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l(pending))
}

export function beginActivity() {
  pending += 1
  emit()
}

export function endActivity() {
  pending = Math.max(0, pending - 1)
  emit()
}

export function subscribeActivity(l: Listener): () => void {
  listeners.add(l)
  l(pending)
  return () => listeners.delete(l)
}
