// Карты: филиалы с потерями на одной карте и выбор точки магазина (геолокация, булавка, поиск адреса).
// Подложка — векторная карта OpenFreeMap (светлая и тёмная под тему), запасная — растровая CARTO.
// Библиотека MapLibre грузится лениво.
// Булавки — свои HTML-элементы: бирка с названием и потерями в день, как ценник на полке.

import { Crosshair, LocateFixed, MapPinOff, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { GeoPoint } from '../../api/types'
import { useSettings } from '../../app/settings'
import { useI18n } from '../../i18n'
import { DEFAULT_CENTER, MAP_STYLE, currentPosition, geocode, rasterStyle, reverseGeocode, type GeoError } from '../../lib/geo'
import { Button } from '../Button'
import { useToast } from '../Toast'
import type { MapInstance, MarkerInstance } from './maplib'

type Lib = typeof import('./maplib')
type MapState = 'loading' | 'ready' | 'error'

const LOAD_TIMEOUT_MS = 12_000

/** Сенсорный экран: жесты карты не должны мешать прокрутке страницы одним пальцем. */
export function isTouch(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)
}

/** Ошибка плитки, шрифта или значка приходит с sourceId/tile — карта при этом работает, закрывать её нельзя.
 *  Фатальна только ошибка самого стиля до первой загрузки. */
function isStyleError(e: unknown): boolean {
  const ev = e as { sourceId?: string; tile?: unknown } | undefined
  return !ev?.sourceId && !ev?.tile
}

/** Создаёт карту в контейнере и держит стиль в тон теме. Не загрузился векторный стиль — переходит
 *  на растровую подложку; не загрузилась и она — честно говорит, что карты нет. */
function useMap(container: RefObject<HTMLDivElement | null>, center: GeoPoint, zoom: number) {
  const { resolvedTheme } = useSettings()
  const [map, setMap] = useState<MapInstance | null>(null)
  const [lib, setLib] = useState<Lib | null>(null)
  const [state, setState] = useState<MapState>('loading')
  const start = useRef({ center, zoom, theme: resolvedTheme, fallback: false })

  useEffect(() => {
    let disposed = false
    let loaded = false
    let instance: MapInstance | null = null
    let timer = 0
    const conf = start.current

    // Первая неудача — растровая подложка; вторая — сообщение «карта не загрузилась».
    const fail = () => {
      if (disposed || loaded || !instance) return
      window.clearTimeout(timer)
      if (conf.fallback) {
        setState('error')
        return
      }
      conf.fallback = true
      instance.setStyle(rasterStyle(conf.theme))
      timer = window.setTimeout(fail, LOAD_TIMEOUT_MS)
    }

    import('./maplib')
      .then((L) => {
        if (disposed || !container.current) return
        instance = new L.Map({
          container: container.current,
          style: conf.fallback ? rasterStyle(conf.theme) : MAP_STYLE[conf.theme],
          center: [conf.center.lng, conf.center.lat],
          zoom: conf.zoom,
          attributionControl: false,
          // Колесо мыши приближает карту; на телефоне MapLibre сам просит «два пальца», чтобы карта
          // не ловила прокрутку страницы одним пальцем (cooperativeGestures), а на ПК колесо работает без Ctrl.
          cooperativeGestures: isTouch(),
          scrollZoom: true,
          dragRotate: false,
          pitchWithRotate: false,
        })
        instance.addControl(new L.NavigationControl({ showCompass: false }), 'top-right')
        instance.addControl(new L.AttributionControl({ compact: true }), 'bottom-right')
        timer = window.setTimeout(fail, LOAD_TIMEOUT_MS)
        instance.on('load', () => {
          loaded = true
          window.clearTimeout(timer)
          if (!disposed) setState('ready')
        })
        instance.on('error', (e: unknown) => {
          if (isStyleError(e)) fail()
        })
        setLib(L)
        setMap(instance)
      })
      // Нет WebGL (выключено аппаратное ускорение) или не загрузилась сама библиотека.
      .catch(() => !disposed && setState('error'))
    return () => {
      disposed = true
      window.clearTimeout(timer)
      instance?.remove()
    }
  }, [container])

  // Смена темы — смена подложки; булавки — DOM-элементы и переживают смену стиля.
  useEffect(() => {
    if (map && start.current.theme !== resolvedTheme) {
      start.current.theme = resolvedTheme
      map.setStyle(start.current.fallback ? rasterStyle(resolvedTheme) : MAP_STYLE[resolvedTheme])
    }
  }, [map, resolvedTheme])

  return { map, lib, state }
}

