// Storage integrity and eviction recovery. Implements the detection half of
// docs/adr/ADR-003-offline-state-machine.md.
//
// iOS can evict IndexedDB even after navigator.storage.persist() is granted,
// so the app must notice missing content rather than silently showing an empty
// or broken library. Metadata is small and survives; the large blobs are what
// disappear, and they are re-fetchable.

import { getDb } from '../db/open'
import { listSongs } from '../db/songs'
import { listAudioBundles } from '../db/audioBundles'
import { missingHashes } from '../db/blobs'
import { getAssetState, putAssetState } from '../db/assetState'
import type { AssetStateValue } from '../core/types'

export interface IntegrityReport {
  /** Songs whose tab file is gone from the blob store. */
  evictedSongs: { id: string; title: string; artist: string; hash: string }[]
  /** Audio bundles missing at least one of their two opus files. */
  evictedBundles: { id: string; songId: string }[]
  checkedAt: number
}

function assetKey(kind: 'tab' | 'audio' | 'soundfont', hash: string): string {
  return `${kind}:${hash}`
}

async function markAsset(
  kind: 'tab' | 'audio',
  hash: string,
  state: AssetStateValue,
): Promise<void> {
  const db = await getDb()
  const key = assetKey(kind, hash)
  const existing = await getAssetState(db, key)
  await putAssetState(db, {
    key,
    state,
    lastVerifiedAt: Date.now(),
    failCount: existing?.failCount ?? 0,
  })
}

/**
 * Fast launch sweep: a key-existence diff, no checksumming on the hot path
 * (ADR-003). Records asset state so the UI can explain what is missing.
 */
export async function sweepForEvictions(): Promise<IntegrityReport> {
  const db = await getDb()
  const [songs, bundles] = await Promise.all([listSongs(db), listAudioBundles(db)])

  const tabHashes = songs.map((s) => s.tabBlobHash)
  // A full-mix bundle has no guitar stem, so filter rather than sweeping for a
  // hash that was never meant to exist and reporting it as evicted.
  const audioHashes = bundles.flatMap((b) =>
    b.guitarBlobHash ? [b.backingBlobHash, b.guitarBlobHash] : [b.backingBlobHash],
  )

  const [missingTabs, missingAudio] = await Promise.all([
    missingHashes(db, tabHashes),
    missingHashes(db, audioHashes),
  ])
  const missingTabSet = new Set(missingTabs)
  const missingAudioSet = new Set(missingAudio)

  const evictedSongs = songs
    .filter((s) => missingTabSet.has(s.tabBlobHash))
    .map((s) => ({ id: s.id, title: s.title, artist: s.artist, hash: s.tabBlobHash }))

  const evictedBundles = bundles
    .filter(
      (b) =>
        missingAudioSet.has(b.backingBlobHash) ||
        (b.guitarBlobHash !== undefined && missingAudioSet.has(b.guitarBlobHash)),
    )
    .map((b) => ({ id: b.id, songId: b.songId }))

  await Promise.all([
    ...tabHashes.map((h) => markAsset('tab', h, missingTabSet.has(h) ? 'evicted' : 'cached')),
    ...audioHashes.map((h) =>
      markAsset('audio', h, missingAudioSet.has(h) ? 'evicted' : 'cached'),
    ),
  ])

  return { evictedSongs, evictedBundles, checkedAt: Date.now() }
}

/** Lazy verification: called when a read misses at the point of use. */
export async function reportMissingAsset(
  kind: 'tab' | 'audio',
  hash: string,
): Promise<void> {
  await markAsset(kind, hash, 'evicted')
}
