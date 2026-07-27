import type { IDBPDatabase } from 'idb'
import type { AudioBundle } from '../core/types.ts'
import type { FretworkDBSchema } from './schema.ts'

type Db = IDBPDatabase<FretworkDBSchema>

export async function getAudioBundle(db: Db, id: string): Promise<AudioBundle | undefined> {
  return db.get('audioBundles', id)
}

export async function putAudioBundle(db: Db, bundle: AudioBundle): Promise<string> {
  return db.put('audioBundles', bundle)
}

export async function deleteAudioBundle(db: Db, id: string): Promise<void> {
  return db.delete('audioBundles', id)
}

export async function listAudioBundles(db: Db): Promise<AudioBundle[]> {
  return db.getAll('audioBundles')
}

export async function getAudioBundleBySongId(db: Db, songId: string): Promise<AudioBundle | undefined> {
  return db.getFromIndex('audioBundles', 'by-songId', songId)
}
