// The bar-level spaced repetition scheduler. This is the implementation of
// docs/adr/ADR-001-bar-level-spaced-repetition.md - read that first; it
// explains why this is not plain SM-2.
//
// Core idea: mastery has two dimensions, tempo and retention, and only one of
// them moves at a time. Below full tempo, tempo is the progress axis and
// intervals stay short. At full tempo, tempo freezes and the interval grows.

import type { PassageReviewState, PracticePhase, ReviewGrade } from '../../core/types'
import { isCleanGrade } from './grading'

export const DAY_MS = 24 * 60 * 60 * 1000

export const EASE_START = 2.2
export const EASE_MIN = 1.3
export const EASE_MAX = 2.8

export const ACQUISITION_CEILING = 90
export const CONSOLIDATION_CEILING = 100

export const MIN_TEMPO_PCT = 30
export const OVERSPEED_TEMPO_PCT = 110
export const MAX_INTERVAL_DAYS = 60

/** Tempo step applied on a successful acquisition block. Configurable ramp. */
export const DEFAULT_RAMP_STEP = 4
export const FAIL_TEMPO_DROP = 8

export interface ReviewInput {
  grade: ReviewGrade
  /** Tempo the block was actually played at. */
  tempoPct: number
  now: number
  /** Ramp step for acquisition; defaults to DEFAULT_RAMP_STEP. */
  rampStep?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function createInitialState(
  passageId: string,
  startTempoPct = 60,
  now = Date.now(),
): PassageReviewState {
  return {
    passageId,
    phase: 'acquisition',
    masteredTempoPct: 0,
    reviewTempoPct: clamp(Math.round(startTempoPct), MIN_TEMPO_PCT, 125),
    ease: EASE_START,
    intervalDays: 1,
    dueAt: now,
    reps: 0,
    lapses: 0,
    consecutiveEasy: 0,
    consecutiveLapses: 0,
    rebuiltFromEventId: '',
  }
}

function phaseFor(masteredTempoPct: number): PracticePhase {
  if (masteredTempoPct >= CONSOLIDATION_CEILING) return 'maintenance'
  if (masteredTempoPct >= ACQUISITION_CEILING) return 'consolidation'
  return 'acquisition'
}

/**
 * A lapse is not a reset. Motor skill relearns fast after a break (the savings
 * effect), so we step back rather than start over. Two lapses in a row is a
 * stronger signal and drops the passage all the way to acquisition.
 */
function applyLapse(state: PassageReviewState, now: number): PassageReviewState {
  const consecutiveLapses = state.consecutiveLapses + 1
  const ease = clamp(state.ease - 0.2, EASE_MIN, EASE_MAX)

  if (consecutiveLapses >= 2) {
    const mastered = Math.max(MIN_TEMPO_PCT, state.masteredTempoPct - 20)
    return {
      ...state,
      phase: 'acquisition',
      masteredTempoPct: mastered,
      reviewTempoPct: Math.max(MIN_TEMPO_PCT, mastered),
      ease,
      intervalDays: 1,
      dueAt: now + DAY_MS,
      lapses: state.lapses + 1,
      consecutiveEasy: 0,
      consecutiveLapses,
      lastReviewedAt: now,
    }
  }

  const mastered = Math.max(60, state.masteredTempoPct - 10)
  return {
    ...state,
    phase: 'consolidation',
    masteredTempoPct: mastered,
    reviewTempoPct: Math.max(MIN_TEMPO_PCT, mastered),
    ease,
    intervalDays: 2,
    dueAt: now + 2 * DAY_MS,
    lapses: state.lapses + 1,
    consecutiveEasy: 0,
    consecutiveLapses,
    lastReviewedAt: now,
  }
}

export function applyReview(
  state: PassageReviewState,
  input: ReviewInput,
): PassageReviewState {
  const { grade, tempoPct, now } = input
  const rampStep = input.rampStep ?? DEFAULT_RAMP_STEP
  const clean = isCleanGrade(grade)

  // A clean block at a tempo is the only thing that proves mastery of it.
  const masteredTempoPct = clean
    ? Math.max(state.masteredTempoPct, Math.round(tempoPct))
    : state.masteredTempoPct

  if (!clean && state.phase !== 'acquisition') {
    return applyLapse({ ...state, reps: state.reps + 1 }, now)
  }

  const base: PassageReviewState = {
    ...state,
    reps: state.reps + 1,
    masteredTempoPct,
    lastReviewedAt: now,
    consecutiveEasy: grade === 'easy' ? state.consecutiveEasy + 1 : 0,
    consecutiveLapses: clean ? 0 : state.consecutiveLapses,
  }

  if (state.phase === 'acquisition') {
    let reviewTempoPct = base.reviewTempoPct
    let intervalDays: number

    if (!clean) {
      reviewTempoPct = Math.max(MIN_TEMPO_PCT, reviewTempoPct - FAIL_TEMPO_DROP)
      intervalDays = 1
    } else if (grade === 'hard') {
      // Hold the tempo; the passage is not ready to go faster yet.
      intervalDays = 1
    } else {
      reviewTempoPct = Math.min(CONSOLIDATION_CEILING, reviewTempoPct + rampStep)
      intervalDays = 2
    }

    const promoted = phaseFor(masteredTempoPct)
    if (promoted !== 'acquisition') {
      // Entering consolidation: intervals start growing, tempo settles high.
      return {
        ...base,
        phase: promoted,
        reviewTempoPct: promoted === 'maintenance' ? 100 : Math.max(96, reviewTempoPct),
        intervalDays: promoted === 'maintenance' ? 3 : 2,
        dueAt: now + (promoted === 'maintenance' ? 3 : 2) * DAY_MS,
      }
    }

    return {
      ...base,
      phase: 'acquisition',
      reviewTempoPct,
      intervalDays,
      dueAt: now + intervalDays * DAY_MS,
    }
  }

  if (state.phase === 'consolidation') {
    if (masteredTempoPct >= CONSOLIDATION_CEILING) {
      return {
        ...base,
        phase: 'maintenance',
        reviewTempoPct: 100,
        intervalDays: 3,
        dueAt: now + 3 * DAY_MS,
      }
    }
    // Fixed gentle growth, no ease multiplication yet.
    const intervalDays = state.intervalDays < 4 ? 4 : 4
    return {
      ...base,
      phase: 'consolidation',
      reviewTempoPct: clamp(Math.max(96, base.reviewTempoPct), 96, CONSOLIDATION_CEILING),
      intervalDays,
      dueAt: now + intervalDays * DAY_MS,
    }
  }

  // Maintenance: now, and only now, it behaves like SM-2, because retention is
  // finally the thing being managed.
  const easeDelta = grade === 'easy' ? 0.15 : grade === 'hard' ? -0.15 : 0
  const ease = clamp(state.ease + easeDelta, EASE_MIN, EASE_MAX)
  const intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.round(state.intervalDays * ease))
  const overspeed = base.consecutiveEasy >= 2

  return {
    ...base,
    phase: 'maintenance',
    ease,
    reviewTempoPct: overspeed ? OVERSPEED_TEMPO_PCT : 100,
    intervalDays,
    dueAt: now + intervalDays * DAY_MS,
  }
}

/**
 * Retirement is offered, never automatic - silently dropping a passage the
 * user still cares about would destroy trust in the scheduler.
 */
export function isRetirementCandidate(state: PassageReviewState): boolean {
  return state.intervalDays >= MAX_INTERVAL_DAYS && state.ease >= 2.5
}

/** How overdue a passage is, relative to its own interval. */
export function overdueFactor(state: PassageReviewState, now: number): number {
  if (now < state.dueAt) return 0
  const days = Math.max(1, state.intervalDays)
  return (now - state.dueAt) / (days * DAY_MS)
}
