import { afterEach, describe, expect, it, vi } from 'vitest'
import * as searchStore from '../searchStore.ts'

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

/**
 * Search fans out to both sources, so tests answer per source rather than
 * with one blanket response. Anything not listed comes back empty.
 */
function stubSources(bySource: Record<string, () => Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: unknown) => {
    const url = String(input)
    for (const [source, respond] of Object.entries(bySource)) {
      if (url.includes(`source=${source}`)) return Promise.resolve(respond())
    }
    return Promise.resolve(jsonResponse({ results: [] }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const gprotabResult = {
  sourceId: 'gprotab',
  externalId: '/en/tabs/fuel/shimmer',
  title: 'Shimmer',
  artist: 'Fuel',
  url: 'https://gprotab.net/en/tabs/fuel/shimmer',
  signals: { downloads: 4000, format: 'gp3' },
}

const guitarprotabsResult = {
  sourceId: 'guitarprotabs',
  externalId: '/f/fuel/shimmer_6822/',
  title: 'Shimmer',
  artist: 'Fuel',
  url: 'https://guitarprotabs.org/f/fuel/shimmer_6822/',
  signals: { downloads: 1843, format: 'gp3' },
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

  it('queries every source and merges what they return', async () => {
    const fetchMock = stubSources({
      gprotab: () => jsonResponse({ results: [gprotabResult] }),
      guitarprotabs: () => jsonResponse({ results: [guitarprotabsResult] }),
    })

    searchStore.query.value = 'shimmer'
    await searchStore.runSearch()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(searchStore.state.value).toBe('done')
    expect(searchStore.results.value).toHaveLength(2)
  })

  it('groups one song from two sources into a single row with both versions', async () => {
    stubSources({
      gprotab: () => jsonResponse({ results: [gprotabResult] }),
      guitarprotabs: () => jsonResponse({ results: [guitarprotabsResult] }),
    })

    searchStore.query.value = 'shimmer'
    await searchStore.runSearch()

    expect(searchStore.groups.value).toHaveLength(1)
    const [group] = searchStore.groups.value
    expect(group.title).toBe('Shimmer')
    expect(group.versions).toHaveLength(2)
    expect(group.versions[0].signals?.downloads).toBe(4000)
  })

  it('still shows results when one source is down, with a warning', async () => {
    stubSources({
      gprotab: () => jsonResponse({ error: 'Upstream is down.' }, { status: 503 }),
      guitarprotabs: () => jsonResponse({ results: [guitarprotabsResult] }),
    })

    searchStore.query.value = 'shimmer'
    await searchStore.runSearch()

    expect(searchStore.state.value).toBe('done')
    expect(searchStore.groups.value).toHaveLength(1)
    expect(searchStore.partialWarning.value).toContain('GProTab')
  })

  it('surfaces a retryable error state only when every source fails', async () => {
    stubSources({
      gprotab: () => jsonResponse({ error: 'Upstream is down.' }, { status: 503 }),
      guitarprotabs: () => jsonResponse({ error: 'Upstream is down.' }, { status: 503 }),
    })

    searchStore.query.value = 'metallica'
    await searchStore.runSearch()

    expect(searchStore.state.value).toBe('error')
    expect(searchStore.errorMessage.value).toBe('Upstream is down.')
    expect(searchStore.errorRetryable.value).toBe(true)
  })

  it('reports done with no groups when both sources return nothing', async () => {
    stubSources({})

    searchStore.query.value = 'nothing at all'
    await searchStore.runSearch()

    expect(searchStore.state.value).toBe('done')
    expect(searchStore.groups.value).toEqual([])
  })
})

describe('searchStore.toggleGroup', () => {
  it('expands and collapses a group by key', () => {
    searchStore.toggleGroup('metallica|one')
    expect(searchStore.expandedGroups.value.has('metallica|one')).toBe(true)

    searchStore.toggleGroup('metallica|one')
    expect(searchStore.expandedGroups.value.has('metallica|one')).toBe(false)
  })
})
