// Imports a tab file picked from the filesystem into the library: stores the
// bytes content-addressed in the blobs store (dedup is free, see
// docs/01-data-model.md rule 1) and creates a Song record unless one already
// references those exact bytes.

import type { Song } from '../core/types.ts'
import { getDb } from '../db/open.ts'
import { putBlob } from '../db/blobs.ts'
import { listSongs, putSong } from '../db/songs.ts'
import { ulid } from '../db/ulid.ts'
import { detectTabFormat, guessTitleArtist } from './format.ts'

export async function importTabFile(file: File): Promise<{ song: Song; duplicate: boolean }> {
  const tabFormat = detectTabFormat(file.name)
  if (!tabFormat) {
    throw new Error(
      `"${file.name}" is not a supported tab file. Expected a Guitar Pro (.gp, .gp3-.gp5, .gpx) or MusicXML (.musicxml, .mxl, .xml) file.`,
    )
  }

  const db = await getDb()
  const tabBlobHash = await putBlob(db, file, 'tab')

  const existingSongs = await listSongs(db)
  const existing = existingSongs.find((song) => song.tabBlobHash === tabBlobHash)
  if (existing) {
    return { song: existing, duplicate: true }
  }

  const { title, artist } = guessTitleArtist(file.name)
  const song: Song = {
    id: ulid(),
    title,
    artist,
    source: { sourceId: 'file' },
    tabBlobHash,
    tabFormat,
    defaultTrackIndex: 0,
    targetTempoBpm: 120,
    favourite: false,
    tags: [],
    addedAt: Date.now(),
  }
  await putSong(db, song)
  return { song, duplicate: false }
}
