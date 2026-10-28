// Где магазин: геолокация телефона и адреса через OpenStreetMap (Nominatim).
// Nominatim бесплатный, без ключа, но просит не чаще запроса в секунду — поэтому поиск адреса
// только по кнопке, а обратный поиск — по отпусканию булавки, не на каждое движение.

import type { GeoPoint } from '../api/types'
import type { Locale } from '../i18n'

const NOMINATIM = 'https://nominatim.openstreetmap.org'

// Стили карты OpenFreeMap: светлый «Positron» и тёмный — под тему приложения. Ключ не нужен.
export const MAP_STYLE = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const

/** Бишкек: центр карты, пока у магазина нет точки. */
export const DEFAULT_CENTER: GeoPoint = { lat: 42.8746, lng: 74.6122 }

export type GeoError = 'denied' | 'unavailable' | 'timeout' | 'unsupported'

export function currentPosition(timeoutMs = 12_000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject('unsupported' satisfies GeoError)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) }),
      (err) => reject((err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable') satisfies GeoError),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

/** 6 знаков — точность около 10 см, больше хранить незачем. */
export function round(v: number): number {
  return Math.round(v * 1e6) / 1e6
}

interface NominatimAddress {
  road?: string
  pedestrian?: string
  house_number?: string
  neighbourhood?: string
  suburb?: string
  city?: string
  town?: string
  village?: string
}

/** «Улица дом, город» — коротко, как пишут на вывеске. Длинную строку Nominatim не показываем. */
export function shortAddress(a: NominatimAddress | undefined, fallback = ''): string {
  if (!a) return fallback
  const street = [a.road ?? a.pedestrian ?? a.neighbourhood ?? a.suburb, a.house_number].filter(Boolean).join(' ')
  const city = a.city ?? a.town ?? a.village
  return [street, city].filter(Boolean).join(', ') || fallback
}

function lang(locale: Locale): string {
  return locale === 'ky' ? 'ky,ru' : locale
}

export async function reverseGeocode(p: GeoPoint, locale: Locale, signal?: AbortSignal): Promise<string | null> {
  try {
    const url = `${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${p.lat}&lon=${p.lng}&accept-language=${lang(locale)}`
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const body = (await res.json()) as { address?: NominatimAddress; display_name?: string }
    const text = shortAddress(body.address, body.display_name?.split(',').slice(0, 2).join(',').trim() ?? '')
    return text ? text.slice(0, 120) : null
  } catch {
    return null
  }
}

export async function geocode(query: string, locale: Locale, near?: GeoPoint, signal?: AbortSignal): Promise<GeoPoint | null> {
  const q = query.trim()
  if (q.length < 3) return null
  try {
    // Без страны в запросе «Чуй 120» находится где угодно; подсказываем ближайшую область вокруг текущей точки.
    const around = near ? `&viewbox=${near.lng - 0.5},${near.lat + 0.5},${near.lng + 0.5},${near.lat - 0.5}` : ''
    const url = `${NOMINATIM}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}${around}&accept-language=${lang(locale)}`
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const list = (await res.json()) as { lat: string; lon: string }[]
    if (!list.length) return null
    return { lat: round(Number(list[0].lat)), lng: round(Number(list[0].lon)) }
  } catch {
    return null
  }
}

export function hasPoint(s: { lat?: number | null; lng?: number | null }): s is { lat: number; lng: number } {
  return typeof s.lat === 'number' && typeof s.lng === 'number'
}
