// Экран агента: прогон по событиям (блокировка правилом крупно, исправление, ответ поставщика, итог),
// утверждение заказов со ссылками в WhatsApp, разговор текстом и голосом, правила, офлайн-повтор из снимка.

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes, Providers } from '../App'
import { parseSse } from '../lib/sse'
import { encodeWav, resample } from '../lib/audio'
import { replyText, violationText, weekdayName } from '../lib/agentText'
import { translate } from '../i18n'
import { agentRun, approvedOrders, happyRoutes, jsonResponse, mockFetch, rules, seedSettings, sseBody, type Routes } from '../test/fixtures'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Providers poll={false}>
        <AppRoutes />
      </Providers>
    </MemoryRouter>,
  )
}

const fmt = (kgs: number) => `${kgs} сом`
const t = (key: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate('ru', key, p)

describe('Слова для журнала агента', () => {
  it('дни недели на языке интерфейса, 0 — понедельник', () => {
    expect(weekdayName(0, 'ru')).toBe('понедельник')
    expect(weekdayName(4, 'en')).toBe('Friday')
    expect(weekdayName(6, 'ky')).toMatch(/жекшемби/i)
    expect(weekdayName(null, 'ru')).toBe('—')
  })

  it('нарушения собираются из структуры события, а не из русской строки сервера', () => {
    const draft = agentRun.events[2].data.draft
    const v = agentRun.events[2].data.violations![0]
    expect(violationText(v, draft, 'ru', t, fmt)).toBe('Coca-Cola 1 л: 36 вместо нужного, а скидка всего 5% (нужно ≥ 7%)')
    expect(violationText(v, draft, 'en', (k, p) => translate('en', k, p), fmt)).toContain('only 5% discount (needs ≥ 7%)')
    const day = agentRun.events[10].data.violations![0]
    expect(violationText(day, undefined, 'ru', t, fmt)).toBe('Молочку нельзя заказывать на пятница')
    expect(violationText(day, undefined, 'en', (k, p) => translate('en', k, p), fmt)).toBe('No dairy deliveries on Friday')
  })

  it('ответ поставщика по полям: наличие, скидка, день, встречное предложение', () => {
    const reply = agentRun.events[6].data.reply!
    expect(replyText(reply, 'ru', t, fmt)).toBe('Всё есть. Привезём четверг. От 72 шт. — скидка 5%.')
    const rejected = { ...reply, rejected: [{ sku: 'fanta', name: 'Fanta 1 л' }], discount_pct: 5, offers: [] }
    expect(replyText(rejected, 'ru', t, fmt)).toBe('Нет на складе: Fanta 1 л. Остальное есть, скидка 5% за объём. Привезём четверг.')
    expect(replyText({ ...reply, min_order_ok: false, offers: [] }, 'ru', t, fmt, 2000)).toContain('Минимальный заказ 2000 сом')
  })
})

describe('Поток событий и звук', () => {
  it('parseSse режет кадры и оставляет хвост', () => {
    const { frames, rest } = parseSse('event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\nevent: c\ndata: {"z')
    expect(frames).toEqual([
      { event: 'a', data: '{"x":1}' },
      { event: 'b', data: '{"y":2}' },
    ])
    expect(rest).toBe('event: c\ndata: {"z')
    expect(parseSse(sseBody(agentRun)).frames.at(-1)?.event).toBe('done')
  })

  it('WAV: 16 бит моно, нужная частота, заголовок RIFF', () => {
    const samples = resample(new Float32Array([0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5]), 32_000, 16_000)
    expect(samples.length).toBe(4)
    const buf = encodeWav(samples, 16_000)
    const view = new DataView(buf)
    expect(String.fromCharCode(...new Uint8Array(buf.slice(0, 4)))).toBe('RIFF')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(buf.byteLength).toBe(44 + samples.length * 2)
  })
})

describe('Агент: прогон и утверждение', () => {
  beforeEach(() => seedSettings({ motion: 'calm' }))

  it('события приходят по одному; блокировка правилом — крупно, с текстом на языке интерфейса; итог с заказами', async () => {
    mockFetch(happyRoutes)
    renderAt('/app/agent')
    await userEvent.click(await screen.findByTestId('run-agent'))
    const feed = await screen.findByTestId('run-feed')
    // События выходят по одному: первая блокировка видна раньше второй, итог — после всех.
    await waitFor(() => expect(within(feed).getAllByTestId('event-verifier_block')).toHaveLength(1), { timeout: 8000 })
    expect(screen.queryByTestId('run-result')).toBeNull()
    const result = await screen.findByTestId('run-result', {}, { timeout: 8000 })
    // Первая блокировка — апсайз без скидки, вторая — молочка в пятницу. Текст собран из структуры, не из сервера.
    const blocks = within(feed).getAllByTestId('event-verifier_block')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toHaveTextContent('Правило хозяина остановило')
    expect(blocks[0]).toHaveTextContent('скидка всего 5% (нужно ≥ 7%)')
    expect(blocks[1]).toHaveTextContent('Молочку нельзя заказывать на пятница')
    expect(within(feed).getAllByTestId('event-fix')).toHaveLength(2)
    expect(within(feed).getAllByTestId('event-supplier_reply')[0]).toHaveTextContent('Привезём четверг')
    expect(result).toHaveTextContent('Заказы готовы')
    expect(result).toHaveTextContent('2 заказа на 5 680 сом')
    expect(result).toHaveTextContent('правила сработали 2 раза')
    expect(within(result).getAllByTestId('result-order')).toHaveLength(2)
    // Утверждаем — заказы с кнопкой в WhatsApp, «отправлено» меняет состояние.
    await userEvent.click(within(result).getByTestId('approve-all'))
    const cards = await screen.findAllByTestId('order-card')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByTestId('whatsapp-link')).toHaveAttribute('href', expect.stringMatching(/^https:\/\/wa\.me\/996555000011\?text=/))
    await userEvent.click(within(cards[0]).getByTestId('mark-sent'))
    await waitFor(() => expect(screen.getAllByTestId('order-card')[0]).toHaveAttribute('data-status', 'sent'))
    expect(screen.getByTestId('approved-orders')).toHaveTextContent('Утверждено')
  })

  it('разговор: вопрос про потери, правило голосом текста, «закажи» запускает прогон', async () => {
    const fn = mockFetch(happyRoutes)
    renderAt('/app/agent')
    const input = await screen.findByTestId('chat-input')
    await userEvent.type(input, 'сколько теряю?{Enter}')
    expect(await screen.findByText('Сегодня полка теряет 765 сом в день.')).toBeInTheDocument()
    expect(screen.getAllByTestId('msg-user')[0]).toHaveTextContent('сколько теряю?')
    await userEvent.type(screen.getByTestId('chat-input'), 'не заказывай молочку на пятницу{Enter}')
    expect(await screen.findByText('Правила сохранены')).toBeInTheDocument()
    await userEvent.type(screen.getByTestId('chat-input'), 'закажи всё{Enter}')
    expect(await screen.findByTestId('run-feed', {}, { timeout: 5000 })).toBeInTheDocument()
    const chatCalls = (fn.mock.calls as [string, RequestInit][]).filter(([u]) => u.endsWith('/agent/chat'))
    expect(chatCalls).toHaveLength(3)
    const body = JSON.parse(String(chatCalls[2][1].body)) as { history: unknown[]; lang: string; walk_id: string }
    expect(body.lang).toBe('ru')
    expect(body.walk_id).toBe('demo-tue')
    expect(body.history.length).toBeGreaterThanOrEqual(2)
  })

  it('правила: чипы дней и сохранение уходят на сервер', async () => {
    const fn = mockFetch(happyRoutes)
    renderAt('/app/agent')
    const card = await screen.findByTestId('rules-card')
    expect(within(card).getByTestId('dairy-day-4')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('save-rules')).toBeNull()
    await userEvent.click(within(card).getByTestId('dairy-day-5'))
    await userEvent.click(within(card).getByTestId('save-rules'))
    expect(await screen.findByText('Правила сохранены')).toBeInTheDocument()
    const put = (fn.mock.calls as [string, RequestInit][]).find(([u, i]) => u.includes('/rules') && i?.method === 'PUT')!
    expect(JSON.parse(String(put[1].body))).toEqual({ ...rules, no_dairy_on: [4, 5] })
  })

  it('живой режим без кода судьи: просит код и сохраняет его в настройки', async () => {
    seedSettings({ motion: 'calm', dataMode: 'live' }, { currentShop: 'shop-1' })
    const liveWalk = { id: 'live-9', created_at: '2026-10-28T02:12:00Z', label: 'x', source: 'live', shop_id: 'shop-1', photos: [] }
    const live: Routes = {
      ...happyRoutes,
      '/health': () => jsonResponse({ status: 'ok', version: '0', provider: 'meta', live_enabled: true, mode: 'live', reason: null, live_calls_today: 0, live_calls_per_day_total: 60, budget: { calls_today: 0, calls_limit: 60, calls_left: 60, est_spend_usd: 0, errors_today: 0, last_error: null }, voice_enabled: true }),
      '/walks?source=live&shop_id=shop-1': () => jsonResponse([liveWalk]),
      '/walks/live-9/diff': () => happyRoutes['/walks/demo-tue/diff'](),
      '/walks/live-9': () => jsonResponse(liveWalk),
      '/rules?shop_id=shop-1': () => jsonResponse(rules),
      '/orders?shop_id=shop-1&walk_id=live-9': () => jsonResponse([]),
      '/agent/run?walk_id=live-9': () => jsonResponse({ detail: { code: 'demo_key_required', message: 'нужен код' } }, 401),
    }
    mockFetch(live)
    renderAt('/app/agent')
    await userEvent.click(await screen.findByTestId('run-agent'))
    const keyInput = await screen.findByTestId('key-input')
    await userEvent.type(keyInput, 'dukon-judge')
    await userEvent.click(screen.getByTestId('key-save'))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('dukon.settings')!).demoKey).toBe('dukon-judge'))
  })
})

