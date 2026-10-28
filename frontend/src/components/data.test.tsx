import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes, Providers } from '../App'
import { saveBlob } from '../lib/export/download'
import { chartHandlers, chartOptions, happyRoutes, mockFetch, seedSettings } from '../test/fixtures'
import { Donut, percent } from './charts/Donut'
import { QtyStepper, parseQty } from './QtyStepper'

// Сохранение файла в jsdom некуда отдать — подменяем и проверяем, что отдали.
vi.mock('../lib/export/download', () => ({ saveBlob: vi.fn() }))
// pdfmake в jsdom тяжёл и не нужен: документ проверяется отдельно (pdfDoc), здесь — только путь до файла.
vi.mock('../lib/export/pdf', async (orig) => ({ ...(await orig<typeof import('../lib/export/pdf')>()), toPdf: vi.fn(async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' })) }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Providers poll={false}>
        <AppRoutes />
      </Providers>
    </MemoryRouter>,
  )
}

function readText(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.readAsText(blob)
  })
}

describe('Количество в заказе: кнопки и ввод с клавиатуры', () => {
  function Host({ start = 5 }: { start?: number }) {
    const [n, setN] = useState(start)
    return (
      <>
        <QtyStepper value={n} onChange={setN} label="Молоко" inputLabel="Количество: Молоко" />
        <span data-testid="value">{n}</span>
        <button type="button">elsewhere</button>
      </>
    )
  }

  it('печатаем число — оно принимается по Enter, лишние символы отбрасываются', async () => {
    render(<Host />)
    const input = screen.getByLabelText('Количество: Молоко')
    await userEvent.click(input)
    await userEvent.keyboard('4a8{Enter}')
    expect(screen.getByTestId('value')).toHaveTextContent('48')
    expect(input).toHaveValue('48')
  })

  it('уход из поля тоже принимает; Escape возвращает прежнее; пусто — ноль', async () => {
    render(<Host />)
    const input = screen.getByLabelText('Количество: Молоко')
    await userEvent.click(input)
    await userEvent.keyboard('12')
    await userEvent.click(screen.getByText('elsewhere'))
    expect(screen.getByTestId('value')).toHaveTextContent('12')
    await userEvent.click(input)
    await userEvent.keyboard('99{Escape}')
    expect(screen.getByTestId('value')).toHaveTextContent('12')
    expect(input).toHaveValue('12')
    await userEvent.click(input)
    await userEvent.keyboard('{Backspace}{Enter}')
    expect(screen.getByTestId('value')).toHaveTextContent('0')
    expect(screen.getByRole('button', { name: '−' })).toBeDisabled()
  })

  it('стрелки: ±1, с Shift — ±10; кнопки «+» и «−»; не больше 9999', async () => {
    render(<Host start={9995} />)
    const input = screen.getByLabelText('Количество: Молоко')
    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByTestId('value')).toHaveTextContent('9994')
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}')
    expect(screen.getByTestId('value')).toHaveTextContent('9999')
    expect(screen.getByRole('button', { name: '+' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '−' }))
    expect(screen.getByTestId('value')).toHaveTextContent('9998')
  })

  it('разбор ввода', () => {
    expect(parseQty('')).toBe(0)
    expect(parseQty('007')).toBe(7)
    expect(parseQty('12 шт')).toBe(12)
    expect(parseQty('123456')).toBe(9999)
  })
})

