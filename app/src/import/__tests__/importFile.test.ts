import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { getDb } from '../../db/open.ts'
import { listSongs } from '../../db/songs.ts'
import { resetTestDb } from '../../db/__tests__/testDb.ts'
import { importTabFile } from '../importFile.ts'

afterEach(resetTestDb)

function makeFile(name: string, contents: string): File {
  return new File([contents], name, { type: 'application/octet-stream' })
}

describe('importTabFile', () => {
  it('creates a song from a supported tab file', async () => {
    const file = makeFile('Metallica - One.gp5', 'gp5-bytes')

    const { song, duplicate } = await importTabFile(file)

    expect(duplicate).toBe(false)
    expect(song.title).toBe('One')
    expect(song.artist).toBe('Metallica')
    expect(song.tabFormat).toBe('gp5')
    expect(song.source).toEqual({ sourceId: 'file' })
    expect(song.defaultTrackIndex).toBe(0)
    expect(song.targetTempoBpm).toBe(120)
    expect(song.favourite).toBe(false)
    expect(song.tags).toEqual([])
    expect(typeof song.tabBlobHash).toBe('string')
    expect(song.tabBlobHash.length).toBeGreaterThan(0)

    const db = await getDb()
    const all = await listSongs(db)
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(song.id)
  })

  it('throws a descriptive error for unsupported files', async () => {
    const file = makeFile('notes.txt', 'hello')

    await expect(importTabFile(file)).rejects.toThrow(/notes\.txt/)
  })

  it('deduplicates identical bytes into a single song', async () => {
    const bytes = 'identical-bytes'
    const first = await importTabFile(makeFile('Song A.gp5', bytes))
    const second = await importTabFile(makeFile('Song B.gp5', bytes))

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.song.id).toBe(first.song.id)

    const db = await getDb()
    const all = await listSongs(db)
    expect(all).toHaveLength(1)
  })

  it('does not deduplicate distinct bytes', async () => {
    const first = await importTabFile(makeFile('Song A.gp5', 'bytes-a'))
    const second = await importTabFile(makeFile('Song B.gp5', 'bytes-b'))

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(false)

    const db = await getDb()
    const all = await listSongs(db)
    expect(all).toHaveLength(2)
  })
})
