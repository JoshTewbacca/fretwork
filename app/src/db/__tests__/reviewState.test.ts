import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import type { PassageReviewState } from '../../core/types.ts'
import { getDb } from '../open.ts'
import { listDue, putReviewState } from '../reviewState.ts'
import { resetTestDb } from './testDb.ts'

afterEach(resetTestDb)

function state(passageId: string, dueAt: number): PassageReviewState {
  return {
    passageId,
    phase: 'acquisition',
    masteredTempoPct: 80,
    reviewTempoPct: 80,
    ease: 2.2,
    intervalDays: 1,
    dueAt,
    reps: 0,
    lapses: 0,
    rebuiltFromEventId: 'e-0',
  }
}

describe('listDue', () => {
  it('includes the exact boundary and excludes anything after it', async () => {
    const db = await getDb()
    await putReviewState(db, state('before', 900))
    await putReviewState(db, state('at-boundary', 1000))
    await putReviewState(db, state('after', 1100))

    const due = await listDue(db, 1000)

    expect(due.map((s) => s.passageId).sort()).toEqual(['at-boundary', 'before'])
  })
})
