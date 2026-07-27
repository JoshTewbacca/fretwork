import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TabSearchResult, TabSource } from '../../sources/types.ts'
import { getDb } from '../../db/open.ts'
import { listSongs } from '../../db/songs.ts'
import { resetTestDb } from '../../db/__tests__/testDb.ts'
import { addSearchResultToLibrary } from '../addFromSource.ts'

afterEach(async () => {
  vi.unstubAllGlobals()
  await resetTestDb()
})

function makeResult(overrides: Partial<TabSearchResult> = {}): TabSearchResult {
  return {
    sourceId: 'gprotab',
    externalId: 'metallica/one',
    title: 'One',
    artist: 'Metallica',
    url: 'https://gprotab.net/metallica/one',
    ...overrides,
  }
}

function makeSource(fetchTab: TabSource['fetchTab']): TabSource {
  return {
    id: 'gprotab',
    label: 'GProTab',
    search: vi.fn(),
    fetchTab,
  }
}

describe('addSearchResultToLibrary', () => {
  it('creates a song from the fetched tab, detecting the format from the filename', async () => {
    const result = makeResult()
    const source = makeSource(async () => ({
      bytes: new TextEncoder().encode('gp5-bytes').buffer,
      filename: 'One.gp5',
    }))

    const song = await addSearchResultToLibrary(source, result)

    expect(song.title).toBe('One')
    expect(song.artist).toBe('Metallica')
    expect(song.tabFormat).toBe('gp5')
    expect(song.source).toEqual({
      sourceId: 'gprotab',
      externalId: 'metallica/one',
      url: 'https://gprotab.net/metallica/one',
    })
    expect(song.defaultTrackIndex).toBe(0)
    expect(song.targetTempoBpm).toBe(120)
    expect(song.favourite).toBe(false)
    expect(song.tags).toEqual([])

    const db = await getDb()
    const all = await listSongs(db)
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(song.id)
  })

  it('falls back to gp3 when the filename has no usable extension', async () => {
    const result = makeResult()
    const source = makeSource(async () => ({
      bytes: new TextEncoder().encode('bytes').buffer,
      filename: 'download',
    }))

    const song = await addSearchResultToLibrary(source, result)

    expect(song.tabFormat).toBe('gp3')
  })

  it('deduplicates identical bytes into a single song', async () => {
    const bytes = new TextEncoder().encode('identical-bytes').buffer
    const sourceA = makeSource(async () => ({ bytes, filename: 'One.gp5' }))
    const sourceB = makeSource(async () => ({ bytes, filename: 'One (live).gp5' }))

    const first = await addSearchResultToLibrary(sourceA, makeResult({ externalId: 'a' }))
    const second = await addSearchResultToLibrary(
      sourceB,
      makeResult({ externalId: 'b', title: 'One (Live)' }),
    )

    expect(second.id).toBe(first.id)

    const db = await getDb()
    const all = await listSongs(db)
    expect(all).toHaveLength(1)
  })

  it('does not deduplicate distinct bytes', async () => {
    const sourceA = makeSource(async () => ({
      bytes: new TextEncoder().encode('bytes-a').buffer,
      filename: 'One.gp5',
    }))
    const sourceB = makeSource(async () => ({
      bytes: new TextEncoder().encode('bytes-b').buffer,
      filename: 'Two.gp5',
    }))

    const first = await addSearchResultToLibrary(sourceA, makeResult({ externalId: 'a' }))
    const second = await addSearchResultToLibrary(sourceB, makeResult({ externalId: 'b' }))

    expect(second.id).not.toBe(first.id)

    const db = await getDb()
    const all = await listSongs(db)
    expect(all).toHaveLength(2)
  })
})
