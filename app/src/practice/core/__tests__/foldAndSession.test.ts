import { describe, expect, it } from 'vitest'
import { foldPracticeEvents, findCandidatePassages } from '../fold.ts'
import { buildSession, BLOCK_MINUTES } from '../sessionBuilder.ts'
import { propagateReview } from '../propagation.ts'
import { createInitialState, DAY_MS } from '../scheduler.ts'
import type {
  Passage,
  PassageReviewState,
  PracticeEvent,
  ReviewGrade,
} from '../../../core/types.ts'

const NOW = 1_700_000_000_000

function passage(id: string, startBar: number, endBar: number, over: Partial<Passage> = {}): Passage {
  return {
    id,
    songId: 'song-1',
    trackIndex: 0,
    startBar,
    endBar,
    origin: 'user',
    status: 'active',
    createdAt: 0,
    ...over,
  }
}

function review(
  id: string,
  passageId: string,
  grade: ReviewGrade,
  tempoPct: number,
  ts: number,
): PracticeEvent {
  return { id, ts, type: 'review_result', passageId, tempoPct, grade }
}

describe('foldPracticeEvents', () => {
  const passages = [passage('p1', 4, 12)]

  it('produces no state when there is no history', () => {
    const { states } = foldPracticeEvents([], passages)
    expect(states.size).toBe(0)
  })

  it('is deterministic: refolding the same log gives identical state', () => {
    const events: PracticeEvent[] = [
      review('e1', 'p1', 'good', 60, NOW),
      review('e2', 'p1', 'good', 64, NOW + DAY_MS),
      review('e3', 'p1', 'fail', 68, NOW + 2 * DAY_MS),
      review('e4', 'p1', 'easy', 60, NOW + 3 * DAY_MS),
    ]

    const first = foldPracticeEvents(events, passages)
    const second = foldPracticeEvents(events, passages)

    expect(second.states.get('p1')).toEqual(first.states.get('p1'))
    expect(second.lastEventId).toBe('e4')
  })

  it('rebuilding from scratch matches incremental folding', () => {
    const early: PracticeEvent[] = [
      review('e1', 'p1', 'good', 60, NOW),
      review('e2', 'p1', 'good', 64, NOW + DAY_MS),
    ]
    const later: PracticeEvent[] = [review('e3', 'p1', 'hard', 68, NOW + 2 * DAY_MS)]

    const incremental = foldPracticeEvents(
      later,
      passages,
      foldPracticeEvents(early, passages).states,
    )
    const fromScratch = foldPracticeEvents([...early, ...later], passages)

    expect(incremental.states.get('p1')).toEqual(fromScratch.states.get('p1'))
  })

  it('ignores reviews for passages that no longer exist', () => {
    const { states } = foldPracticeEvents([review('e1', 'ghost', 'good', 60, NOW)], passages)
    expect(states.has('ghost')).toBe(false)
  })

  it('records which event each state was built from', () => {
    const { states } = foldPracticeEvents([review('e1', 'p1', 'good', 60, NOW)], passages)
    expect(states.get('p1')?.rebuiltFromEventId).toBe('e1')
  })
})

describe('propagateReview', () => {
  const kernel = passage('k', 10, 12)
  const parent = passage('p', 4, 20)
  const all = [kernel, parent]

  it('credits a kernel when its parent is played cleanly', () => {
    const states = new Map<string, PassageReviewState>([
      ['k', createInitialState('k', 60, NOW)],
      ['p', createInitialState('p', 90, NOW)],
    ])

    const changed = propagateReview({
      reviewedPassage: parent,
      grade: 'good',
      tempoPct: 90,
      now: NOW,
      allPassages: all,
      states,
    })

    expect(changed.has('k')).toBe(true)
    expect(changed.get('k')?.masteredTempoPct).toBe(90)
  })

  it('does not downgrade a kernel already mastered faster', () => {
    const strongKernel = { ...createInitialState('k', 100, NOW), masteredTempoPct: 100 }
    const states = new Map<string, PassageReviewState>([
      ['k', strongKernel],
      ['p', createInitialState('p', 90, NOW)],
    ])

    const changed = propagateReview({
      reviewedPassage: parent,
      grade: 'good',
      tempoPct: 90,
      now: NOW,
      allPassages: all,
      states,
    })

    expect(changed.has('k')).toBe(false)
  })

  it('caps a parent tempo when its hardest kernel fails', () => {
    const states = new Map<string, PassageReviewState>([
      ['k', { ...createInitialState('k', 70, NOW), masteredTempoPct: 70 }],
      ['p', { ...createInitialState('p', 100, NOW), reviewTempoPct: 100 }],
    ])

    const changed = propagateReview({
      reviewedPassage: kernel,
      grade: 'fail',
      tempoPct: 80,
      now: NOW,
      allPassages: all,
      states,
    })

    expect(changed.get('p')?.reviewTempoPct).toBe(70)
  })
})

