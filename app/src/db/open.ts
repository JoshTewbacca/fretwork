// Opens (and lazily caches) the `fretwork` IndexedDB database.
//
// Migrations are structured as a switch over `oldVersion` so each version bump only
// needs a new `case` that runs the delta from the previous version forward. There is
// only one version today, but the shape is in place for when v2 shows up.

import { openDB, type IDBPDatabase } from 'idb'
import { DB_NAME, DB_VERSION, type FretworkDBSchema } from './schema.ts'

function migrate(db: IDBPDatabase<FretworkDBSchema>, oldVersion: number): void {
  // Falls through intentionally: each case applies the delta for that version, and a
  // fresh database (oldVersion === 0) runs every case in sequence.
  switch (oldVersion) {
    case 0: {
      const songs = db.createObjectStore('songs', { keyPath: 'id' })
      songs.createIndex('by-artist', 'artist')
      songs.createIndex('by-addedAt', 'addedAt')

      const audioBundles = db.createObjectStore('audioBundles', { keyPath: 'id' })
      audioBundles.createIndex('by-songId', 'songId')

      const passages = db.createObjectStore('passages', { keyPath: 'id' })
      passages.createIndex('by-songId', 'songId')

      const reviewState = db.createObjectStore('reviewState', { keyPath: 'passageId' })
      reviewState.createIndex('by-dueAt', 'dueAt')

      const events = db.createObjectStore('events', { keyPath: 'id' })
      events.createIndex('by-ts', 'ts')
      // Not every PracticeEvent variant has a passageId; idb/IndexedDB simply omits
      // records where the keyPath value is undefined from this index.
      events.createIndex('by-passageId', 'passageId')

      db.createObjectStore('setlists', { keyPath: 'id' })
      db.createObjectStore('blobs', { keyPath: 'hash' })
      db.createObjectStore('assetState', { keyPath: 'key' })
      db.createObjectStore('kv', { keyPath: 'key' })
      // falls through
    }
  }
}

let dbPromise: Promise<IDBPDatabase<FretworkDBSchema>> | undefined

/** Returns the shared, lazily-opened database handle. Safe to call repeatedly. */
export function getDb(): Promise<IDBPDatabase<FretworkDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<FretworkDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        migrate(db, oldVersion)
      },
    })
  }
  return dbPromise
}

/** Test-only escape hatch: forces the next getDb() call to re-open the database. */
export function resetDbForTests(): void {
  dbPromise = undefined
}