describe('Агент офлайн', () => {
  beforeEach(() => seedSettings({ motion: 'calm' }))

  it('сервер лежит — прогон повторяется из встроенного снимка, с теми же блокировками', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    renderAt('/app/agent')
    await userEvent.click(await screen.findByTestId('run-agent', {}, { timeout: 10_000 }))
    const feed = await screen.findByTestId('run-feed', {}, { timeout: 10_000 })
    const result = await screen.findByTestId('run-result', {}, { timeout: 10_000 })
    expect(within(feed).getAllByTestId('event-verifier_block')).toHaveLength(2)
    expect(result).toHaveTextContent('Записанный демо-прогон')
    await userEvent.click(within(result).getByTestId('approve-all'))
    expect((await screen.findAllByTestId('whatsapp-link'))[0]).toHaveAttribute('href', expect.stringMatching(/^https:\/\/wa\.me\/996555/))
  })
})

describe('Голос', () => {
  beforeEach(() => seedSettings({ motion: 'calm' }))

  it('без распознавания в браузере и без ключа — микрофона нет; с распознаванием браузера — текст уходит в разговор', async () => {
    mockFetch(happyRoutes)
    const { unmount } = renderAt('/app/agent')
    await screen.findByTestId('chat-input')
    expect(screen.queryByTestId('mic')).toBeNull()
    unmount()

    class FakeRecognition {
      lang = ''
      interimResults = false
      maxAlternatives = 1
      continuous = false
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null
      onerror: ((e: { error: string }) => void) | null = null
      onend: (() => void) | null = null
      start() {
        setTimeout(() => {
          this.onresult?.({ results: [[{ transcript: 'сколько теряю' }]] })
          this.onend?.()
        }, 10)
      }
      stop() {}
      abort() {}
    }
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    renderAt('/app/agent')
    const mic = await screen.findByTestId('mic')
    expect(mic).toHaveAttribute('data-engine', 'browser')
    await userEvent.click(mic)
    expect(await screen.findByText('Сегодня полка теряет 765 сом в день.')).toBeInTheDocument()
    expect(screen.getAllByTestId('msg-user')[0]).toHaveTextContent('сколько теряю')
  })
})

