import { describe, it, expect } from 'vitest'
import { isUpToDate, mergeSong, toUploadBody, PHONE_OWNED_FIELDS } from '../merge.ts'
import type { Song } from '../../core/types.ts'
import type { LibrarySong } from '../../desktop/client.ts'

function remoteSong(overrides: Partial<LibrarySong> = {}): LibrarySong {
  return {
    id: 'song-1',
    title: 'Welcome To The Black Parade',
    artist: 'My Chemical Romance',
    album: null,
    source: { source_id: 'purchased', external_id: null, url: null },
    tab_blob_hash: 'a'.repeat(64),
    tab_format: 'gp',
    default_track_index: 0,
    target_tempo_bpm: 150,
    archived: false,
    added_at: 1000,
    updated_at: 1000,
    bundles: [],
    ...overrides,
  }
}

function localSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 'song-1',
    title: 'Welcome To The Black Parade',
    artist: 'My Chemical Romance',
    source: { sourceId: 'purchased' },
    tabBlobHash: 'a'.repeat(64),
    tabFormat: 'gp',
    defaultTrackIndex: 0,
    targetTempoBpm: 150,
    favourite: false,
    tags: [],
    addedAt: 1000,
    ...overrides,
  }
}

describe('mergeSong: a song new to this phone', () => {
  it('takes every catalogue field from the desktop', () => {
    const merged = mergeSong(undefined, remoteSong({ album: 'The Black Parade' }))

    expect(merged.title).toBe('Welcome To The Black Parade')
    expect(merged.artist).toBe('My Chemical Romance')
    expect(merged.album).toBe('The Black Parade')
    expect(merged.tabBlobHash).toBe('a'.repeat(64))
    expect(merged.tabFormat).toBe('gp')
    expect(merged.targetTempoBpm).toBe(150)
    expect(merged.addedAt).toBe(1000)
  })

  it('starts phone-owned fields empty rather than inventing values', () => {
    const merged = mergeSong(undefined, remoteSong())

    expect(merged.favourite).toBe(false)
    expect(merged.tags).toEqual([])
    expect(merged.lastPlayedAt).toBeUndefined()
    expect(merged.correctedTabBlobHash).toBeUndefined()
    expect(merged.audioBundleId).toBeUndefined()
  })

  it('seeds the track index from the desktop', () => {
    const merged = mergeSong(undefined, remoteSong({ default_track_index: 3 }))
    expect(merged.defaultTrackIndex).toBe(3)
  })

  it('falls back to the first track when the desktop has no opinion', () => {
    const merged = mergeSong(undefined, remoteSong({ default_track_index: null }))
    expect(merged.defaultTrackIndex).toBe(0)
  })
})

describe('mergeSong: field ownership on an existing song', () => {
  it('overwrites desktop-owned fields', () => {
    const local = localSong({ title: 'old title', artist: 'old artist' })
    const merged = mergeSong(local, remoteSong({ title: 'new title', artist: 'new artist' }))

    expect(merged.title).toBe('new title')
    expect(merged.artist).toBe('new artist')
  })

  it('never touches phone-owned fields', () => {
    const local = localSong({
      favourite: true,
      tags: ['riffs', 'setlist'],
      lastPlayedAt: 99999,
    })

    const merged = mergeSong(local, remoteSong({ title: 'renamed on the desktop' }))

    expect(merged.favourite).toBe(true)
    expect(merged.tags).toEqual(['riffs', 'setlist'])
    expect(merged.lastPlayedAt).toBe(99999)
    expect(merged.title).toBe('renamed on the desktop')
  })

  it('keeps the track index the player discovered, and does not reset it', () => {
    // The failure this guards: you pick the rhythm guitar part during
    // practice, the desktop still thinks track 0, and a sync silently puts
    // you back on the wrong staff.
    const local = localSong({ defaultTrackIndex: 4 })

    const merged = mergeSong(local, remoteSong({ default_track_index: 0 }))

    expect(merged.defaultTrackIndex).toBe(4)
  })

  it('keeps local corrections when the desktop replaces the tab file', () => {
    const local = localSong({
      correctedTabBlobHash: 'c'.repeat(64),
      correctionsBaseHash: 'a'.repeat(64),
    })

    const merged = mergeSong(local, remoteSong({ tab_blob_hash: 'b'.repeat(64) }))

    expect(merged.tabBlobHash).toBe('b'.repeat(64))
    // Corrections survive, and now point at a base that no longer matches -
    // which is exactly what makes the existing "corrections were made against
    // an older revision" path fire instead of silently mixing versions.
    expect(merged.correctedTabBlobHash).toBe('c'.repeat(64))
    expect(merged.correctionsBaseHash).toBe('a'.repeat(64))
    expect(merged.correctionsBaseHash).not.toBe(merged.tabBlobHash)
  })

  it('leaves the bundle association to bundleStore', () => {
    // Setting this from the catalogue would claim playable audio that has not
    // been downloaded.
    const local = localSong({ audioBundleId: 'bundle-1' })
    const merged = mergeSong(local, remoteSong())
    expect(merged.audioBundleId).toBe('bundle-1')
  })

  it('survives repeated syncs without drifting', () => {
    const remote = remoteSong()
    let song = mergeSong(localSong({ favourite: true, defaultTrackIndex: 2 }), remote)
    const first = { ...song }
    song = mergeSong(song, remote)
    song = mergeSong(song, remote)

    expect(song).toEqual(first)
  })
})

