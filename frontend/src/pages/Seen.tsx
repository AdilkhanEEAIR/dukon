// «Что я увидел»: фото обхода с рамками SAM поверх и список того, что прочитал Spark.
// Это первый экран после загрузки: человек за секунду видит, что ИИ посмотрел и понял,
// и только потом идёт к цифрам. Рамки — доказательство: зелёные прочитаны уверенно,
// красные стоит проверить, жёлтые — ценники, откуда взяты цены.

import { ArrowLeftRight, ArrowRight, Home, ImageOff, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { PhotoAnalysis, ShelfItem, Walk, WalkDiff } from '../api/types'
import { Button, IconButton } from '../components/Button'
import { Money } from '../components/Money'
import { PageActions } from '../components/Nav'
import { Pill } from '../components/Pill'
import { ProductIcon } from '../components/ProductIcon'
import { EmptyState, ErrorState, Notice, ReportSkeleton } from '../components/States'
import { useAsync } from '../hooks/useAsync'
import { useI18n } from '../i18n'
import { productName } from '../i18n/products'
import { formatWhen } from '../lib/format'

interface Seen {
  walk: Walk
  diff: WalkDiff
}

export function SeenPage() {
  const { id } = useParams()
  const { t, locale } = useI18n()
  const { state, refetch } = useAsync<Seen>(
    async () => {
      const [walk, diff] = await Promise.all([api.walk(id!), api.diff(id!)])
      return { walk, diff }
    },
    [id],
    !!id,
  )

  return (
    <div className="page stagger" data-testid="seen">
      <header className="page-head">
        <div className="page-head__text">
          <h1 className="h1">{t('seen.title')}</h1>
          {state.status === 'success' && <p className="page-head__sub">{subtitle(state.data.walk, t)}</p>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {state.status === 'success' && (
            <IconButton label={t('seen.toReport')} outline to={`/app/shelves/${state.data.walk.id}`}>
              <ArrowLeftRight size={18} />
            </IconButton>
          )}
          <PageActions />
        </div>
      </header>

      {state.status === 'loading' || state.status === 'idle' ? (
        <ReportSkeleton />
      ) : state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={() => void refetch()} secondary={<Button variant="secondary" to="/app">{t('common.home')}</Button>} />
      ) : (
        <SeenBody walk={state.data.walk} diff={state.data.diff} locale={locale} />
      )}
    </div>
  )
}

function subtitle(walk: Walk, t: ReturnType<typeof useI18n>['t']): string {
  const calls = walk.photos.reduce((a, p) => a + p.model_calls, 0)
  const seconds = walk.photos.reduce((a, p) => a + (p.seconds ?? 0), 0)
  return t('seen.subtitle', { n: walk.photos.length, calls, s: Math.round(seconds) })
}

function SeenBody({ walk, diff, locale }: Seen & { locale: ReturnType<typeof useI18n>['locale'] }) {
  const { t } = useI18n()
  const first = diff.walk_before_id === null
  return (
    <div className="stack" style={{ gap: 18 }}>
      {walk.photos.map((photo, i) => (
        <PhotoCard key={photo.photo_id} photo={photo} index={i} total={walk.photos.length} locale={locale} />
      ))}
      <p className="small">{t('seen.legend')}</p>

      {first ? (
        <Notice tone="ok" title={t('seen.firstTitle')} text={t('seen.firstBody')} action={<Button to="/app" icon={<Home size={16} />}>{t('seen.home')}</Button>} />
      ) : (
        <Button size="lg" block to={`/app/shelves/${walk.id}`} icon={<ArrowRight size={18} />} data-testid="seen-compare">
          {t('seen.compare')}
        </Button>
      )}
    </div>
  )
}

function PhotoCard({ photo, index, total, locale }: { photo: PhotoAnalysis; index: number; total: number; locale: ReturnType<typeof useI18n>['locale'] }) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<string | null>(null)
  const items = photo.shelves.flatMap((s) => s.items)
  const when = photo.taken_at ? formatWhen(photo.taken_at, locale) : null
  const labels = (photo.concepts ?? []).map((c) => c.label || c.query).join(', ')
  const found = (photo.concepts ?? []).reduce((a, c) => a + c.boxes, 0)

  return (
    <section className="sheet seen-card" data-testid="seen-photo">
      <header className="row row--between row--wrap seen-card__head">
        <span className="h3">
          {t('scan.photoOf', { i: index + 1, n: total })}
          {when && <span className="small" style={{ marginLeft: 8 }}>{when}</span>}
        </span>
        {labels && (
          <span className="row row--wrap" style={{ gap: 6 }}>
            <Pill>{t('seen.scout', { labels })}</Pill>
            {photo.evidence === 'boxes' && <Pill tone="ok">{t('seen.found', { n: found })}</Pill>}
            {!!photo.price_tags?.length && <Pill tone="price">{t('seen.tags', { n: photo.price_tags.length })}</Pill>}
          </span>
        )}
      </header>

      <div className="seen-card__body">
        <PhotoWithBoxes photo={photo} items={items} selected={selected} onSelect={setSelected} />
        <div className="stack" style={{ gap: 6 }}>
          {photo.evidence === 'model_count' && <Notice title={t('seen.countedByModel')} />}
          {items.length === 0 ? (
            <EmptyState icon={ScanLine} title={t('seen.nothing')} />
          ) : (
            <ul className="seen-list" data-testid="seen-list">
              {items.map((item) => (
                <li key={item.sku + item.name} className={`seen-item${selected === item.sku ? ' is-selected' : ''}`} onMouseEnter={() => setSelected(item.sku)} onMouseLeave={() => setSelected(null)} data-testid="seen-item">
                  <ProductIcon name={item.name} size={34} />
                  <span className="stack stack--tight grow" style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ fontWeight: 600 }}>{productName(item.name, locale)}</span>
                    <span className="small row" style={{ gap: 8 }}>
                      {item.price !== null ? <Money kgs={item.price} noAlt animate={false} /> : <span>—</span>}
                      {item.needs_review ? <Pill tone="out">{t('seen.review')}</Pill> : <Pill tone="ok">{t('seen.sure')}</Pill>}
                    </span>
                  </span>
                  <span className="num-md">×{item.count}</span>
                </li>
              ))}
            </ul>
          )}
          {photo.notes.length > 0 && (
            <details className="seen-notes">
              <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>{t('seen.notes')}</summary>
              {photo.notes.map((n) => (
                <p key={n} className="small" style={{ margin: '6px 0 0' }}>
                  {n}
                </p>
              ))}
            </details>
          )}
        </div>
      </div>
    </section>
  )
}

