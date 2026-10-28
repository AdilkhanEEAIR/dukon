import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { ItemChange } from '../api/types'
import { Providers, transitionKey } from '../App'
import { productName } from '../i18n/products'
import { translate } from '../i18n'
import { beginActivity, endActivity } from '../lib/activity'
import { bump } from '../lib/fly'
import { reasonOf } from '../lib/reason'
import { useRipple } from '../hooks/useRipple'
import { diff, happyRoutes, mockFetch, seedSettings, walk, walkBefore } from '../test/fixtures'
import { LogoMark } from './Logo'
import { Money } from './Money'
import { Ticker } from './Ticker'
import { TopLoader } from './TopLoader'
import { dayKey, groupByDay, weekEndFor } from './WalkCalendar'

function withApp(ui: ReactNode, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Providers poll={false}>{ui}</Providers>
    </MemoryRouter>,
  )
}

describe('Деньги', () => {
  it('в сомах — рядом «≈ $» по курсу НБКР', () => {
    seedSettings({ currency: 'KGS' })
    mockFetch(happyRoutes)
    withApp(<Money kgs={874.5} testId="m" />)
    const m = screen.getByTestId('m')
    expect(m).toHaveTextContent(/875\sсом/)
    expect(m).toHaveTextContent(/≈ 10,00\s\$/)
    expect(m.getAttribute('aria-label')).toMatch(/875\sсом \(≈ 10,00\s\$\)/)
  })

  it('в долларах подписи «≈» нет; пусто — прочерк; ноль без подписи', () => {
    seedSettings({ currency: 'USD', locale: 'en' })
    mockFetch(happyRoutes)
    withApp(
      <>
        <Money kgs={874.5} testId="usd" />
        <Money kgs={null} testId="none" />
        <Money kgs={0} testId="zero" />
      </>,
    )
    expect(screen.getByTestId('usd')).toHaveTextContent('$10.00')
    expect(screen.getByTestId('usd')).not.toHaveTextContent('≈')
    expect(screen.getByTestId('none')).toHaveTextContent('—')
    expect(screen.getByTestId('zero')).not.toHaveTextContent('≈')
  })

  it('цена с копейками на ценнике остаётся с копейками', () => {
    seedSettings({ currency: 'KGS' })
    mockFetch(happyRoutes)
    withApp(<Money kgs={42.5} kind="price" noAlt testId="p" />)
    expect(screen.getByTestId('p')).toHaveTextContent(/42,50\sсом/)
  })
})

describe('Число со щелчком', () => {
  it('показывает новое значение после изменения', async () => {
    function Counter() {
      const [n, setN] = useState(1)
      return (
        <>
          <Ticker value={n} testId="t" />
          <button type="button" onClick={() => setN(n + 1)}>
            +
          </button>
        </>
      )
    }
    render(<Counter />)
    expect(screen.getByTestId('t')).toHaveTextContent('1')
    await userEvent.click(screen.getByRole('button', { name: '+' }))
    expect(await screen.findByText('2')).toBeInTheDocument()
  })
})

describe('Названия товаров', () => {
  it('демо-товары переведены, у прочих переводятся единицы', () => {
    expect(productName('Молоко Эльвест 6% 1 л', 'en')).toBe('Elvest milk 6% 1 L')
    expect(productName('Хлеб нарезной', 'de')).toBe('Toastbrot')
    expect(productName('Кукуруза консервированная', 'fr')).toBe('Maïs en conserve')
    expect(productName('Масло сливочное 180 г', 'ky')).toBe('Сары май 180 г')
    expect(productName('Coca-Cola 1 л', 'en')).toBe('Coca-Cola 1 L')
    expect(productName('Coca-Cola 1 л', 'de')).toBe('Coca-Cola 1 l')
    expect(productName('Cheetos 55 г', 'es')).toBe('Cheetos 55 g')
    // русский — как на ценнике, неизвестное кыргызское — тоже
    expect(productName('Coca-Cola 1 л', 'ru')).toBe('Coca-Cola 1 л')
    expect(productName('Что-то 2 л', 'ky')).toBe('Что-то 2 л')
  })

  it('пояснение статуса собирается на языке интерфейса', () => {
    const t = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate('en', k, p)
    const out = diff.changes.find((c) => c.status === 'out_of_stock') as ItemChange
    expect(reasonOf(out, t, 'en', 'USD')).toBe(`Was ${out.before}, now 0 — the shelf is empty`)
    const price = diff.changes.find((c) => c.status === 'price_mismatch') as ItemChange
    expect(reasonOf(price, t, 'en', 'KGS')).toMatch(/^Price tag changed: .+ → .+$/)
    const ok = { ...out, status: 'ok' as const, velocity_per_day: 0 }
    expect(reasonOf(ok, t, 'en', 'USD')).toBe('No change')
  })
})

describe('Календарь обходов: расчёты', () => {
  it('обходы группируются по дням', () => {
    const map = groupByDay([walk, walkBefore])
    expect([...map.keys()]).toEqual([dayKey(new Date(walkBefore.created_at)), dayKey(new Date(walk.created_at))])
  })

  it('неделя заканчивается сегодня, если обход свежий, иначе — через три дня после него', () => {
    const today = new Date(2026, 10, 3)
    expect(dayKey(weekEndFor(new Date(2026, 10, 2), today))).toBe('2026-11-03')
    expect(dayKey(weekEndFor(new Date(2026, 9, 20), today))).toBe('2026-10-23')
  })
})

describe('Отклик интерфейса', () => {
  it('полоса загрузки видна, пока идёт запрос', () => {
    seedSettings()
    mockFetch(happyRoutes)
    withApp(<TopLoader />)
    act(() => beginActivity())
    expect(screen.getByTestId('top-loader')).toHaveAttribute('data-busy', 'true')
    act(() => endActivity())
  })

  it('нажатие на кнопку пускает волну, на неактивную — нет', () => {
    function Host() {
      useRipple()
      return (
        <>
          <button type="button" className="btn" data-testid="on">
            ok
          </button>
          <button type="button" className="btn" disabled data-testid="off">
            no
          </button>
        </>
      )
    }
    document.documentElement.dataset.motion = 'full'
    render(<Host />)
    fireEvent.pointerDown(screen.getByTestId('on'), { button: 0, clientX: 5, clientY: 5 })
    expect(screen.getByTestId('on').querySelector('.ripple-host .ripple')).not.toBeNull()
    fireEvent.pointerDown(screen.getByTestId('off'), { button: 0 })
    expect(screen.getByTestId('off').querySelector('.ripple-host')).toBeNull()
  })

  it('цель «подпрыгивает» и подсвечивается', () => {
    const el = document.createElement('a')
    document.body.appendChild(el)
    bump(el)
    expect(el).toHaveClass('is-bumped')
    el.remove()
  })

  it('смена обхода внутри полок — не смена страницы', () => {
    expect(transitionKey('/app/shelves/demo-tue')).toBe('/app/shelves')
    expect(transitionKey('/app/shelves')).toBe('/app/shelves')
    expect(transitionKey('/app/orders')).toBe('/app/orders')
  })

  it('знак Dukon — рисунок магазинчика, а не буква', () => {
    const { container } = render(<LogoMark size={40} />)
    const svg = container.querySelector('svg.logo-mark')!
    expect(svg).toHaveAttribute('width', '40')
    expect(svg.querySelector('text')).toBeNull()
    // козырёк, витрина, дверь — несколько фигур, а не один символ
    expect(svg.querySelectorAll('rect, path, circle').length).toBeGreaterThan(10)
  })
})
