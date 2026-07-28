// The heart of the feature (ADR-001): runs one review block. The user holds
// a guitar, so this is two big thumb buttons and nothing else while the block
// is live; the grade is derived, never self-reported.

import { useState } from 'preact/hooks'
import type { ReviewGrade } from '../../core/types'
import { practiceStore } from '../practiceStore'
import { gradeExplanation, gradeWord } from './helpers'

export interface ReviewBlockProps {
  passageId: string
  tempoPct: number
  label: string
  onFinished: (grade: ReviewGrade) => void
}

export function ReviewBlock({ passageId, tempoPct, label, onFinished }: ReviewBlockProps) {
  const [reps, setReps] = useState<boolean[]>([])
  const [saving, setSaving] = useState(false)
  const [grade, setGrade] = useState<ReviewGrade | null>(null)

  const cleanCount = reps.filter(Boolean).length

  function recordRep(clean: boolean) {
    setReps((prev) => [...prev, clean])
  }

  async function finishBlock() {
    if (reps.length === 0 || saving) return
    setSaving(true)
    try {
      const result = await practiceStore.recordReview(passageId, reps, tempoPct)
      setGrade(result)
    } finally {
      setSaving(false)
    }
  }

  if (grade) {
    return (
      <div class="review-block">
        <h3 class="review-block__label">{label}</h3>
        <p class="review-block__result-word">{gradeWord(grade)}</p>
        <p class="review-block__result-explanation">{gradeExplanation(grade)}</p>
        <button
          type="button"
          class="btn review-block__continue"
          onClick={() => onFinished(grade)}
        >
          Continue
        </button>
      </div>
    )
  }

  return (
    <div class="review-block">
      <h3 class="review-block__label">{label}</h3>
      <p class="review-block__tempo">Tempo {tempoPct}%</p>

      <div class="review-block__buttons">
        <button
          type="button"
          class="review-block__clean"
          onClick={() => recordRep(true)}
        >
          Clean
        </button>
        <button
          type="button"
          class="review-block__notyet"
          onClick={() => recordRep(false)}
        >
          Not yet
        </button>
      </div>

      <p class="review-block__count">
        {reps.length} rep{reps.length === 1 ? '' : 's'} - {cleanCount} clean
      </p>

      <button
        type="button"
        class="btn review-block__finish"
        disabled={reps.length === 0 || saving}
        onClick={finishBlock}
      >
        Finish block
      </button>
    </div>
  )
}
