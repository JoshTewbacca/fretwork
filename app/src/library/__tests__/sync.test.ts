import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '../../core/types.ts'
import type { LibrarySong } from '../../desktop/client.ts'
import { getDb } from '../../db/open.ts'
import { getSong, putSong } from '../../db/songs.ts'
import { hasBlob, putBlob } from '../../db/blobs.ts'
import { resetTestDb } from '../../db/__tests__/testDb.ts'
import { pullLibrary, pushLibrary, syncLibrary, visible } from '../sync.ts'

const BASE = 'https://desktop.example.ts.net'
const TAB_BYTES = new Blob([new Uint8Array([1, 2, 3, 4])])

/**
 * The real SHA-256 of TAB_BYTES. The fake desktop has to serve bytes that
 * genuinely hash to the value its catalogue advertises, because the blob
 * store is content-addressed and sync now checks that what arrived is what
 * was asked for. A fixture that fakes the hash would not be modelling a
 * desktop at all.
 */
let TAB_HASH = ''

beforeEach(async () => {
  const digest = await crypto.subtle.digest('SHA-256', await TAB_BYTES.arrayBuffer())
  TAB_HASH = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await resetTestDb()
})

function remoteSong(overrides: Partial<LibrarySong> = {}): LibrarySong {
  return {
    id: 'song-1',
    title: 'Welcome To The Black Parade',
    artist: 'My Chemical Romance',
    album: null,
    source: { source_id: 'purchased', external_id: null, url: null },
    // Defaults to the hash the fake desktop's bytes actually produce, so a
    // test has to opt in to a mismatch rather than hit one by accident.
    tab_blob_hash: TAB_HASH,
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
    id: 'local-1',
    title: 'Where The Streets Have No Name',
    artist: 'U2',
    source: { sourceId: 'gprotab', externalId: '99' },
    tabBlobHash: 'unset',
    tabFormat: 'gp3',
    defaultTrackIndex: 0,
    targetTempoBpm: 120,
    favourite: false,
    tags: [],
    addedAt: 500,
    ...overrides,
  }
}

interface FakeServer {
  library: LibrarySong[]
  /** Hashes the fake desktop will serve from /blob. */
  blobs: Set<string>
  uploads: Blob[]
  posted: Record<string, unknown>[]
  blobStatus?: number
  songStatus?: number
}

/** Stub fetch with a small in-memory stand-in for the desktop API. */
function stubDesktop(server: FakeServer) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(BASE, '')
      const method = init?.method ?? 'GET'

      if (path === '/library') {
        return new Response(JSON.stringify({ version: 2, songs: server.library }), { status: 200 })
      }
      if (path === '/blob' && method === 'POST') {
        if (server.blobStatus && server.blobStatus !== 200) {
          return new Response('', { status: server.blobStatus })
        }
        server.uploads.push(init!.body as Blob)
        return new Response(JSON.stringify({ hash: 'uploaded-hash', size: 4 }), { status: 200 })
      }
      if (path === '/songs' && method === 'POST') {
        if (server.songStatus && server.songStatus !== 200) {
          return new Response(JSON.stringify({ detail: 'no blob stored for tab_blob_hash' }), {
            status: server.songStatus,
          })
        }
        server.posted.push(JSON.parse(init!.body as string))
        return new Response(JSON.stringify({}), { status: 200 })
      }
      if (path.startsWith('/blob/')) {
        const hash = path.slice('/blob/'.length)
        if (!server.blobs.has(hash)) return new Response('', { status: 404 })
        return new Response(TAB_BYTES, { status: 200 })
      }
      return new Response('', { status: 404 })
    }),
  )
  return server
}

function emptyServer(overrides: Partial<FakeServer> = {}): FakeServer {
  return { library: [], blobs: new Set(), uploads: [], posted: [], ...overrides }
}

