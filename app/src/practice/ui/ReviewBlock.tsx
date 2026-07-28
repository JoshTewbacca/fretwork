// The heart of the feature (ADR-001): runs one review block.
//
// It lives in the player dock, replacing the speed rail, because the player is
// where the passage is actually looping at the tempo the scheduler chose. The
// user holds a guitar, so while the block is live this is two big thumb
// buttons and nothing else; the grade is derived, never self-reported.

import { useRef, useState } from 'preact/hooks'
import type { ActiveReview } from '../activeReview'
import { practiceStore } from '../practiceStore'
import { gradeExplanation, gradeWord } from './helpers'
import type { ReviewGrade } from '../../core/types'

export interface ReviewBlockProps {
  review: ActiveReview
  /** Called once the user has seen the result and moved on. */
  onFinished: (grade: ReviewGrade | null) => void
}

export function ReviewBlock({ review, onFinished }: ReviewBlockProps) {
  const [reps, setReps] = useState<boolean[]>([])
  const [saving, setSaving] = useState(false)
  const [grade, setGrade] = useState<ReviewGrade | null>(null)
  // Time spent on the block, so reviews count toward the practice log.
  const startedAt = useRef(Date.now())

  const cleanCount = reps.filter(Boolean).length

  async function finishBlock() {
    if (reps.length === 0 || saving) return
    setSaving(true)
    try {
      setGrade(
        await practiceStore.recordReview(
          review.passageId,
          reps,
          review.tempoPct,
          Date.now() - startedAt.current,
        ),
      )
    } finally {
      setSaving(false)
    }
  }

  // The result waits for the user rather than closing itself, so it is
  // actually seen (see the M2 note in docs/00-milestone-plan.md).
  if (grade) {
    return (
      <div class="review-dock review-dock--result">
        <p class="review-dock__result">{gradeWord(grade)}</p>
        <p class="review-dock__explanation">{gradeExplanation(grade)}</p>
        <button
          type="button"
          class="btn btn--primary btn--block"
          onClick={() => onFinished(grade)}
        >
          Continue
        </button>
      </div>
    )
  }

  return (
    <div class="review-dock">
      <div class="review-dock__head">
        <div class="review-dock__text">
          <div class="review-dock__label">{review.label}</div>
          <div class="review-dock__meta">
            {reps.length} rep{reps.length === 1 ? '' : 's'} · {cleanCount} clean ·{' '}
            {review.tempoPct}%
          </div>
        </div>
        <button
          type="button"
          class="btn btn--small"
          disabled={saving}
          onClick={() => (reps.length === 0 ? onFinished(null) : void finishBlock())}
        >
          {reps.length === 0 ? 'Cancel' : 'Finish'}
        </button>
      </div>

      <div class="review-dock__buttons">
        <button
          type="button"
          class="review-dock__clean"
          onClick={() => setReps((prev) => [...prev, true])}
        >
          Clean
        </button>
        <button
          type="button"
          class="review-dock__notyet"
          onClick={() => setReps((prev) => [...prev, false])}
        >
          Not yet
        </button>
      </div>
    </div>
  )
}
