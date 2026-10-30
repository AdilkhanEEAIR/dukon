// Голос в браузере: озвучка ответов агента и распознавание речи силами самого браузера
// (русский в Chrome распознаётся лучше облачных моделей; кыргызский браузер не знает — он идёт в Muse Spark).
// Всё необязательное: нет поддержки — кнопки просто не показываем.

import type { Locale } from '../i18n'

const SPEECH_LANG: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU', ky: 'ky-KG', kk: 'kk-KZ', es: 'es-ES', de: 'de-DE', fr: 'fr-FR' }
const RECOGNITION_LANG: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU', ky: 'ky-KG', kk: 'kk-KZ', es: 'es-ES', de: 'de-DE', fr: 'fr-FR' }
// Какие языки умеет распознавать браузер. Кыргызского и казахского нет ни в Chrome, ни в Safari: запрос падает
// с «language-not-supported», и микрофон гаснет сразу — поэтому их здесь нет, они идут в модель Meta.
const BROWSER_RECOGNIZES = new Set<Locale>(['en', 'ru', 'es', 'de', 'fr'])
// Языки ответа, которые читаем кириллическим голосом с подменой букв, если своего голоса в браузере нет.
const CYRILLIC_TURKIC = new Set(['ky', 'kk'])

// Кыргызские и казахские буквы, которых нет в кириллическом голосе браузера: он читает их как «о с чертой»
// или молчит. Заменяем на ближайшие по звучанию — слова становятся разборчивыми.
const TURKIC_TO_RU: Record<string, string> = {
  ө: 'о',
  Ө: 'О',
  ү: 'у',
  Ү: 'У',
  ң: 'н',
  Ң: 'Н',
  ә: 'а',
  Ә: 'А',
  ғ: 'г',
  Ғ: 'Г',
  қ: 'к',
  Қ: 'К',
  ұ: 'у',
  Ұ: 'У',
  һ: 'х',
  Һ: 'Х',
  і: 'и',
  І: 'И',
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

export function canRecognizeLocale(locale: Locale): boolean {
  return canRecognize() && BROWSER_RECOGNIZES.has(locale)
}

/** Текст для кириллического голоса: кыргызские и казахские буквы → ближайшие. Экспорт ради тестов. */
export function kyrgyzForRussianVoice(text: string): string {
  return text.replace(/[өӨүҮңҢәӘғҒқҚұҰһҺіІ]/g, (ch) => TURKIC_TO_RU[ch] ?? ch)
}

/** Код языка ответа (ru, kk, hi…) → тег для голоса. Для своих языков — точный регион, для прочих — как есть. */
function speechTag(lang: string): string {
  return (SPEECH_LANG as Record<string, string>)[lang] ?? lang
}

/** Голос для языка: точное совпадение → тот же язык → для кыргызского и казахского друг друга и кириллический. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const tag = speechTag(lang)
  const short = tag.slice(0, 2).toLowerCase()
  const prefixes = CYRILLIC_TURKIC.has(short) ? [short, short === 'ky' ? 'kk' : 'ky', 'ru'] : [short]
  const exact = voices.find((v) => v.lang === tag || v.lang.replace('_', '-') === tag)
  if (exact) return exact
  for (const p of prefixes) {
    const found = voices.find((v) => v.lang.toLowerCase().startsWith(p))
    if (found) return found
  }
  return null
}

/** Озвучка на языке ответа: lang — локаль интерфейса или код, который вернул сервер (ru, kk, hi…). */
export function speak(text: string, lang: string): void {
  if (!canSpeak() || !text.trim()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const short = speechTag(lang).slice(0, 2).toLowerCase()
  const voice = pickVoice(synth.getVoices(), lang)
  const voiceLang = (voice?.lang ?? speechTag(lang)).toLowerCase()
  // Кыргызского голоса в браузерах нет, казахский есть не везде: читаем кириллическим, подменив буквы.
  const spoken = CYRILLIC_TURKIC.has(short) && !voiceLang.startsWith('ky') && !voiceLang.startsWith('kk') ? kyrgyzForRussianVoice(text) : text
  const u = new SpeechSynthesisUtterance(spoken)
  u.lang = voice?.lang ?? (CYRILLIC_TURKIC.has(short) ? 'ru-RU' : speechTag(lang))
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