describe('buildSession', () => {
  const kernel = passage('k', 10, 12)
  const parent = passage('p', 4, 20)

  function dueState(id: string, overdueDays: number): PassageReviewState {
    return {
      ...createInitialState(id, 80, NOW),
      dueAt: NOW - overdueDays * DAY_MS,
      intervalDays: 2,
    }
  }

  it('returns nothing to do when no passage is due', () => {
    const states = new Map([['p', { ...createInitialState('p', 80, NOW), dueAt: NOW + DAY_MS }]])
    const plan = buildSession({ minutes: 20, passages: [parent], states, now: NOW })
    expect(plan.items.filter((i) => i.kind === 'review')).toHaveLength(0)
  })

  it('orders a kernel before the parent that contains it', () => {
    const states = new Map([
      ['p', dueState('p', 4)],
      ['k', dueState('k', 1)],
    ])
    const plan = buildSession({
      minutes: 30,
      passages: [parent, kernel],
      states,
      now: NOW,
    })
    const reviews = plan.items.filter((i) => i.kind === 'review').map((i) => i.passageId)
    expect(reviews.indexOf('k')).toBeLessThan(reviews.indexOf('p'))
  })

  it('respects the time budget and reports what did not fit', () => {
    const many = Array.from({ length: 6 }, (_, i) => passage(`x${i}`, i * 10, i * 10 + 4))
    const states = new Map(many.map((p, i) => [p.id, dueState(p.id, i + 1)]))
    const plan = buildSession({ minutes: BLOCK_MINUTES * 2, passages: many, states, now: NOW })

    expect(plan.items.filter((i) => i.kind === 'review')).toHaveLength(2)
    expect(plan.deferredCount).toBe(4)
    expect(plan.totalMinutes).toBeLessThanOrEqual(BLOCK_MINUTES * 2)
  })

  it('skips retired passages', () => {
    const retired = passage('r', 4, 20, { status: 'retired' })
    const states = new Map([['r', dueState('r', 5)]])
    const plan = buildSession({ minutes: 20, passages: [retired], states, now: NOW })
    expect(plan.items.filter((i) => i.kind === 'review')).toHaveLength(0)
  })
})

describe('findCandidatePassages', () => {
  it('suggests a range the user keeps looping', () => {
    const events: PracticeEvent[] = [
      { id: 'a', ts: NOW, type: 'session_start' },
      {
        id: 'b',
        ts: NOW + 1,
        type: 'loop_block',
        songId: 'song-1',
        startBar: 12,
        endBar: 16,
        tempoPct: 70,
        reps: 10,
        cleanReps: 3,
        durationMs: 60_000,
      },
    ]
    const found = findCandidatePassages(events, new Map([['song-1', 0]]))
    expect(found).toHaveLength(1)
    expect(found[0].startBar).toBe(12)
  })

  it('ignores loop blocks that already belong to a passage', () => {
    const events: PracticeEvent[] = [
      {
        id: 'b',
        ts: NOW,
        type: 'loop_block',
        songId: 'song-1',
        passageId: 'existing',
        startBar: 12,
        endBar: 16,
        tempoPct: 70,
        reps: 20,
        cleanReps: 3,
        durationMs: 60_000,
      },
    ]
    expect(findCandidatePassages(events, new Map())).toHaveLength(0)
  })

  it('does not suggest a range touched only briefly', () => {
    const events: PracticeEvent[] = [
      {
        id: 'b',
        ts: NOW,
        type: 'loop_block',
        songId: 'song-1',
        startBar: 12,
        endBar: 16,
        tempoPct: 70,
        reps: 2,
        cleanReps: 2,
        durationMs: 10_000,
      },
    ]
    expect(findCandidatePassages(events, new Map())).toHaveLength(0)
  })
})
