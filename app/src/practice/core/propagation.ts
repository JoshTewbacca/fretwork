// Result propagation between nested passages (ADR-001).
//
// Playing a whole solo cleanly proves its hardest lick was clean too, and a
// kernel that still fails means the parent is not really ready at full tempo.
// Without this, nested passages drift into contradicting each other.

import type { Passage, PassageReviewState, ReviewGrade } from '../../core/types'
import { findKernels, findParents } from './passageGeometry'
import { isCleanGrade } from './grading'
import { applyReview } from './scheduler'

export interface PropagationInput {
  reviewedPassage: Passage
  grade: ReviewGrade
  tempoPct: number
  now: number
  allPassages: readonly Passage[]
  states: ReadonlyMap<string, PassageReviewState>
}

/**
 * Returns only the states that changed as a result of propagation. The
 * reviewed passage itself is handled by the caller via applyReview.
 */
export function propagateReview(input: PropagationInput): Map<string, PassageReviewState> {
  const { reviewedPassage, grade, tempoPct, now, allPassages, states } = input
  const changed = new Map<string, PassageReviewState>()

  if (isCleanGrade(grade)) {
    // Downward: a clean parent implies a clean kernel at the same tempo.
    for (const kernel of findKernels(reviewedPassage, allPassages)) {
      const state = states.get(kernel.id)
      if (!state) continue
      // Only ever an implicit 'good' - never better than an explicit review.
      if (state.masteredTempoPct >= tempoPct) continue
      changed.set(
        kernel.id,
        applyReview(state, { grade: 'good', tempoPct, now }),
      )
    }
    return changed
  }

  // Upward: a failed kernel caps what its parents may claim. Playing the whole
  // passage at 100 percent is not credible while its hardest bar is not.
  for (const parent of findParents(reviewedPassage, allPassages)) {
    const parentState = states.get(parent.id)
    const kernelState = states.get(reviewedPassage.id)
    if (!parentState || !kernelState) continue
    const cap = Math.max(kernelState.masteredTempoPct, 30)
    if (parentState.reviewTempoPct <= cap) continue
    changed.set(parent.id, { ...parentState, reviewTempoPct: cap })
  }

  return changed
}
