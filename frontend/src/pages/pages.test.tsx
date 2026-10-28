import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes, Shell } from '../App'
import { ToastProvider } from '../components/Toast'
import { diff, health, jsonResponse, mockFetch, walk } from '../test/fixtures'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Shell>
          <AppRoutes />
        </Shell>
      </ToastProvider>
    </MemoryRouter>,
  )
}

const happyRoutes = {
  '/health': () => jsonResponse(health),
  '/walks?source=live': () => jsonResponse([]),
  '/walks?source=demo': () => jsonResponse([walk]),
  '/walks/demo-tue/diff': () => jsonResponse(diff),
  '/walks/demo-tue': () => jsonResponse(walk),
}

describe('Главная', () => {
  it('скелетон → данные: потери, счётчики, список внимания', async () => {
    mockFetch(happyRoutes)
    renderAt('/')
    expect(screen.getByTestId('skeleton')).toBeInTheDocument()
    expect(await screen.findByTestId('total-items')).toHaveTextContent('16')
    expect(screen.getByTestId('loss-card')).toHaveTextContent('765 сом')
    expect(screen.getByText('Молоко Эльвест 6% 1 л')).toBeInTheDocument()
    expect(screen.queryByText('Масло сливочное 180 г')).not.toBeInTheDocument() // ok-позиции не в «внимании»
  })

  it('пустое состояние, когда обходов нет', async () => {
    mockFetch({ ...happyRoutes, '/walks?source=demo': () => jsonResponse([]) })
    renderAt('/')
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('Обходов пока нет')
  })

  it('ошибка сети с кнопкой повтора, повтор грузит данные', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (fail) throw new TypeError('Failed to fetch')
      const path = input.toString().replace(/^https?:\/\/[^/]+/, '')
      const key = Object.keys(happyRoutes).find((k) => path === k || path.startsWith(k))!
      return happyRoutes[key as keyof typeof happyRoutes]()
    }))
    renderAt('/')
    const err = await screen.findByTestId('error-state')
    expect(err).toHaveAttribute('data-code', 'network')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: /повторить/i }))
    expect(await screen.findByTestId('total-items')).toBeInTheDocument()
  })

  it('живые обходы важнее демо', async () => {
    const live = { ...walk, id: 'live-1', source: 'live' as const, label: 'Мой обход' }
    mockFetch({ ...happyRoutes, '/walks?source=live': () => jsonResponse([live]), '/walks/live-1/diff': () => jsonResponse(diff) })
    renderAt('/')
    expect(await screen.findByText('Мой обход')).toBeInTheDocument()
    expect(screen.getByText('Живой обход')).toBeInTheDocument()
  })
})

describe('Отчёт', () => {
  it('фильтр по статусу меняет список', async () => {
    mockFetch(happyRoutes)
    renderAt('/report/demo-tue')
    const list = await screen.findByTestId('changes-list')
    expect(list).toHaveTextContent('Coca-Cola 1 л')
    await userEvent.click(screen.getByRole('tab', { name: /ценник/i }))
    expect(screen.getByTestId('changes-list')).toHaveTextContent('Кукуруза')
    expect(screen.getByTestId('changes-list')).not.toHaveTextContent('Coca-Cola')
    await userEvent.click(screen.getByRole('tab', { name: /^нет/i }))
    expect(screen.getByTestId('changes-list')).toHaveTextContent('Молоко')
  })

  it('404 обхода → понятная ошибка', async () => {
    mockFetch({ ...happyRoutes, '/walks/zzz': () => jsonResponse({ detail: { code: 'not_found', message: 'нет' } }, 404) })
    renderAt('/report/zzz')
    expect(await screen.findByTestId('error-state')).toHaveAttribute('data-code', 'not_found')
  })

  it('клик по строке ведёт на карточку товара', async () => {
    mockFetch(happyRoutes)
    renderAt('/report/demo-tue')
    await userEvent.click(await screen.findByText('Молоко Эльвест 6% 1 л'))
    expect(await screen.findByTestId('after-count')).toHaveTextContent('0')
    expect(screen.getByText(/765 сом/)).toBeInTheDocument()
  })
})

describe('Карточка товара', () => {
  it('не найденный товар → пустое состояние', async () => {
    mockFetch(happyRoutes)
    renderAt('/item/nope')
    expect(await screen.findByTestId('empty-state')).toHaveTextContent('Товар не найден')
  })
})

describe('Обход', () => {
  it('кнопка заблокирована без фото, разблокируется после выбора', async () => {
    mockFetch(happyRoutes)
    renderAt('/scan')
    const submit = await screen.findByTestId('submit')
    expect(submit).toBeDisabled()
    const file = new File(['abc'], 'shelf.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByTestId('file-input'), file)
    expect(screen.getByTestId('thumbs')).toBeInTheDocument()
    expect(submit).toBeEnabled()
    expect(submit).toHaveTextContent('Разобрать 1 фото')
  })

  it('живой режим выключен → предупреждение и кнопка заблокирована', async () => {
    mockFetch({ ...happyRoutes, '/health': () => jsonResponse({ ...health, live_enabled: false }) })
    renderAt('/scan')
    expect(await screen.findByText(/живой режим выключен/i)).toBeInTheDocument()
    await userEvent.upload(screen.getByTestId('file-input'), new File(['a'], 'a.jpg', { type: 'image/jpeg' }))
    expect(screen.getByTestId('submit')).toBeDisabled()
  })

  it('ошибка сервера показывается с причиной и кнопкой «Ещё раз»', async () => {
    mockFetch({ ...happyRoutes, '/walks/analyze': () => jsonResponse({ detail: { code: 'rate_limited', message: 'x' } }, 429) })
    renderAt('/scan')
    await screen.findByTestId('submit')
    await userEvent.upload(screen.getByTestId('file-input'), new File(['a'], 'a.jpg', { type: 'image/jpeg' }))
    await userEvent.click(screen.getByTestId('submit'))
    const err = await screen.findByTestId('inline-error')
    expect(err).toHaveAttribute('data-code', 'rate_limited')
    expect(screen.getByText(/слишком много обходов/i)).toBeInTheDocument()
  })

  it('успех: конвейер, тост, переход на отчёт', async () => {
    const live = { ...walk, id: 'live-9', source: 'live' as const }
    mockFetch({ ...happyRoutes, '/walks/analyze': () => jsonResponse(live, 201), '/walks/live-9/diff': () => jsonResponse(diff), '/walks/live-9': () => jsonResponse(live) })
    renderAt('/scan')
    await screen.findByTestId('submit')
    await userEvent.upload(screen.getByTestId('file-input'), new File(['a'], 'a.jpg', { type: 'image/jpeg' }))
    await userEvent.click(screen.getByTestId('submit'))
    await waitFor(() => expect(screen.getByTestId('changes-list')).toBeInTheDocument(), { timeout: 3000 })
  })
})

describe('Оболочка', () => {
  it('офлайн-баннер появляется при потере сети', async () => {
    mockFetch(happyRoutes)
    renderAt('/orders')
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    window.dispatchEvent(new Event('offline'))
    expect(await screen.findByTestId('offline-banner')).toBeInTheDocument()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('неизвестный адрес → 404', async () => {
    mockFetch(happyRoutes)
    renderAt('/whatever')
    expect(await screen.findByText('Такой страницы нет')).toBeInTheDocument()
  })
})
