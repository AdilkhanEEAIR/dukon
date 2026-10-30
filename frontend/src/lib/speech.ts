// Голос в браузере: озвучка ответов агента и распознавание речи силами самого браузера
// (русский в Chrome распознаётся лучше облачных моделей; кыргызский браузер не знает — он идёт в Muse Spark).
// Всё необязательное: нет поддержки — кнопки просто не показываем.

import type { Locale } from '../i18n'

const SPEECH_LANG: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU', ky: 'ky-KG', es: 'es-ES', de: 'de-DE', fr: 'fr-FR' }
const RECOGNITION_LANG: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU', ky: 'ky-KG', es: 'es-ES', de: 'de-DE', fr: 'fr-FR' }
// Какие языки умеет распознавать браузер. Кыргызского нет ни в Chrome, ни в Safari: запрос падает
// с «language-not-supported», и микрофон гаснет сразу — поэтому ky здесь нет, и он идёт в модель Meta.
const BROWSER_RECOGNIZES = new Set<Locale>(['en', 'ru', 'es', 'de', 'fr'])

// Кыргызские буквы, которых нет в русском: русский голос читает их как «о с чертой» или молчит.
// Заменяем на ближайшие по звучанию — слова становятся разборчивыми.
const KY_TO_RU: Record<string, string> = { ө: 'о', Ө: 'О', ү: 'у', Ү: 'У', ң: 'н', Ң: 'Н' }

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

export function canRecognizeLocale(locale: Locale): boolean {
  return canRecognize() && BROWSER_RECOGNIZES.has(locale)
}

/** Текст для русского голоса: кыргызские буквы → русские. Экспорт ради тестов. */
export function kyrgyzForRussianVoice(text: string): string {
  return text.replace(/[өӨүҮңҢ]/g, (ch) => KY_TO_RU[ch] ?? ch)
}

/** Голос для языка: точное совпадение → тот же язык → для кыргызского казахский (те же ө, ү, ң) → русский. */
export function pickVoice(voices: SpeechSynthesisVoice[], locale: Locale): SpeechSynthesisVoice | null {
  const lang = SPEECH_LANG[locale]
  const prefixes = locale === 'ky' ? ['ky', 'kk', 'ru'] : [lang.slice(0, 2)]
  const exact = voices.find((v) => v.lang === lang || v.lang.replace('_', '-') === lang)
  if (exact) return exact
  for (const p of prefixes) {
    const found = voices.find((v) => v.lang.toLowerCase().startsWith(p))
    if (found) return found
  }
  return null
}

export function speak(text: string, locale: Locale): void {
  if (!canSpeak() || !text.trim()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const voice = pickVoice(synth.getVoices(), locale)
  const voiceLang = (voice?.lang ?? SPEECH_LANG[locale]).toLowerCase()
  // Кыргызского голоса в браузерах нет: читаем русским (или казахским в Edge), подменив буквы.
  const spoken = locale === 'ky' && !voiceLang.startsWith('ky') && !voiceLang.startsWith('kk') ? kyrgyzForRussianVoice(text) : text
  const u = new SpeechSynthesisUtterance(spoken)
  u.lang = voice?.lang ?? (locale === 'ky' ? 'ru-RU' : SPEECH_LANG[locale])
  u.rate = 1.02
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
  onspeechstart?: (() => void) | null
  onspeechend?: (() => void) | null
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

export interface ListenHooks {
  /** Браузер услышал речь — можно показать «слышу». */
  onSpeechStart?: () => void
  /** Речь кончилась, браузер дорасшифровывает — время показать спиннер. */
  onSpeechEnd?: () => void
  /**
   * Непрерывный режим: браузер не обрывает запись на первой паузе в полсекунды («What am I…»),
   * а слушает, пока мы сами не скажем stop() по своему детектору тишины.
   */
  continuous?: boolean
}

/** Распознавание силами браузера: итог — строка (пустая, если ничего не услышали). */
export function listen(locale: Locale, hooks: ListenHooks = {}): Listener {
  const Ctor = recognitionCtor()
  if (!Ctor) throw new Error('no-recognition')
  const rec = new Ctor()
  rec.lang = RECOGNITION_LANG[locale]
  rec.interimResults = false
  rec.maxAlternatives = 1
  rec.continuous = !!hooks.continuous
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
  rec.onspeechstart = () => hooks.onSpeechStart?.()
  rec.onspeechend = () => hooks.onSpeechEnd?.()
  rec.start()
  return { done, stop: () => rec.stop(), cancel: () => rec.abort() }
}