describe('pullLibrary', () => {
  it('adds a song and downloads its tab file', async () => {
    stubDesktop(
      emptyServer({
        library: [remoteSong({ tab_blob_hash: TAB_HASH })],
        blobs: new Set([TAB_HASH]),
      }),
    )

    const result = await pullLibrary(BASE)

    expect(result.added).toBe(1)
    expect(result.tabsMissing).toEqual([])
    const db = await getDb()
    const stored = await getSong(db, 'song-1')
    expect(stored?.title).toBe('Welcome To The Black Parade')
    expect(await hasBlob(db, TAB_HASH)).toBe(true)
  })

  it('reports a tab whose bytes do not match the hash asked for', async () => {
    // A desktop serving the wrong bytes would otherwise leave a song that
    // looks downloaded but whose tab never resolves.
    stubDesktop(
      emptyServer({
        library: [remoteSong({ tab_blob_hash: 'a'.repeat(64) })],
        blobs: new Set(['a'.repeat(64)]), // served content is TAB_BYTES, which hashes differently
      }),
    )

    const result = await pullLibrary(BASE)

    expect(result.tabsMissing).toEqual(['Welcome To The Black Parade'])
    const db = await getDb()
    expect(await hasBlob(db, 'a'.repeat(64))).toBe(false)
  })

  it('keeps the song when its tab file cannot be downloaded', async () => {
    // ADR-003 principle 2: the library list always renders, and a missing
    // asset is state on the row rather than a vanished row.
    stubDesktop(emptyServer({ library: [remoteSong()], blobs: new Set() }))

    const result = await pullLibrary(BASE)

    expect(result.added).toBe(1)
    expect(result.tabsMissing).toEqual(['Welcome To The Black Parade'])
    const db = await getDb()
    expect(await getSong(db, 'song-1')).toBeDefined()
  })

  it('does not re-download a tab it already has', async () => {
    const db = await getDb()
    await putBlob(db, TAB_BYTES, 'tab')
    stubDesktop(
      emptyServer({ library: [remoteSong({ tab_blob_hash: TAB_HASH })], blobs: new Set([TAB_HASH]) }),
    )

    await pullLibrary(BASE)

    const blobFetches = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).includes('/blob/'),
    )
    expect(blobFetches.length).toBe(0)
  })

  it('reports an unchanged song rather than rewriting it', async () => {
    stubDesktop(emptyServer({ library: [remoteSong()], blobs: new Set([TAB_HASH]) }))
    await pullLibrary(BASE)

    const second = await pullLibrary(BASE)

    expect(second.unchanged).toBe(1)
    expect(second.added).toBe(0)
    expect(second.updated).toBe(0)
  })

  it('applies a rename made on the desktop', async () => {
    stubDesktop(emptyServer({ library: [remoteSong()], blobs: new Set([TAB_HASH]) }))
    await pullLibrary(BASE)

    stubDesktop(
      emptyServer({ library: [remoteSong({ title: 'Renamed' })], blobs: new Set([TAB_HASH]) }),
    )
    const result = await pullLibrary(BASE)

    expect(result.updated).toBe(1)
    const db = await getDb()
    expect((await getSong(db, 'song-1'))?.title).toBe('Renamed')
  })

  it('does not spend bandwidth on an archived song', async () => {
    const server = stubDesktop(
      emptyServer({ library: [remoteSong({ archived: true })], blobs: new Set([TAB_HASH]) }),
    )

    await pullLibrary(BASE)

    const blobFetches = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
      String(call[0]).includes('/blob/'),
    )
    expect(blobFetches.length).toBe(0)
    expect(server.posted).toEqual([])

    const db = await getDb()
    expect((await getSong(db, 'song-1'))?.archived).toBe(true)
  })
})

