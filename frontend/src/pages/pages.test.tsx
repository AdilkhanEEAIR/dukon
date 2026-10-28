import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes, Providers } from '../App'
import { DEVICE, demoHealth, diff, happyRoutes, health, jsonResponse, liveRoutes, mockFetch, mineOverview, seedSettings, shops, walk, walkBefore, type Routes } from '../test/fixtures'
import { dayKey } from '../components/WalkCalendar'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Providers poll={false}>
        <AppRoutes />
      </Providers>
    </MemoryRouter>,
  )
}

const noShops: Routes = { ...happyRoutes, '/shops': (init) => (init?.method === 'POST' ? happyRoutes['/shops'](init) : jsonResponse([])) }
const noShopsLive: Routes = { ...noShops, '/health': () => jsonResponse(health) }
const ownWalk = { ...walk, id: 'live-1', source: 'live' as const, shop_id: 'shop-1' }
const ownRoutes: Routes = { ...liveRoutes, '/walks?source=live&shop_id=shop-1': () => jsonResponse([ownWalk]), '/walks/live-1/diff': () => jsonResponse(diff), '/walks/live-1': () => jsonResponse(ownWalk) }

/** Сервер не отвечает вовсе: любой запрос падает по сети. */
function serverDown() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }),
  )
}

describe('Лендинг', () => {
  it('по умолчанию английский; без магазина кнопка ведёт в онбординг; автор в подвале', async () => {
    mockFetch(noShopsLive)
    renderAt('/')
    expect(screen.getByTestId('landing')).toBeInTheDocument()
    expect(screen.getByText(/Walk the shelves/)).toBeInTheDocument()
    expect(screen.getByTestId('shelf-art')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Open the app/ })[0]).toHaveAttribute('href', '/app/onboarding'))
    // живой сервер: вторая кнопка — «Как это работает», слова «демо» на первом экране нет
    expect(screen.getByRole('button', { name: /How it works/ })).toBeInTheDocument()
    expect(screen.queryByText(/See the demo/)).not.toBeInTheDocument()
    const footer = screen.getByTestId('landing-footer')
    expect(within(footer).getByRole('link', { name: 'Made by Adilkhan' })).toHaveAttribute('href', 'https://github.com/AdilkhanEEAIR/dukon')
  })

  it('с магазином кнопка ведёт в приложение', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    renderAt('/')
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Открыть приложение/ })[0]).toHaveAttribute('href', '/app'))
  })

  it('без моделей на сервере — «Посмотреть демо», приложение открывается без магазина', async () => {
    mockFetch(noShops)
    renderAt('/')
    await waitFor(() => expect(screen.getByRole('link', { name: /See the demo/ })).toHaveAttribute('href', '/app/shelves?demo=1'))
    expect(screen.getAllByRole('link', { name: /Open the app/ })[0]).toHaveAttribute('href', '/app')
  })

  it('ссылка ?demo=1 включает демо даже при живом сервере и без магазина', async () => {
    mockFetch(noShopsLive)
    renderAt('/app/shelves?demo=1')
    // Без настроек интерфейс английский — и названия товаров тоже: «1 л» → «1 L», «Молоко Эльвест» → «Elvest milk»
    const list = await screen.findByTestId('changes-list')
    expect(list).toHaveTextContent('Coca-Cola 1 L')
    expect(list).toHaveTextContent('Elvest milk 6% 1 L')
    expect(list).not.toHaveTextContent('Молоко')
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).dataMode).toBe('demo')
    expect(screen.getByTestId('data-switch')).toHaveAttribute('data-state', 'demo')
  })
})

describe('Ссылка на демо без кредитов', () => {
  it('?demo=1 на сервере без моделей показывает демо, но выбор не запоминает', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    renderAt('/app/shelves?demo=1')
    expect(await screen.findByTestId('changes-list')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).dataMode).not.toBe('demo')
  })
})

