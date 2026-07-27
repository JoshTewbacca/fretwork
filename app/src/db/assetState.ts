import type { IDBPDatabase } from 'idb'
import type { AssetState } from '../core/types.ts'
import type { FretworkDBSchema } from './schema.ts'

type Db = IDBPDatabase<FretworkDBSchema>

export async function getAssetState(db: Db, key: string): Promise<AssetState | undefined> {
  return db.get('assetState', key)
}

export async function putAssetState(db: Db, state: AssetState): Promise<string> {
  return db.put('assetState', state)
}

export async function deleteAssetState(db: Db, key: string): Promise<void> {
  return db.delete('assetState', key)
}

export async function listAssetStates(db: Db): Promise<AssetState[]> {
  return db.getAll('assetState')
}
