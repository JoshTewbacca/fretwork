// Deriving a review grade from what actually happened in a loop block.
//
// ADR-001 deliberately does not ask the user for an SM-2 style 0-5 rating:
// self-grading fidelity while holding a guitar is low, so the grade is derived
// from the sequence of clean/not-clean marks instead. Four buckets is the
// honest resolution of that signal.

import type { ReviewGrade } from '../../core/types'

/** Number of leading repetitions considered "early" when grading. */
export const EARLY_WINDOW = 5

/**
 * @param repResults ordered results of each repetition, true = clean.
 */
export function deriveGrade(repResults: readonly boolean[]): ReviewGrade {
  const cleanCount = repResults.filter(Boolean).length
  if (cleanCount === 0) return 'fail'

  // Straight out of the gate.
  if (repResults.length >= 2 && repResults[0] && repResults[1]) return 'easy'

  const early = repResults.slice(0, EARLY_WINDOW)
  if (early.filter(Boolean).length >= 2) return 'good'

  // Got there in the end, but it took more than the early window.
  return 'hard'
}

/** True for any grade that counts as having played the passage cleanly. */
export function isCleanGrade(grade: ReviewGrade): boolean {
  return grade !== 'fail'
}
