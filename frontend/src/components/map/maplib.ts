// MapLibre грузится отдельным куском только там, где на экране есть карта (филиалы, настройки магазина):
// библиотека тяжёлая, и главной странице она не нужна. Воркер для Vite подключается по документации OpenFreeMap.

import { AttributionControl, LngLatBounds, Map, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(workerUrl)

export { AttributionControl, LngLatBounds, Map, Marker, NavigationControl }
export type MapInstance = Map
export type MarkerInstance = Marker
