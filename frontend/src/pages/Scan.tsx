// Новый обход: фото → отправка → шаги → отчёт. Если живой режим недоступен — объясняем причину
// и предлагаем демо-результат. Ошибка сервера показывается с кодом и кнопкой «ещё раз».

import { Camera, Circle, CircleAlert, CircleCheck, LoaderCircle, MapPin, Sparkles, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorCode } from '../api/client'
import { useLatest } from '../app/data'
import { useMode } from '../app/mode'
import { useSettings } from '../app/settings'
import { useShops } from '../app/shops'
import { Button, IconButton } from '../components/Button'
import { Field, Input } from '../components/Fields'
import { Notice, Skeleton } from '../components/States'
import { useToast } from '../components/Toast'
import { useI18n } from '../i18n'
import { capitalize } from '../lib/format'

const MAX_FILES = 12
const MAX_BYTES = 25 * 1024 * 1024
const ACCEPT = '.jpg,.jpeg,.png,.heic,.heif,image/*'

type Phase = 'pick' | 'uploading' | 'done'

export function ScanPage() {
  const { t, locale, list } = useI18n()
  const navigate = useNavigate()
  const toast = useToast()
  const { status, mode, reason, refresh } = useMode()
  const { settings, update, deviceId } = useSettings()
  const { current } = useShops()
  const { reload } = useLatest()
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>('pick')
  const [error, setError] = useState<unknown>(null)
  const [step, setStep] = useState(0)
  const [demoKey, setDemoKey] = useState(settings.demoKey)
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const previews = usePreviews(files)
  const steps = list<string>('scan.steps')

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const incoming = Array.from(list)
      const rejected = incoming.filter((f) => f.size > MAX_BYTES)
      const accepted = incoming.filter((f) => f.size <= MAX_BYTES)
      if (rejected.length) toast('danger', t('scan.tooBig'), rejected.map((f) => f.name).join(', '))
      setFiles((prev) => {
        if (prev.length + accepted.length > MAX_FILES) toast('info', t('scan.tooMany', { n: MAX_FILES }))
        return [...prev, ...accepted].slice(0, MAX_FILES)
      })
    },
    [toast, t],
  )

  const submit = async () => {
    if (!files.length) return
    setError(null)
    setPhase('uploading')
    setStep(0)
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, 2)), 2500)
    try {
      update({ demoKey })
      const walk = await api.analyze(files, { demoKey, label: new Date().toLocaleDateString(locale), shopId: current?.id, deviceId })
      setStep(3)
      setPhase('done')
      toast('success', t('scan.done'), t('scan.doneBody', { n: walk.photos.length }))
      void reload()
      void refresh()
      setTimeout(() => navigate(`/app/shelves/${walk.id}`), 500)
    } catch (err) {
      setError(err)
      setPhase('pick')
      void refresh()
    } finally {
      clearInterval(ticker)
    }
  }

  const liveBlocked = status === 'ready' && mode === 'demo' && reason !== 'manual'

  return (
    <div className="page stagger" style={{ maxWidth: 640 }} data-testid="scan">
      <header className="page-head">
        <div className="page-head__text">
          <h1 className="h1">{t('scan.title')}</h1>
          <p className="page-head__sub row row--wrap" style={{ gap: '4px 12px' }}>
            <span>{t('scan.subtitle')}</span>
            {current && (
              <span className="row" style={{ gap: 4 }}>
                <MapPin size={13} /> {current.name}
              </span>
            )}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <IconButton label={t('common.close')} outline onClick={() => navigate('/app')}>
            <X size={18} />
          </IconButton>
        </div>
      </header>

      {status === 'loading' ? (
        <div className="stack">
          <Skeleton h={200} r={18} />
          <Skeleton h={52} r={26} />
        </div>
      ) : phase === 'uploading' ? (
        <Pipeline step={step} count={files.length} steps={steps} />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {liveBlocked && <Notice title={t('scan.liveOff')} text={reason && reason !== 'no_api_key' ? capitalize(t(`mode.reasons.${reason}`)) : t('scan.liveOffBody')} />}
          {status === 'down' && <Notice tone="out" title={t('errors.network.title')} text={t('errors.network.hint')} />}

          <label
            className={`dropzone${over ? ' is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              addFiles(e.dataTransfer.files)
            }}
            data-testid="dropzone"
          >
            <input ref={inputRef} type="file" accept={ACCEPT} multiple onChange={(e) => e.target.files && addFiles(e.target.files)} data-testid="file-input" />
            <span className="state__icon">
              <Camera size={22} />
            </span>
            <span style={{ fontWeight: 700 }}>{files.length ? t('scan.pickMore') : t('scan.pick')}</span>
            <span className="small">{t('scan.pickHint', { max: MAX_FILES })}</span>
          </label>

          {files.length > 0 && (
            <div className="thumbs" data-testid="thumbs">
              {previews.map((src, i) => (
                <div key={files[i].name + i} className="thumb">
                  {src ? <img src={src} alt={files[i].name} /> : <span className="thumb__heic">HEIC</span>}
                  <button type="button" className="thumb__x" aria-label={t('scan.remove', { name: files[i].name })} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Field label={t('scan.demoKey')} hint={t('scan.demoKeyHint')} htmlFor="demo-key">
            <Input id="demo-key" value={demoKey} onChange={(e) => setDemoKey(e.target.value)} autoComplete="off" />
          </Field>

          {error !== null && <InlineError error={error} onRetry={submit} />}

          <Button size="lg" block disabled={files.length === 0 || liveBlocked || status === 'down'} onClick={submit} icon={<Upload size={18} />} data-testid="submit">
            {files.length ? t('scan.analyze', { n: files.length }) : t('scan.addFirst')}
          </Button>
          <Button variant="quiet" block to="/app/shelves?demo=1" icon={<Sparkles size={16} />}>
            {t('scan.useDemo')}
          </Button>
        </div>
      )}
    </div>
  )
}

function InlineError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n()
  const { code, status, retryable } = errorCode(error)
  return (
    <div className="notice notice--out" role="alert" data-testid="inline-error" data-code={code}>
      <CircleAlert size={18} className="notice__icon" />
      <div className="stack stack--tight grow">
        <span className="notice__title">{t(`errors.${code}.title`)}</span>
        <span className="notice__text">
          {t(`errors.${code}.hint`)}
          {status ? ` · ${t('errors.code', { n: status })}` : ''}
        </span>
      </div>
      {retryable && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}

function Pipeline({ step, count, steps }: { step: number; count: number; steps: string[] }) {
  const { t } = useI18n()
  const pct = Math.min(99, 20 + step * 30)
  return (
    <div className="stack" style={{ gap: 20, alignItems: 'center', paddingTop: 32, textAlign: 'center' }} data-testid="pipeline">
      <span className="num-xl">{pct}</span>
      <span className="small">{t('scan.percent')}</span>
      <span className="h2">{t('scan.reading')}</span>
      <span className="small">{t('scan.readingHint', { n: count })}</span>
      <div className="bar" style={{ width: '100%', maxWidth: 360 }}>
        <div className="bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="steps" style={{ width: '100%', maxWidth: 360, paddingTop: 8, textAlign: 'left' }}>
        {steps.map((s, i) => (
          <div key={s} className={`step${i < step ? ' step--done' : i === step ? ' step--active' : ''}`}>
            <span className="step__icon" aria-hidden>
              {i < step ? <CircleCheck size={16} /> : i === step ? <LoaderCircle size={16} /> : <Circle size={16} />}
            </span>
            <span className="grow">{s}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function usePreviews(files: File[]) {
  // HEIC браузер не показывает — для него плашка вместо битой картинки.
  const urls = useMemo(() => files.map((f) => (/heic|heif/i.test(f.type + f.name) ? null : URL.createObjectURL(f))), [files])
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls])
  return urls
}
