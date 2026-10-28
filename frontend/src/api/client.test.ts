import { ApiError, ERROR_CODES, api, errorCode } from './client'
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
