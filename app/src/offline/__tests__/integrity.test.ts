import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetTestDb } from '../../db/__tests__/testDb.ts'
import { getDb } from '../../db/open.ts'
import { putBlob, deleteBlob } from '../../db/blobs.ts'
import { putSong } from '../../db/songs.ts'
import { getAssetState } from '../../db/assetState.ts'
import { sweepForEvictions } from '../integrity.ts'
import type { Song } from '../../core/types.ts'

function makeSong(id: string, tabBlobHash: string): Song {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Tester',
    source: { sourceId: 'file' },
    tabBlobHash,
    tabFormat: 'gp5',
    defaultTrackIndex: 0,
    targetTempoBpm: 120,
    favourite: false,
    tags: [],
    addedAt: Date.now(),
  }
}

describe('sweepForEvictions', () => {
  beforeEach(async () => {
    await resetTestDb()
  })

  it('reports nothing when every tab blob is present', async () => {
    const db = await getDb()
    const hash = await putBlob(db, new Blob(['tab-bytes']), 'tab')
    await putSong(db, makeSong('a', hash))

    const report = await sweepForEvictions()

    expect(report.evictedSongs).toHaveLength(0)
    expect(report.evictedBundles).toHaveLength(0)
    expect((await getAssetState(db, `tab:${hash}`))?.state).toBe('cached')
  })

  it('detects a song whose tab blob was evicted', async () => {
    const db = await getDb()
    const keptHash = await putBlob(db, new Blob(['kept']), 'tab')
    const goneHash = await putBlob(db, new Blob(['gone']), 'tab')
    await putSong(db, makeSong('kept', keptHash))
    await putSong(db, makeSong('gone', goneHash))

    // Simulate the browser reclaiming space.
    await deleteBlob(db, goneHash)

    const report = await sweepForEvictions()

    expect(report.evictedSongs).toHaveLength(1)
    expect(report.evictedSongs[0].id).toBe('gone')
    expect((await getAssetState(db, `tab:${goneHash}`))?.state).toBe('evicted')
    expect((await getAssetState(db, `tab:${keptHash}`))?.state).toBe('cached')
  })

  it('recovers to cached once the blob is restored', async () => {
    const db = await getDb()
    const hash = await putBlob(db, new Blob(['restore-me']), 'tab')
    await putSong(db, makeSong('a', hash))
    await deleteBlob(db, hash)
    await sweepForEvictions()
    expect((await getAssetState(db, `tab:${hash}`))?.state).toBe('evicted')

    await putBlob(db, new Blob(['restore-me']), 'tab')
    const report = await sweepForEvictions()

    expect(report.evictedSongs).toHaveLength(0)
    expect((await getAssetState(db, `tab:${hash}`))?.state).toBe('cached')
  })

  it('handles an empty library without failing', async () => {
    const report = await sweepForEvictions()
    expect(report.evictedSongs).toHaveLength(0)
    expect(report.checkedAt).toBeGreaterThan(0)
  })
})