describe('Заказы с сервера', () => {
  beforeEach(() => seedSettings({ motion: 'calm' }))

  it('после прогона агента количества и дни — его; утверждение создаёт заказы с WhatsApp', async () => {
    mockFetch({ ...happyRoutes, '/agent/runs/latest?walk_id=demo-tue': () => jsonResponse(agentRun) })
    renderAt('/app/orders')
    expect(await screen.findByText('Агент договорился')).toBeInTheDocument()
    expect(screen.getByText('через агента')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('approve-orders'))
    const approved = await screen.findByTestId('orders-approved')
    expect(within(approved).getAllByTestId('order-card')).toHaveLength(2)
  })

  it('нарушение правил при утверждении показывается на месте', async () => {
    mockFetch({
      ...happyRoutes,
      '/orders/approve': () => jsonResponse({ detail: { code: 'rules_violation', message: 'x', violations: [{ rule: 'no_dairy_on', message: 'x', sku: null, limit: null, actual: 4, fix: '' }] } }, 409),
    })
    renderAt('/app/orders')
    await screen.findAllByTestId('order-line')
    await userEvent.click(screen.getByTestId('approve-orders'))
    expect(await screen.findByTestId('approve-violation')).toHaveTextContent('Молочку нельзя заказывать на пятница')
  })

  it('уже утверждённые заказы показаны сверху', async () => {
    mockFetch({ ...happyRoutes, '/orders?shop_id=demo-chuy&walk_id=demo-tue': () => jsonResponse(approvedOrders) })
    renderAt('/app/orders')
    const approved = await screen.findByTestId('orders-approved')
    expect(within(approved).getAllByTestId('order-card')).toHaveLength(2)
    expect(approved).toHaveTextContent('Утверждённые заказы')
  })
})
