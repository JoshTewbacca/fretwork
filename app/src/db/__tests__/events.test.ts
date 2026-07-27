import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import type { PracticeEvent } from '../../core/types.ts'
import { getDb } from '../open.ts'
import { append, listAll, listByPassage, listSince } from '../events.ts'
import { resetTestDb } from './testDb.ts'

afterEach(resetTestDb)

function sessionEvent(id: string, ts: number): PracticeEvent {
  return { id, ts, type: 'session_start' }
}

describe('events', () => {
  it('listAll and listSince return events ordered by ts ascending, regardless of insertion order', async () => {
    const db = await getDb()

    // Insert out of ts order on purpose.
    await append(db, sessionEvent('e-300', 300))
    await append(db, sessionEvent('e-100', 100))
    await append(db, sessionEvent('e-200', 200))

    const all = await listAll(db)
    expect(all.map((e) => e.ts)).toEqual([100, 200, 300])

    const since200 = await listSince(db, 200)
    expect(since200.map((e) => e.id)).toEqual(['e-200', 'e-300'])
  })

  it('listSince is inclusive of the boundary timestamp', async () => {
    const db = await getDb()
    await append(db, sessionEvent('e-boundary', 500))

    const result = await listSince(db, 500)

    expect(result.map((e) => e.id)).toEqual(['e-boundary'])
  })

  it('listByPassage only returns events referencing that passage', async () => {
    const db = await getDb()
    const withPassage: PracticeEvent = {
      id: 'e-loop',
      ts: 1,
      type: 'loop_block',
      songId: 'song-1',
      passageId: 'passage-1',
      startBar: 0,
      endBar: 4,
      tempoPct: 100,
      reps: 1,
      cleanReps: 1,
      durationMs: 1000,
    }
    const withoutPassage: PracticeEvent = { id: 'e-session', ts: 2, type: 'session_end' }

    await append(db, withPassage)
    await append(db, withoutPassage)

    const result = await listByPassage(db, 'passage-1')

    expect(result.map((e) => e.id)).toEqual(['e-loop'])
  })
})