describe('mergeSong: archiving', () => {
  it('flags rather than drops, so the song can still be named', () => {
    const merged = mergeSong(localSong(), remoteSong({ archived: true }))
    expect(merged.archived).toBe(true)
    expect(merged.title).toBe('Welcome To The Black Parade')
  })

  it('clears the flag when the song comes back', () => {
    const archived = mergeSong(localSong(), remoteSong({ archived: true }))
    const restored = mergeSong(archived, remoteSong({ archived: false }))
    expect(restored.archived).toBe(false)
  })

  it('keeps phone-owned state through an archive and restore', () => {
    const local = localSong({ favourite: true, tags: ['solo'], defaultTrackIndex: 5 })
    const archived = mergeSong(local, remoteSong({ archived: true }))
    const restored = mergeSong(archived, remoteSong({ archived: false }))

    expect(restored.favourite).toBe(true)
    expect(restored.tags).toEqual(['solo'])
    expect(restored.defaultTrackIndex).toBe(5)
  })
})

describe('isUpToDate', () => {
  it('is false for a song this phone has never seen', () => {
    expect(isUpToDate(undefined, remoteSong())).toBe(false)
  })

  it('is true when only phone-owned fields differ', () => {
    const local = localSong({ favourite: true, lastPlayedAt: 123, tags: ['x'] })
    expect(isUpToDate(local, remoteSong())).toBe(true)
  })

  it('notices a rename, a new tab file, and an archive', () => {
    expect(isUpToDate(localSong(), remoteSong({ title: 'other' }))).toBe(false)
    expect(isUpToDate(localSong(), remoteSong({ tab_blob_hash: 'z'.repeat(64) }))).toBe(false)
    expect(isUpToDate(localSong(), remoteSong({ archived: true }))).toBe(false)
  })
})

describe('toUploadBody', () => {
  it('sends desktop-owned fields and no phone-owned ones', () => {
    const body = toUploadBody(
      localSong({
        favourite: true,
        tags: ['riffs'],
        lastPlayedAt: 5,
        correctedTabBlobHash: 'c'.repeat(64),
        audioBundleId: 'bundle-1',
      }),
    )

    const keys = Object.keys(body)
    for (const field of PHONE_OWNED_FIELDS) {
      expect(keys).not.toContain(field)
    }
    expect(keys).not.toContain('favourite')
    expect(keys).not.toContain('tags')
  })

  it('carries addedAt so a migrated library keeps its real dates', () => {
    expect(toUploadBody(localSong({ addedAt: 12345 })).added_at).toBe(12345)
  })

  it('sends a phone-originated source through unchanged', () => {
    const body = toUploadBody(
      localSong({ source: { sourceId: 'gprotab', externalId: '42', url: 'https://x' } }),
    )
    expect(body.source_id).toBe('gprotab')
    expect(body.source_external_id).toBe('42')
    expect(body.source_url).toBe('https://x')
  })

  it('round-trips through a merge without changing anything', () => {
    // Push then pull must be a no-op on desktop-owned fields, or a phone that
    // syncs twice slowly rewrites its own library.
    const local = localSong({ album: 'The Black Parade', favourite: true })
    const body = toUploadBody(local)
    const asRemote = remoteSong({
      ...body,
      source: {
        source_id: body.source_id,
        external_id: body.source_external_id,
        url: body.source_url,
      },
      archived: false,
      updated_at: 2000,
    })

    const merged = mergeSong(local, asRemote)

    expect(merged.title).toBe(local.title)
    expect(merged.artist).toBe(local.artist)
    expect(merged.album).toBe(local.album)
    expect(merged.tabBlobHash).toBe(local.tabBlobHash)
    expect(merged.targetTempoBpm).toBe(local.targetTempoBpm)
    expect(merged.addedAt).toBe(local.addedAt)
    expect(merged.favourite).toBe(true)
  })
})
