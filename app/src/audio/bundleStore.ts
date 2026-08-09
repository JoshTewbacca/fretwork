// Getting the real recording onto the phone and back off it again.
//
// Audio is downloaded once from the desktop and played from IndexedDB, never
// streamed: the point of the whole offline layer is that practice works with the
// desktop switched off (ADR-003). So a bundle is "available" only when its bytes
// are local, and the desktop is needed exactly once per song.

import { signal, type ReadonlySignal } from '@preact/signals'
import type { AudioBundle, SyncMap } from '../core/types'
import { getDb } from '../db/open'
import { getAudioBundleBySongId, putAudioBundle } from '../db/audioBundles'
import { getBlob, hasBlob, putBlob } from '../db/blobs'
import { activeDesktopUrl, fetchBlob, fetchManifest } from '../desktop/client'
import { readStorageBudget } from '../offline/storageBudget'
import type { AudioSources } from '../player/core/externalMedia'

export type DownloadState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'downloading'; label: string }
  | { status: 'done' }
  | { status: 'error'; message: string }

const state = signal<DownloadState>({ status: 'idle' })
export const downloadState: ReadonlySignal<DownloadState> = state

/** A bundle held locally, with object URLs ready for the audio elements. */
export interface LocalBundle {
  bundle: AudioBundle
  sources: AudioSources
  syncMap: SyncMap
  /** Revokes the object URLs. Call when the song is closed. */
  release: () => void
}

/**
 * Load the stored bundle for a song, or null when there is none or its audio has
 * been evicted. Object URLs are minted here and must be released by the caller.
 */
export async function loadLocalBundle(songId: string): Promise<LocalBundle | null> {
  const db = await getDb()
  const bundle = await getAudioBundleBySongId(db, songId)
  if (!bundle) return null

  const backing = await getBlob(db, bundle.backingBlobHash)
  if (!backing) return null
  // The guitar stem is optional: a bundle built before separation ran stores the
  // full mix as the backing and has no guitar hash worth resolving.
  const guitar = bundle.guitarBlobHash
    ? await getBlob(db, bundle.guitarBlobHash)
    : undefined

  const backingUrl = URL.createObjectURL(backing.bytes)
  const guitarUrl = guitar ? URL.createObjectURL(guitar.bytes) : undefined

  return {
    bundle,
    syncMap: bundle.syncMap,
    sources: { backingUrl, guitarUrl, durationMs: bundle.durationMs },
    release: () => {
      URL.revokeObjectURL(backingUrl)
      if (guitarUrl) URL.revokeObjectURL(guitarUrl)
    },
  }
}

/** True when this song already has playable audio stored locally. */
export async function hasLocalBundle(songId: string): Promise<boolean> {
  const db = await getDb()
  const bundle = await getAudioBundleBySongId(db, songId)
  if (!bundle) return false
  return hasBlob(db, bundle.backingBlobHash)
}

/**
 * Download the desktop's bundle for a song and store it.
 *
 * Returns the stored bundle, or null when the desktop has nothing for this song.
 * Throws with a message worth showing when the desktop is unreachable, the
 * download fails, or there is no room.
 */
export async function downloadBundle(songId: string): Promise<AudioBundle | null> {
  state.value = { status: 'checking' }
  try {
    const baseUrl = activeDesktopUrl.value
    if (!baseUrl) {
      throw new Error(
        'The desktop is not connected. Open Settings and test the connection first.',
      )
    }

    const manifest = await fetchManifest(baseUrl)
    const song = manifest.songs.find((entry) => entry.song_id === songId)
    const candidate = song?.bundles.find((b) => b.backing_hash !== null)
    if (!song || !candidate || !candidate.backing_hash) {
      state.value = { status: 'idle' }
      return null
    }
    if (!candidate.sync_map) {
      throw new Error('That bundle has no sync information yet, so it cannot be lined up.')
    }

    // Refuse before downloading rather than filling the last of the quota and
    // failing on write (ADR-003: blocked at 95%).
    const budget = await readStorageBudget()
    if (budget?.level === 'critical') {
      throw new Error('Storage is nearly full. Remove a song before downloading audio.')
    }

    const db = await getDb()
    state.value = { status: 'downloading', label: 'backing track' }
    const backingBlob = await fetchBlob(baseUrl, candidate.backing_hash)
    const backingBlobHash = await putBlob(db, backingBlob, 'audio')

    let guitarBlobHash: string | undefined
    if (candidate.guitar_hash) {
      state.value = { status: 'downloading', label: 'guitar track' }
      const guitarBlob = await fetchBlob(baseUrl, candidate.guitar_hash)
      guitarBlobHash = await putBlob(db, guitarBlob, 'audio')
    }

    const bundle: AudioBundle = {
      id: candidate.id,
      songId,
      backingBlobHash,
      guitarBlobHash,
      durationMs: candidate.duration_ms ?? 0,
      encodeBitrateKbps: 96,
      sourceAudioFingerprint: song.fingerprint,
      // Left absent for a full-mix bundle: claiming a Demucs model that never
      // ran would make a later "which separation produced this" check lie.
      demucsModel: guitarBlobHash ? 'htdemucs_6s' : undefined,
      syncMap: candidate.sync_map,
      createdAt: candidate.created_at,
    }
    await putAudioBundle(db, bundle)

    state.value = { status: 'done' }
    return bundle
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state.value = { status: 'error', message }
    throw err
  }
}

export function resetDownloadState(): void {
  state.value = { status: 'idle' }
}