describe('Онбординг', () => {
  it('/app без магазинов → онбординг; пустое имя — ошибка; магазин создаётся на сервере', async () => {
    const fn = mockFetch(noShopsLive)
    renderAt('/app')
    const form = await screen.findByTestId('onboarding')
    expect(screen.getByPlaceholderText('e.g. Shop on Chuy')).toBeInTheDocument()
    expect(screen.getByText('Enter your shop name the way customers know it.')).toBeInTheDocument()
    await userEvent.click(within(form).getByTestId('onboarding-submit'))
    expect(screen.getByRole('alert')).toHaveTextContent(/name/i)
    await userEvent.type(screen.getByLabelText('Shop name'), 'Shop on Chuy')
    await userEvent.type(screen.getByLabelText('Address'), 'Chuy 120')
    await userEvent.click(within(form).getByTestId('onboarding-submit'))
    expect(await screen.findByTestId('home')).toBeInTheDocument()
    const post = (fn.mock.calls as [string, RequestInit][]).find(([u, i]) => u.endsWith('/shops') && i?.method === 'POST')!
    expect(JSON.parse(String(post[1].body))).toEqual({ name: 'Shop on Chuy', address: 'Chuy 120' })
    expect((post[1].headers as Record<string, string>)['x-device-id']).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
  })

  it('язык, валюта и тема применяются сразу; доллар первый в списке', async () => {
    mockFetch(noShops)
    renderAt('/app/onboarding')
    await screen.findByTestId('onboarding')
    await userEvent.click(screen.getByTestId('onboarding-currency'))
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('USD')
    await userEvent.click(screen.getByRole('option', { name: /KGS/ }))
    await userEvent.click(screen.getByTestId('onboarding-lang'))
    await userEvent.click(screen.getByRole('option', { name: 'Кыргызча' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Дүкөнүңүздү жөндөңүз')
    await userEvent.click(screen.getByRole('radio', { name: /Караңгы/ }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(JSON.parse(localStorage.getItem('dukon.settings')!)).toMatchObject({ currency: 'KGS', locale: 'ky', theme: 'dark' })
    expect(screen.queryByRole('radio', { name: /System|систем/i })).not.toBeInTheDocument()
  })

  it('ошибка сервера при создании показана с причиной', async () => {
    mockFetch({ ...noShops, '/shops': (init) => (init?.method === 'POST' ? jsonResponse({ detail: { code: 'too_many_shops' } }, 409) : jsonResponse([])) })
    renderAt('/app/onboarding')
    await userEvent.type(await screen.findByLabelText('Shop name'), 'X')
    await userEvent.click(screen.getByTestId('onboarding-submit'))
    expect(await screen.findByTestId('onboarding-error')).toHaveAttribute('data-code', 'too_many_shops')
  })

  it('у кого магазин уже есть — онбординг уводит на главную', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    renderAt('/app/onboarding')
    expect(await screen.findByTestId('home')).toBeInTheDocument()
  })

  it('сервер отвечает, а магазины не грузятся и в кэше их нет → понятная ошибка с повтором', async () => {
    mockFetch({ ...liveRoutes, '/shops': () => new Response('x', { status: 503 }) })
    renderAt('/app')
    expect(await screen.findByTestId('error-state')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })

  it('сервер лежит целиком → демо из встроенного снимка вместо страницы ошибки', async () => {
    serverDown()
    renderAt('/app')
    expect(await screen.findByTestId('loss-tag')).toBeInTheDocument()
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('data-switch')).toHaveAttribute('data-state', 'down')
  })
})

describe('Главная', () => {
  beforeEach(() => seedSettings())

  it('скелетон → ценник потерь, метрики, график, внимание, обходы, филиалы', async () => {
    mockFetch(happyRoutes)
    renderAt('/app')
    expect(await screen.findByTestId('home')).toBeInTheDocument()
    expect(await screen.findByTestId('total-items')).toHaveTextContent('16')
    expect(screen.getByTestId('loss-tag')).toHaveTextContent(/765/)
    expect(screen.getByTestId('loss-tag')).toHaveTextContent(/в месяц/)
    expect(screen.getAllByText('Молоко Эльвест 6% 1 л').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('walk-row')).toHaveLength(2)
    // демо-режим: в шапке и в ссылке на филиалы — демо-сеть, свои магазины не подменяются
    expect(screen.getByTestId('shop-name')).toHaveTextContent('Chuy 120')
    expect(screen.getByTestId('branches-link')).toHaveTextContent('3 магазина')
    await waitFor(() => expect(screen.getByTestId('stock-chart')).toHaveAttribute('data-ready', 'true'))
  })

  it('в долларах сумма пересчитывается, а сомы остаются подписью', async () => {
    seedSettings({ currency: 'USD' })
    mockFetch(happyRoutes)
    renderAt('/app')
    const tag = await screen.findByTestId('loss-tag')
    expect(tag).toHaveTextContent('$')
    expect(tag).toHaveTextContent('765 сом по ценникам')
  })

  it('пустое состояние без обходов', async () => {
    mockFetch({ ...happyRoutes, '/walks?source=demo': () => jsonResponse([]) })
    renderAt('/app')
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('Обходов пока нет')
  })

  it('живой режим без своих обходов — приглашение к первому обходу, демо не подмешивается', async () => {
    mockFetch(liveRoutes)
    const { container } = renderAt('/app')
    const hero = await screen.findByTestId('first-walk')
    expect(hero).toHaveTextContent('Обходов пока нет')
    expect(within(hero).getByTestId('shelf-art')).toBeInTheDocument()
    expect(within(hero).getByRole('link', { name: /Первый обход/ })).toHaveAttribute('href', '/app/scan')
    // кнопки «Новый обход» приглашают пульсом
    expect(container.querySelector('.app')).toHaveAttribute('data-invite', 'true')
    expect(screen.queryByTestId('loss-tag')).not.toBeInTheDocument()
  })

  it('живой режим: свой обход, а слова «демо» на экране нет', async () => {
    mockFetch(ownRoutes)
    const { container } = renderAt('/app')
    expect(await screen.findByText('Ваш обход')).toBeInTheDocument()
    expect(screen.getByTestId('shop-name')).toHaveTextContent('Дүкөн на Чуй')
    expect(screen.getByTestId('branches-link')).toHaveTextContent('2 магазина')
    expect(container.querySelector('main')!.textContent).not.toMatch(/демо/i)
    expect(container.querySelector('aside')!.textContent).not.toMatch(/демо/i)
    expect(screen.getByTestId('rail-mode')).toHaveTextContent('Живой')
    // кнопка в углу — тихий кружок, надпись «Показать демо» только для наведения и чтения с экрана
    expect(screen.getByTestId('data-switch')).toHaveAttribute('data-state', 'live')
  })

  it('живой счётчик потерь за сегодня тикает на барабанах', async () => {
    mockFetch(ownRoutes)
    renderAt('/app')
    const meter = await screen.findByTestId('loss-meter')
    expect(meter).toHaveTextContent('Сегодня уже потеряно')
    expect(within(meter).getByText('потеряно')).toHaveClass('loss-word')
    const first = screen.getByTestId('loss-meter-value').textContent
    await waitFor(() => expect(screen.getByTestId('loss-meter-value').textContent).not.toBe(first), { timeout: 2500 })
  })

  it('ошибка сети → повтор → данные', async () => {
    let fail = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = input.toString().replace(/^https?:\/\/[^/]+/, '')
        if (path.startsWith('/health')) return ownRoutes['/health']()
        if (path.startsWith('/shops')) return ownRoutes['/shops'](init)
        if (fail) throw new TypeError('Failed to fetch')
        const key = Object.keys(ownRoutes).find((k) => path === k) ?? Object.keys(ownRoutes).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0]
        return ownRoutes[key](init)
      }),
    )
    renderAt('/app')
    const err = await screen.findByTestId('error-state')
    expect(err).toHaveAttribute('data-code', 'network')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: /повторить/i }))
    expect(await screen.findByTestId('total-items')).toBeInTheDocument()
  })

  it('свой обход магазина помечен', async () => {
    mockFetch(ownRoutes)
    renderAt('/app')
    expect(await screen.findByText('Ваш обход')).toBeInTheDocument()
  })
})

