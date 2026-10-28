import { Component, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Sidebar, TabBar } from './components/Nav'
import { ErrorState } from './components/States'
import { ToastProvider } from './components/Toast'
import { useOnline } from './hooks/useOnline'
import { HomePage } from './pages/Home'
import { ItemPage } from './pages/Item'
import { AgentPage, NotFoundPage, OrdersPage } from './pages/Placeholders'
import { ReportPage } from './pages/Report'
import { ScanPage } from './pages/Scan'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/scan" element={<ScanPage />} />
      <Route path="/report" element={<ReportPage />} />
      <Route path="/report/:id" element={<ReportPage />} />
      <Route path="/item/:sku" element={<ItemPage />} />
      <Route path="/orders" element={<OrdersPage />} />
      <Route path="/agent" element={<AgentPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const online = useOnline()
  return (
    <div className="app">
      <Sidebar />
      <div className="app__main">
        {!online && (
          <div role="status" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', textAlign: 'center', padding: '8px 16px', fontSize: 13, fontWeight: 500 }} data-testid="offline-banner">
            Нет интернета — показываем последние данные, отправка обхода недоступна
          </div>
        )}
        <ErrorBoundary>{children}</ErrorBoundary>
        <TabBar />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Shell>
          <AppRoutes />
        </Shell>
      </ToastProvider>
    </BrowserRouter>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} />
        </div>
      )
    }
    return this.props.children
  }
}
