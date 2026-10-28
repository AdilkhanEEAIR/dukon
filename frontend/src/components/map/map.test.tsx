import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { GeoPoint } from '../../api/types'
import { AppRoutes, Providers } from '../../App'
import { geocode, hasPoint, shortAddress } from '../../lib/geo'
import { happyRoutes, jsonResponse, mineOverview, mockFetch, seedSettings, type Routes } from '../../test/fixtures'
import { ThemeToggle } from '../Nav'
import { BranchesMap, LocationPicker } from './GeoMap'

interface FakeMap {
  style: string
  flights: { center: [number, number] }[]
  fits: unknown[]
}
const maps = () => (globalThis as unknown as { __maps: FakeMap[] }).__maps

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Providers poll={false}>
        <AppRoutes />
      </Providers>
    </MemoryRouter>,
  )
}

function stubGeolocation(result: { ok: true; lat: number; lng: number } | { ok: false; code: number }) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) =>
        result.ok ? ok({ coords: { latitude: result.lat, longitude: result.lng } } as GeolocationPosition) : fail({ code: result.code } as GeolocationPositionError),
    },
  })
}

const geoRoutes: Routes = {
  ...happyRoutes,
  '/reverse': () => jsonResponse({ address: { road: 'Чуй проспекти', house_number: '120', city: 'Бишкек' } }),
  '/search': () => jsonResponse([{ lat: '42.8766', lon: '74.6046' }]),
}

describe('Карта филиалов', () => {
  beforeEach(() => seedSettings())

  it('демо-сеть: бирки с потерями, карта подлетает к филиалам, булавка выделяет строку', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/branches')
    const map = await screen.findByTestId('branches-map')
    await waitFor(() => expect(within(map).getAllByTestId('map-pin')).toHaveLength(3))
    // три точки — карта берёт их в рамку
    await waitFor(() => expect(maps()[0].fits).toHaveLength(1))
    const manas = within(map).getAllByTestId('map-pin').find((p) => p.textContent?.includes('Manas 47'))!
    expect(manas).toHaveClass('map-pin--out')
    expect(manas).toHaveTextContent(/1\s248\sсом/)
    await userEvent.click(manas)
    const row = screen.getAllByTestId('branch-row').find((r) => r.textContent?.includes('Manas 47'))!
    expect(row).toHaveClass('is-focus')
    expect(manas).toHaveClass('is-active')
    expect(maps()[0].flights.at(-1)?.center).toEqual([74.5873, 42.8665])
  })

  it('кнопка «показать на карте» у строки перелетает к филиалу', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/branches')
    await screen.findByTestId('branches-map')
    const row = (await screen.findAllByTestId('branch-row')).find((r) => r.textContent?.includes('Osh Bazaar'))!
    await userEvent.click(within(row).getByTestId('focus-on-map'))
    await waitFor(() => expect(maps()[0].flights.at(-1)?.center).toEqual([74.5694, 42.8748]))
  })

  it('свои филиалы без точек — приглашение отметить их в настройках', async () => {
    const mine = mineOverview.map((r, i) => ({ ...r, walks: 1, last_walk_id: `w${i}`, last_walk_at: '2026-10-28T00:00:00Z' }))
    mockFetch({ ...happyRoutes, '/branches/overview?scope=mine': () => jsonResponse(mine) })
    renderAt('/app/branches')
    expect(await screen.findByTestId('map-empty')).toHaveTextContent('Ваших магазинов пока нет на карте')
    expect(screen.queryByTestId('branches-map')).not.toBeInTheDocument()
  })

  it('смена темы меняет подложку карты', async () => {
    seedSettings({ theme: 'light' })
    mockFetch(happyRoutes)
    render(
      <MemoryRouter>
        <Providers poll={false}>
          <BranchesMap pins={[{ id: 'a', point: { lat: 42.87, lng: 74.6 }, title: 'A', caption: '1 сом', tone: 'out' }]} focus={null} onFocus={() => {}} />
          <ThemeToggle />
        </Providers>
      </MemoryRouter>,
    )
    await waitFor(() => expect(maps()).toHaveLength(1))
    expect(maps()[0].style).toMatch(/positron/)
    await userEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(maps()[0].style).toMatch(/dark/))
  })
})