describe('Полки и товар', () => {
  beforeEach(() => seedSettings())

  it('фильтры меняют список, шторка показывает прогноз и кладёт в черновик', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/shelves')
    const list = await screen.findByTestId('changes-list')
    expect(list).toHaveTextContent('Coca-Cola 1 л')
    await userEvent.click(screen.getByRole('tab', { name: /ценник/i }))
    expect(screen.getByTestId('changes-list')).toHaveTextContent('Кукуруза')
    // Строка уходит с анимацией: даже при skipAnimations AnimatePresence убирает её на следующем кадре,
    // а не сразу после клика. На медленной машине кадр не успевает — поэтому ждём, а не проверяем мгновенно.
    await waitFor(() => expect(screen.getByTestId('changes-list')).not.toHaveTextContent('Coca-Cola'))
    await userEvent.click(screen.getByRole('tab', { name: /^нет/i }))
    await userEvent.click(within(screen.getByTestId('changes-list')).getByText('Молоко Эльвест 6% 1 л'))
    const drawer = await screen.findByTestId('drawer')
    expect(within(drawer).getByTestId('after-count')).toHaveTextContent('0')
    expect(within(drawer).getByTestId('forecast-caption')).toHaveTextContent('Уже закончился')
    await userEvent.click(within(drawer).getByTestId('to-draft'))
    expect(await screen.findByRole('status')).toHaveTextContent(/черновик/i)
  })

  it('обход по id: история того же магазина', async () => {
    const fn = mockFetch(happyRoutes)
    renderAt('/app/shelves/demo-sun')
    expect(await screen.findByText(/первый обход/i)).toBeInTheDocument()
    expect((fn.mock.calls as [string][]).some(([u]) => u.includes('/walks?source=demo&shop_id=demo-chuy'))).toBe(true)
  })

  it('календарь: неделя вкладками, день с обходом открывает его отчёт, месяц — по кнопке', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/shelves/demo-tue')
    const cal = await screen.findByTestId('walk-calendar')
    const tueKey = dayKey(new Date(walk.created_at))
    const sunKey = dayKey(new Date(walkBefore.created_at))
    expect(within(cal).getByTestId(`day-${tueKey}`)).toHaveAttribute('aria-selected', 'true')
    // день без обхода неактивен
    const tabs = within(cal).getAllByRole('tab')
    expect(tabs).toHaveLength(7)
    expect(tabs.filter((t) => (t as HTMLButtonElement).disabled).length).toBeGreaterThanOrEqual(5)
    // месяц: открывается по кнопке, выделенные дни — с обходами
    await userEvent.click(within(cal).getByTestId('calendar-open'))
    expect(await screen.findByTestId('calendar')).toBeInTheDocument()
    expect(screen.getByTestId(`cal-${sunKey}`)).not.toBeDisabled()
    await userEvent.click(screen.getByTestId(`cal-${sunKey}`))
    // выбранный день открывает свой обход: у воскресного нет предыдущего
    expect(await screen.findByText(/первый обход/i)).toBeInTheDocument()
    expect(within(screen.getByTestId('walk-calendar')).getByTestId(`day-${sunKey}`)).toHaveAttribute('aria-selected', 'true')
  })

  it('названия товаров и пояснения — на языке интерфейса', async () => {
    seedSettings({ locale: 'en' })
    mockFetch(happyRoutes)
    renderAt('/app/shelves')
    const list = await screen.findByTestId('changes-list')
    await userEvent.click(within(list).getByText('Elvest milk 6% 1 L'))
    const drawer = await screen.findByTestId('drawer')
    expect(within(drawer).getByRole('heading', { level: 2 })).toHaveTextContent('Elvest milk 6% 1 L')
    expect(within(drawer).getByText(/the shelf is empty/)).toBeInTheDocument()
  })

  it('не найденный обход → понятная ошибка', async () => {
    mockFetch({ ...happyRoutes, '/walks/zzz': () => jsonResponse({ detail: { code: 'not_found' } }, 404), '/walks/zzz/diff': () => jsonResponse({ detail: { code: 'not_found' } }, 404) })
    renderAt('/app/shelves/zzz')
    expect(await screen.findByTestId('error-state')).toHaveAttribute('data-code', 'not_found')
  })

  it('товар по ссылке и «не найден»', async () => {
    mockFetch(happyRoutes)
    const { unmount } = renderAt(`/app/item/${encodeURIComponent('coca cola 1 л')}`)
    expect(await screen.findByTestId('forecast-caption')).toHaveTextContent(/Закончится примерно через/)
    unmount()
    renderAt('/app/item/nope')
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('Товар не найден')
  })
})

