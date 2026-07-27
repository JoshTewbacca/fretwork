// IndexedDB schema for the `fretwork` database. Authoritative shape reference:
// docs/01-data-model.md. Types are imported from core/types.ts (read-only) so the
// two never drift silently.

import type { DBSchema } from 'idb'
import type {
  AssetState,
  AudioBundle,
  BlobRecord,
  PassageReviewState,
  Passage,
  PracticeEvent,
  Setlist,
  Song,
} from '../core/types.ts'

export const DB_NAME = 'fretwork'
export const DB_VERSION = 1

/** Row shape for the `kv` store: arbitrary settings/config keyed by string. */
export interface KvEntry {
  key: string
  value: unknown
}

export interface FretworkDBSchema extends DBSchema {
  songs: {
    key: string
    value: Song
    indexes: { 'by-artist': string; 'by-addedAt': number }
  }
  audioBundles: {
    key: string
    value: AudioBundle
    indexes: { 'by-songId': string }
  }
  passages: {
    key: string
    value: Passage
    indexes: { 'by-songId': string }
  }
  reviewState: {
    key: string
    value: PassageReviewState
    indexes: { 'by-dueAt': number }
  }
  events: {
    key: string
    value: PracticeEvent
    indexes: { 'by-ts': number; 'by-passageId': string }
  }
  setlists: {
    key: string
    value: Setlist
  }
  blobs: {
    key: string
    value: BlobRecord
  }
  assetState: {
    key: string
    value: AssetState
  }
  kv: {
    key: string
    value: KvEntry
  }
}
