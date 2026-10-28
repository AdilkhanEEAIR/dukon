import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Providers } from '../App'
import { DEVICE, demoHealth, diff, happyRoutes, health, jsonResponse, liveRoutes, mockFetch, seedSettings, shops, walk } from '../test/fixtures'
import { useLatest } from './data'
import { useMode } from './mode'
import { useNotifications } from './notifications'
import { useSettings } from './settings'
import { useShops } from './shops'

function Probe() {
  const { settings, update, resolvedTheme, deviceId } = useSettings()
  const mode = useMode()
  const { latest } = useLatest()
  const notif = useNotifications()
  const sh = useShops()
  return (
    <div>
      <span data-testid="theme">{resolvedTheme}</span>
      <span data-testid="locale">{settings.locale}</span>
      <span data-testid="currency">{settings.currency}</span>
      <span data-testid="device">{deviceId}</span>
      <span data-testid="mode">
        {mode.status}:{mode.mode}:{mode.reason ?? '-'}
      </span>
      <span data-testid="latest">{latest.status === 'success' ? `success:${latest.data?.walk.id ?? 'none'}` : latest.status}</span>
      <span data-testid="unread">{notif.unread}</span>
      <span data-testid="shops">
        {sh.status}:{sh.shops.length}:{sh.current?.id ?? '-'}
      </span>
      <button onClick={() => update({ theme: 'dark' })}>dark</button>
      <button onClick={() => update({ locale: 'ky' })}>ky</button>
      <button onClick={() => mode.setView('demo')}>force</button>
      <button onClick={() => mode.setView('live')}>tolive</button>
      <button onClick={notif.markAll}>readall</button>
      <button onClick={() => notif.markRead(notif.items[0]?.id ?? '')}>readone</button>
      <button onClick={() => sh.select('shop-2')}>select2</button>
      <button onClick={() => void sh.create('Новый', 'Адрес')}>create</button>
    </div>
  )
}

function renderProbe() {
  return render(
    <MemoryRouter>
      <Providers poll={false}>
        <Probe />
      </Providers>
    </MemoryRouter>,
  )
}

describe('SettingsProvider', () => {
  it('первый запуск: английский, доллар, светлая тема, код устройства создан', () => {
    mockFetch(happyRoutes)
    renderProbe()
    expect(screen.getByTestId('locale')).toHaveTextContent('en')
    expect(screen.getByTestId('currency')).toHaveTextContent('USD')
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    const device = screen.getByTestId('device').textContent ?? ''
    expect(device).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(localStorage.getItem('dukon.device')).toBe(device)
  })

  it('пишет тему и язык на <html> и сохраняет изменения', async () => {
    seedSettings({ theme: 'light', locale: 'ru' })
    mockFetch(happyRoutes)
    renderProbe()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.lang).toBe('ru')
    await userEvent.click(screen.getByText('dark'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).theme).toBe('dark')
    await userEvent.click(screen.getByText('ky'))
    expect(document.documentElement.lang).toBe('ky')
  })

  it('старые настройки чинятся: тема «system» и неизвестный язык', () => {
    localStorage.setItem('dukon.settings', JSON.stringify({ theme: 'system', locale: 'jp', currency: 'XXX' }))
    mockFetch(happyRoutes)
    renderProbe()
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(screen.getByTestId('locale')).toHaveTextContent('en')
    expect(screen.getByTestId('currency')).toHaveTextContent('USD')
  })

  it('битый JSON в хранилище не роняет приложение', () => {
    localStorage.setItem('dukon.settings', '{oops')
    mockFetch(happyRoutes)
    renderProbe()
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
  })
})

describe('ModeProvider', () => {
  it('live с сервера', async () => {
    mockFetch(liveRoutes)
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('ready:live:-'))
  })

  it('demo с причиной', async () => {
    mockFetch({ ...happyRoutes, '/health': () => jsonResponse(demoHealth) })
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('ready:demo:no_api_key'))
  })

  it('сервер недоступен → down + network', async () => {
    mockFetch({ ...happyRoutes, '/health': () => new Response('x', { status: 503 }) })
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('down:demo:network'))
  })

  it('кнопка в углу: демо и обратно, выбор запоминается на устройстве', async () => {
    mockFetch(liveRoutes)
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('ready:live'))
    await userEvent.click(screen.getByText('force'))
    expect(screen.getByTestId('mode')).toHaveTextContent('ready:demo:manual')
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).dataMode).toBe('demo')
    await userEvent.click(screen.getByText('tolive'))
    expect(screen.getByTestId('mode')).toHaveTextContent('ready:live:-')
    // при живом сервере возврат — снова «автоматически»: кончатся кредиты — само уйдёт в демо
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).dataMode).toBe('auto')
  })

  it('без кредитов свои данные всё равно можно открыть — новые обходы на паузе', async () => {
    mockFetch(happyRoutes)
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('ready:demo:no_api_key'))
    await userEvent.click(screen.getByText('tolive'))
    expect(screen.getByTestId('mode')).toHaveTextContent('ready:live:no_api_key')
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).dataMode).toBe('live')
  })

  it('запрос упал по сети — сервер перепроверяется сразу, приложение уходит в демо из снимка', async () => {
    seedSettings()
    let healthCalls = 0
    mockFetch({
      ...liveRoutes,
      '/health': () => {
        healthCalls += 1
        if (healthCalls === 1) return jsonResponse(health)
        throw new TypeError('Failed to fetch')
      },
      '/walks?source=live': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('down:demo:network'))
    expect(healthCalls).toBeGreaterThanOrEqual(2)
    // демо-обходы пришли из встроенного снимка, а не с сервера
    await waitFor(() => expect(screen.getByTestId('latest')).toHaveTextContent('success:demo-tue'))
  })
})

