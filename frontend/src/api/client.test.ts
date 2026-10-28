import { ApiError, ERROR_CODES, api, errorCode, onServerFailure, setServerDown } from './client'
import { demoRoute, shiftDates } from '../demo/offline'
import { jsonResponse, mockFetch } from '../test/fixtures'

describe('api', () => {
  it('health отдаёт режим и бюджет', async () => {
    mockFetch({ '/health': () => jsonResponse({ status: 'ok', mode: 'demo', reason: 'no_api_key', budget: { calls_left: 60 } }) })
    const h = await api.health()
    expect(h.mode).toBe('demo')
    expect(h.budget.calls_left).toBe(60)
  })

  it('код ошибки берётся из detail.code', async () => {
    mockFetch({ '/walks/x': () => jsonResponse({ detail: { code: 'daily_budget', message: 'лимит', retryable: false } }, 429) })
    await expect(api.walk('x')).rejects.toMatchObject({ code: 'daily_budget', status: 429, retryable: false })
  })

  it('404 без тела → not_found; 500 без кода → unknown и retryable', async () => {
    mockFetch({ '/walks/a': () => new Response('nope', { status: 404 }), '/walks/b': () => new Response('boom', { status: 500 }) })
    await expect(api.walk('a')).rejects.toMatchObject({ code: 'not_found' })
    await expect(api.walk('b')).rejects.toMatchObject({ code: 'unknown', retryable: true })
  })

  it('неизвестный код сервера сводится к unknown', async () => {
    mockFetch({ '/walks/z': () => jsonResponse({ detail: { code: 'teapot' } }, 418) })
    await expect(api.walk('z')).rejects.toMatchObject({ code: 'unknown' })
  })

  it('обрыв сети → network, retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(api.health()).rejects.toMatchObject({ code: 'network', retryable: true })
  })

  it('analyze шлёт multipart с демо-кодом, магазином и кодом устройства', async () => {
    const fn = mockFetch({ '/walks/analyze': () => jsonResponse({ id: 'w1', photos: [] }, 201) })
    const file = new File(['abc'], 'shelf.jpg', { type: 'image/jpeg' })
    await api.analyze([file], { demoKey: 'dukon-judge', label: 'Утро', shopId: 'shop-1', deviceId: 'device-x-0001' })
    const [url, init] = fn.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/walks/analyze?label=')
    expect(url).toContain('shop_id=shop-1')
    const headers = init.headers as Record<string, string>
    expect(headers['x-demo-key']).toBe('dukon-judge')
    expect(headers['x-device-id']).toBe('device-x-0001')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('магазины: код устройства в заголовке, JSON в теле', async () => {
    const fn = mockFetch({
      '/shops': (init) => jsonResponse(init?.method === 'POST' ? { id: 's1', name: 'A', address: '', created_at: '', demo: false } : []),
      '/shops/s1': () => jsonResponse({ deleted: 's1' }),
      '/branches/overview?scope=demo': () => jsonResponse([]),
    })
    await api.shops('device-x-0001')
    await api.createShop('device-x-0001', { name: 'A' })
    await api.updateShop('device-x-0001', 's1', { address: 'B' })
    await api.deleteShop('device-x-0001', 's1')
    await api.overview('demo')
    const calls = fn.mock.calls as [string, RequestInit][]
    expect((calls[0][1].headers as Record<string, string>)['x-device-id']).toBe('device-x-0001')
    expect(calls[1][1].method).toBe('POST')
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ name: 'A' })
    expect((calls[1][1].headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(calls[2][1].method).toBe('PATCH')
    expect(calls[3][1].method).toBe('DELETE')
    expect(calls[4][0]).toContain('/branches/overview?scope=demo')
  })

  it('walks фильтрует по магазину', async () => {
    const fn = mockFetch({ '/walks?source=live&shop_id=s1': () => jsonResponse([]) })
    await api.walks('live', 's1')
    expect((fn.mock.calls[0] as [string])[0]).toContain('/walks?source=live&shop_id=s1')
  })

  it('errorCode: ApiError и всё остальное', () => {
    expect(errorCode(new ApiError('billing', 'x', 402))).toEqual({ code: 'billing', status: 402, retryable: false })
    expect(errorCode(new Error('?'))).toEqual({ code: 'unknown', status: 0, retryable: true })
    expect(ERROR_CODES).toContain('rate_limited')
    expect(ERROR_CODES).toEqual(expect.arrayContaining(['device_required', 'too_many_shops', 'shop_not_found', 'validation']))
  })
})

describe('запасной демо-набор, когда сервер лежит', () => {
  afterEach(() => setServerDown(false))

  it('разбирает только демо-запросы: свои магазины и живые обходы офлайн не подменяются', () => {
    expect(demoRoute('/walks?source=demo&shop_id=demo-osh')).toEqual({ kind: 'walks', shopId: 'demo-osh' })
    expect(demoRoute('/walks?source=demo')).toEqual({ kind: 'walks', shopId: null })
    expect(demoRoute('/walks/demo-tue')).toEqual({ kind: 'walk', id: 'demo-tue' })
    expect(demoRoute('/walks/demo-tue/diff')).toEqual({ kind: 'diff', id: 'demo-tue' })
    expect(demoRoute('/shops/demo')).toEqual({ kind: 'shops' })
    expect(demoRoute('/branches/overview?scope=demo')).toEqual({ kind: 'overview' })
    expect(demoRoute('/walks?source=live&shop_id=shop-1')).toBeNull()
    expect(demoRoute('/walks/live-abc')).toBeNull()
    expect(demoRoute('/branches/overview?scope=mine')).toBeNull()
    expect(demoRoute('/shops')).toBeNull()
  })

  it('сдвигает даты снимка, будто демо-обходы прошли только что', () => {
    const shifted = shiftDates({ created_at: '2026-10-01T00:00:00.000Z', nested: [{ last_walk_at: '2026-10-01T06:00:00.000Z', label: 'x' }] }, 86_400_000)
    expect(shifted.created_at).toBe('2026-10-02T00:00:00.000Z')
    expect(shifted.nested[0].last_walk_at).toBe('2026-10-02T06:00:00.000Z')
    expect(shifted.nested[0].label).toBe('x')
  })

  it('сеть упала — демо-обходы приходят из снимка, а свои по-прежнему падают с ошибкой', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const walks = await api.walks('demo', 'demo-chuy')
    expect(walks.map((w) => w.id)).toEqual(['demo-sun', 'demo-tue'])
    // даты свежие: последний демо-обход — не старше суток
    expect(Date.now() - Date.parse(walks[1].created_at)).toBeLessThan(86_400_000)
    const diff = await api.diff('demo-tue')
    expect(diff.loss_per_day).toBeGreaterThan(0)
    expect((await api.demoShops()).map((s) => s.id)).toEqual(['demo-chuy', 'demo-manas', 'demo-osh'])
    expect(await api.overview('demo')).toHaveLength(3)
    await expect(api.walks('live', 'shop-1')).rejects.toMatchObject({ code: 'network' })
  })

  it('хостинг отвечает 502/503 на демо-чтение — тоже снимок', async () => {
    mockFetch({ '/walks/demo-sun': () => new Response('bad gateway', { status: 502 }), '/walks/demo-tue': () => new Response('sleeping', { status: 503 }) })
    expect((await api.walk('demo-sun')).id).toBe('demo-sun')
    expect((await api.walk('demo-tue')).id).toBe('demo-tue')
  })

  it('когда известно, что сервер лежит, демо-запросы даже не идут в сеть', async () => {
    const fn = mockFetch({})
    setServerDown(true)
    expect((await api.walks('demo', 'demo-manas')).map((w) => w.id)).toEqual(['demo-manas-1', 'demo-manas-2'])
    expect(fn).not.toHaveBeenCalled()
  })

  it('падение по сети сообщается подписчикам — кроме фоновой проверки /health', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const cb = vi.fn()
    const off = onServerFailure(cb)
    await api.health().catch(() => {})
    expect(cb).not.toHaveBeenCalled()
    await api.shops('device-x-0001').catch(() => {})
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    await api.shops('device-x-0001').catch(() => {})
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
