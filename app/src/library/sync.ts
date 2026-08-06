// Pulling the desktop catalogue down, and pushing this phone's library up.
//
// Two directions, deliberately asymmetric (ADR-006). The desktop holds the
// durable catalogue, so the pull is routine and runs whenever the desktop is
// reachable. The push exists because the phone can still originate a song --
// ADR-005's search works anywhere without the desktop awake -- and because the
// library that already exists here predates the catalogue entirely.
//
// There is no merge algorithm for conflicts because there are none to
// resolve: a song originates in one place, carries a ULID from birth that is
// never reassigned, and every field has exactly one owner (see merge.ts).

import { signal, type ReadonlySignal } from '@preact/signals'
import type { Song } from '../core/types.ts'
import { getDb } from '../db/open.ts'
import { getSong, listSongs, putSong } from '../db/songs.ts'
import { getBlob, hasBlob, putBlob } from '../db/blobs.ts'
import {
  fetchBlob,
  fetchLibrary,
  pushSong,
  uploadBlob,
  type LibrarySong,
} from '../desktop/client.ts'
import { isUpToDate, mergeSong, toUploadBody } from './merge.ts'

export type SyncState =
  | { status: 'idle' }
  | { status: 'syncing'; label: string }
  | { status: 'done'; summary: string }
  | { status: 'error'; message: string }

const state = signal<SyncState>({ status: 'idle' })
export const syncState: ReadonlySignal<SyncState> = state

export interface PullResult {
  added: number
  updated: number
  unchanged: number
  /** Songs whose tab file could not be fetched; they are stored regardless. */
  tabsMissing: string[]
}

export interface PushResult {
  pushed: number
  /** Songs skipped because their tab bytes are not on this phone. */
  skippedNoBlob: string[]
  /** Songs the desktop refused, with the reason it gave. */
  rejected: { id: string; reason: string }[]
}

/**
 * Fetch the tab file for a song if it is not already local.
 *
 * A song is stored even when this fails. The library list renders from the
 * songs store and shows missing assets as state on the row rather than
 * dropping the row (ADR-003 principle 2), so a catalogue entry without its
 * bytes yet is a normal, recoverable condition -- not a reason to lose the
 * song entirely.
 */
async function ensureTab(baseUrl: string, hash: string): Promise<boolean> {
  const db = await getDb()
  if (await hasBlob(db, hash)) return true
  try {
    const bytes = await fetchBlob(baseUrl, hash)
    // putBlob keys on the hash of what it was given, so what comes back is
    // the hash of what actually arrived. If it differs from what was asked
    // for, the bytes are not the file the catalogue points at -- the song
    // would look downloaded while `hasBlob(tabBlobHash)` stayed false forever,
    // which is a far worse failure than reporting it now.
    const stored = await putBlob(db, bytes, 'tab')
    return stored === hash
  } catch {
    return false
  }
}

/** Merge one catalogue row into local storage. Exported for testing. */
export async function applyRemoteSong(
  remote: LibrarySong,
): Promise<'added' | 'updated' | 'unchanged'> {
  const db = await getDb()
  const local = await getSong(db, remote.id)

  if (isUpToDate(local, remote)) return 'unchanged'

  const merged = mergeSong(local, remote)
  await putSong(db, merged)
  return local ? 'updated' : 'added'
}

/**
 * Pull the desktop catalogue into this phone's library.
 *
 * Archived songs are merged like any other: they arrive with the flag set,
 * the library hides them, and their passages and events are left alone.
 */
export async function pullLibrary(baseUrl: string): Promise<PullResult> {
  const result: PullResult = { added: 0, updated: 0, unchanged: 0, tabsMissing: [] }
  const { songs } = await fetchLibrary(baseUrl)

  for (const remote of songs) {
    state.value = { status: 'syncing', label: remote.title }

    const outcome = await applyRemoteSong(remote)
    result[outcome] += 1

    // Archived songs are not worth spending bandwidth or storage on: they are
    // hidden, and if one is ever restored the next sync fetches its tab then.
    if (!remote.archived) {
      const ok = await ensureTab(baseUrl, remote.tab_blob_hash)
      if (!ok) result.tabsMissing.push(remote.title)
    }
  }

  return result
}

/**
 * Push songs the desktop does not have. Used for the one-time migration of an
 * existing phone library, and afterwards for anything added here via search.
 *
 * Only songs the desktop has never seen are sent. Re-pushing a song it
 * already holds would overwrite its catalogue fields with this phone's copy,
 * which would quietly undo any edit made on the desktop -- a rename there
 * would come back changed on the next sync.
 */
export async function pushLibrary(baseUrl: string): Promise<PushResult> {
  const result: PushResult = { pushed: 0, skippedNoBlob: [], rejected: [] }
  const db = await getDb()

  const remote = await fetchLibrary(baseUrl)
  const known = new Set(remote.songs.map((song) => song.id))
  const local = await listSongs(db)

  for (const song of local) {
    if (known.has(song.id)) continue
    state.value = { status: 'syncing', label: song.title }

    // The tab bytes have to go up first: POST /songs rejects a hash with no
    // blob behind it, which is what stops a catalogue row pointing at nothing.
    const blob = await getBlob(db, song.tabBlobHash)
    if (!blob) {
      // Evicted or never downloaded. Nothing to upload, and inventing a row
      // for it would create exactly the dangling reference the desktop
      // refuses on purpose.
      result.skippedNoBlob.push(song.title)
      continue
    }

    try {
      const hash = await uploadBlob(baseUrl, blob.bytes)
      await pushSong(baseUrl, { ...toUploadBody(song), tab_blob_hash: hash })
      result.pushed += 1
    } catch (err) {
      result.rejected.push({
        id: song.id,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

function describe(pull: PullResult, push: PushResult): string {
  const parts: string[] = []
  if (push.pushed) parts.push(`${push.pushed} sent to the desktop`)
  if (pull.added) parts.push(`${pull.added} added`)
  if (pull.updated) parts.push(`${pull.updated} updated`)
  if (!parts.length) parts.push('already up to date')

  const problems: string[] = []
  if (pull.tabsMissing.length) problems.push(`${pull.tabsMissing.length} tab file(s) did not download`)
  if (push.skippedNoBlob.length) problems.push(`${push.skippedNoBlob.length} could not be sent (file not on this phone)`)
  if (push.rejected.length) problems.push(`${push.rejected.length} rejected by the desktop`)

  return problems.length ? `${parts.join(', ')}. ${problems.join('; ')}.` : `${parts.join(', ')}.`
}

/**
 * One full round trip: send what the desktop is missing, then take what it
 * has.
 *
 * Push first. A song added on the phone and not yet on the desktop would
 * otherwise be absent from the pull, present locally, and indistinguishable
 * from one the desktop had archived.
 */
export async function syncLibrary(baseUrl: string): Promise<{ pull: PullResult; push: PushResult }> {
  state.value = { status: 'syncing', label: 'checking the desktop' }
  try {
    const push = await pushLibrary(baseUrl)
    const pull = await pullLibrary(baseUrl)
    state.value = { status: 'done', summary: describe(pull, push) }
    return { pull, push }
  } catch (err) {
    state.value = {
      status: 'error',
      message: err instanceof Error ? err.message : 'The library sync failed.',
    }
    throw err
  }
}

/** Songs the library list should show: everything not archived. */
export function visible(songs: Song[]): Song[] {
  return songs.filter((song) => !song.archived)
}
