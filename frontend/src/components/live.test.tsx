import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AppRoutes, Providers } from '../App'
import { KGS_PER_UNIT } from '../lib/currency'
import { demoHealth, happyRoutes, health, jsonResponse, liveRoutes, mockFetch, seedSettings } from '../test/fixtures'
import { Odometer, lostSoFar, meterDecimals, timeAgo } from './Live'

function Where() {
  const { pathname } = useLocation()
  return <span data-testid="where">{pathname}</span>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Providers poll={false}>
        <AppRoutes />
        <Where />
      </Providers>
    </MemoryRouter>,
  )
}

describe('Кнопка в углу: живые данные ↔ демо', () => {
  beforeEach(() => seedSettings())

  it('живой режим → «Показать демо» → демо-сеть и тост; обратно — свои данные', async () => {
    mockFetch(liveRoutes)
    renderAt('/app')
    expect(await screen.findByTestId('first-walk')).toBeInTheDocument()
    const sw = screen.getByTestId('data-switch')
    expect(sw).toHaveAttribute('data-state', 'live')
    expect(sw).toHaveAccessibleName('Показать демо')

    await userEvent.click(sw)
    expect(await screen.findByTestId('loss-tag')).toBeInTheDocument()
    expect(screen.getByTestId('data-switch')).toHaveAttribute('data-state', 'demo')
    expect(screen.getByRole('status')).toHaveTextContent('Показываем демо-данные')
    expect(screen.getByTestId('rail-mode')).toHaveTextContent('Демо')

    await userEvent.click(screen.getByTestId('data-switch'))
    expect(await screen.findByTestId('first-walk')).toBeInTheDocument()
    expect(screen.getByTestId('data-switch')).toHaveAttribute('data-state', 'live')
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).dataMode).toBe('auto')
  })

  it('с отчёта конкретного обхода переключение уводит на последний обход нового набора', async () => {
    seedSettings({ dataMode: 'demo' })
    mockFetch(liveRoutes)
    renderAt('/app/shelves/demo-tue')
    await screen.findByTestId('changes-list')
    await userEvent.click(screen.getByTestId('data-switch'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/shelves$/))
  })

  it('сервер без кредитов: демо по умолчанию, «Вернуть мои данные» открывает свои — обходы на паузе', async () => {
    mockFetch({ ...happyRoutes, '/health': () => jsonResponse({ ...health, mode: 'demo', reason: 'billing' }) })
    renderAt('/app')
    expect(await screen.findByTestId('loss-tag')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('data-switch'))
    await waitFor(() => expect(screen.getByTestId('data-switch')).toHaveAttribute('data-state', 'live'))
    // свои данные открылись: пусто, но честно; режим — живой, причина паузы — в подсказке
    expect(await screen.findByTestId('first-walk')).toBeInTheDocument()
    expect(screen.getByTestId('rail-mode')).toHaveAttribute('title', 'новые обходы на паузе: нет кредитов на аккаунте Meta')
  })

  it('сервер лежит: плашка «Сервер недоступен», нажатие проверяет связь; вернулся — тост и снова живое', async () => {
    let up = false
    mockFetch({
      ...liveRoutes,
      '/health': () => {
        if (!up) throw new TypeError('Failed to fetch')
        return jsonResponse(health)
      },
    })
    renderAt('/app')
    const sw = await screen.findByTestId('data-switch')
    expect(sw).toHaveAttribute('data-state', 'down')
    expect(sw).toHaveTextContent('Сервер недоступен')
    // демо пришло из встроенного снимка
    expect(await screen.findByTestId('loss-tag')).toBeInTheDocument()
    up = true
    await userEvent.click(sw)
    await waitFor(() => expect(screen.getByTestId('data-switch')).toHaveAttribute('data-state', 'live'))
    expect(await screen.findByText('Сервер снова на связи')).toBeInTheDocument()
    expect(await screen.findByTestId('first-walk')).toBeInTheDocument()
  })

  it('на лендинге и в онбординге кнопки нет', async () => {
    mockFetch(liveRoutes)
    renderAt('/')
    await screen.findByTestId('landing')
    expect(screen.queryByTestId('data-switch')).not.toBeInTheDocument()
  })
})

describe('Уведомления о режиме', () => {
  beforeEach(() => seedSettings())

  it('живой режим без кредитов — «новые обходы на паузе», без слова «демо»', async () => {
    seedSettings({ dataMode: 'live' })
    mockFetch({ ...happyRoutes, '/health': () => jsonResponse(demoHealth) })
    renderAt('/app/notifications')
    const notif = await screen.findByTestId('notif')
    expect(notif).toHaveTextContent('Новые обходы на паузе: на сервере нет ключа моделей')
    expect(notif.textContent).not.toMatch(/демо/i)
  })
})

describe('Настройки: источник данных', () => {
  it('«Демо» в настройках — то же, что кнопка в углу', async () => {
    seedSettings()
    mockFetch(liveRoutes)
    renderAt('/app/settings')
    const group = await screen.findByRole('radiogroup', { name: 'Данные' })
    expect(within(group).getByRole('radio', { name: /Автоматически/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(group).getByRole('radio', { name: /Демо/ }))
    await waitFor(() => expect(screen.getByTestId('data-switch')).toHaveAttribute('data-state', 'demo'))
    expect(screen.getByLabelText('Код доступа')).toBeInTheDocument()
  })
})

describe('Живые счётчики', () => {
  it('сколько знаков: последняя цифра меняется примерно раз в секунду', () => {
    expect(meterDecimals(765, 'KGS')).toBe(3)
    expect(meterDecimals(765, 'USD')).toBe(4)
    expect(meterDecimals(0, 'USD')).toBe(2)
    expect(meterDecimals(KGS_PER_UNIT.USD * 100_000, 'USD')).toBe(2)
  })

  it('потери за сегодня считаются с полуночи', () => {
    // полдень — половина дневных потерь, шесть утра — четверть
    expect(lostSoFar(240, new Date(2026, 9, 28, 12, 0, 0).getTime())).toBeCloseTo(120)
    expect(lostSoFar(240, new Date(2026, 9, 28, 6, 0, 0).getTime())).toBeCloseTo(60)
  })

  it('«3 ч назад» по правилам языка', () => {
    const now = Date.parse('2026-10-28T12:00:00Z')
    expect(timeAgo('2026-10-28T11:59:40Z', now, 'en')).toBe('now')
    expect(timeAgo('2026-10-28T09:00:00Z', now, 'en')).toBe('3 hr. ago')
    expect(timeAgo('2026-10-28T11:55:00Z', now, 'ru')).toMatch(/5 мин\.? назад/)
  })

  it('барабаны: каждая цифра в своём окошке, разделители — отдельно', () => {
    render(<Odometer text="1 234,56 сом" testId="odo" />)
    const odo = screen.getByTestId('odo')
    expect(odo).toHaveTextContent('1 234,56 сом')
    expect(odo.querySelectorAll('.odo__slot')).toHaveLength(6)
  })
})