function MapFallback({ state }: { state: MapState }) {
  const { t } = useI18n()
  if (state === 'ready') return null
  return (
    <div className={`geo-map__veil${state === 'error' ? ' is-error' : ''}`} data-testid={`map-${state}`}>
      {state === 'error' ? <span>{t('map.offline')}</span> : <span className="geo-map__shimmer" aria-hidden />}
    </div>
  )
}

// ---- филиалы на карте

export interface MapPin {
  id: string
  point: GeoPoint
  title: string
  caption: string
  tone: 'out' | 'ok'
}

function pinElement(pin: MapPin, onClick: (id: string) => void): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = `map-pin map-pin--${pin.tone}`
  el.setAttribute('aria-label', `${pin.title}: ${pin.caption}`)
  el.dataset.testid = 'map-pin'
  const title = document.createElement('span')
  title.className = 'map-pin__title'
  title.textContent = pin.title
  const caption = document.createElement('span')
  caption.className = 'map-pin__caption'
  caption.textContent = pin.caption
  el.append(title, caption)
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick(pin.id)
  })
  return el
}

export function BranchesMap({ pins, focus, onFocus, height = 340 }: { pins: MapPin[]; focus: string | null; onFocus: (id: string) => void; height?: number }) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const first = pins[0]?.point ?? DEFAULT_CENTER
  const { map, lib, state } = useMap(box, first, 10)
  const markers = useRef(new Map<string, MarkerInstance>())
  const onFocusRef = useRef(onFocus)
  useEffect(() => {
    onFocusRef.current = onFocus
  }, [onFocus])

  // Булавки пересоздаём при смене набора филиалов (переименовали, добавили точку).
  const key = pins.map((p) => `${p.id}:${p.point.lat}:${p.point.lng}:${p.title}:${p.caption}`).join('|')
  useEffect(() => {
    if (!map || !lib) return
    const current = markers.current
    current.forEach((m) => m.remove())
    current.clear()
    for (const pin of pins) {
      const marker = new lib.Marker({ element: pinElement(pin, (id) => onFocusRef.current(id)), anchor: 'bottom', offset: [0, -8] }).setLngLat([pin.point.lng, pin.point.lat]).addTo(map)
      current.set(pin.id, marker)
    }
    return () => {
      current.forEach((m) => m.remove())
      current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, lib, key])

  // Первый показ: карта «подлетает» от города к филиалам — одно заметное движение, а не мгновенный кадр.
  const framed = useRef(false)
  useEffect(() => {
    if (!map || !lib || state !== 'ready' || framed.current || !pins.length) return
    framed.current = true
    if (pins.length === 1) {
      map.flyTo({ center: [pins[0].point.lng, pins[0].point.lat], zoom: 14.5, duration: 2200, essential: false })
      return
    }
    const bounds = new lib.LngLatBounds()
    pins.forEach((p) => bounds.extend([p.point.lng, p.point.lat]))
    map.fitBounds(bounds, { padding: { top: 70, bottom: 30, left: 60, right: 60 }, maxZoom: 14.5, duration: 2200 })
  }, [map, lib, state, pins])

  // Выбранный филиал: булавка выделена, карта плавно перелетает к нему.
  useEffect(() => {
    markers.current.forEach((m, id) => m.getElement().classList.toggle('is-active', id === focus))
    const pin = pins.find((p) => p.id === focus)
    if (map && pin && state === 'ready') map.flyTo({ center: [pin.point.lng, pin.point.lat], zoom: Math.max(map.getZoom(), 14), duration: 1400, essential: false })
  }, [focus, map, pins, state])

  return (
    <section className="geo-map sheet" style={{ height }} aria-label={t('map.title')} data-testid="branches-map">
      <div ref={box} className="geo-map__canvas" />
      <MapFallback state={state} />
    </section>
  )
}

// ---- выбор точки магазина

function geoErrorKey(err: unknown): 'map.denied' | 'map.unavailable' {
  return (err as GeoError) === 'denied' ? 'map.denied' : 'map.unavailable'
}

