// Чтение потока событий сервера (text/event-stream) из обычного fetch: EventSource не умеет заголовки,
// а нам нужен код устройства. Разбираем по кадрам «event: … / data: …», пустая строка — конец кадра.

export interface SseFrame {
  event: string
  data: string
}

/** Разбирает накопленный текст на кадры; возвращает кадры и хвост, который ещё не закончился. */
export function parseSse(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = []
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const rest = parts.pop() ?? ''
  for (const chunk of parts) {
    let event = 'message'
    const data: string[] = []
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length) frames.push({ event, data: data.join('\n') })
  }
  return { frames, rest }
}

/** Читает ответ до конца, отдавая кадры по мере прихода. Прерывается через signal. */
export async function readSse(res: Response, onFrame: (frame: SseFrame) => void, signal?: AbortSignal): Promise<void> {
  const body = res.body
  if (!body) {
    // Среда без потоков (старый браузер, тесты): читаем всё разом.
    const { frames } = parseSse((await res.text()) + '\n\n')
    frames.forEach(onFrame)
    return
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const stop = () => void reader.cancel().catch(() => {})
  signal?.addEventListener('abort', stop, { once: true })
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { frames, rest } = parseSse(buffer)
      buffer = rest
      frames.forEach(onFrame)
    }
    const tail = parseSse(buffer + '\n\n')
    tail.frames.forEach(onFrame)
  } finally {
    signal?.removeEventListener('abort', stop)
  }
}
