// Module-level library store: signals for the song list plus the current
// filter/sort UI state, and a computed view combining them. Screens bind to
// the signals directly (no props threading needed).

import { signal, computed } from '@preact/signals'
import type { Song } from '../core/types.ts'
import { getDb } from '../db/open.ts'
import { listSongs, putSong, deleteSong } from '../db/songs.ts'
import { sweepUnreferencedBlobs } from '../db/gc.ts'

export type SortBy = 'recent' | 'recent-played' | 'title' | 'artist'

/** All songs, newest first. Populated by refresh(). */
export const songs = signal<Song[]>([])
export const query = signal('')
export const sortBy = signal<SortBy>('recent')
export const favouritesOnly = signal(false)

function byAddedAtDesc(a: Song, b: Song): number {
  return b.addedAt - a.addedAt
}

// Never-played songs (no lastPlayedAt) always sort after any played song,
// regardless of direction; among played songs, most-recent first.
function byLastPlayedDesc(a: Song, b: Song): number {
  if (a.lastPlayedAt == null && b.lastPlayedAt == null) return 0
  if (a.lastPlayedAt == null) return 1
  if (b.lastPlayedAt == null) return -1
  return b.lastPlayedAt - a.lastPlayedAt
}

function sortSongs(list: Song[], by: SortBy): Song[] {
  const sorted = [...list]
  switch (by) {
    case 'title':
      sorted.sort((a, b) => a.title.localeCompare(b.title))
      break
    case 'artist':
      sorted.sort((a, b) => a.artist.localeCompare(b.artist))
      break
    case 'recent':
      sorted.sort(byAddedAtDesc)
      break
    case 'recent-played':
      sorted.sort(byLastPlayedDesc)
      break
  }
  return sorted
}

/** Songs after applying the text query and favourites filter, then sortBy. */
export const visibleSongs = computed(() => {
  const q = query.value.trim().toLowerCase()
  // Archived songs stay in `songs` so the practice log can still resolve their
  // titles, and are filtered out of every list the user browses (ADR-006).
  let list = songs.value.filter((song) => !song.archived)

  if (favouritesOnly.value) {
    list = list.filter((song) => song.favourite)
  }
  if (q) {
    list = list.filter(
      (song) => song.title.toLowerCase().includes(q) || song.artist.toLowerCase().includes(q),
    )
  }

  return sortSongs(list, sortBy.value)
})

export async function refresh(): Promise<void> {
  const db = await getDb()
  const all = await listSongs(db)
  songs.value = [...all].sort(byAddedAtDesc)
}

export async function toggleFavourite(id: string): Promise<void> {
  const db = await getDb()
  const song = songs.value.find((s) => s.id === id)
  if (!song) return
  await putSong(db, { ...song, favourite: !song.favourite })
  await refresh()
}

export async function removeSong(id: string): Promise<void> {
  const db = await getDb()
  await deleteSong(db, id)
  // The song's tab blob (and, once corrections exist, correctedTabBlobHash)
  // is now orphaned unless another song references the same bytes.
  await sweepUnreferencedBlobs(db)
  await refresh()
}