describe('Обход', () => {
  beforeEach(() => seedSettings())

  it('кнопка заблокирована без фото; HEIC — плашка; убрать — удаляет', async () => {
    mockFetch(liveRoutes)
    renderAt('/app/scan')
    const submit = await screen.findByTestId('submit')
    expect(submit).toBeDisabled()
    await userEvent.upload(screen.getByTestId('file-input'), new File(['a'], 'IMG_7423.HEIC', { type: '' }))
    expect(screen.getByText('HEIC')).toBeInTheDocument()
    expect(submit).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /убрать/i }))
    expect(screen.queryByTestId('thumbs')).not.toBeInTheDocument()
  })

  it('демо-режим на сервере → предупреждение, кнопка заблокирована', async () => {
    mockFetch({ ...happyRoutes, '/health': () => jsonResponse(demoHealth) })
    renderAt('/app/scan')
    expect(await screen.findByText(/живой режим выключен/i)).toBeInTheDocument()
    await userEvent.upload(screen.getByTestId('file-input'), new File(['a'], 'a.jpg', { type: 'image/jpeg' }))
    expect(screen.getByTestId('submit')).toBeDisabled()
  })

  it('ошибки: лимит с повтором, биллинг без повтора', async () => {
    let code = 'rate_limited'
    mockFetch({ ...liveRoutes, '/walks/analyze': () => jsonResponse({ detail: { code, retryable: code === 'rate_limited' } }, code === 'rate_limited' ? 429 : 502) })
    renderAt('/app/scan')
    await screen.findByTestId('submit')
    await userEvent.upload(screen.getByTestId('file-input'), new File(['a'], 'a.jpg', { type: 'image/jpeg' }))
    await userEvent.click(screen.getByTestId('submit'))
    let err = await screen.findByTestId('inline-error')
    expect(err).toHaveAttribute('data-code', 'rate_limited')
    expect(within(err).getByRole('button', { name: /повторить/i })).toBeInTheDocument()
    code = 'billing'
    await userEvent.click(screen.getByTestId('submit'))
    await waitFor(() => expect(screen.getByTestId('inline-error')).toHaveAttribute('data-code', 'billing'))
    err = screen.getByTestId('inline-error')
    expect(within(err).queryByRole('button')).not.toBeInTheDocument()
  })

  it('успех: обход уходит в текущий магазин, затем отчёт', async () => {
    const live = { ...walk, id: 'live-9', source: 'live' as const, shop_id: 'shop-1' }
    const fn = mockFetch({ ...liveRoutes, '/walks/analyze': () => jsonResponse(live, 201), '/walks/live-9/diff': () => jsonResponse(diff), '/walks/live-9': () => jsonResponse(live) })
    const { container } = renderAt('/app/scan')
    await screen.findByTestId('submit')
    // в живом режиме ни «демо-кода», ни «показать демо-результат»
    expect(container.querySelector('main')!.textContent).not.toMatch(/демо/i)
    await userEvent.type(screen.getByLabelText(/код доступа/i), 'dukon-judge')
    await userEvent.upload(screen.getByTestId('file-input'), new File(['a'], 'a.jpg', { type: 'image/jpeg' }))
    await userEvent.click(screen.getByTestId('submit'))
    await waitFor(() => expect(screen.getByTestId('changes-list')).toBeInTheDocument(), { timeout: 3000 })
    const call = (fn.mock.calls as [string, RequestInit][]).find(([u]) => u.includes('/walks/analyze'))!
    expect(call[0]).toContain('shop_id=shop-1')
    expect((call[1].headers as Record<string, string>)['x-device-id']).toBe(DEVICE)
  })

  it('обход из демо-режима возвращает приложение к своим данным', async () => {
    seedSettings({ dataMode: 'demo' })
    const live = { ...walk, id: 'live-9', source: 'live' as const, shop_id: 'shop-1' }
    mockFetch({ ...liveRoutes, '/walks/analyze': () => jsonResponse(live, 201), '/walks/live-9/diff': () => jsonResponse(diff), '/walks/live-9': () => jsonResponse(live) })
    renderAt('/app/scan')
    expect(await screen.findByTestId('scan-from-demo')).toHaveTextContent('Дүкөн на Чуй')
    await userEvent.upload(screen.getByTestId('file-input'), new File(['a'], 'a.jpg', { type: 'image/jpeg' }))
    await userEvent.click(screen.getByTestId('submit'))
    await waitFor(() => expect(screen.getByTestId('changes-list')).toBeInTheDocument(), { timeout: 3000 })
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).dataMode).toBe('auto')
    await waitFor(() => expect(screen.getByTestId('data-switch')).toHaveAttribute('data-state', 'live'))
  })

  it('без своего магазина обход не начинается — сначала настроить магазин', async () => {
    localStorage.removeItem('dukon.shopsCache')
    mockFetch(noShops)
    renderAt('/app/scan')
    const empty = await screen.findByTestId('empty-state')
    expect(empty).toHaveTextContent('Сначала настройте магазин')
    expect(within(empty).getByRole('link', { name: /Настроить магазин/ })).toHaveAttribute('href', '/app/onboarding')
  })
})