describe('Кольцо долей', () => {
  const slices = [
    { id: 'a', name: 'Молоко', value: 3, color: '#111111', display: '3 шт' },
    { id: 'b', name: 'Кефир', value: 1, color: '#222222' },
    { id: 'c', name: 'Пусто', value: 0, color: '#333333' },
  ]

  function Host() {
    const [sel, setSel] = useState<string | null>(null)
    return (
      <Providers poll={false}>
        <Donut slices={slices} total="4" caption="всего" selected={sel} onSelect={setSel} label="Доли" testId="d" />
      </Providers>
    )
  }

  it('легенда со значениями и процентами; ноль в кольцо не попадает', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    render(
      <MemoryRouter>
        <Host />
      </MemoryRouter>,
    )
    const rows = screen.getAllByTestId('d-row')
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringMatching(/Молоко3 шт75\s?%/), expect.stringMatching(/Кефир125\s?%/), expect.stringMatching(/Пусто00\s?%/)])
    expect(rows[2]).toBeDisabled()
    await waitFor(() => expect(chartOptions().length).toBeGreaterThan(0))
    const series = (chartOptions().at(-1) as { series: { data: { name: string }[]; padAngle?: number }[] }).series
    expect(series[1].data.map((d) => d.name)).toEqual(['Молоко', 'Кефир'])
    expect(series[1].padAngle).toBe(3)
    expect(screen.getByTestId('d-center')).toHaveTextContent('4всего')
  })

  it('выбор строкой легенды и кликом по сектору: в центре — доля выбранного, повторный клик снимает', async () => {
    seedSettings()
    mockFetch(happyRoutes)
    render(
      <MemoryRouter>
        <Host />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getAllByTestId('d-row')[1])
    expect(await screen.findByTestId('d-center')).toHaveTextContent('1Кефир')
    expect(screen.getAllByTestId('d-row')[1]).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(chartHandlers().length).toBeGreaterThan(0))
    chartHandlers()[0].click({ seriesIndex: 1, dataIndex: 0 })
    await waitFor(() => expect(screen.getByTestId('d-center')).toHaveTextContent('3 штМолоко'))
    // клик по серой дорожке ничего не выбирает
    chartHandlers()[0].click({ seriesIndex: 0, dataIndex: 0 })
    expect(screen.getByTestId('d-center')).toHaveTextContent('Молоко')
    await userEvent.click(screen.getAllByTestId('d-row')[0])
    await waitFor(() => expect(screen.getByTestId('d-center')).toHaveTextContent('4всего'))
  })

  it('в спокойном режиме сектора не прыгают', async () => {
    seedSettings({ motion: 'calm' })
    mockFetch(happyRoutes)
    render(
      <MemoryRouter>
        <Host />
      </MemoryRouter>,
    )
    await waitFor(() => expect(chartOptions().length).toBeGreaterThan(0))
    expect((chartOptions().at(-1) as { animation: boolean }).animation).toBe(false)
  })

  it('проценты по правилам языка', () => {
    expect(percent(1, 4, 'en')).toBe('25%')
    expect(percent(1, 30, 'ru')).toMatch(/^3,3\s%$/)
    expect(percent(1, 0, 'en')).toBe('0%')
  })
})

