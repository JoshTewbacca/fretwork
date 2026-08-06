// Merging a desktop catalogue row into the local one (ADR-006).
//
// Pure and IO-free on purpose: this is where a mistake silently destroys
// something the user cannot get back, so it is the part that has to be
// testable against fixed inputs rather than observed in a running sync.
//
// The ownership split is the whole design. Three categories, not two:
//
//   desktop-owned   overwritten every sync
//   seed-once       written only when the song is new to this phone
//   phone-owned     never touched here, and never sent to the desktop
//
// The middle category is the one a naive implementation gets wrong.

import type { Song, SourceId, TabFormat } from '../core/types.ts'
import type { LibrarySong } from '../desktop/client.ts'

/**
 * Fields this phone owns. Listed as a value, not just a comment, so a change
 * to Song that should have been considered here shows up as a type error
 * instead of being silently overwritten on the next sync.
 */
export const PHONE_OWNED_FIELDS = [
  'favourite',
  'tags',
  'lastPlayedAt',
  'correctedTabBlobHash',
  'correctionsBaseHash',
  'audioBundleId',
] as const satisfies readonly (keyof Song)[]

/**
 * The desktop does not validate source_id (it is display metadata, not an
 * integrity concern), so an unrecognised value can arrive. It is carried
 * through rather than coerced: `getTabSource` already returns undefined for
 * an unknown source and the UI copes, whereas rewriting it to something
 * known would make the song claim a provenance it does not have.
 */
function asSourceId(value: string): SourceId {
  return value as SourceId
}

function asTabFormat(value: string): TabFormat {
  return value as TabFormat
}

/**
 * Build the Song to store, given what the desktop says and what is already
 * here. `local` is undefined when the song is new to this phone.
 */
export function mergeSong(local: Song | undefined, remote: LibrarySong): Song {
  // --- desktop-owned: the catalogue facts -----------------------------------
  const merged: Song = {
    id: remote.id,
    title: remote.title,
    artist: remote.artist,
    source: {
      sourceId: asSourceId(remote.source.source_id),
      externalId: remote.source.external_id ?? undefined,
      url: remote.source.url ?? undefined,
    },
    tabBlobHash: remote.tab_blob_hash,
    tabFormat: asTabFormat(remote.tab_format),
    // Derived from the tab file, so the desktop owns it. Falls back to what
    // is already here rather than to zero, so a catalogue row that never
    // recorded a tempo cannot wipe one the phone worked out at import.
    targetTempoBpm: remote.target_tempo_bpm ?? local?.targetTempoBpm ?? 0,
    // added_at is desktop-owned but originates here: the one-time push sends
    // this phone's value and the desktop preserves it, so a synced library
    // keeps its real dates rather than all claiming today.
    addedAt: remote.added_at,

    // --- seed-once ----------------------------------------------------------
    // The desktop can guess which track to play when a file is dropped, but
    // the real answer is the part actually played, and that is discovered
    // here during practice. Overwriting it every sync would silently reset
    // the player's track selection; never writing it would leave new songs
    // with no default at all.
    defaultTrackIndex: local ? local.defaultTrackIndex : (remote.default_track_index ?? 0),

    // --- phone-owned: carried across untouched --------------------------------
    favourite: local?.favourite ?? false,
    tags: local?.tags ?? [],

    // Archived state is desktop-owned, but it is a flag rather than a delete
    // so the practice log can still name the song.
    archived: remote.archived,
  }

  // Optional fields are only assigned when present, so a merged Song does not
  // carry a pile of explicit undefineds into IndexedDB.
  if (remote.album != null) merged.album = remote.album
  if (local?.lastPlayedAt != null) merged.lastPlayedAt = local.lastPlayedAt
  if (local?.correctedTabBlobHash != null) {
    merged.correctedTabBlobHash = local.correctedTabBlobHash
  }
  if (local?.correctionsBaseHash != null) {
    merged.correctionsBaseHash = local.correctionsBaseHash
  }
  // Bundle association is managed by bundleStore, which is the only thing that
  // knows whether the audio bytes are actually local. A merge that set this
  // from the manifest would claim playable audio the phone has not downloaded.
  if (local?.audioBundleId != null) merged.audioBundleId = local.audioBundleId

  return merged
}

/**
 * True when the local copy already matches what the desktop is reporting, so
 * the write can be skipped. Compares only desktop-owned fields: a difference
 * in a phone-owned field is not a reason to write, because the merge would
 * not change it anyway.
 */
export function isUpToDate(local: Song | undefined, remote: LibrarySong): boolean {
  if (!local) return false
  return (
    local.title === remote.title &&
    local.artist === remote.artist &&
    (local.album ?? null) === remote.album &&
    local.tabBlobHash === remote.tab_blob_hash &&
    local.tabFormat === remote.tab_format &&
    (local.targetTempoBpm || null) === remote.target_tempo_bpm &&
    Boolean(local.archived) === remote.archived &&
    local.source.sourceId === remote.source.source_id
  )
}

/**
 * The desktop-owned fields of a local song, shaped for POST /songs.
 *
 * Phone-owned fields are absent by construction rather than by filtering.
 * The desktop has nowhere to put them, and a field it could store is a field
 * it could echo back and overwrite on the next sync.
 */
export function toUploadBody(song: Song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album ?? null,
    source_id: song.source.sourceId,
    source_external_id: song.source.externalId ?? null,
    source_url: song.source.url ?? null,
    tab_blob_hash: song.tabBlobHash,
    tab_format: song.tabFormat,
    default_track_index: song.defaultTrackIndex,
    target_tempo_bpm: song.targetTempoBpm || null,
    // Sent so the desktop can preserve it; this is the value that keeps a
    // migrated library's dates honest.
    added_at: song.addedAt,
  }
}