/** Фото с рамками: SVG с тем же viewBox, что размер снимка, — рамки масштабируются вместе с картинкой. */
function PhotoWithBoxes({ photo, items, selected, onSelect }: { photo: PhotoAnalysis; items: ShelfItem[]; selected: string | null; onSelect: (sku: string | null) => void }) {
  const { t } = useI18n()
  const [missing, setMissing] = useState(false)
  if (missing) {
    return (
      <div className="seen-photo seen-photo--missing" data-testid="seen-no-photo">
        <ImageOff size={22} />
        <span className="small">{t('seen.noPhoto')}</span>
      </div>
    )
  }
  const stroke = Math.max(2, Math.round(photo.width / 400))
  return (
    <div className="seen-photo" style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
      <img src={api.photoUrl(photo)} alt="" onError={() => setMissing(true)} data-testid="seen-img" />
      <svg viewBox={`0 0 ${photo.width} ${photo.height}`} preserveAspectRatio="none" aria-hidden data-testid="seen-boxes">
        {(photo.price_tags ?? []).map((b, i) => (
          <rect key={`tag-${i}`} x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} className="box box--tag" strokeWidth={stroke} />
        ))}
        {items.map((item) =>
          item.boxes.map((b, i) => (
            <rect
              key={`${item.sku}-${i}`}
              x={b.x1}
              y={b.y1}
              width={b.x2 - b.x1}
              height={b.y2 - b.y1}
              className={`box ${item.needs_review ? 'box--review' : 'box--ok'}${selected === item.sku ? ' is-selected' : selected ? ' is-dim' : ''}`}
              strokeWidth={stroke}
              onMouseEnter={() => onSelect(item.sku)}
              onMouseLeave={() => onSelect(null)}
              data-sku={item.sku}
            />
          )),
        )}
      </svg>
    </div>
  )
}
