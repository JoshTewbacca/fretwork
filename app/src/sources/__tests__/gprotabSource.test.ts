import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabSourceError } from '../types.ts'
import { gprotabSource } from '../gprotabSource.ts'

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('gprotabSource.search', () => {
  it('parses a successful JSON response into results', async () => {
    const results = [
      { sourceId: 'gprotab', externalId: 'abc/one', title: 'One', artist: 'Metallica', url: 'https://gprotab.net/abc/one' },
    ]
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results }))
    vi.stubGlobal('fetch', fetchMock)

    const found = await gprotabSource.search('one')

    expect(found).toEqual(results)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/api/tabs/search?q=one')
  })

  it('throws a non-retryable TabSourceError with the server message on a 4xx response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'No matches for that query.' }, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(gprotabSource.search('nomatch')).rejects.toMatchObject({
      name: 'TabSourceError',
      message: 'No matches for that query.',
      retryable: false,
    })
  })

  it('throws a retryable TabSourceError on a 5xx response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'Upstream is down.' }, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(gprotabSource.search('one')).rejects.toMatchObject({
      name: 'TabSourceError',
      message: 'Upstream is down.',
      retryable: true,
    })
  })

  it('throws a retryable TabSourceError when the network request itself fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const error = await gprotabSource.search('one').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(TabSourceError)
    expect((error as TabSourceError).retryable).toBe(true)
  })
})

describe('gprotabSource.fetchTab', () => {
  const result = {
    sourceId: 'gprotab' as const,
    externalId: 'abc/one',
    title: 'One',
    artist: 'Metallica',
    url: 'https://gprotab.net/abc/one',
  }

  it('returns the bytes and the filename from the X-Tab-Filename header', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, { status: 200, headers: { 'X-Tab-Filename': 'One.gp5' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const fetched = await gprotabSource.fetchTab(result)

    expect(fetched.filename).toBe('One.gp5')
    expect(new Uint8Array(fetched.bytes)).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('falls back to a title-derived filename when the header is missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1]).buffer, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const fetched = await gprotabSource.fetchTab(result)

    expect(fetched.filename).toBe('one.gp3')
  })
})
