import { describe, expect, it } from 'vitest'
import type { PracticeEvent } from '../../core/types.ts'
import {
  DAY_MS,
  currentStreakDays,
  longestStreakDays,
  mostPracticedPassages,
  practiceMsByDay,
  practiceMsBySong,
  reviewOutcomeCounts,
  sessionSummaries,
  totalPracticeMs,
} from '../aggregate.ts'

// Fixed local-time instants (not UTC) so day-boundary math matches whatever
// timezone the test runner is in, same as the intent of "local day" in the
// aggregate functions themselves.
function local(y: number, m: number, d: number, h = 0, mi = 0): number {
  return new Date(y, m - 1, d, h, mi, 0, 0).getTime()
}

// Plain Omit collapses a discriminated union down to its shared fields; this
// distributes per-member so each variant keeps its own extra properties.
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

let nextId = 0
function ev(partial: DistributiveOmit<PracticeEvent, 'id'>): PracticeEvent {
  nextId++
  return { id: `e${nextId}`, ...partial } as PracticeEvent
}

/**
 * A day marker for streak tests. Streaks count only days the guitar was
 * actually played, so these must be playing events rather than bookkeeping.
 */
function play(ts: number): PracticeEvent {
  return ev({
    type: 'playthrough',
    ts,
    songId: 's1',
    trackIndex: 0,
    tempoPct: 100,
    mode: 'synth',
    durationMs: 300_000,
  })
}

describe('totalPracticeMs', () => {
  it('is zero for an empty log', () => {
    expect(totalPracticeMs([])).toBe(0)
  })

  it('sums playthrough and loop_block durations, ignoring other event types', () => {
    const events: PracticeEvent[] = [
      ev({ type: 'session_start', ts: local(2026, 7, 1, 9, 0) }),
      ev({
        type: 'playthrough',
        ts: local(2026, 7, 1, 9, 5),
        songId: 's1',
        trackIndex: 0,
        tempoPct: 100,
        mode: 'synth',
        durationMs: 60_000,
      }),
      ev({
        type: 'loop_block',
        ts: local(2026, 7, 1, 9, 10),
        songId: 's1',
        startBar: 0,
        endBar: 4,
        tempoPct: 80,
        reps: 5,
        cleanReps: 3,
        durationMs: 30_000,
      }),
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 12), passageId: 'p1', tempoPct: 80, grade: 'good' }),
      ev({ type: 'session_end', ts: local(2026, 7, 1, 9, 20) }),
    ]
    expect(totalPracticeMs(events)).toBe(90_000)
  })
})

describe('practiceMsBySong', () => {
  it('buckets duration events by songId', () => {
    const events: PracticeEvent[] = [
      ev({
        type: 'playthrough',
        ts: local(2026, 7, 1, 9, 0),
        songId: 'a',
        trackIndex: 0,
        tempoPct: 100,
        mode: 'synth',
        durationMs: 10_000,
      }),
      ev({
        type: 'loop_block',
        ts: local(2026, 7, 1, 9, 1),
        songId: 'a',
        startBar: 0,
        endBar: 2,
        tempoPct: 80,
        reps: 3,
        cleanReps: 1,
        durationMs: 5_000,
      }),
      ev({
        type: 'playthrough',
        ts: local(2026, 7, 1, 9, 2),
        songId: 'b',
        trackIndex: 0,
        tempoPct: 100,
        mode: 'synth',
        durationMs: 20_000,
      }),
    ]
    const bySong = practiceMsBySong(events)
    expect(bySong.get('a')).toBe(15_000)
    expect(bySong.get('b')).toBe(20_000)
    expect(bySong.size).toBe(2)
  })

  it('is empty for an empty log', () => {
    expect(practiceMsBySong([]).size).toBe(0)
  })
})

describe('practiceMsByDay', () => {
  it('zero-fills every day in the window when there is no practice', () => {
    const now = local(2026, 7, 27, 12, 0)
    const buckets = practiceMsByDay([], 14, now)
    expect(buckets).toHaveLength(14)
    expect(buckets.every((b) => b.ms === 0)).toBe(true)
    expect(buckets[13].dayStartMs).toBe(local(2026, 7, 27, 0, 0))
    expect(buckets[0].dayStartMs).toBe(local(2026, 7, 14, 0, 0))
  })

  it('buckets an event correctly across a local midnight boundary', () => {
    const now = local(2026, 7, 27, 23, 0)
    const events: PracticeEvent[] = [
      // 11:59pm on the 26th - must land in the 26th's bucket, not the 27th's.
      ev({
        type: 'loop_block',
        ts: local(2026, 7, 26, 23, 59),
        songId: 's1',
        startBar: 0,
        endBar: 1,
        tempoPct: 80,
        reps: 1,
        cleanReps: 1,
        durationMs: 45_000,
      }),
      // 12:01am on the 27th - the very next minute, different local day.
      ev({
        type: 'playthrough',
        ts: local(2026, 7, 27, 0, 1),
        songId: 's1',
        trackIndex: 0,
        tempoPct: 100,
        mode: 'synth',
        durationMs: 15_000,
      }),
    ]
    const buckets = practiceMsByDay(events, 2, now)
    expect(buckets).toHaveLength(2)
    const day26 = buckets.find((b) => b.dayStartMs === local(2026, 7, 26, 0, 0))
    const day27 = buckets.find((b) => b.dayStartMs === local(2026, 7, 27, 0, 0))
    expect(day26?.ms).toBe(45_000)
    expect(day27?.ms).toBe(15_000)
  })

  it('ignores practice outside the requested window', () => {
    const now = local(2026, 7, 27, 12, 0)
    const events: PracticeEvent[] = [
      ev({
        type: 'playthrough',
        ts: local(2026, 1, 1, 9, 0),
        songId: 's1',
        trackIndex: 0,
        tempoPct: 100,
        mode: 'synth',
        durationMs: 60_000,
      }),
    ]
    const buckets = practiceMsByDay(events, 7, now)
    expect(buckets.reduce((sum, b) => sum + b.ms, 0)).toBe(0)
  })
})

