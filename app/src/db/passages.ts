import type { IDBPDatabase } from 'idb'
import type { Passage } from '../core/types.ts'
import type { FretworkDBSchema } from './schema.ts'

type Db = IDBPDatabase<FretworkDBSchema>

export async function getPassage(db: Db, id: string): Promise<Passage | undefined> {
  return db.get('passages', id)
}

export async function putPassage(db: Db, passage: Passage): Promise<string> {
  return db.put('passages', passage)
}

export async function deletePassage(db: Db, id: string): Promise<void> {
  return db.delete('passages', id)
}

export async function listPassages(db: Db): Promise<Passage[]> {
  return db.getAll('passages')
}

export async function listPassagesBySongId(db: Db, songId: string): Promise<Passage[]> {
  return db.getAllFromIndex('passages', 'by-songId', songId)
}
