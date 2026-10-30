// Поле разговора с агентом: текст, микрофон (нажал — говоришь — замолчал), отправка и главная кнопка
// «Договориться о заказах». Пока человек говорит — вместо поля живые волны громкости, пока ждём текст —
// спиннер «распознаю». Подпись под полем говорит, какой движок слушает: модель Meta или сам браузер.

import { Bot, LoaderCircle, Mic, Send, Square, Volume2, VolumeX } from 'lucide-react'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Voice } from '../../hooks/useVoice'
import { useI18n, type TKey } from '../../i18n'
import { Button } from '../Button'

const MIC_ERRORS = new Set(['mic_denied', 'mic', 'silence'])

interface Props {
  voice: Voice
  onSend: (text: string) => void
  onRun: () => void
  canRun: boolean
  running: boolean
  busy: boolean
  speakOn: boolean
  canSpeak: boolean
  onToggleSpeak: () => void
}

export function Composer({ voice, onSend, onRun, canRun, running, busy, speakOn, canSpeak, onToggleSpeak }: Props) {
  const { t, locale } = useI18n()
  const [text, setText] = useState('')
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    setText('')
    onSend(value)
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) submit(e)
  }
  const listening = voice.status === 'listening'
  const transcribing = voice.status === 'transcribing'
  const micLabel =
    voice.engine === 'meta'
      ? t(locale === 'ky' ? 'agent.micSpark' : 'agent.micMeta')
      : voice.engine === 'browser'
        ? t('agent.micBrowser')
        : voice.needsKey
          ? t('agent.micNeedsKey')
          : t('agent.micNone')
  const toggleMic = () => {
    if (listening) void voice.stop()
    else void voice.start()
  }

  return (
    <form className="composer" onSubmit={submit} data-testid="composer">
      <Button size="lg" block icon={<Bot size={18} />} onClick={onRun} disabled={!canRun} loading={running} data-testid="run-agent">
        {running ? t('agent.running') : t('agent.run')}
      </Button>
      <div className="composer__row">
        {voice.engine !== 'none' && (
          <button
            type="button"
            className={`mic${listening ? ' is-on' : ''}${transcribing ? ' is-busy' : ''}`}
            onClick={toggleMic}
            disabled={busy || transcribing}
            aria-label={listening ? t('agent.micStop') : t('agent.mic')}
            aria-pressed={listening}
            title={micLabel}
            data-testid="mic"
            data-engine={voice.engine}
            style={{ ['--level' as string]: voice.level }}
          >
            {listening ? <Square size={16} /> : transcribing ? <LoaderCircle size={18} className="spin" /> : <Mic size={18} />}
          </button>
        )}
        {/* Пока слушаем — вместо поля живые столбики громкости: видно, что микрофон слышит (оба движка). */}
        {listening && (
          <div className={`vu${voice.spoke ? ' vu--heard' : ''}`} style={{ ['--level' as string]: voice.level }} aria-hidden data-testid="vu">
            <i />
            <i />
            <i />
            <i />
            <i />
            <span className="vu__text">{voice.spoke ? t('agent.micHeard') : t('agent.micListening')}</span>
          </div>
        )}
        {transcribing && (
          <div className="vu vu--busy" aria-live="polite" data-testid="transcribing">
            <LoaderCircle size={20} className="spin" />
            <span className="vu__text">{t('agent.micTranscribing')}</span>
          </div>
        )}
        <textarea
          className="composer__input"
          rows={1}
          value={text}
          hidden={listening || transcribing}
          placeholder={t('agent.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          disabled={busy}
          aria-label={t('agent.placeholder')}
          data-testid="chat-input"
        />
        <button type="submit" className="composer__send" disabled={!text.trim() || busy} aria-label={t('agent.send')} data-testid="chat-send">
          <Send size={18} />
        </button>
        {canSpeak && (
          <button type="button" className={`speak${speakOn ? ' is-on' : ''}`} onClick={onToggleSpeak} aria-pressed={speakOn} aria-label={speakOn ? t('agent.speakOn') : t('agent.speakOff')} title={speakOn ? t('agent.speakOn') : t('agent.speakOff')} data-testid="speak-toggle">
            {speakOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        )}
      </div>
      {voice.error && (
        <span className="small c-out" role="alert" data-testid="voice-error">
          {MIC_ERRORS.has(voice.error) ? t(`agent.voiceErrors.${voice.error}` as TKey) : t(`errors.${voice.error}.title` as TKey)}
        </span>
      )}
      {!voice.error && (voice.engine !== 'none' || voice.needsKey) && (
        <span className="small c-3" data-testid="mic-label">
          {micLabel}
        </span>
      )}
    </form>
  )
}