export function LocationPicker({
  value,
  address,
  onChange,
  onAddress,
  height = 240,
}: {
  value: GeoPoint | null
  address: string
  onChange: (p: GeoPoint | null) => void
  onAddress: (a: string) => void
  height?: number
}) {
  const { t, locale } = useI18n()
  const toast = useToast()
  const box = useRef<HTMLDivElement>(null)
  const { map, lib, state } = useMap(box, value ?? DEFAULT_CENTER, value ? 15.5 : 11)
  const marker = useRef<MarkerInstance | null>(null)
  const [locating, setLocating] = useState(false)
  const [searching, setSearching] = useState(false)
  const lookup = useRef<AbortController | null>(null)

  // Адрес по точке: последний запрос отменяет предыдущий — Nominatim просит не спамить.
  const fillAddress = useCallback(
    async (p: GeoPoint) => {
      lookup.current?.abort()
      const ctrl = new AbortController()
      lookup.current = ctrl
      const text = await reverseGeocode(p, locale, ctrl.signal)
      if (text && !ctrl.signal.aborted) {
        onAddress(text)
        toast('success', t('map.addressFilled'), text)
      }
    },
    [locale, onAddress, toast, t],
  )
  const fillRef = useRef(fillAddress)
  const changeRef = useRef(onChange)
  useEffect(() => {
    fillRef.current = fillAddress
    changeRef.current = onChange
  }, [fillAddress, onChange])

  const place = useCallback((p: GeoPoint) => {
    changeRef.current(p)
    void fillRef.current(p)
  }, [])

  // Клик по карте ставит булавку.
  useEffect(() => {
    if (!map) return
    const onClick = (e: { lngLat: { lat: number; lng: number } }) => place({ lat: Math.round(e.lngLat.lat * 1e6) / 1e6, lng: Math.round(e.lngLat.lng * 1e6) / 1e6 })
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [map, place])

  // Булавка следует за значением; перетаскивание — тоже способ поставить точку.
  useEffect(() => {
    if (!map || !lib) return
    if (!value) {
      marker.current?.remove()
      marker.current = null
      return
    }
    if (!marker.current) {
      const el = document.createElement('span')
      el.className = 'shop-pin'
      el.dataset.testid = 'shop-pin'
      el.innerHTML = '<span class="shop-pin__head"></span><span class="shop-pin__shadow"></span>'
      const m = new lib.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([value.lng, value.lat]).addTo(map)
      m.on('dragend', () => {
        const ll = m.getLngLat()
        place({ lat: Math.round(ll.lat * 1e6) / 1e6, lng: Math.round(ll.lng * 1e6) / 1e6 })
      })
      marker.current = m
      el.classList.add('is-dropping')
      window.setTimeout(() => el.classList.remove('is-dropping'), 700)
    } else {
      marker.current.setLngLat([value.lng, value.lat])
    }
  }, [map, lib, value, place])

  useEffect(
    () => () => {
      marker.current?.remove()
      lookup.current?.abort()
    },
    [],
  )

  const flyTo = (p: GeoPoint) => map?.flyTo({ center: [p.lng, p.lat], zoom: 16.5, duration: 1600, essential: false })

  const locate = async () => {
    setLocating(true)
    try {
      const p = await currentPosition()
      place(p)
      flyTo(p)
    } catch (err) {
      toast('danger', t(geoErrorKey(err)))
    } finally {
      setLocating(false)
    }
  }

  const find = async () => {
    setSearching(true)
    try {
      const p = await geocode(address, locale, value ?? DEFAULT_CENTER)
      if (!p) {
        toast('info', t('map.notFound'))
        return
      }
      changeRef.current(p)
      flyTo(p)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="loc-picker stack" style={{ gap: 10 }} data-testid="location-picker">
      <div className="row row--wrap" style={{ gap: 8 }}>
        <Button size="sm" variant="secondary" icon={<LocateFixed size={15} />} loading={locating} onClick={() => void locate()} data-testid="use-location">
          {t('map.useMyLocation')}
        </Button>
        <Button size="sm" variant="quiet" icon={<Search size={15} />} loading={searching} disabled={address.trim().length < 3} onClick={() => void find()} data-testid="find-address">
          {t('map.findAddress')}
        </Button>
        {value && (
          <Button size="sm" variant="quiet" icon={<MapPinOff size={15} />} onClick={() => onChange(null)} data-testid="clear-point">
            {t('map.removePoint')}
          </Button>
        )}
      </div>
      <div className="geo-map geo-map--picker sheet" style={{ height }}>
        <div ref={box} className="geo-map__canvas" />
        {!value && state === 'ready' && (
          <span className="geo-map__hint">
            <Crosshair size={14} />
            {t('map.pickHint')}
          </span>
        )}
        <MapFallback state={state} />
      </div>
    </div>
  )
}