describe('Филиалы', () => {
  beforeEach(() => seedSettings())

  it('демо-режим — демо-сеть: сумма, график, три филиала', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/branches')
    expect(await screen.findByText(/демо-сеть из трёх филиалов/)).toBeInTheDocument()
    expect(screen.getAllByTestId('branch-row')).toHaveLength(3)
    // 765 + 1248 + 0 сом в день по трём филиалам
    // сумма в сомах и рядом — в долларах по курсу НБКР
    expect(screen.getByTestId('branches-total').getAttribute('aria-label')).toMatch(/^2\s013\sсом \(≈ 23,02\s\$\)$/)
    expect(screen.getByTestId('branches-worst')).toHaveTextContent('Больше всего теряет: Manas 47')
    // слово о потерях — красным и жирным, отдельным элементом
    expect(within(screen.getByTestId('branches-worst')).getByText('теряет')).toHaveClass('loss-word')
    expect(within(screen.getByTestId('branches-total-label')).getByText('теряют')).toHaveClass('loss-word')
    await waitFor(() => expect(screen.getByTestId('branches-chart')).toHaveAttribute('data-ready', 'true'))
  })

  it('свои филиалы с обходами — без демо, можно сделать текущим', async () => {
    const mine = [{ ...mineOverview[0], walks: 1, last_walk_id: 'live-1', last_walk_at: '2026-10-28T00:00:00Z', loss_per_day: 100 }, mineOverview[1]]
    mockFetch({ ...liveRoutes, '/branches/overview?scope=mine': () => jsonResponse(mine) })
    renderAt('/app/branches')
    const rows = await screen.findAllByTestId('branch-row')
    expect(screen.queryByText(/демо-сеть/)).not.toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('Обходов ещё нет')
    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Сделать текущим' }))
    expect(await screen.findByTestId('home')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('dukon.currentShop')!)).toBe('shop-2')
  })

  it('живой режим без обходов — только свои филиалы, демо-сеть не подставляется', async () => {
    const fn = mockFetch(liveRoutes)
    const { container } = renderAt('/app/branches')
    const rows = await screen.findAllByTestId('branch-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Дүкөн на Чуй')
    expect(container.querySelector('main')!.textContent).not.toMatch(/демо/i)
    expect((fn.mock.calls as [string][]).some(([u]) => u.includes('scope=demo'))).toBe(false)
  })
})

