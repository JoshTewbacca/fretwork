import type { IDBPDatabase } from 'idb'
import type { PassageReviewState } from '../core/types.ts'
import type { FretworkDBSchema } from './schema.ts'

type Db = IDBPDatabase<FretworkDBSchema>

export async function getReviewState(db: Db, passageId: string): Promise<PassageReviewState | undefined> {
  return db.get('reviewState', passageId)
}

export async function putReviewState(db: Db, state: PassageReviewState): Promise<string> {
  return db.put('reviewState', state)
}

export async function deleteReviewState(db: Db, passageId: string): Promise<void> {
  return db.delete('reviewState', passageId)
}

export async function listReviewStates(db: Db): Promise<PassageReviewState[]> {
  return db.getAll('reviewState')
}

/** Passages due at or before `now` (inclusive), ordered by dueAt ascending. */
export async function listDue(db: Db, now: number): Promise<PassageReviewState[]> {
  return db.getAllFromIndex('reviewState', 'by-dueAt', IDBKeyRange.upperBound(now))
}
