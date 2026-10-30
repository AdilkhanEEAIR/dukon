// Новый обход: фото → отправка → шаги → отчёт. Обход всегда уходит в свой магазин: нет магазина — сначала
// онбординг. Модели недоступны — объясняем причину; в демо-режиме ещё и предлагаем демо-результат.
// Успешный обход из демо-режима возвращает приложение к своим данным: человек только что сделал настоящее.

import { Camera, Circle, CircleAlert, CircleCheck, FlaskConical, LoaderCircle, MapPin, Sparkles, Store, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorCode } from '../api/client'
import type { Walk } from '../api/types'
import { useLatest } from '../app/data'
import { useMode } from '../app/mode'
import { useSettings } from '../app/settings'
import { useShops } from '../app/shops'
import { Button, IconButton } from '../components/Button'
import { Field, Input } from '../components/Fields'
import { EmptyState, Notice, Skeleton } from '../components/States'
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
  const { status, mode, health, liveReady, setView, refresh } = useMode()
  const { settings, update, deviceId } = useSettings()
  const { current } = useShops()
  const { reload } = useLatest()
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>('pick')
  const [error, setError] = useState<unknown>(null)
  const [step, setStep] = useState(0)
  // Какое фото сейчас разбирается: фото уходят по одному, чтобы прогресс был настоящим, а не нарисованным.
  const [photoIndex, setPhotoIndex] = useState(0)
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
    setPhotoIndex(0)
    // Шаги внутри одного фото: разведка ~8 с, SAM ~5 с, чтение ~25 с. Таймер лишь подсвечивает, где мы примерно.
    let ticker = setInterval(() => setStep((s) => Math.min(s + 1, 2)), 9000)
    const restart = () => {
      clearInterval(ticker)
      setStep(0)
      ticker = setInterval(() => setStep((s) => Math.min(s + 1, 2)), 9000)
    }
    let walk: Walk | null = null
    try {
      update({ demoKey })
      const common = { demoKey, deviceId }
      walk = await api.analyze([files[0]], { ...common, label: new Date().toLocaleDateString(locale), shopId: current?.id })
      for (let i = 1; i < files.length; i += 1) {
        setPhotoIndex(i)
        restart()
        walk = await api.addPhotos(walk.id, [files[i]], common)
      }
      setStep(3)
      setPhase('done')
      toast('success', t('scan.done'), t('scan.doneBody', { n: walk.photos.length }))
    } catch (err) {
      if (walk === null) {
        setError(err)
        setPhase('pick')
        void refresh()
        clearInterval(ticker)
        return
      }
      // Первое фото прошло, дальше сорвалось: обход уже есть — показываем, что успели, и честно говорим сколько.
      toast('danger', t('scan.partial', { done: walk.photos.length, n: files.length }))
      setPhase('done')
    } finally {
      clearInterval(ticker)
    }
    // Из демо — обратно к своим данным; перезагрузка данных случится сама при смене режима.
    if (mode === 'demo') setView('live')
    else void reload()
    void refresh()
    const id = walk.id
    setTimeout(() => navigate(`/app/shelves/${id}/seen`), 500)
  }

  // Сервер отвечает, но модели недоступны (нет ключа, кредитов, бюджета) — новые обходы на паузе.
  const liveBlocked = status === 'ready' && !liveReady
  const serverReason = health?.reason ?? 'unknown'

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
      ) : !current && status === 'ready' ? (
        <div className="sheet">
          <EmptyState icon={Store} title={t('scan.needShop')} text={t('scan.needShopBody')} action={<Button to="/app/onboarding">{t('scan.needShopCta')}</Button>} />
        </div>
      ) : phase !== 'pick' ? (
        // «done» — те же шаги на 100 %, пока открывается экран «Что я увидел»: без пустого кадра между ними.
        <Pipeline step={phase === 'done' ? 3 : step} index={photoIndex} count={files.length} steps={steps} />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {liveBlocked && <Notice title={t('scan.liveOff')} text={serverReason !== 'no_api_key' ? capitalize(t(`mode.reasons.${serverReason}`)) : t('scan.liveOffBody')} />}
          {!liveBlocked && mode === 'demo' && status === 'ready' && current && (
            <p className="demo-line" data-testid="scan-from-demo">
              <span className="demo-line__tag">
                <FlaskConical size={12} />
              </span>
              {t('scan.fromDemo', { shop: current.name })}
            </p>
          )}
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
          {mode === 'demo' && (
            <Button variant="quiet" block to="/app/shelves" icon={<Sparkles size={16} />}>
              {t('scan.useDemo')}
            </Button>
          )}
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

function Pipeline({ step, index, count, steps }: { step: number; index: number; count: number; steps: string[] }) {
  const { t } = useI18n()
  // Прогресс по всем фото: пройденные фото целиком плюс доля текущего по шагам.
  const pct = step >= 3 ? 100 : Math.min(99, Math.round(((index + (0.15 + step * 0.28)) / Math.max(1, count)) * 100))
  return (
    <div className="stack" style={{ gap: 20, alignItems: 'center', paddingTop: 32, textAlign: 'center' }} data-testid="pipeline">
      <span className="num-xl" data-testid="pipeline-pct">
        {pct}
        <span className="num-unit">%</span>
      </span>
      <span className="h2">{t('scan.reading')}</span>
      <span className="small" data-testid="pipeline-photo">
        {count > 1 ? `${t('scan.photoOf', { i: Math.min(index + 1, count), n: count })} · ` : ''}
        {t('scan.readingHint', { n: count })}
      </span>
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