describe('ShopsProvider', () => {
  it('загружает магазины устройства, первый — текущий, выбор запоминается', async () => {
    seedSettings()
    const fn = mockFetch(happyRoutes)
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('shops')).toHaveTextContent('ready:2:shop-1'))
    const shopCall = (fn.mock.calls as [string, RequestInit][]).find(([u]) => u.endsWith('/shops'))!
    expect((shopCall[1].headers as Record<string, string>)['x-device-id']).toBe(DEVICE)
    await userEvent.click(screen.getByText('select2'))
    expect(screen.getByTestId('shops')).toHaveTextContent('ready:2:shop-2')
    expect(JSON.parse(localStorage.getItem('dukon.currentShop')!)).toBe('shop-2')
  })

  it('создание магазина делает его текущим и кладёт в кэш', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('shops')).toHaveTextContent('ready:2'))
    await userEvent.click(screen.getByText('create'))
    await waitFor(() => expect(screen.getByTestId('shops')).toHaveTextContent('ready:3:shop-new'))
    expect(JSON.parse(localStorage.getItem('dukon.shopsCache')!)).toHaveLength(3)
  })

  it('без сети показывает магазины из кэша устройства', async () => {
    seedSettings()
    localStorage.setItem('dukon.shopsCache', JSON.stringify(shops))
    mockFetch({ ...happyRoutes, '/shops': () => new Response('x', { status: 503 }) })
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('shops')).toHaveTextContent('error:2:shop-1'))
  })

  it('название магазина из прошлой версии переносится на сервер один раз', async () => {
    localStorage.setItem('dukon.settings', JSON.stringify({ shopName: 'Старый', onboarded: true, locale: 'ru' }))
    const created: string[] = []
    mockFetch({
      ...happyRoutes,
      '/shops': (init) => {
        if (init?.method === 'POST') {
          created.push(JSON.parse(String(init.body)).name)
          return jsonResponse({ id: 'shop-old', name: 'Старый', address: '', created_at: '', demo: false }, 201)
        }
        return jsonResponse([])
      },
    })
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('shops')).toHaveTextContent('ready:1:shop-old'))
    expect(created).toEqual(['Старый'])
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).shopName).toBeUndefined()
  })
})

describe('DataProvider + NotificationsProvider', () => {
  it('демо-режим: обходы демо-филиала и уведомления', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('latest')).toHaveTextContent('success:demo-tue'))
    // 3 изменения (нет/мало/ценник) + 1 про режим
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('4'))
  })

  it('живой режим: свой обход текущего магазина', async () => {
    seedSettings()
    const live = { ...walk, id: 'live-1', source: 'live' as const, shop_id: 'shop-1' }
    mockFetch({ ...liveRoutes, '/walks?source=live&shop_id=shop-1': () => jsonResponse([live]), '/walks/live-1/diff': () => jsonResponse(diff) })
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('latest')).toHaveTextContent('success:live-1'))
  })

  it('живой режим без своих обходов — пусто, демо не подмешивается', async () => {
    seedSettings()
    const fn = mockFetch(liveRoutes)
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('latest')).toHaveTextContent('success:none'))
    const urls = (fn.mock.calls as [string][]).map(([u]) => u)
    expect(urls.some((u) => u.includes('source=demo'))).toBe(false)
    // уведомление только про живой режим, без слова «демо»
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'))
  })

  it('смена магазина перезагружает данные', async () => {
    seedSettings()
    const live = { ...walk, id: 'live-2', source: 'live' as const, shop_id: 'shop-2' }
    mockFetch({ ...liveRoutes, '/walks?source=live&shop_id=shop-2': () => jsonResponse([live]), '/walks/live-2/diff': () => jsonResponse(diff) })
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('latest')).toHaveTextContent('success:none'))
    await userEvent.click(screen.getByText('select2'))
    await waitFor(() => expect(screen.getByTestId('latest')).toHaveTextContent('success:live-2'))
  })

  it('прочитанность запоминается на устройстве', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    const { unmount } = renderProbe()
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('4'))
    await userEvent.click(screen.getByText('readone'))
    expect(screen.getByTestId('unread')).toHaveTextContent('3')
    await userEvent.click(screen.getByText('readall'))
    expect(screen.getByTestId('unread')).toHaveTextContent('0')
    unmount()
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('latest')).toHaveTextContent('success'))
    expect(screen.getByTestId('unread')).toHaveTextContent('0')
  })

  it('ошибка загрузки не ломает уведомления о режиме', async () => {
    seedSettings()
    mockFetch({ '/health': () => jsonResponse(demoHealth), '/shops': () => jsonResponse(shops), '/walks': () => new Response('x', { status: 500 }) })
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('latest')).toHaveTextContent('error'))
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'))
  })
})
