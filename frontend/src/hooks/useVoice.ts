// Голосовой ввод с двумя движками. Снаружи одно и то же: нажал — говоришь — замолчал — текст в поле.
//   · «meta» — запись → WAV → сервер: Muse Spark (кыргызский) или Muse Voice Transcribe (остальные языки);
//   · «browser» — распознавание самого браузера: русский в Chrome распознаётся лучше облачных моделей и бесплатно.
// Оба показывают волны громкости, пока человек говорит, и спиннер «распознаю», пока ждём текст.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorCode } from '../api/client'
import { useMode } from '../app/mode'
import { useSettings } from '../app/settings'
import { useI18n } from '../i18n'
import { canMeter, canRecord, startMeter, startRecording, type Meter, type Recorder } from '../lib/audio'
import { canRecognizeLocale, listen, type Listener } from '../lib/speech'

export type VoiceEngine = 'meta' | 'browser' | 'none'
export type VoiceStatus = 'idle' | 'listening' | 'transcribing'

// Автостоп: после речи тишина дольше этого — запись закончена сама, без второго нажатия.
// Три секунды: хозяин думает между словами, и обрыв на полуслове бесит сильнее, чем лишняя секунда ожидания.
export const SILENCE_MS = 3000
// Не заговорил вовсе — отпускаем микрофон, чтобы он не висел красным.
export const NO_SPEECH_MS = 7000
// Потолок одной фразы: хозяин говорит коротко, а длинная запись дорога и медленна.
export const MAX_MS = 20000
const SPEECH_LEVEL = 0.14
const SILENCE_LEVEL = 0.07

export interface Voice {
  engine: VoiceEngine
  status: VoiceStatus
  /** Громкость 0..1, пока идёт запись или распознавание. */
  level: number
  /** Говорил ли уже человек в этой записи — чтобы показать «слушаю» и «понял, заканчиваю». */
  spoke: boolean
  /** Движка нет, потому что для этого языка нужен сервер с ключом Meta (кыргызский без ключа). */
  needsKey: boolean
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  cancel: () => void
}

export function useVoice(onText: (text: string) => void, keywords: string[] = []): Voice {
  const { locale } = useI18n()
  const { settings } = useSettings()
  const { health, liveReady, mode } = useMode()
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [level, setLevel] = useState(0)
  const [spoke, setSpoke] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stopRef = useRef<() => Promise<void>>(async () => {})
  const recorder = useRef<Recorder | null>(null)
  const listener = useRef<Listener | null>(null)
  const meter = useRef<Meter | null>(null)
  const raf = useRef(0)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  // Серверный голос — только когда всё живое: ключ есть, сервер отвечает, показываем свои данные.
  const metaReady = !!health?.voice_enabled && liveReady && mode === 'live' && !!settings.demoKey && canRecord()
  // Браузер берём, когда он знает язык и это русский (там он лучше модели) или когда сервера нет.
  const browserOk = canRecognizeLocale(locale)
  const preferBrowser = locale === 'ru' && browserOk
  const engine: VoiceEngine = metaReady && !preferBrowser ? 'meta' : browserOk ? 'browser' : 'none'
  // Кыргызский умеет только модель: без ключа честно говорим, что нужно, а не гасим микрофон молча.
  const needsKey = engine === 'none' && !browserOk && canRecord()

  const stopMeter = () => {
    cancelAnimationFrame(raf.current)
    meter.current?.stop()
    meter.current = null
    setLevel(0)
  }

  // Один цикл на оба движка: громкость → волны, тишина после речи → автостоп (только для записи).
  const watch = (source: () => number, autoStop: boolean) => {
    const startedAt = performance.now()
    let spokeAt = 0
    let quietSince = 0
    const tick = () => {
      const now = performance.now()
      const lvl = source()
      setLevel(lvl)
      if (lvl > SPEECH_LEVEL) {
        if (!spokeAt) setSpoke(true)
        spokeAt = now
        quietSince = 0
      } else if (spokeAt && lvl < SILENCE_LEVEL) {
        quietSince ||= now
      }
      if (autoStop) {
        // Сам заканчиваем: помолчал после фразы, не заговорил вовсе или говорит слишком долго.
        const silentLong = spokeAt && quietSince && now - quietSince > SILENCE_MS
        const neverSpoke = !spokeAt && now - startedAt > NO_SPEECH_MS
        if (silentLong || neverSpoke || now - startedAt > MAX_MS) {
          void stopRef.current()
          return
        }
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }

  const start = useCallback(async () => {
    setError(null)
    if (engine === 'none' || status !== 'idle') return
    setSpoke(false)
    try {
      if (engine === 'browser') {
        // Браузер свою громкость не отдаёт: ради волн и своего детектора тишины открываем микрофон параллельно.
        // Пока есть микрофон — слушаем непрерывно и заканчиваем сами после паузы; без него — как умеет браузер.
        const continuous = canMeter()
        const meterPromise = continuous ? startMeter().catch(() => null) : Promise.resolve(null)
        listener.current = listen(locale, {
          onSpeechStart: () => setSpoke(true),
          onSpeechEnd: () => {
            if (!continuous) setStatus('transcribing')
          },
          continuous,
        })
        setStatus('listening')
        let fallbackTimer = 0
        void meterPromise.then((m) => {
          if (!listener.current) {
            m?.stop()
            return
          }
          if (!m) {
            // Микрофон не дали, а запись непрерывная: страхуемся потолком, иначе она не кончится.
            if (continuous) fallbackTimer = window.setTimeout(() => void stopRef.current(), MAX_MS)
            return
          }
          meter.current = m
          watch(m.level, continuous)
        })
        let text = ''
        try {
          text = await listener.current.done
        } finally {
          window.clearTimeout(fallbackTimer)
          listener.current = null
          stopMeter()
          setStatus('idle')
        }
        if (text) onTextRef.current(text)
        else setError('silence')
        return
      }
      recorder.current = await startRecording()
      setStatus('listening')
      watch(() => recorder.current?.level() ?? 0, true)
    } catch (err) {
      listener.current = null
      setStatus('idle')
      stopMeter()
      setError((err as Error).name === 'NotAllowedError' ? 'mic_denied' : 'mic')
    }
  }, [engine, status, locale])

  const stop = useCallback(async () => {
    if (listener.current) {
      // Браузер дорасшифрует после stop(): до итога показываем спиннер, а не пустое поле.
      setStatus('transcribing')
      listener.current.stop()
      return
    }
    const rec = recorder.current
    if (!rec) return
    recorder.current = null
    cancelAnimationFrame(raf.current)
    setLevel(0)
    setStatus('transcribing')
    try {
      const wav = await rec.finish()
      const result = await api.transcribe(wav, { lang: locale, keywords, demoKey: settings.demoKey })
      if (result.text) onTextRef.current(result.text)
      else setError('silence')
    } catch (err) {
      setError(errorCode(err).code)
    } finally {
      setStatus('idle')
    }
  }, [locale, keywords, settings.demoKey])

  useEffect(() => {
    stopRef.current = stop
  }, [stop])

  const cancel = useCallback(() => {
    listener.current?.cancel()
    listener.current = null
    recorder.current?.cancel()
    recorder.current = null
    stopMeter()
    setStatus('idle')
  }, [])

  useEffect(() => () => cancel(), [cancel])

  return { engine, status, level, spoke, needsKey, error, start, stop, cancel }
}
