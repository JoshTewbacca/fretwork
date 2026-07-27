import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import type { Song } from '../../core/types.ts'
import { getDb } from '../../db/open.ts'
import { putSong } from '../../db/songs.ts'
import { putBlob, hasBlob } from '../../db/blobs.ts'
import { resetTestDb } from '../../db/__tests__/testDb.ts'
import {
  favouritesOnly,
  query,
  refresh,
  removeSong,
  songs,
  sortBy,
  toggleFavourite,
  visibleSongs,
} from '../libraryStore.ts'

afterEach(async () => {
  await resetTestDb()
  query.value = ''
  sortBy.value = 'recent'
  favouritesOnly.value = false
  songs.value = []
})

function makeSong(overrides: Partial<Song> & { id: string }): Song {
  return {
    title: 'Title',
    artist: 'Artist',
    source: { sourceId: 'file' },
    tabBlobHash: 'unset',
    tabFormat: 'gp5',
    defaultTrackIndex: 0,
    targetTempoBpm: 120,
    favourite: false,
    tags: [],
    addedAt: Date.now(),
    ...overrides,
  }
}

describe('libraryStore.refresh', () => {
  it('loads all songs, newest first', async () => {
    const db = await getDb()
    await putSong(db, makeSong({ id: 'a', addedAt: 1000 }))
    await putSong(db, makeSong({ id: 'b', addedAt: 3000 }))
    await putSong(db, makeSong({ id: 'c', addedAt: 2000 }))

    await refresh()

    expect(songs.value.map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('libraryStore.visibleSongs', () => {
  it('filters by query across title and artist, case-insensitively', async () => {
    const db = await getDb()
    await putSong(db, makeSong({ id: 'a', title: 'One', artist: 'Metallica', addedAt: 1 }))
    await putSong(db, makeSong({ id: 'b', title: 'Two', artist: 'Iron Maiden', addedAt: 2 }))
    await refresh()

    query.value = 'metal'
    expect(visibleSongs.value.map((s) => s.id)).toEqual(['a'])

    query.value = 'TWO'
    expect(visibleSongs.value.map((s) => s.id)).toEqual(['b'])

    query.value = 'nomatch'
    expect(visibleSongs.value).toEqual([])
  })

  it('filters to favourites only when enabled', async () => {
    const db = await getDb()
    await putSong(db, makeSong({ id: 'a', favourite: true, addedAt: 1 }))
    await putSong(db, makeSong({ id: 'b', favourite: false, addedAt: 2 }))
    await refresh()

    expect(favouritesOnly.value).toBe(false)
    expect(visibleSongs.value.map((s) => s.id)).toEqual(['b', 'a'])

    favouritesOnly.value = true
    expect(visibleSongs.value.map((s) => s.id)).toEqual(['a'])
  })

  it('sorts by title or artist independently of the addedAt order', async () => {
    const db = await getDb()
    await putSong(db, makeSong({ id: 'a', title: 'Bravo', artist: 'Alpha', addedAt: 1 }))
    await putSong(db, makeSong({ id: 'b', title: 'Alpha', artist: 'Bravo', addedAt: 2 }))
    await refresh()

    sortBy.value = 'title'
    expect(visibleSongs.value.map((s) => s.id)).toEqual(['b', 'a'])

    sortBy.value = 'artist'
    expect(visibleSongs.value.map((s) => s.id)).toEqual(['a', 'b'])

    sortBy.value = 'recent'
    expect(visibleSongs.value.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('sorts by recent-played, with never-played songs last', async () => {
    const db = await getDb()
    await putSong(db, makeSong({ id: 'a', addedAt: 1, lastPlayedAt: 5000 }))
    await putSong(db, makeSong({ id: 'b', addedAt: 2, lastPlayedAt: undefined }))
    await putSong(db, makeSong({ id: 'c', addedAt: 3, lastPlayedAt: 9000 }))
    await putSong(db, makeSong({ id: 'd', addedAt: 4, lastPlayedAt: undefined }))
    await refresh()

    sortBy.value = 'recent-played'

    const order = visibleSongs.value.map((s) => s.id)
    // Played songs first, most-recently-played first; never-played songs after,
    // in whatever relative order (stable sort keeps addedAt-desc from refresh()).
    expect(order.slice(0, 2)).toEqual(['c', 'a'])
    expect(order.slice(2)).toEqual(expect.arrayContaining(['b', 'd']))
    expect(order.indexOf('b')).toBeGreaterThan(order.indexOf('a'))
    expect(order.indexOf('d')).toBeGreaterThan(order.indexOf('c'))
  })
})

describe('libraryStore.toggleFavourite', () => {
  it('persists the flip and refreshes the store', async () => {
    const db = await getDb()
    await putSong(db, makeSong({ id: 'a', favourite: false, addedAt: 1 }))
    await refresh()

    await toggleFavourite('a')

    expect(songs.value.find((s) => s.id === 'a')?.favourite).toBe(true)
    const persisted = await db.get('songs', 'a')
    expect(persisted?.favourite).toBe(true)
  })
})

describe('libraryStore.removeSong', () => {
  it('deletes the song and sweeps its now-orphaned blob', async () => {
    const db = await getDb()
    const hash = await putBlob(db, new Blob([new Uint8Array([1, 2, 3])]), 'tab')
    await putSong(db, makeSong({ id: 'a', tabBlobHash: hash, addedAt: 1 }))
    await refresh()

    await removeSong('a')

    expect(songs.value.find((s) => s.id === 'a')).toBeUndefined()
    expect(await db.get('songs', 'a')).toBeUndefined()
    expect(await hasBlob(db, hash)).toBe(false)
  })

  it('keeps a blob still referenced by another song', async () => {
    const db = await getDb()
    const hash = await putBlob(db, new Blob([new Uint8Array([4, 5, 6])]), 'tab')
    await putSong(db, makeSong({ id: 'a', tabBlobHash: hash, addedAt: 1 }))
    await putSong(db, makeSong({ id: 'b', tabBlobHash: hash, addedAt: 2 }))
    await refresh()

    await removeSong('a')

    expect(await hasBlob(db, hash)).toBe(true)
  })
})
