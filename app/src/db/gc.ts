// Garbage-collects blobs no longer referenced by any song, audio bundle, or the
// soundfont kv setting. See docs/01-data-model.md rule 1 (content-addressed blobs).

import type { IDBPDatabase } from 'idb'
import type { FretworkDBSchema } from './schema.ts'

type Db = IDBPDatabase<FretworkDBSchema>

async function collectReferencedHashes(db: Db): Promise<Set<string>> {
  const referenced = new Set<string>()

  const songs = await db.getAll('songs')
  for (const song of songs) {
    referenced.add(song.tabBlobHash)
    if (song.correctedTabBlobHash) referenced.add(song.correctedTabBlobHash)
  }

  const bundles = await db.getAll('audioBundles')
  for (const bundle of bundles) {
    referenced.add(bundle.backingBlobHash)
    referenced.add(bundle.guitarBlobHash)
  }

  const soundfontHash = await db.get('kv', 'soundfontHash')
  if (soundfontHash && typeof soundfontHash.value === 'string') {
    referenced.add(soundfontHash.value)
  }

  return referenced
}

/** Deletes every blob record not referenced by songs, audio bundles, or the soundfont kv entry. */
export async function sweepUnreferencedBlobs(db: Db): Promise<{ removed: string[] }> {
  const referenced = await collectReferencedHashes(db)
  const allHashes = await db.getAllKeys('blobs')

  const removed: string[] = []
  for (const hash of allHashes) {
    if (!referenced.has(hash)) {
      await db.delete('blobs', hash)
      removed.push(hash)
    }
  }

  return { removed }
}