describe('Кольца на экранах', () => {
  beforeEach(() => seedSettings())

  it('отчёт обхода: сектор «На месте» показывает в списке только то, что в порядке', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/shelves')
    const donut = await screen.findByTestId('status-donut')
    const rows = within(donut).getAllByTestId('status-donut-row')
    expect(rows.map((r) => r.textContent?.replace(/\d.*$/, ''))).toEqual(['Нет в наличии', 'Заканчивается', 'Ценник не совпадает', 'На месте'])
    await userEvent.click(rows[3])
    await waitFor(() => expect(screen.getByTestId('changes-list')).toHaveTextContent('Масло сливочное 180 г'))
    // Ушедшие строки пропадают после анимации ухода (на следующем кадре) — ждём их исчезновения.
    await waitFor(() => expect(screen.getByTestId('changes-list')).not.toHaveTextContent('Молоко'))
    // тот же выбор видно во вкладках: «Все» больше не выбрана
    expect(screen.getByRole('tab', { name: /^Все/ })).toHaveAttribute('aria-selected', 'false')
    await userEvent.click(within(donut).getAllByTestId('status-donut-row')[3])
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Все/ })).toHaveAttribute('aria-selected', 'true'))
  })

  it('филиалы: доли потерь, сектор выделяет филиал в списке', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/branches')
    const share = await screen.findByTestId('branches-share')
    expect(within(share).getByText('потерь')).toHaveClass('loss-word')
    const rows = within(share).getAllByTestId('branches-donut-row')
    expect(rows.map((r) => r.textContent?.split(/\d/)[0])).toEqual(['Manas ', 'Chuy '])
    await userEvent.click(rows[0])
    await waitFor(() => expect(screen.getAllByTestId('branch-row').find((r) => r.textContent?.includes('Manas 47'))).toHaveClass('is-focus'))
  })

  it('заказ: ввод количества с клавиатуры меняет итог и кольцо', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/orders')
    const inputs = await screen.findAllByTestId('qty')
    const milk = inputs.find((i) => i.getAttribute('aria-label')?.includes('Молоко'))!
    await userEvent.click(milk)
    await userEvent.keyboard('48{Enter}')
    await waitFor(() => expect(screen.getByTestId('order-total').getAttribute('aria-label')).toMatch(/^10\s440\sсом/))
    const legend = within(screen.getByTestId('orders-share')).getAllByTestId('orders-donut-row')
    expect(legend[0]).toHaveTextContent(/Молоко Эльвест 6% 1 л8\s160\sсом78\s?%/)
    await userEvent.click(legend[1])
    await waitFor(() => expect(screen.getAllByTestId('order-line').find((l) => l.textContent?.includes('Coca-Cola'))).toHaveClass('is-focus'))
  })
})

describe('Экспорт', () => {
  beforeEach(() => {
    seedSettings()
    vi.mocked(saveBlob).mockClear()
  })

  it('меню: PDF, Excel, CSV с подсказками; CSV сохраняется с правильным именем и содержимым', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/shelves')
    await screen.findByTestId('changes-list')
    await userEvent.click(screen.getByTestId('export-report'))
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['PDFДля печати и отправки', 'ExcelТаблица с формулами итогов', 'CSVДля учётных программ'])
    await userEvent.click(screen.getByRole('option', { name: /^CSV/ }))
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1))
    const [blob, name] = vi.mocked(saveBlob).mock.calls[0]
    expect(name).toBe('dukon-report-chuy-120-2026-10-28.csv')
    const text = await readText(blob)
    expect(text).toContain('Молоко Эльвест 6% 1 л,Нет в наличии,9,0,9,4.5,170,765,18')
    expect(await screen.findByText('Файл готов')).toBeInTheDocument()
  })

  it('PDF и Excel тоже отдаются файлами; демо-данные помечены в файле', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/orders')
    await screen.findAllByTestId('order-line')
    await userEvent.click(screen.getByTestId('export-orders'))
    await userEvent.click(screen.getByRole('option', { name: /^PDF/ }))
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1))
    expect(vi.mocked(saveBlob).mock.calls[0][1]).toMatch(/^dukon-order-chuy-120-\d{4}-\d{2}-\d{2}\.pdf$/)
    await userEvent.click(screen.getByTestId('export-orders'))
    await userEvent.click(screen.getByRole('option', { name: /^Excel/ }))
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(2))
    const [xlsx, name] = vi.mocked(saveBlob).mock.calls[1]
    expect(name).toMatch(/\.xlsx$/)
    expect(xlsx.size).toBeGreaterThan(1000)
  })

  it('ошибка сборки — понятный тост, кнопка снова доступна', async () => {
    const { toPdf } = await import('../lib/export/pdf')
    vi.mocked(toPdf).mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(happyRoutes)
    renderAt('/app/branches')
    await screen.findAllByTestId('branch-row')
    await userEvent.click(screen.getByTestId('export-branches'))
    await userEvent.click(screen.getByRole('option', { name: /^PDF/ }))
    expect(await screen.findByText(/Не получилось собрать файл/)).toBeInTheDocument()
    expect(saveBlob).not.toHaveBeenCalled()
    expect(screen.getByTestId('export-branches')).toHaveTextContent('Экспорт')
  })
})
