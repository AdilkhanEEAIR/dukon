// Новый обход: выбрать фото → отправить → смотреть шаги → перейти к отчёту.
// Если живой режим недоступен (нет ключа/кода/лимит), объясняем причину и предлагаем демо.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api, describeError } from '../api/client'
import type { Health } from '../api/types'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { ErrorState, Skeleton } from '../components/States'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'

const MAX_FILES = 12
const MAX_BYTES = 25 * 1024 * 1024
const ACCEPT = '.jpg,.jpeg,.png,.heic,.heif,image/*'
const DEMO_KEY_STORAGE = 'dukon.demoKey'

type Phase = 'pick' | 'uploading' | 'done'

export function ScanPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const health = useAsync<Health>(() => api.health(), [])
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>('pick')
  const [error, setError] = useState<unknown>(null)
  const [step, setStep] = useState(0)
  const [demoKey, setDemoKey] = useState(() => safeGet(DEMO_KEY_STORAGE) ?? '')
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const previews = usePreviews(files)

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const incoming = Array.from(list)
      const rejected = incoming.filter((f) => f.size > MAX_BYTES)
      const accepted = incoming.filter((f) => f.size <= MAX_BYTES)
      if (rejected.length) toast('danger', 'Файл больше 25 МБ', rejected.map((f) => f.name).join(', '))
      setFiles((prev) => {
        const next = [...prev, ...accepted].slice(0, MAX_FILES)
        if (prev.length + accepted.length > MAX_FILES) toast('info', `Берём первые ${MAX_FILES} фото`)
        return next
      })
    },
    [toast],
  )

  const submit = async () => {
    if (!files.length) return
    setError(null)
    setPhase('uploading')
    setStep(0)
    const ticker = setInterval(() => setStep((s) => Math.min(s + 1, 2)), 2500)
    try {
      safeSet(DEMO_KEY_STORAGE, demoKey)
      const walk = await api.analyze(files, demoKey, `Обход ${new Date().toLocaleDateString('ru-RU')}`)
      setStep(3)
      setPhase('done')
      toast('success', 'Обход готов', `${walk.photos.length} фото разобрано`)
      setTimeout(() => navigate(`/report/${walk.id}`), 500)
    } catch (err) {
      setError(err)
      setPhase('pick')
    } finally {
      clearInterval(ticker)
    }
  }

  const liveBlocked = health.state.status === 'success' && !health.state.data.live_enabled

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__text">
          <span className="label">Новый обход</span>
          <h1 className="h2" style={{ margin: 0 }}>
            Снимите полки
          </h1>
        </div>
        <button className="icon-btn" aria-label="Закрыть" onClick={() => navigate('/')}>
          <Icon name="close" size={18} />
        </button>
      </header>

      {health.state.status === 'loading' || health.state.status === 'idle' ? (
        <div className="stack"><Skeleton h={220} r={26} /><Skeleton h={54} r={18} /></div>
      ) : health.state.status === 'error' ? (
        <ErrorState error={health.state.error} onRetry={health.refetch} secondary={<DemoButton />} />
      ) : phase === 'uploading' ? (
        <Pipeline step={step} count={files.length} />
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {liveBlocked && (
            <div className="card row" style={{ background: 'var(--warning-soft)', borderColor: 'transparent' }} role="status">
              <Icon name="alert" size={18} className="c-warning" />
              <div className="stack" style={{ gap: 1, flex: 1 }}>
                <span style={{ fontWeight: 600 }}>Живой режим выключен на сервере</span>
                <span className="caption">Нет ключа моделей. Посмотрите демо: там всё то же самое на готовых обходах.</span>
              </div>
            </div>
          )}

          <label
            className={`dropzone${over ? ' is-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}
            data-testid="dropzone"
          >
            <input ref={inputRef} type="file" accept={ACCEPT} multiple onChange={(e) => e.target.files && addFiles(e.target.files)} data-testid="file-input" />
            <div className="state__icon"><Icon name="camera" size={24} /></div>
            <span style={{ fontWeight: 600 }}>{files.length ? 'Добавить ещё фото' : 'Выберите фото полок'}</span>
            <span className="caption">JPG, PNG или HEIC с iPhone · до {MAX_FILES} фото · до 25 МБ каждое</span>
          </label>

          {files.length > 0 && (
            <div className="thumbs" data-testid="thumbs">
              {previews.map((src, i) => (
                <div key={files[i].name + i} className="thumb">
                  {src ? <img src={src} alt={files[i].name} /> : <div className="skeleton" style={{ width: '100%', height: '100%' }} />}
                  <button className="thumb__x" aria-label={`Убрать ${files[i].name}`} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="card stack" style={{ gap: 8 }}>
            <label className="caption" htmlFor="demo-key">Демо-код для живого режима</label>
            <input
              id="demo-key"
              value={demoKey}
              onChange={(e) => setDemoKey(e.target.value)}
              placeholder="Код из описания проекта"
              autoComplete="off"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--stroke-light)', borderRadius: 12, padding: '12px 14px', outline: 'none' }}
            />
          </div>

          {error !== null && <InlineError error={error} onRetry={submit} />}

          <Button block loading={false} disabled={files.length === 0 || liveBlocked} onClick={submit} icon={<Icon name="upload" size={18} />} data-testid="submit">
            {files.length ? `Разобрать ${files.length} фото` : 'Сначала добавьте фото'}
          </Button>
          <DemoButton />
        </div>
      )}
    </div>
  )
}

function DemoButton() {
  const navigate = useNavigate()
  return (
    <Button variant="ghost" block onClick={() => navigate('/report/demo-tue')} icon={<Icon name="sparkle" size={16} />}>
      Посмотреть демо-обход
    </Button>
  )
}

function InlineError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const info = describeError(error)
  const status = error instanceof ApiError ? error.status : 0
  return (
    <div className="card row" style={{ background: 'var(--danger-soft)', borderColor: 'transparent', alignItems: 'flex-start' }} role="alert" data-testid="inline-error" data-code={info.code}>
      <Icon name="alert" size={18} className="c-danger" />
      <div className="stack" style={{ gap: 2, flex: 1 }}>
        <span style={{ fontWeight: 600 }}>{info.title}</span>
        <span className="caption">{info.hint}{status ? ` (код ${status})` : ''}</span>
      </div>
      {info.retryable && (
        <Button size="sm" variant="secondary" onClick={onRetry}>Ещё раз</Button>
      )}
    </div>
  )
}

const STEPS = ['SAM 3.1 находит товары', 'Muse Spark читает названия и ценники', 'Сравниваем с прошлым обходом', 'Готово']

function Pipeline({ step, count }: { step: number; count: number }) {
  return (
    <div className="stack" style={{ gap: 20, alignItems: 'center', paddingTop: 40 }} data-testid="pipeline">
      <span className="num-xl">{Math.min(99, 20 + step * 30)}</span>
      <span className="label">процентов</span>
      <span className="h2">Читаем ваши полки</span>
      <span className="caption">{count} фото · обычно до 20 секунд на фото</span>
      <div className="bar" style={{ width: '100%', maxWidth: 342 }}><div className="bar__fill" style={{ width: `${Math.min(99, 20 + step * 30)}%` }} /></div>
      <div className="steps" style={{ width: '100%', maxWidth: 342, paddingTop: 10 }}>
        {STEPS.map((s, i) => (
          <div key={s} className={`step${i < step ? ' step--done' : i === step ? ' step--active' : ''}`}>
            <span className="step__dot" />
            <span className={i > step ? 'faint' : ''}>{s}</span>
            {i < step && <Icon name="check" size={14} className="c-success" />}
          </div>
        ))}
      </div>
    </div>
  )
}

function usePreviews(files: File[]) {
  // HEIC браузер не показывает — для него оставляем скелетон вместо битой картинки.
  const urls = useMemo(() => files.map((f) => (/heic|heif/i.test(f.type + f.name) ? null : URL.createObjectURL(f))), [files])
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls])
  return urls
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* приватный режим — просто не запоминаем */ }
}
