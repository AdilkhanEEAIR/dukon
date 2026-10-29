// Голос в браузере: озвучка ответов агента и запасное распознавание речи, когда голосовая модель Meta
// недоступна (нет ключа, нет сервера). Всё необязательное: нет поддержки — кнопки просто не показываем.

import type { Locale } from '../i18n'

// У кыргызского нет голосов ни в одном браузере — читаем русским: интонация не та, но слова слышны.
const SPEECH_LANG: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU', ky: 'ru-RU', es: 'es-ES', de: 'de-DE', fr: 'fr-FR' }
const RECOGNITION_LANG: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU', ky: 'ky-KG', es: 'es-ES', de: 'de-DE', fr: 'fr-FR' }

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

export function speak(text: string, locale: Locale): void {
  if (!canSpeak() || !text.trim()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = SPEECH_LANG[locale]
  u.rate = 1.02
  const voices = synth.getVoices()
  const voice = voices.find((v) => v.lang === u.lang) ?? voices.find((v) => v.lang.startsWith(u.lang.slice(0, 2)))
  if (voice) u.voice = voice
  synth.speak(u)
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel()
}

interface RecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function canRecognize(): boolean {
  return typeof window !== 'undefined' && recognitionCtor() !== null
}

export interface Listener {
  stop: () => void
  cancel: () => void
  done: Promise<string>
}

/** Распознавание силами браузера: одна фраза, итог — строка (пустая, если ничего не услышали). */
export function listen(locale: Locale): Listener {
  const Ctor = recognitionCtor()
  if (!Ctor) throw new Error('no-recognition')
  const rec = new Ctor()
  rec.lang = RECOGNITION_LANG[locale]
  rec.interimResults = false
  rec.maxAlternatives = 1
  rec.continuous = false
  let text = ''
  let settled = false
  const done = new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => {
      text = Array.from({ length: e.results.length }, (_, i) => e.results[i][0]?.transcript ?? '').join(' ').trim()
    }
    rec.onerror = (e) => {
      if (settled) return
      settled = true
      // «no-speech» и «aborted» — не ошибки для пользователя: он просто передумал.
      if (e.error === 'no-speech' || e.error === 'aborted') resolve('')
      else reject(new Error(e.error))
    }
    rec.onend = () => {
      if (settled) return
      settled = true
      resolve(text)
    }
  })
  rec.start()
  return { done, stop: () => rec.stop(), cancel: () => rec.abort() }
}
