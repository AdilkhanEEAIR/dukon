import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderHook } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { useScrollReveal } from '../hooks/useScrollReveal'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '../api/client'
import { Providers } from '../App'
import { I18nProvider } from '../i18n'
import { KGS_PER_UNIT } from '../lib/currency'
import { chartOptions, diff, happyRoutes, liveRoutes, mockFetch, seedSettings } from '../test/fixtures'
import { Button, IconButton } from './Button'
import { BranchesChart, ForecastChart, StockChart, forecastPoints } from './charts/Charts'
import { CountUp } from './CountUp'
import { Drawer } from './Drawer'
import { Dropdown } from './Dropdown'
import { ChoiceRow, Switch } from './Fields'
import { AuthorLine, LangSwitch, ModePill, ShopSwitcher, ThemeToggle } from './Nav'
import { Pill, StatusPill } from './Pill'
import { LossTag } from './PriceTag'
import { ProductIcon, productKind } from './ProductIcon'
import { MoonGlyph, SunGlyph } from './ThemeIcon'
import { Segmented } from './Segmented'
import { ShelfArt } from './ShelfArt'
import { EmptyState, ErrorState, Notice, ReportSkeleton } from './States'
import { ToastProvider, useToast } from './Toast'

function withI18n(ui: ReactNode, locale: 'en' | 'ru' = 'ru') {
  return render(
    <MemoryRouter>
      <I18nProvider locale={locale} setLocale={() => {}}>
        {ui}
      </I18nProvider>
    </MemoryRouter>,
  )
}

function withApp(ui: ReactNode) {
  return render(
    <MemoryRouter>
      <Providers poll={false}>{ui}</Providers>
    </MemoryRouter>,
  )
}