describe('sessionSummaries', () => {
  it('is empty for an empty log', () => {
    expect(sessionSummaries([])).toEqual([])
  })

  it('pairs a session_start with its session_end and counts nested events', () => {
    const start = local(2026, 7, 1, 9, 0)
    const end = local(2026, 7, 1, 9, 30)
    const events: PracticeEvent[] = [
      ev({ type: 'session_start', ts: start }),
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 5), passageId: 'p1', tempoPct: 80, grade: 'good' }),
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 6), passageId: 'p2', tempoPct: 80, grade: 'fail' }),
      ev({
        type: 'loop_block',
        ts: local(2026, 7, 1, 9, 10),
        songId: 's1',
        startBar: 0,
        endBar: 2,
        tempoPct: 80,
        reps: 4,
        cleanReps: 2,
        durationMs: 20_000,
      }),
      ev({ type: 'session_end', ts: end }),
    ]
    const summaries = sessionSummaries(events)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toEqual({
      startTs: start,
      endTs: end,
      durationMs: end - start,
      reviewCount: 2,
      loopCount: 1,
    })
  })

  it('reports a session_start with no matching session_end as still open', () => {
    const start = local(2026, 7, 1, 9, 0)
    const events: PracticeEvent[] = [
      ev({ type: 'session_start', ts: start }),
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 5), passageId: 'p1', tempoPct: 80, grade: 'easy' }),
    ]
    const summaries = sessionSummaries(events)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toEqual({
      startTs: start,
      endTs: null,
      durationMs: null,
      reviewCount: 1,
      loopCount: 0,
    })
  })

  it('does not attribute events outside of any open session to a summary', () => {
    const events: PracticeEvent[] = [
      ev({ type: 'review_result', ts: local(2026, 7, 1, 8, 0), passageId: 'stray', tempoPct: 80, grade: 'good' }),
      ev({ type: 'session_start', ts: local(2026, 7, 1, 9, 0) }),
      ev({ type: 'session_end', ts: local(2026, 7, 1, 9, 30) }),
    ]
    const summaries = sessionSummaries(events)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].reviewCount).toBe(0)
  })

  it('handles multiple complete sessions in chronological order', () => {
    const events: PracticeEvent[] = [
      ev({ type: 'session_start', ts: local(2026, 7, 1, 9, 0) }),
      ev({ type: 'session_end', ts: local(2026, 7, 1, 9, 10) }),
      ev({ type: 'session_start', ts: local(2026, 7, 2, 9, 0) }),
      ev({ type: 'session_end', ts: local(2026, 7, 2, 9, 20) }),
    ]
    const summaries = sessionSummaries(events)
    expect(summaries.map((s) => s.durationMs)).toEqual([10 * 60_000, 20 * 60_000])
  })
})

describe('currentStreakDays', () => {
  it('is zero for an empty log', () => {
    expect(currentStreakDays([], local(2026, 7, 27, 12, 0))).toBe(0)
  })

  it('counts a streak that includes today', () => {
    const events: PracticeEvent[] = [
      play(local(2026, 7, 25, 9, 0)),
      play(local(2026, 7, 26, 9, 0)),
      play(local(2026, 7, 27, 9, 0)),
    ]
    expect(currentStreakDays(events, local(2026, 7, 27, 20, 0))).toBe(3)
  })

  it('counts a streak that ended yesterday as still current (today not over)', () => {
    const events: PracticeEvent[] = [
      play(local(2026, 7, 25, 9, 0)),
      play(local(2026, 7, 26, 9, 0)),
    ]
    expect(currentStreakDays(events, local(2026, 7, 27, 8, 0))).toBe(2)
  })

  it('is broken by a missing day', () => {
    const events: PracticeEvent[] = [
      play(local(2026, 7, 20, 9, 0)),
      // gap: nothing on the 21st through the 25th
      play(local(2026, 7, 26, 9, 0)),
    ]
    // "today" is the 27th and yesterday (26th) has practice, so streak is 1.
    expect(currentStreakDays(events, local(2026, 7, 27, 12, 0))).toBe(1)
  })

  it('is zero once the most recent practice is two or more days in the past', () => {
    const events: PracticeEvent[] = [play(local(2026, 7, 24, 9, 0))]
    expect(currentStreakDays(events, local(2026, 7, 27, 12, 0))).toBe(0)
  })
})

