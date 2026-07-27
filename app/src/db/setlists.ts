import type { IDBPDatabase } from 'idb'
import type { Setlist } from '../core/types.ts'
import type { FretworkDBSchema } from './schema.ts'

type Db = IDBPDatabase<FretworkDBSchema>

export async function getSetlist(db: Db, id: string): Promise<Setlist | undefined> {
  return db.get('setlists', id)
}

export async function putSetlist(db: Db, setlist: Setlist): Promise<string> {
  return db.put('setlists', setlist)
}

export async function deleteSetlist(db: Db, id: string): Promise<void> {
  return db.delete('setlists', id)
}

export async function listSetlists(db: Db): Promise<Setlist[]> {
  return db.getAll('setlists')
}
