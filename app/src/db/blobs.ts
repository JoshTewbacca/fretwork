import type { IDBPDatabase } from 'idb'
import type { BlobKind, BlobRecord } from '../core/types.ts'
import type { FretworkDBSchema } from './schema.ts'

type Db = IDBPDatabase<FretworkDBSchema>

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(bytes: Blob): Promise<string> {
  const buffer = await bytes.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return toHex(digest)
}

/**
 * Stores `bytes` content-addressed by SHA-256. Idempotent: if a blob with the same
 * hash already exists, the existing record is left untouched and the hash is returned.
 */
export async function putBlob(db: Db, bytes: Blob, kind: BlobKind): Promise<string> {
  const hash = await sha256Hex(bytes)
  const existing = await db.get('blobs', hash)
  if (existing) return hash

  const record: BlobRecord = {
    hash,
    bytes,
    size: bytes.size,
    kind,
    refAddedAt: Date.now(),
  }
  await db.put('blobs', record)
  return hash
}

export async function getBlob(db: Db, hash: string): Promise<BlobRecord | undefined> {
  return db.get('blobs', hash)
}

export async function deleteBlob(db: Db, hash: string): Promise<void> {
  return db.delete('blobs', hash)
}

export async function hasBlob(db: Db, hash: string): Promise<boolean> {
  return (await db.getKey('blobs', hash)) !== undefined
}

/** Returns the subset of `hashes` that do not have a stored blob. */
export async function missingHashes(db: Db, hashes: string[]): Promise<string[]> {
  const missing: string[] = []
  for (const hash of hashes) {
    if (!(await hasBlob(db, hash))) missing.push(hash)
  }
  return missing
}
