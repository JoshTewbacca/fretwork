// Turns a search result from a TabSource into a library Song: fetches the
// bytes, stores them content-addressed (dedup is free, see
// docs/01-data-model.md rule 1), and creates a Song record unless one already
// references those exact bytes. Mirrors import/importFile.ts's shape, but the
// format falls back to 'gp3' instead of rejecting, since sources here are
// trusted to serve tab files even when the filename carries no extension.

import type { Song } from '../core/types.ts'
import type { TabSearchResult, TabSource } from '../sources/types.ts'
import { getDb } from '../db/open.ts'
import { putBlob } from '../db/blobs.ts'
import { listSongs, putSong } from '../db/songs.ts'
import { ulid } from '../db/ulid.ts'
import { detectTabFormat } from '../import/format.ts'

const FALLBACK_FORMAT = 'gp3'

export async function addSearchResultToLibrary(
  source: TabSource,
  result: TabSearchResult,
): Promise<Song> {
  const fetched = await source.fetchTab(result)
  const tabFormat = detectTabFormat(fetched.filename) ?? FALLBACK_FORMAT

  const db = await getDb()
  const blob = new Blob([fetched.bytes])
  const tabBlobHash = await putBlob(db, blob, 'tab')

  const existingSongs = await listSongs(db)
  const existing = existingSongs.find((song) => song.tabBlobHash === tabBlobHash)
  if (existing) return existing

  const song: Song = {
    id: ulid(),
    title: result.title,
    artist: result.artist,
    source: { sourceId: source.id, externalId: result.externalId, url: result.url },
    tabBlobHash,
    tabFormat,
    defaultTrackIndex: 0,
    targetTempoBpm: 120,
    favourite: false,
    tags: [],
    addedAt: Date.now(),
  }
  await putSong(db, song)
  return song
}