describe('Заказы', () => {
  beforeEach(() => seedSettings())
  it('строки из рекомендаций, степпер меняет итог', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/orders')
    const lines = await screen.findAllByTestId('order-line')
    expect(lines).toHaveLength(2)
    const total = screen.getByTestId('order-total')
    const before = total.textContent
    await userEvent.click(within(lines[0]).getByRole('button', { name: '+' }))
    expect(total.textContent).not.toBe(before)
    await userEvent.click(within(lines[0]).getByRole('button', { name: '−' }))
    expect(total.textContent).toBe(before)
    // итог в сомах — с подписью в долларах
    expect(total).toHaveTextContent('≈')
  })
  it('пусто, когда заказывать нечего', async () => {
    mockFetch({ ...happyRoutes, '/walks/demo-tue/diff': () => jsonResponse({ ...diff, changes: diff.changes.map((c) => ({ ...c, suggested_order: 0 })) }) })
    renderAt('/app/orders')
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('Заказы собираются')
  })
})

describe('Настройки', () => {
  beforeEach(() => seedSettings())

  it('филиалы: добавить, переименовать, удалить в два нажатия', async () => {
    const calls: string[] = []
    mockFetch({
      ...happyRoutes,
      '/shops/shop-2': (init) => {
        calls.push(init?.method ?? 'GET')
        return init?.method === 'DELETE' ? jsonResponse({ deleted: 'shop-2' }) : jsonResponse({ ...shops[1], name: 'Манас 2' })
      },
    })
    renderAt('/app/settings')
    const section = await screen.findByTestId('shops-section')
    await waitFor(() => expect(within(section).getAllByTestId('shop-row')).toHaveLength(2))

    await userEvent.type(within(section).getByTestId('new-shop-name'), 'Ош базар')
    await userEvent.click(within(section).getByTestId('add-shop'))
    await waitFor(() => expect(within(section).getAllByTestId('shop-row')).toHaveLength(3))

    const row2 = within(section).getAllByTestId('shop-row')[1]
    await userEvent.click(within(row2).getByRole('button', { name: 'Изменить' }))
    const edit = within(section).getByTestId('shop-edit')
    const nameInput = within(edit).getByLabelText('Название магазина')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Манас 2')
    await userEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }))
    expect(await within(section).findByText('Манас 2')).toBeInTheDocument()

    const row = within(section).getAllByTestId('shop-row')[1]
    await userEvent.click(within(row).getByTestId('delete-shop'))
    await userEvent.click(within(row).getByTestId('confirm-delete'))
    await waitFor(() => expect(within(section).getAllByTestId('shop-row')).toHaveLength(2))
    expect(calls).toEqual(['PATCH', 'DELETE'])
  })

  it('последний магазин удалить нельзя', async () => {
    mockFetch({ ...happyRoutes, '/shops': () => jsonResponse([shops[0]]) })
    renderAt('/app/settings')
    const row = await screen.findByTestId('shop-row')
    await userEvent.click(within(row).getByTestId('delete-shop'))
    expect(await screen.findByRole('status')).toHaveTextContent('Должен остаться хотя бы один магазин')
  })

  it('язык и валюта через выпадающие списки, тема — светлая/тёмная', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/settings')
    await userEvent.click(await screen.findByTestId('settings-lang'))
    await userEvent.click(screen.getByRole('option', { name: 'Français' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Réglages')
    await userEvent.click(screen.getByTestId('settings-currency'))
    await userEvent.click(screen.getByRole('option', { name: /EUR/ }))
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).currency).toBe('EUR')
    // тема: светлая/тёмная; анимации: как в системе/все/спокойные; данные: автоматически/мои/демо
    expect(screen.getAllByRole('radio')).toHaveLength(8)
  })

  it('анимации: «как в системе» при системном «меньше движения» — спокойные, «Все» включает полные', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/settings')
    // matchMedia в тестах говорит «уменьшить движение» — поэтому подсказка и спокойный режим
    expect(await screen.findByTestId('motion-system-note')).toBeInTheDocument()
    expect(document.documentElement.dataset.motion).toBe('calm')
    await userEvent.click(screen.getByRole('radio', { name: /Все/ }))
    expect(document.documentElement.dataset.motion).toBe('full')
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).motion).toBe('full')
    expect(screen.queryByTestId('motion-system-note')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Спокойные/ }))
    expect(document.documentElement.dataset.motion).toBe('calm')
  })

  it('код устройства: копировать, привязать чужой, неверный код отклоняется', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/settings')
    expect(await screen.findByTestId('device-code')).toHaveTextContent(DEVICE)
    await userEvent.click(screen.getByRole('button', { name: 'Копировать' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(DEVICE)
    await userEvent.type(screen.getByLabelText('Код с другого устройства'), 'bad')
    await userEvent.click(screen.getByTestId('link-device'))
    expect(await screen.findByText(/от 8 до 64/)).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Код с другого устройства'))
    await userEvent.type(screen.getByLabelText('Код с другого устройства'), 'device-other-9999')
    await userEvent.click(screen.getByTestId('link-device'))
    await waitFor(() => expect(screen.getByTestId('device-code')).toHaveTextContent('device-other-9999'))
    expect(localStorage.getItem('dukon.device')).toBe('device-other-9999')
  })

  it('сброс уводит в онбординг и отвязывает устройство', async () => {
    mockFetch({ ...happyRoutes, '/shops': (init) => (init?.method === 'POST' ? happyRoutes['/shops'](init) : jsonResponse(localStorage.getItem('dukon.device') === DEVICE ? shops : [])) })
    renderAt('/app/settings')
    await userEvent.click(await screen.findByTestId('reset'))
    expect(await screen.findByTestId('onboarding')).toBeInTheDocument()
    expect(localStorage.getItem('dukon.device')).not.toBe(DEVICE)
  })

  it('ссылки «О Dukon» и автор', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/settings')
    expect((await screen.findAllByRole('link', { name: /О Dukon/ }))[0]).toHaveAttribute('href', '/')
    expect(screen.getAllByRole('link', { name: 'Сделал Адилхан' }).length).toBeGreaterThan(0)
  })
})

