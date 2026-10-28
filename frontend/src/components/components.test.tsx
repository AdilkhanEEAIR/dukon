import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ApiError } from '../api/client'
import { Button } from './Button'
import { Chip, StatusChip } from './Chip'
import { Sidebar, TabBar } from './Nav'
import { EmptyState, ErrorState, ReportSkeleton } from './States'
import { ToastProvider, useToast } from './Toast'

describe('Button', () => {
  it('рендерит варианты и блокируется в loading', () => {
    const { rerender } = render(<Button variant="secondary">Ок</Button>)
    expect(screen.getByRole('button', { name: 'Ок' })).toHaveClass('btn--secondary')
    rerender(<Button loading>Ок</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
  it('не вызывает onClick, когда disabled', async () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Ок</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Chip', () => {
  it('статусы переводятся в тон и текст', () => {
    render(<StatusChip status="out_of_stock" />)
    expect(screen.getByText('Нет в наличии')).toHaveClass('chip--danger')
    render(<Chip tone="violet">Новое</Chip>)
    expect(screen.getByText('Новое')).toHaveClass('chip--violet')
  })
})

describe('States', () => {
  it('EmptyState показывает заголовок, текст и действие', () => {
    render(<EmptyState title="Пусто" text="Ничего" action={<button>Да</button>} />)
    expect(screen.getByTestId('empty-state')).toHaveTextContent('Пусто')
    expect(screen.getByRole('button', { name: 'Да' })).toBeInTheDocument()
  })
  it('ErrorState объясняет причину и даёт повторить', async () => {
    const onRetry = vi.fn()
    render(<ErrorState error={new ApiError('daily_budget', 'x', 429)} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveAttribute('data-code', 'daily_budget')
    expect(screen.getByText(/дневной лимит/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /повторить/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
  it('ErrorState для сети показывает иконку офлайна', () => {
    render(<ErrorState error={new ApiError('network', 'x')} />)
    expect(document.querySelector('[data-icon="wifiOff"]')).toBeInTheDocument()
  })
  it('ReportSkeleton рендерит скелетоны', () => {
    render(<ReportSkeleton />)
    expect(screen.getByTestId('skeleton').querySelectorAll('.skeleton').length).toBeGreaterThan(5)
  })
})

describe('Nav', () => {
  it('TabBar подсвечивает активный раздел', () => {
    render(<MemoryRouter initialEntries={['/report']}><TabBar /></MemoryRouter>)
    expect(screen.getByText('Полки').closest('a')).toHaveClass('is-active')
    expect(screen.getByText('Главная').closest('a')).not.toHaveClass('is-active')
    expect(screen.getByLabelText('Новый обход')).toHaveAttribute('href', '/scan')
  })
  it('Sidebar содержит все разделы и кнопку обхода', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>)
    expect(screen.getByText('Заказы')).toBeInTheDocument()
    expect(screen.getByText('Новый обход').closest('a')).toHaveClass('btn--primary')
  })
})

describe('Toast', () => {
  function Demo() {
    const push = useToast()
    return <button onClick={() => push('success', 'Готово', 'подпись')}>show</button>
  }
  it('показывает и прячет тост', async () => {
    render(<ToastProvider><Demo /></ToastProvider>)
    await userEvent.click(screen.getByText('show'))
    expect(screen.getByRole('status')).toHaveTextContent('Готово')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), { timeout: 5000 })
  }, 7000)
})
