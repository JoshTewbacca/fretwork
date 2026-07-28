// Rebuilding all practice state from the append-only event log (ADR-001,
// ADR-004). Nothing here mutates history: PassageReviewState is a cache of a
// fold, so a scheduler bug is fixed by changing the fold and rebuilding, not
// by patching stored state.

import type {
  Passage,
  PassageReviewState,
  PracticeEvent,
} from '../../core/types'
import { applyReview, createInitialState } from './scheduler'
import { propagateReview } from './propagation'

export interface FoldResult {
  states: Map<string, PassageReviewState>
  /** Id of the last event folded in, for incremental continuation. */
  lastEventId: string
}

/**
 * Folds review events into per-passage state.
 *
 * @param events must be ordered by timestamp ascending.
 * @param initial optional existing states, for incremental folding.
 */
export function foldPracticeEvents(
  events: readonly PracticeEvent[],
  passages: readonly Passage[],
  initial?: ReadonlyMap<string, PassageReviewState>,
): FoldResult {
  const states = new Map<string, PassageReviewState>(initial ?? [])
  let lastEventId = ''

  for (const event of events) {
    lastEventId = event.id
    if (event.type !== 'review_result') continue

    const passage = passages.find((p) => p.id === event.passageId)
    if (!passage) continue

    const current =
      states.get(event.passageId) ??
      createInitialState(event.passageId, event.tempoPct, event.ts)

    const next = applyReview(current, {
      grade: event.grade,
      tempoPct: event.tempoPct,
      now: event.ts,
    })
    states.set(event.passageId, { ...next, rebuiltFromEventId: event.id })

    const propagated = propagateReview({
      reviewedPassage: passage,
      grade: event.grade,
      tempoPct: event.tempoPct,
      now: event.ts,
      allPassages: passages,
      states,
    })
    for (const [id, state] of propagated) {
      states.set(id, { ...state, rebuiltFromEventId: event.id })
    }
  }

  return { states, lastEventId }
}

export interface LoopTelemetry {
  songId: string
  trackIndex: number
  startBar: number
  endBar: number
  totalReps: number
  sessionCount: number
}

export const CANDIDATE_MIN_REPS_IN_SESSION = 8
export const CANDIDATE_MIN_SESSIONS = 3

/**
 * Loop blocks the user keeps returning to are evidence of a trouble spot.
 * These become *suggested* passages only - silently scheduling something the
 * user never asked for is the fastest way to make a practice tool untrusted.
 */
export function findCandidatePassages(
  events: readonly PracticeEvent[],
  trackIndexBySong: ReadonlyMap<string, number>,
): LoopTelemetry[] {
  const byRange = new Map<string, LoopTelemetry & { sessions: Set<number> }>()
  let sessionIndex = 0

  for (const event of events) {
    if (event.type === 'session_start') {
      sessionIndex += 1
      continue
    }
    if (event.type !== 'loop_block') continue
    // An explicit passage already exists for this block.
    if (event.passageId) continue

    const key = `${event.songId}:${event.startBar}:${event.endBar}`
    const existing = byRange.get(key)
    if (existing) {
      existing.totalReps += event.reps
      existing.sessions.add(sessionIndex)
    } else {
      byRange.set(key, {
        songId: event.songId,
        trackIndex: trackIndexBySong.get(event.songId) ?? 0,
        startBar: event.startBar,
        endBar: event.endBar,
        totalReps: event.reps,
        sessionCount: 0,
        sessions: new Set([sessionIndex]),
      })
    }
  }

  return [...byRange.values()]
    .map((v) => ({
      songId: v.songId,
      trackIndex: v.trackIndex,
      startBar: v.startBar,
      endBar: v.endBar,
      totalReps: v.totalReps,
      sessionCount: v.sessions.size,
    }))
    .filter(
      (v) =>
        v.totalReps >= CANDIDATE_MIN_REPS_IN_SESSION ||
        v.sessionCount >= CANDIDATE_MIN_SESSIONS,
    )
}