describe('Button', () => {
  it('варианты, loading и disabled', () => {
    const { rerender } = withI18n(<Button variant="secondary">Ок</Button>)
    expect(screen.getByRole('button', { name: 'Ок' })).toHaveClass('btn--secondary')
    rerender(
      <MemoryRouter>
        <Button loading>Ок</Button>
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
  it('disabled не кликается, to — ссылка', async () => {
    const onClick = vi.fn()
    withI18n(
      <>
        <Button disabled onClick={onClick}>
          Ок
        </Button>
        <Button to="/x">Перейти</Button>
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ок' }))
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Перейти' })).toHaveAttribute('href', '/x')
  })
  it('IconButton с бейджем', () => {
    withI18n(
      <IconButton label="Уведомления" badge={120}>
        x
      </IconButton>,
    )
    expect(screen.getByLabelText('Уведомления')).toHaveTextContent('99+')
  })
})

describe('Pill', () => {
  it('статусы переводятся, у пилюли иконка вместо точки', () => {
    withI18n(<StatusPill status="out_of_stock" />)
    expect(screen.getByText('Нет в наличии')).toHaveClass('pill--out')
    withI18n(
      <Pill tone="ok" icon={<svg data-testid="ico" />}>
        Ок
      </Pill>,
    )
    expect(screen.getByText('Ок')).toHaveClass('pill--ok')
    expect(screen.getByTestId('ico')).toBeInTheDocument()
    expect(document.querySelector('.pill__dot')).toBeNull()
  })
})

describe('Dropdown', () => {
  function Demo({ onChange = () => {} }: { onChange?: (v: string) => void }) {
    const [v, setV] = useState('a')
    return (
      <>
        <Dropdown
          label="Выбор"
          value={v}
          onChange={(x) => {
            setV(x)
            onChange(x)
          }}
          testId="dd"
          options={[
            { value: 'a', label: 'Альфа', hint: 'первый' },
            { value: 'b', label: 'Бета' },
            { value: 'c', label: 'Гамма' },
          ]}
          footer={(close) => (
            <button type="button" onClick={close}>
              действие
            </button>
          )}
        />
        <button type="button">снаружи</button>
      </>
    )
  }

  it('открывается, показывает выбранное, выбирает мышью и закрывается', async () => {
    const onChange = vi.fn()
    withI18n(<Demo onChange={onChange} />)
    const trigger = screen.getByTestId('dd')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('Альфа')
    await userEvent.click(trigger)
    const list = screen.getByRole('listbox', { name: 'Выбор' })
    expect(within(list).getByRole('option', { name: /Альфа/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(within(list).getByRole('option', { name: 'Бета' }))
    expect(onChange).toHaveBeenCalledWith('b')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(trigger).toHaveTextContent('Бета')
  })

  it('клавиатура: стрелки, End, Enter; Escape закрывает и возвращает фокус', async () => {
    const onChange = vi.fn()
    withI18n(<Demo onChange={onChange} />)
    const trigger = screen.getByTestId('dd')
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('b')
    await userEvent.click(trigger)
    await userEvent.keyboard('{End}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('c')
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('клик снаружи и действие в подвале закрывают меню', async () => {
    withI18n(<Demo />)
    await userEvent.click(screen.getByTestId('dd'))
    await userEvent.click(screen.getByText('снаружи'))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    await userEvent.click(screen.getByTestId('dd'))
    await userEvent.click(screen.getByText('действие'))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })
})

describe('States', () => {
  it('EmptyState с действием', () => {
    withI18n(<EmptyState title="Пусто" text="Ничего" action={<button>Да</button>} />)
    expect(screen.getByTestId('empty-state')).toHaveTextContent('Пусто')
  })
  it('ErrorState переводит код, показывает статус и повторяет', async () => {
    const onRetry = vi.fn()
    withI18n(<ErrorState error={new ApiError('daily_budget', 'x', 429, true)} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveAttribute('data-code', 'daily_budget')
    expect(screen.getByText(/дневной лимит/i)).toBeInTheDocument()
    expect(screen.getByText(/код 429/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /повторить/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
  it('новые коды ошибок тоже переведены', () => {
    withI18n(<ErrorState error={new ApiError('too_many_shops', 'x', 409)} />, 'en')
    expect(screen.getByText('Too many shops')).toBeInTheDocument()
  })
  it('ReportSkeleton и Notice', () => {
    withI18n(
      <>
        <ReportSkeleton />
        <Notice tone="out" title="Внимание" text="Текст" />
      </>,
    )
    expect(screen.getByTestId('skeleton').querySelectorAll('.skeleton').length).toBeGreaterThan(5)
    expect(screen.getByRole('status')).toHaveClass('notice--out')
  })
})

describe('Segmented', () => {
  it('переключает и отмечает выбранное', async () => {
    const onChange = vi.fn()
    withI18n(<Segmented label="Фильтр" value="a" onChange={onChange} items={[{ key: 'a', label: 'A', count: 2 }, { key: 'b', label: 'B' }]} />)
    expect(screen.getByRole('tab', { name: /A/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'B' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})

describe('Drawer', () => {
  it('открывается в body, закрывается по Escape и по затемнению', async () => {
    const onClose = vi.fn()
    withI18n(
      <Drawer open onClose={onClose} label="Товар">
        <p>Содержимое</p>
      </Drawer>,
    )
    expect(screen.getByRole('dialog', { name: 'Товар' })).toHaveTextContent('Содержимое')
    expect(screen.getByRole('dialog').parentElement).toBe(document.body)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(document.querySelector('.scrim')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('Fields', () => {
  it('Switch и ChoiceRow', async () => {
    const onSwitch = vi.fn()
    const onChoice = vi.fn()
    withI18n(
      <>
        <Switch checked={false} onChange={onSwitch} label="Вкл" />
        <ChoiceRow label="Тема" value="a" onChange={onChoice} items={[{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]} />
      </>,
    )
    await userEvent.click(screen.getByRole('switch'))
    expect(onSwitch).toHaveBeenCalledWith(true)
    await userEvent.click(screen.getByRole('radio', { name: 'B' }))
    expect(onChoice).toHaveBeenCalledWith('b')
  })
})

describe('Toast', () => {
  function Demo() {
    const push = useToast()
    return <button onClick={() => push('success', 'Готово', 'подпись')}>show</button>
  }
  it('показывает и прячет', async () => {
    render(
      <ToastProvider>
        <Demo />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByText('show'))
    expect(screen.getByRole('status')).toHaveTextContent('Готово')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), { timeout: 6000 })
  }, 8000)
})

describe('Nav: тема, язык, режим, магазин, автор', () => {
  it('ThemeToggle переключает только светлую и тёмную', async () => {
    seedSettings({ theme: 'light' })
    mockFetch(happyRoutes)
    withApp(<ThemeToggle />)
    expect(document.documentElement.dataset.theme).toBe('light')
    await userEvent.click(screen.getByTestId('theme-toggle'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    await userEvent.click(screen.getByTestId('theme-toggle'))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('LangSwitch: семь языков, английский первым, выбор меняет язык', async () => {
    seedSettings({ locale: 'ru' })
    mockFetch(liveRoutes)
    withApp(
      <>
        <LangSwitch />
        <ModePill />
      </>,
    )
    await waitFor(() => expect(screen.getByText(/Живой/)).toBeInTheDocument())
    await userEvent.click(screen.getByTestId('lang-switch'))
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['English', 'Русский', 'Кыргызча', 'Қазақша', 'Español', 'Deutsch', 'Français'])
    await userEvent.click(screen.getByRole('option', { name: 'Кыргызча' }))
    expect(screen.getByText(/Чыныгы/)).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).locale).toBe('ky')
  })

  it('ShopSwitcher показывает филиалы и переключает текущий', async () => {
    seedSettings()
    mockFetch(liveRoutes)
    withApp(<ShopSwitcher variant="rail" />)
    const trigger = await screen.findByTestId('shop-switcher-rail')
    expect(trigger).toHaveTextContent('Дүкөн на Чуй')
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('option', { name: /Дүкөн Манас/ }))
    await waitFor(() => expect(screen.getByTestId('shop-switcher-rail')).toHaveTextContent('Дүкөн Манас'))
    await userEvent.click(screen.getByTestId('shop-switcher-rail'))
    expect(screen.getByText('Добавить филиал')).toBeInTheDocument()
  })

  it('ShopSwitcher в демо: филиалы демо-сети, без «Добавить филиал»', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    withApp(<ShopSwitcher variant="rail" />)
    const trigger = await screen.findByTestId('shop-switcher-rail')
    expect(trigger).toHaveTextContent('Chuy 120')
    await userEvent.click(trigger)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Chuy 120'), expect.stringContaining('Manas 47'), expect.stringContaining('Osh Bazaar')])
    expect(screen.queryByText('Добавить филиал')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: /Manas 47/ }))
    await waitFor(() => expect(screen.getByTestId('shop-switcher-rail')).toHaveTextContent('Manas 47'))
    expect(JSON.parse(localStorage.getItem('dukon.demoShop')!)).toBe('demo-manas')
  })

  it('подпись автора ведёт на репозиторий и на лендинг', () => {
    withI18n(<AuthorLine />, 'en')
    expect(screen.getByRole('link', { name: 'Made by Adilkhan' })).toHaveAttribute('href', 'https://github.com/AdilkhanEEAIR/dukon')
    expect(screen.getByRole('link', { name: /About Dukon/ })).toHaveAttribute('href', '/')
  })
})

describe('Ценник и числа', () => {
  it('LossTag: сумма в долларах, прикидка на месяц и сомы по ценникам', () => {
    seedSettings({ currency: 'USD', locale: 'en' })
    mockFetch(happyRoutes)
    withApp(<LossTag valueKgs={KGS_PER_UNIT.USD * 10} label="Lost" unit="per day" />)
    const tag = screen.getByTestId('loss-tag')
    expect(within(tag).getByLabelText('$10.00')).toBeInTheDocument()
    expect(tag).toHaveTextContent('$300.00 per month')
    expect(tag).toHaveTextContent('875 som at shelf prices')
  })
  it('CountUp при «меньше движения» сразу показывает итог', () => {
    render(<CountUp value={67} testId="n" />)
    expect(screen.getByTestId('n')).toHaveTextContent('67')
  })
})

describe('Графики', () => {
  it('StockChart: прошлое и сейчас по товарам, есть табличный вид', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    withApp(<StockChart changes={diff.changes} />)
    await waitFor(() => expect(screen.getByTestId('stock-chart')).toHaveAttribute('data-ready', 'true'))
    // data-ready ставится на кадр раньше, чем график получает опции — ждём сами опции.
    await waitFor(() => expect(chartOptions().length).toBeGreaterThan(0))
    const opt = chartOptions().at(-1) as { series: { data: number[] }[] }
    expect(opt.series).toHaveLength(2)
    expect(opt.series[0].data).toContain(12)
    expect(opt.series[1].data).toContain(2)
    // «График | Таблица»: блоки сменяют друг друга — график уходит, таблица приходит, и обратно
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Таблица' }))
    expect(await screen.findByRole('table')).toHaveTextContent('Coca-Cola 1 л')
    await waitFor(() => expect(screen.queryByTestId('stock-chart')).not.toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Таблица' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'График' }))
    expect(await screen.findByTestId('stock-chart')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument())
  })

  it('прогноз до нуля по скорости продаж и подпись', async () => {
    expect(forecastPoints([{ at: '2026-10-28T00:00:00Z', count: 10 }], 5)).toEqual([
      { at: '2026-10-28T00:00:00Z', count: 10 },
      { at: '2026-10-30T00:00:00.000Z', count: 0 },
    ])
    expect(forecastPoints([{ at: '2026-10-28T00:00:00Z', count: 0 }], 5)).toEqual([])
    expect(forecastPoints([{ at: '2026-10-28T00:00:00Z', count: 4 }], 0)).toEqual([])
    seedSettings()
    mockFetch(happyRoutes)
    withApp(<ForecastChart history={[{ at: '2026-10-26T00:00:00Z', count: 12 }, { at: '2026-10-28T00:00:00Z', count: 2 }]} change={diff.changes[1]} caption="скоро" />)
    await waitFor(() => expect(screen.getByTestId('forecast-chart')).toHaveAttribute('data-ready', 'true'))
    // data-ready ставится на кадр раньше, чем график получает опции — ждём сами опции.
    await waitFor(() => expect(chartOptions().length).toBeGreaterThan(0))
    const opt = chartOptions().at(-1) as { series: unknown[] }
    expect(opt.series).toHaveLength(2)
    expect(screen.getByTestId('forecast-caption')).toHaveTextContent('скоро')
  })

  it('BranchesChart сортирует филиалы по потерям', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    withApp(
      <BranchesChart
        rows={[
          { id: 'a', name: 'A', value: 100 },
          { id: 'b', name: 'B', value: 300 },
        ]}
        format={(v) => `${v}`}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('branches-chart')).toHaveAttribute('data-ready', 'true'))
    // data-ready ставится на кадр раньше, чем график получает опции — ждём сами опции.
    await waitFor(() => expect(chartOptions().length).toBeGreaterThan(0))
    const opt = chartOptions().at(-1) as { yAxis: { data: string[] }; series: { itemStyle: { color: string }; data: unknown[] }[] }
    // Снизу вверх: самый большой столбец — наверху.
    expect(opt.yAxis.data).toEqual(['A', 'B'])
    // Потери — красным (статусный critical), а не зелёным акцентом «в плюсе».
    expect(opt.series[0].itemStyle.color).toBe('#d03b3b')
    // Заголовок графика выделяет слово «Потери»
    expect(screen.getByText('Потери')).toHaveClass('loss-word')
  })

  it('BranchesChart: нулевая потеря подписана серым, а не красным', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    withApp(<BranchesChart rows={[{ id: 'a', name: 'A', value: 0 }, { id: 'b', name: 'B', value: 50 }]} format={(v) => `${v}`} />)
    await waitFor(() => expect(screen.getByTestId('branches-chart')).toHaveAttribute('data-ready', 'true'))
    // data-ready ставится на кадр раньше, чем график получает опции — ждём сами опции.
    await waitFor(() => expect(chartOptions().length).toBeGreaterThan(0))
    const opt = chartOptions().at(-1) as { series: { data: unknown[] }[] }
    expect(opt.series[0].data[0]).toMatchObject({ value: 0, label: { fontWeight: 600 } })
    expect(opt.series[0].data[1]).toBe(50)
  })

  it('ShelfArt рисует полку с рамками', () => {
    withI18n(<ShelfArt animate={false} />)
    expect(screen.getByTestId('shelf-art').querySelectorAll('.box').length).toBeGreaterThan(10)
  })
})

describe('Иконки товаров', () => {
  it('категория по названию: демо-товары, бренды и кириллица', () => {
    expect(productKind('Coca-Cola 1 л')).toBe('cola')
    expect(productKind('Fanta 1 л')).toBe('orangeSoda')
    expect(productKind('Вода Легенда 0.5 л')).toBe('water')
    expect(productKind('Молоко Эльвест 6% 1 л')).toBe('milk')
    expect(productKind('Кефир Эльвест 0.5 л')).toBe('kefir')
    expect(productKind('Масло сливочное 180 г')).toBe('butter')
    expect(productKind('Масло подсолнечное 1 л')).toBe('oil')
    expect(productKind('Cheetos 55 г')).toBe('chips')
    expect(productKind('Orbit мята')).toBe('gum')
    expect(productKind('Кукуруза консервированная')).toBe('corn')
    expect(productKind('Хлеб нарезной')).toBe('bread')
    expect(productKind('Red Bull 0.25')).toBe('energy')
    expect(productKind('Сүт 1 л')).toBe('milk')
  })

  it('«кола» внутри «шоколада» не делает его газировкой', () => {
    expect(productKind('Шоколад молочный')).toBe('chocolate')
    expect(productKind('Milk chocolate bar')).toBe('chocolate')
    expect(productKind('Школьный набор')).toBe('box')
  })

  it('незнакомый товар — коробка; нет на полке — пустая плитка', () => {
    const { container } = render(
      <>
        <ProductIcon name="Что-то новое" />
        <ProductIcon name="Молоко" empty />
      </>,
    )
    const [box, milk] = screen.getAllByTestId('product-icon')
    expect(box).toHaveAttribute('data-kind', 'box')
    expect(milk).toHaveClass('pi--empty')
    expect(container.querySelectorAll('svg.pi__art')).toHaveLength(2)
  })
})

describe('Переключатель темы', () => {
  it('кнопка из toggles.dev: состояние «нажата» и класс следуют теме, тема сохраняется', async () => {
    seedSettings({ theme: 'light' })
    mockFetch(happyRoutes)
    withApp(<ThemeToggle />)
    const btn = screen.getByTestId('theme-toggle')
    expect(btn).toHaveAccessibleName('Сменить тему')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveClass('theme-toggle', 'light')
    expect(btn.querySelector('svg')).not.toBeNull()
    await userEvent.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveClass('dark')
    expect(btn).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(JSON.parse(localStorage.getItem('dukon.settings')!).theme).toBe('dark')
  })

  it('значки в настройках — Sun и Moon из lucide, в цвет текста', () => {
    const { container } = render(
      <>
        <SunGlyph />
        <MoonGlyph />
      </>,
    )
    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(2)
    expect(svgs[0]).toHaveClass('lucide-sun')
    expect(svgs[1]).toHaveClass('lucide-moon-star')
    svgs.forEach((svg) => expect(svg).toHaveAttribute('stroke', 'currentColor'))
  })
})

describe('Появление при прокрутке', () => {
  type Cb = (entries: Partial<IntersectionObserverEntry>[]) => void
  let fire: Cb = () => {}
  const observed: Element[] = []
  class FakeIO {
    constructor(cb: Cb) {
      fire = cb
    }
    observe(el: Element) {
      observed.push(el)
    }
    unobserve() {}
    disconnect() {}
  }

  const realIO = window.IntersectionObserver
  beforeEach(() => {
    observed.length = 0
    window.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver
  })
  afterEach(() => {
    window.IntersectionObserver = realIO
  })

  it('блок ниже экрана прячется, при докрутке выезжает, при уходе вниз снова прячется', () => {
    const animate = vi.fn(() => ({ cancel() {}, onfinish: null }))
    const card = document.createElement('div')
    card.className = 'sheet'
    card.animate = animate as unknown as typeof card.animate
    document.body.appendChild(card)
    const { unmount } = renderHook(() => useScrollReveal())
    expect(observed).toContain(card)

    const rect = (top: number) => ({ top }) as DOMRectReadOnly
    const rootBounds = { height: 800 } as DOMRectReadOnly
    // ниже экрана с самого начала — мгновенно прячется
    fire([{ target: card, isIntersecting: false, boundingClientRect: rect(1200), rootBounds }])
    expect(animate).toHaveBeenLastCalledWith([expect.objectContaining({ opacity: 0 })], expect.objectContaining({ duration: 0 }))
    // докрутили — выезжает снизу
    fire([{ target: card, isIntersecting: true, boundingClientRect: rect(600), rootBounds }])
    const [frames, opts] = animate.mock.lastCall as unknown as [Keyframe[], KeyframeAnimationOptions]
    expect(frames[0]).toMatchObject({ opacity: 0 })
    expect(frames[1]).toMatchObject({ opacity: 1 })
    expect(opts.fill).toBe('both')
    // крутим вверх — блок уходит вниз с анимацией
    fire([{ target: card, isIntersecting: false, boundingClientRect: rect(900), rootBounds }])
    expect(animate).toHaveBeenLastCalledWith([expect.objectContaining({ opacity: 0 })], expect.objectContaining({ duration: expect.any(Number) }))
    expect((animate.mock.lastCall as unknown as [unknown, { duration: number }])[1].duration).toBeGreaterThan(0)
    unmount()
    card.remove()
  })

  it('навигация и плавающие слои не прячутся', () => {
    const menu = document.createElement('div')
    menu.className = 'dd__menu'
    menu.innerHTML = '<div class="sheet"></div>'
    document.body.appendChild(menu)
    const { unmount } = renderHook(() => useScrollReveal())
    expect(observed).not.toContain(menu.firstElementChild)
    unmount()
    menu.remove()
  })
})