describe('Уведомления, система, агент, оболочка', () => {
  beforeEach(() => seedSettings())

  it('уведомления: список, прочитать все, переход к товару', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/notifications')
    await waitFor(() => expect(screen.getAllByTestId('notif')).toHaveLength(4))
    expect(screen.getAllByTestId('notif')[0]).toHaveClass('notif--unread')
    await userEvent.click(screen.getByTestId('mark-all'))
    await waitFor(() => expect(screen.queryByTestId('mark-all')).not.toBeInTheDocument())
    await userEvent.click(screen.getAllByTestId('notif')[0])
    expect(await screen.findByTestId('item-page')).toBeInTheDocument()
  })

  it('система: бюджет и провайдер; без сервера — ошибка', async () => {
    mockFetch(liveRoutes)
    const { unmount } = renderAt('/app/system')
    expect(await screen.findByTestId('calls-today')).toHaveTextContent('2 / 60')
    unmount()
    localStorage.setItem('dukon.shopsCache', JSON.stringify(shops))
    mockFetch({ ...happyRoutes, '/health': () => new Response('x', { status: 503 }) })
    renderAt('/app/system')
    expect(await screen.findByRole('heading', { name: /сервер недоступен/i })).toBeInTheDocument()
    // и кнопка в углу честно говорит то же самое, нажатие — проверить ещё раз
    expect(screen.getByTestId('data-switch')).toHaveAttribute('data-state', 'down')
  })

  it('агент: правила', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/agent')
    expect(await screen.findByText(/Агент ещё не подключён/)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('офлайн-баннер при потере сети', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/orders')
    await screen.findByTestId('orders')
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    window.dispatchEvent(new Event('offline'))
    expect(await screen.findByTestId('offline-banner')).toBeInTheDocument()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('неизвестный адрес внутри приложения → 404', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/whatever')
    expect(await screen.findByTestId('not-found')).toBeInTheDocument()
  })

  it('навигация: филиалы в рейле, агент в таббаре, ни одной точки у пилюль', async () => {
    mockFetch(happyRoutes)
    renderAt('/app')
    await screen.findByTestId('home')
    expect(screen.getAllByRole('link', { name: /Филиалы/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /Агент/ }).length).toBeGreaterThan(0)
    expect(document.querySelector('.pill__dot, .notif__unread, .step__dot')).toBeNull()
  })
})
