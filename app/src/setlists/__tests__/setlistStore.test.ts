import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { getDb } from '../../db/open.ts'
import { resetTestDb } from '../../db/__tests__/testDb.ts'
import {
  addSongToSetlist,
  createSetlist,
  deleteSetlist,
  refresh,
  removeSongFromSetlist,
  renameSetlist,
  reorderSetlist,
  setlists,
} from '../setlistStore.ts'

afterEach(async () => {
  await resetTestDb()
  setlists.value = []
})

describe('setlistStore.createSetlist', () => {
  it('persists a new setlist and adds it to the store', async () => {
    const id = await createSetlist('Gig night', 'setlist')

    expect(setlists.value).toHaveLength(1)
    expect(setlists.value[0].id).toBe(id)
    expect(setlists.value[0].name).toBe('Gig night')
    expect(setlists.value[0].kind).toBe('setlist')
    expect(setlists.value[0].songIds).toEqual([])

    const db = await getDb()
    const persisted = await db.get('setlists', id)
    expect(persisted?.name).toBe('Gig night')
  })

  it('supports the practice-group kind', async () => {
    const id = await createSetlist('Warmups', 'practice-group')
    expect(setlists.value.find((s) => s.id === id)?.kind).toBe('practice-group')
  })
})

describe('setlistStore.renameSetlist', () => {
  it('updates the name and persists it', async () => {
    const id = await createSetlist('Old name', 'setlist')

    await renameSetlist(id, 'New name')

    expect(setlists.value.find((s) => s.id === id)?.name).toBe('New name')
    const db = await getDb()
    expect((await db.get('setlists', id))?.name).toBe('New name')
  })
})

describe('setlistStore.deleteSetlist', () => {
  it('removes the setlist from the store and the database', async () => {
    const id = await createSetlist('Temp', 'setlist')

    await deleteSetlist(id)

    expect(setlists.value.find((s) => s.id === id)).toBeUndefined()
    const db = await getDb()
    expect(await db.get('setlists', id)).toBeUndefined()
  })
})

describe('setlistStore.addSongToSetlist', () => {
  it('appends a song id', async () => {
    const id = await createSetlist('List', 'setlist')

    await addSongToSetlist(id, 'song-a')

    expect(setlists.value.find((s) => s.id === id)?.songIds).toEqual(['song-a'])
  })

  it('does not add a duplicate song id', async () => {
    const id = await createSetlist('List', 'setlist')

    await addSongToSetlist(id, 'song-a')
    await addSongToSetlist(id, 'song-a')

    expect(setlists.value.find((s) => s.id === id)?.songIds).toEqual(['song-a'])
  })

  it('preserves insertion order across distinct songs', async () => {
    const id = await createSetlist('List', 'setlist')

    await addSongToSetlist(id, 'song-a')
    await addSongToSetlist(id, 'song-b')

    expect(setlists.value.find((s) => s.id === id)?.songIds).toEqual(['song-a', 'song-b'])
  })
})

describe('setlistStore.removeSongFromSetlist', () => {
  it('removes only the targeted song id', async () => {
    const id = await createSetlist('List', 'setlist')
    await addSongToSetlist(id, 'song-a')
    await addSongToSetlist(id, 'song-b')

    await removeSongFromSetlist(id, 'song-a')

    expect(setlists.value.find((s) => s.id === id)?.songIds).toEqual(['song-b'])
  })
})

describe('setlistStore.reorderSetlist', () => {
  it('replaces the song order and persists it', async () => {
    const id = await createSetlist('List', 'setlist')
    await addSongToSetlist(id, 'song-a')
    await addSongToSetlist(id, 'song-b')
    await addSongToSetlist(id, 'song-c')

    await reorderSetlist(id, ['song-c', 'song-a', 'song-b'])

    expect(setlists.value.find((s) => s.id === id)?.songIds).toEqual([
      'song-c',
      'song-a',
      'song-b',
    ])
    const db = await getDb()
    expect((await db.get('setlists', id))?.songIds).toEqual(['song-c', 'song-a', 'song-b'])
  })
})

describe('setlistStore.refresh', () => {
  it('loads setlists newest first', async () => {
    const db = await getDb()
    await db.put('setlists', { id: 'a', name: 'A', songIds: [], kind: 'setlist', createdAt: 1000 })
    await db.put('setlists', { id: 'b', name: 'B', songIds: [], kind: 'setlist', createdAt: 3000 })
    await db.put('setlists', { id: 'c', name: 'C', songIds: [], kind: 'setlist', createdAt: 2000 })

    await refresh()

    expect(setlists.value.map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })
})