describe('longestStreakDays', () => {
  it('is zero for an empty log', () => {
    expect(longestStreakDays([])).toBe(0)
  })

  it('finds the longest run even when a later, shorter run is more recent', () => {
    const events: PracticeEvent[] = [
      play(local(2026, 7, 1, 9, 0)),
      play(local(2026, 7, 2, 9, 0)),
      play(local(2026, 7, 3, 9, 0)),
      play(local(2026, 7, 4, 9, 0)),
      // gap
      play(local(2026, 7, 10, 9, 0)),
      play(local(2026, 7, 11, 9, 0)),
    ]
    expect(longestStreakDays(events)).toBe(4)
  })

  it('counts multiple events on the same day only once', () => {
    const events: PracticeEvent[] = [
      play(local(2026, 7, 1, 9, 0)),
      ev({ type: 'session_end', ts: local(2026, 7, 1, 10, 0) }),
    ]
    expect(longestStreakDays(events)).toBe(1)
  })
})

describe('reviewOutcomeCounts', () => {
  it('returns zero for every grade on an empty log', () => {
    expect(reviewOutcomeCounts([])).toEqual({ easy: 0, good: 0, hard: 0, fail: 0 })
  })

  it('counts review_result events per grade', () => {
    const events: PracticeEvent[] = [
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 0), passageId: 'p1', tempoPct: 80, grade: 'easy' }),
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 1), passageId: 'p1', tempoPct: 80, grade: 'easy' }),
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 2), passageId: 'p2', tempoPct: 80, grade: 'fail' }),
      ev({ type: 'passage_marked', ts: local(2026, 7, 1, 9, 3), passageId: 'p3' }),
    ]
    expect(reviewOutcomeCounts(events)).toEqual({ easy: 2, good: 0, hard: 0, fail: 1 })
  })
})

describe('mostPracticedPassages', () => {
  it('is empty for an empty log', () => {
    expect(mostPracticedPassages([], 5)).toEqual([])
  })

  it('ranks passage ids by review count, most first, respecting the limit', () => {
    const events: PracticeEvent[] = [
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 0), passageId: 'p1', tempoPct: 80, grade: 'good' }),
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 1), passageId: 'p2', tempoPct: 80, grade: 'good' }),
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 2), passageId: 'p2', tempoPct: 80, grade: 'good' }),
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 3), passageId: 'p2', tempoPct: 80, grade: 'good' }),
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 4), passageId: 'p3', tempoPct: 80, grade: 'good' }),
      ev({ type: 'review_result', ts: local(2026, 7, 1, 9, 5), passageId: 'p3', tempoPct: 80, grade: 'good' }),
    ]
    expect(mostPracticedPassages(events, 2)).toEqual([
      { passageId: 'p2', reviewCount: 3 },
      { passageId: 'p3', reviewCount: 2 },
    ])
  })
})

// Sanity check that DAY_MS matches the standard 24h day, since several tests
// above rely on it implicitly via local() date arithmetic performed by the
// aggregate functions themselves.
describe('DAY_MS', () => {
  it('is 24 hours', () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('streaks count only days the guitar was played', () => {
  const DAY = 24 * 60 * 60 * 1000
  const noon = new Date(2026, 0, 15, 12, 0, 0).getTime()

  it('does not count a day that only has bookkeeping events', () => {
    const events: PracticeEvent[] = [
      { id: 'a', ts: noon, type: 'session_start' },
      { id: 'b', ts: noon + 60_000, type: 'passage_marked', passageId: 'p1' },
      { id: 'c', ts: noon + 120_000, type: 'session_end' },
    ]
    expect(currentStreakDays(events, noon + 3 * 60_000)).toBe(0)
    expect(longestStreakDays(events)).toBe(0)
  })

  it('counts a day with a real playthrough', () => {
    const events: PracticeEvent[] = [
      { id: 'a', ts: noon, type: 'session_start' },
      {
        id: 'b',
        ts: noon + 60_000,
        type: 'playthrough',
        songId: 's1',
        trackIndex: 0,
        tempoPct: 100,
        mode: 'synth',
        durationMs: 300_000,
      },
    ]
    expect(currentStreakDays(events, noon + 2 * 60_000)).toBe(1)
  })

  it('breaks a streak on a day that had only a passage mark', () => {
    const events: PracticeEvent[] = [
      {
        id: 'a',
        ts: noon - 2 * DAY,
        type: 'review_result',
        passageId: 'p1',
        tempoPct: 90,
        grade: 'good',
      },
      { id: 'b', ts: noon - DAY, type: 'passage_marked', passageId: 'p2' },
      {
        id: 'c',
        ts: noon,
        type: 'review_result',
        passageId: 'p1',
        tempoPct: 92,
        grade: 'good',
      },
    ]
    // Today counts, yesterday does not, so the streak stops at one.
    expect(currentStreakDays(events, noon + 60_000)).toBe(1)
  })
})
