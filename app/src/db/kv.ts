import type { IDBPDatabase } from 'idb'
import type { FretworkDBSchema, KvEntry } from './schema.ts'

type Db = IDBPDatabase<FretworkDBSchema>

export async function getKv<T = unknown>(db: Db, key: string): Promise<T | undefined> {
  const entry = await db.get('kv', key)
  return entry?.value as T | undefined
}

export async function putKv(db: Db, key: string, value: unknown): Promise<string> {
  const entry: KvEntry = { key, value }
  return db.put('kv', entry)
}

export async function deleteKv(db: Db, key: string): Promise<void> {
  return db.delete('kv', key)
}

export async function listKv(db: Db): Promise<KvEntry[]> {
  return db.getAll('kv')
}
