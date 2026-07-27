import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import type { AudioBundle, Song } from '../../core/types.ts'
import { getDb } from '../open.ts'
import { putBlob, hasBlob } from '../blobs.ts'
import { putSong } from '../songs.ts'
import { putAudioBundle } from '../audioBundles.ts'
import { putKv } from '../kv.ts'
import { sweepUnreferencedBlobs } from '../gc.ts'
import { resetTestDb } from './testDb.ts'

afterEach(resetTestDb)

function bytesOf(byte: number): Blob {
  return new Blob([new Uint8Array([byte])])
}

function makeSong(overrides: Partial<Song>): Song {
  return {
    id: 'song-1',
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

function makeBundle(overrides: Partial<AudioBundle>): AudioBundle {
  return {
    id: 'bundle-1',
    songId: 'song-1',
    backingBlobHash: 'unset',
    guitarBlobHash: 'unset',
    durationMs: 1000,
    encodeBitrateKbps: 80,
    sourceAudioFingerprint: 'fp',
    demucsModel: 'htdemucs_6s',
    syncMap: { version: 1, points: [], confidence: 1, status: 'auto' },
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('sweepUnreferencedBlobs', () => {
  it('keeps blobs referenced by songs, audio bundles, and the soundfont kv entry, removes the rest', async () => {
    const db = await getDb()

    const tabHash = await putBlob(db, bytesOf(1), 'tab')
    const correctedHash = await putBlob(db, bytesOf(2), 'tab')
    const backingHash = await putBlob(db, bytesOf(3), 'audio')
    const guitarHash = await putBlob(db, bytesOf(4), 'audio')
    const soundfontHash = await putBlob(db, bytesOf(5), 'soundfont')
    const orphanHash = await putBlob(db, bytesOf(6), 'tab')

    await putSong(db, makeSong({ tabBlobHash: tabHash, correctedTabBlobHash: correctedHash }))
    await putAudioBundle(db, makeBundle({ backingBlobHash: backingHash, guitarBlobHash: guitarHash }))
    await putKv(db, 'soundfontHash', soundfontHash)

    const result = await sweepUnreferencedBlobs(db)

    expect(result.removed).toEqual([orphanHash])
    expect(await hasBlob(db, tabHash)).toBe(true)
    expect(await hasBlob(db, correctedHash)).toBe(true)
    expect(await hasBlob(db, backingHash)).toBe(true)
    expect(await hasBlob(db, guitarHash)).toBe(true)
    expect(await hasBlob(db, soundfontHash)).toBe(true)
    expect(await hasBlob(db, orphanHash)).toBe(false)
  })
})
