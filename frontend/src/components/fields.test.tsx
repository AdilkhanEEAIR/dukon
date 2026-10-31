// Числовое поле: из него можно стереть всё и вбить своё число, «0» перед цифрой не остаётся,
// пустое поле при уходе возвращает прежнее число, границы соблюдаются.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { NumberInput } from './Fields'

function Host({ initial = 14, min, max, decimals }: { initial?: number; min?: number; max?: number; decimals?: boolean }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <NumberInput value={v} onChange={setV} min={min} max={max} decimals={decimals} data-testid="n" aria-label="n" />
      <output data-testid="out">{v}</output>
      <button type="button" onClick={() => setV(99)}>reset</button>
    </>
  )
}

describe('NumberInput', () => {
  it('можно стереть всё и вбить своё число; число уходит наружу на каждую цифру', async () => {
    render(<Host initial={14} min={1} max={90} />)
    const input = screen.getByTestId('n') as HTMLInputElement
    await userEvent.clear(input)
    expect(input.value).toBe('')
    expect(screen.getByTestId('out')).toHaveTextContent('14')
    await userEvent.type(input, '30')
    expect(input.value).toBe('30')
    expect(screen.getByTestId('out')).toHaveTextContent('30')
  })

  it('ноль по умолчанию не прилипает: «0» → печатаем 525 → 525, а не 0525', async () => {
    render(<Host initial={0} min={0} />)
    const input = screen.getByTestId('n') as HTMLInputElement
    await userEvent.click(input)
    await userEvent.type(input, '525')
    expect(input.value).toBe('525')
    expect(screen.getByTestId('out')).toHaveTextContent('525')
  })

  it('пустое поле при уходе возвращает прежнее число; выход за границу подрезается', async () => {
    render(<Host initial={14} min={1} max={90} />)
    const input = screen.getByTestId('n') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.tab()
    expect(input.value).toBe('14')
    expect(screen.getByTestId('out')).toHaveTextContent('14')
    await userEvent.clear(input)
    await userEvent.type(input, '500')
    await userEvent.tab()
    expect(input.value).toBe('90')
    expect(screen.getByTestId('out')).toHaveTextContent('90')
  })

  it('значение снаружи обновляет поле, когда оно не в фокусе; дробные только с decimals', async () => {
    render(<Host initial={7} min={0} max={100} decimals />)
    const input = screen.getByTestId('n') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, '7.5')
    expect(screen.getByTestId('out')).toHaveTextContent('7.5')
    await userEvent.tab()
    await userEvent.click(screen.getByText('reset'))
    expect(input.value).toBe('99')
  })
})
