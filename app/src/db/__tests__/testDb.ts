// Shared test helper: gives each test a clean `fretwork` database.
// Not itself a test file (no .test.ts suffix), so vitest won't try to run it directly.

import { deleteDB } from 'idb'
import { getDb, resetDbForTests } from '../open.ts'
import { DB_NAME } from '../schema.ts'

export async function resetTestDb(): Promise<void> {
  const db = await getDb()
  db.close()
  resetDbForTests()
  await deleteDB(DB_NAME)
}
