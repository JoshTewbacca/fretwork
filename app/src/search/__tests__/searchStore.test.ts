import { afterEach, describe, expect, it, vi } from 'vitest'
import * as searchStore from '../searchStore.ts'

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  searchStore.reset()
})

describe('searchStore.runSearch', () => {
  it('does not search for queries shorter than 2 characters', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    searchStore.query.value = 'a'
    await searchStore.runSearch()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(searchStore.state.value).toBe('idle')
  })

  it('populates results on success', async () => {
    const results = [
      { sourceId: 'gprotab', externalId: 'x', title: 'X', artist: 'Y', url: 'https://gprotab.net/x' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ results })))

    searchStore.query.value = 'metallica'
    await searchStore.runSearch()

    expect(searchStore.state.value).toBe('done')
    expect(searchStore.results.value).toEqual(results)
  })

  it('surfaces a retryable error state on a 5xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'Upstream is down.' }, { status: 503 })),
    )

    searchStore.query.value = 'metallica'
    await searchStore.runSearch()

    expect(searchStore.state.value).toBe('error')
    expect(searchStore.errorMessage.value).toBe('Upstream is down.')
    expect(searchStore.errorRetryable.value).toBe(true)
  })
})
