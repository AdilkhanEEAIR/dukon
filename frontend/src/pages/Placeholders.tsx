// Заказы и агент появятся на вечерах 2–3. Пока — честные заглушки с описанием, что будет.

import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/States'

export function OrdersPage() {
  const navigate = useNavigate()
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__text">
          <span className="label">Из последнего обхода</span>
          <h1 className="h2" style={{ margin: 0 }}>Черновики заказов</h1>
        </div>
      </header>
      <div className="card">
        <EmptyState
          icon="package"
          title="Заказы собираются"
          text="Здесь появятся черновики по поставщикам: что, сколько и на какую сумму. Агент отправит их после вашего «да»."
          action={<Button variant="secondary" onClick={() => navigate('/report')}>К отчёту</Button>}
        />
      </div>
    </div>
  )
}

export function AgentPage() {
  const navigate = useNavigate()
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__text">
          <span className="label">Переговоры с поставщиками</span>
          <h1 className="h2" style={{ margin: 0 }}>Агент</h1>
        </div>
      </header>
      <div className="card">
        <EmptyState
          icon="sparkle"
          title="Агент ещё не подключён"
          text="Он будет договариваться о сроках и количестве в рамках ваших правил и показывать каждое решение с причиной."
          action={<Button variant="secondary" onClick={() => navigate('/')}>На главную</Button>}
        />
      </div>
    </div>
  )
}

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="page">
      <EmptyState icon="alert" title="Такой страницы нет" text="Проверьте адрес или вернитесь на главную." action={<Button onClick={() => navigate('/')}>На главную</Button>} />
    </div>
  )
}
