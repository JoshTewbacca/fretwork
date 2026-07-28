// Single entry point for the practice-intelligence UI (ADR-001). Composes the
// due list, session builder and passage manager. Owns which review block (if
// any) is currently running.
//
// Due work and the session builder are always visible: they are the reason to
// open this tab. Passage housekeeping is not, so it stays folded away.

import { useState } from 'preact/hooks'
import type { JSX } from 'preact'
import type { ReviewGrade } from '../../core/types'
import { DueList } from './DueList'
import { SessionBuilder } from './SessionBuilder'
import { PassageManager } from './PassageManager'
import { ReviewBlock } from './ReviewBlock'
import '../practice.css'

interface RunningReview {
  passageId: string
  tempoPct: number
  label: string
}

export function PracticePanel(): JSX.Element {
  const [running, setRunning] = useState<RunningReview | null>(null)

  function startReview(passageId: string, tempoPct: number, label: string) {
    setRunning({ passageId, tempoPct, label })
  }

  function finishReview(_grade: ReviewGrade) {
    setRunning(null)
  }

  if (running) {
    return (
      <div class="practice-panel">
        <ReviewBlock
          passageId={running.passageId}
          tempoPct={running.tempoPct}
          label={running.label}
          onFinished={finishReview}
        />
      </div>
    )
  }

  return (
    <div class="practice-panel">
      <h2 class="h-sec">Due now</h2>
      <DueList onStartReview={startReview} />

      <h2 class="h-sec">Build a session</h2>
      <SessionBuilder onStartReview={startReview} />

      <details class="practice-fold">
        <summary class="practice-fold__summary">Trouble spots</summary>
        <div class="practice-fold__body">
          <PassageManager />
        </div>
      </details>
    </div>
  )
}