describe('Выбор точки магазина', () => {
  beforeEach(() => seedSettings())

  function Host({ initial = null }: { initial?: GeoPoint | null }) {
    const [point, setPoint] = useState<GeoPoint | null>(initial)
    const [address, setAddress] = useState('')
    return (
      <>
        <input aria-label="address" value={address} onChange={(e) => setAddress(e.target.value)} />
        <span data-testid="point">{point ? `${point.lat},${point.lng}` : 'none'}</span>
        <LocationPicker value={point} address={address} onChange={setPoint} onAddress={setAddress} />
      </>
    )
  }
  const host = (initial?: GeoPoint | null) =>
    render(
      <MemoryRouter>
        <Providers poll={false}>
          <Host initial={initial} />
        </Providers>
      </MemoryRouter>,
    )

  it('«Моё местоположение»: точка с телефона, адрес приходит с карты, булавка встаёт', async () => {
    mockFetch(geoRoutes)
    stubGeolocation({ ok: true, lat: 42.876612345, lng: 74.604598765 })
    host()
    await userEvent.click(await screen.findByTestId('use-location'))
    await waitFor(() => expect(screen.getByTestId('point')).toHaveTextContent('42.876612,74.604599'))
    await waitFor(() => expect(screen.getByLabelText('address')).toHaveValue('Чуй проспекти 120, Бишкек'))
    expect(await screen.findByTestId('shop-pin')).toBeInTheDocument()
    expect(maps()[0].flights.at(-1)?.center).toEqual([74.604599, 42.876612])
  })

  it('доступ к местоположению запрещён — понятное сообщение, точка не ставится', async () => {
    mockFetch(geoRoutes)
    stubGeolocation({ ok: false, code: 1 })
    host()
    await userEvent.click(await screen.findByTestId('use-location'))
    expect(await screen.findByRole('status')).toHaveTextContent('Доступ к местоположению выключен')
    expect(screen.getByTestId('point')).toHaveTextContent('none')
  })

  it('«Найти адрес» ставит точку по введённому адресу; «Убрать с карты» снимает её', async () => {
    mockFetch(geoRoutes)
    host()
    await userEvent.type(screen.getByLabelText('address'), 'Чуй 120')
    await userEvent.click(screen.getByTestId('find-address'))
    await waitFor(() => expect(screen.getByTestId('point')).toHaveTextContent('42.8766,74.6046'))
    await userEvent.click(screen.getByTestId('clear-point'))
    expect(screen.getByTestId('point')).toHaveTextContent('none')
  })

  it('клик по карте ставит булавку там, куда нажали', async () => {
    mockFetch(geoRoutes)
    host()
    await waitFor(() => expect(maps()).toHaveLength(1))
    const m = maps()[0] as unknown as { fire: (ev: string, p: unknown) => void }
    m.fire('click', { lngLat: { lat: 42.871234567, lng: 74.591234567 } })
    await waitFor(() => expect(screen.getByTestId('point')).toHaveTextContent('42.871235,74.591235'))
  })
})

describe('Адреса и точки', () => {
  it('короткий адрес: улица с домом и город', () => {
    expect(shortAddress({ road: 'Manas Ave', house_number: '47', city: 'Bishkek' })).toBe('Manas Ave 47, Bishkek')
    expect(shortAddress({ suburb: 'Asanbay', town: 'Bishkek' })).toBe('Asanbay, Bishkek')
    expect(shortAddress(undefined, 'запасной')).toBe('запасной')
  })

  it('поиск адреса: короткий запрос не отправляется, ответ превращается в точку', async () => {
    const fn = mockFetch(geoRoutes)
    expect(await geocode('Ч', 'ru')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
    expect(await geocode('Чуй 120', 'ru')).toEqual({ lat: 42.8766, lng: 74.6046 })
  })

  it('точка есть, только если обе координаты числа', () => {
    expect(hasPoint({ lat: 1, lng: 2 })).toBe(true)
    expect(hasPoint({ lat: null, lng: 2 })).toBe(false)
    expect(hasPoint({})).toBe(false)
  })
})

describe('Точка в настройках магазина', () => {
  it('новый филиал с местоположением: адрес заполняется, координаты уходят на сервер', async () => {
    seedSettings()
    let body: Record<string, unknown> = {}
    const routes: Routes = {
      ...geoRoutes,
      '/shops': (init) => {
        if (init?.method === 'POST') {
          body = JSON.parse(String(init.body))
          return jsonResponse({ id: 'shop-new', name: body.name, address: body.address, created_at: '2026-10-28T00:00:00Z', demo: false, lat: body.lat, lng: body.lng }, 201)
        }
        return happyRoutes['/shops'](init)
      },
    }
    mockFetch(routes)
    stubGeolocation({ ok: true, lat: 42.8766, lng: 74.6046 })
    renderAt('/app/settings')
    const section = await screen.findByTestId('shops-section')
    await userEvent.type(within(section).getByTestId('new-shop-name'), 'Магазин на Чуй')
    await userEvent.click(within(section).getAllByTestId('toggle-map').at(-1)!)
    await userEvent.click(await within(section).findByTestId('use-location'))
    await waitFor(() => expect(within(section).getByPlaceholderText(/Чуй 120, Бишкек/)).toHaveValue('Чуй проспекти 120, Бишкек'))
    await userEvent.click(within(section).getByTestId('add-shop'))
    await waitFor(() => expect(body).toMatchObject({ name: 'Магазин на Чуй', address: 'Чуй проспекти 120, Бишкек', lat: 42.8766, lng: 74.6046 }))
  })
})