describe('pushLibrary', () => {
  it('sends a song the desktop has never seen', async () => {
    const db = await getDb()
    const hash = await putBlob(db, TAB_BYTES, 'tab')
    await putSong(db, localSong({ tabBlobHash: hash }))
    const server = stubDesktop(emptyServer())

    const result = await pushLibrary(BASE)

    expect(result.pushed).toBe(1)
    expect(server.uploads.length).toBe(1)
    expect(server.posted[0]).toMatchObject({
      id: 'local-1',
      title: 'Where The Streets Have No Name',
      artist: 'U2',
      source_id: 'gprotab',
      added_at: 500,
    })
  })

  it('uses the hash the desktop computed, not the local one', async () => {
    const db = await getDb()
    const hash = await putBlob(db, TAB_BYTES, 'tab')
    await putSong(db, localSong({ tabBlobHash: hash }))
    const server = stubDesktop(emptyServer())

    await pushLibrary(BASE)

    expect(server.posted[0].tab_blob_hash).toBe('uploaded-hash')
  })

  it('does not re-push a song the desktop already holds', async () => {
    // Re-pushing would overwrite the desktop's catalogue fields with this
    // phone's copy, quietly undoing a rename made there.
    const db = await getDb()
    const hash = await putBlob(db, TAB_BYTES, 'tab')
    await putSong(db, localSong({ id: 'song-1', tabBlobHash: hash }))
    const server = stubDesktop(emptyServer({ library: [remoteSong({ id: 'song-1' })] }))

    const result = await pushLibrary(BASE)

    expect(result.pushed).toBe(0)
    expect(server.posted).toEqual([])
  })

  it('skips a song whose tab bytes are not on this phone', async () => {
    const db = await getDb()
    await putSong(db, localSong({ tabBlobHash: 'evicted' }))
    const server = stubDesktop(emptyServer())

    const result = await pushLibrary(BASE)

    expect(result.pushed).toBe(0)
    expect(result.skippedNoBlob).toEqual(['Where The Streets Have No Name'])
    // Nothing was invented for it: no dangling catalogue row.
    expect(server.posted).toEqual([])
  })

  it('reports a rejection instead of throwing the whole sync away', async () => {
    const db = await getDb()
    const hash = await putBlob(db, TAB_BYTES, 'tab')
    await putSong(db, localSong({ tabBlobHash: hash }))
    stubDesktop(emptyServer({ songStatus: 422 }))

    const result = await pushLibrary(BASE)

    expect(result.pushed).toBe(0)
    expect(result.rejected[0].id).toBe('local-1')
    expect(result.rejected[0].reason).toContain('no blob stored')
  })

  it('preserves ids so practice history stays attached', async () => {
    const db = await getDb()
    const hash = await putBlob(db, TAB_BYTES, 'tab')
    await putSong(db, localSong({ id: '01JQEXISTINGULID0000000001', tabBlobHash: hash }))
    const server = stubDesktop(emptyServer())

    await pushLibrary(BASE)

    expect(server.posted[0].id).toBe('01JQEXISTINGULID0000000001')
  })
})

describe('syncLibrary', () => {
  it('pushes before pulling, so a locally added song is not mistaken for a deletion', async () => {
    const db = await getDb()
    const hash = await putBlob(db, TAB_BYTES, 'tab')
    await putSong(db, localSong({ tabBlobHash: hash }))

    const calls: string[] = []
    const server = emptyServer()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).replace(BASE, '')
        calls.push(`${init?.method ?? 'GET'} ${path}`)
        if (path === '/library') {
          return new Response(JSON.stringify({ version: 2, songs: server.library }), { status: 200 })
        }
        if (path === '/blob') return new Response(JSON.stringify({ hash: 'h' }), { status: 200 })
        if (path === '/songs') return new Response('{}', { status: 200 })
        return new Response('', { status: 404 })
      }),
    )

    await syncLibrary(BASE)

    expect(calls.indexOf('POST /songs')).toBeLessThan(calls.lastIndexOf('GET /library'))
  })
})

describe('visible', () => {
  it('hides archived songs but keeps them retrievable by id', () => {
    const songs = [localSong({ id: 'a' }), localSong({ id: 'b', archived: true })]
    expect(visible(songs).map((s) => s.id)).toEqual(['a'])
  })
})
