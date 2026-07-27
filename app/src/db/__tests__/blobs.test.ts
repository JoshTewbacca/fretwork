import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { getDb } from '../open.ts'
import { getBlob, hasBlob, missingHashes, putBlob } from '../blobs.ts'
import { resetTestDb } from './testDb.ts'

afterEach(resetTestDb)

describe('blobs', () => {
  it('round-trips bytes and produces the known SHA-256 vector for "abc"', async () => {
    const db = await getDb()
    const bytes = new Blob([new TextEncoder().encode('abc')])

    const hash = await putBlob(db, bytes, 'tab')

    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

    const record = await getBlob(db, hash)
    expect(record).toBeDefined()
    expect(record?.kind).toBe('tab')
    expect(record?.size).toBe(3)
    const roundTripped = await record?.bytes.arrayBuffer()
    expect(new Uint8Array(roundTripped!)).toEqual(new Uint8Array([0x61, 0x62, 0x63]))
  })

  it('is idempotent: storing the same bytes twice keeps a single record', async () => {
    const db = await getDb()
    const bytes = new Blob([new Uint8Array([1, 2, 3, 4])])

    const hash1 = await putBlob(db, bytes, 'audio')
    const hash2 = await putBlob(db, bytes, 'audio')

    expect(hash1).toBe(hash2)
    expect(await hasBlob(db, hash1)).toBe(true)

    const all = await db.getAll('blobs')
    expect(all.filter((b) => b.hash === hash1)).toHaveLength(1)
  })

  it('missingHashes reports only hashes without a stored blob', async () => {
    const db = await getDb()
    const present = await putBlob(db, new Blob([new Uint8Array([9])]), 'soundfont')

    const missing = await missingHashes(db, [present, 'deadbeef'])

    expect(missing).toEqual(['deadbeef'])
  })
})
