import type { IDBPDatabase } from 'idb'
import type { PracticeEvent } from '../core/types.ts'
import type { FretworkDBSchema } from './schema.ts'

type Db = IDBPDatabase<FretworkDBSchema>

/** Appends an event to the log. Idempotent on `id` (put, not add). */
export async function append(db: Db, event: PracticeEvent): Promise<string> {
  return db.put('events', event)
}

/** All events with ts >= tsInclusive, ordered by ts ascending. */
export async function listSince(db: Db, tsInclusive: number): Promise<PracticeEvent[]> {
  return db.getAllFromIndex('events', 'by-ts', IDBKeyRange.lowerBound(tsInclusive))
}

/** Every event, ordered by ts ascending. */
export async function listAll(db: Db): Promise<PracticeEvent[]> {
  return db.getAllFromIndex('events', 'by-ts')
}

/** Every event referencing a given passageId, ordered by insertion (not ts). */
export async function listByPassage(db: Db, passageId: string): Promise<PracticeEvent[]> {
  return db.getAllFromIndex('events', 'by-passageId', passageId)
}
