// Голосовой ввод с двумя движками. Основной — Muse Voice Transcribe на сервере (запись → WAV → текст);
// запасной — распознавание самого браузера, когда ключа моделей нет или сервер недоступен.
// Снаружи одно и то же: нажал — говоришь — отпустил — текст в поле.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorCode } from '../api/client'
import { useMode } from '../app/mode'
import { useSettings } from '../app/settings'
import { useI18n } from '../i18n'
import { canRecord, startRecording, type Recorder } from '../lib/audio'
import { canRecognize, listen, type Listener } from '../lib/speech'

export type VoiceEngine = 'meta' | 'browser' | 'none'
export type VoiceStatus = 'idle' | 'listening' | 'transcribing'

export interface Voice {
  engine: VoiceEngine
  status: VoiceStatus
  /** Громкость 0..1, пока идёт запись (только у серверного движка). */
  level: number
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
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<Recorder | null>(null)
  const listener = useRef<Listener | null>(null)
  const raf = useRef(0)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  // Серверный голос — только когда всё живое: ключ есть, сервер отвечает, показываем свои данные.
  const metaReady = !!health?.voice_enabled && liveReady && mode === 'live' && !!settings.demoKey && canRecord()
  const engine: VoiceEngine = metaReady ? 'meta' : canRecognize() ? 'browser' : canRecord() ? 'meta' : 'none'

  const stopMeter = () => {
    cancelAnimationFrame(raf.current)
    setLevel(0)
  }

  const start = useCallback(async () => {
    setError(null)
    if (engine === 'none' || status !== 'idle') return
    try {
      if (engine === 'browser') {
        listener.current = listen(locale)
        setStatus('listening')
        const text = await listener.current.done
        listener.current = null
        setStatus('idle')
        if (text) onTextRef.current(text)
        return
      }
      recorder.current = await startRecording()
      setStatus('listening')
      const tick = () => {
        setLevel(recorder.current?.level() ?? 0)
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)
    } catch (err) {
      setStatus('idle')
      stopMeter()
      setError((err as Error).name === 'NotAllowedError' ? 'mic_denied' : 'mic')
    }
  }, [engine, status, locale])

  const stop = useCallback(async () => {
    if (listener.current) {
      listener.current.stop()
      return
    }
    const rec = recorder.current
    if (!rec) return
    recorder.current = null
    stopMeter()
    setStatus('transcribing')
    try {
      const wav = await rec.stop()
      const result = await api.transcribe(wav, { lang: locale, keywords, demoKey: settings.demoKey })
      if (result.text) onTextRef.current(result.text)
      else setError('silence')
    } catch (err) {
      setError(errorCode(err).code)
    } finally {
      setStatus('idle')
    }
  }, [locale, keywords, settings.demoKey])

  const cancel = useCallback(() => {
    listener.current?.cancel()
    listener.current = null
    recorder.current?.cancel()
    recorder.current = null
    stopMeter()
    setStatus('idle')
  }, [])

  useEffect(() => () => cancel(), [cancel])

  return { engine, status, level, error, start, stop, cancel }
}
