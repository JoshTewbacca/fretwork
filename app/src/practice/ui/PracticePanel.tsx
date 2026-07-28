// Single entry point for the practice-intelligence UI (ADR-001). Composes the
// due list, session builder and passage manager into one panel, following the
// <details>/<summary> pattern from player/ui/PlayerControls.tsx. Owns which
// review block (if any) is currently running.

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
      <details class="practice-panel__section" open>
        <summary>Due now</summary>
        <DueList onStartReview={startReview} />
      </details>

      <details class="practice-panel__section">
        <summary>Build a session</summary>
        <SessionBuilder onStartReview={startReview} />
      </details>

      <details class="practice-panel__section">
        <summary>Passages</summary>
        <PassageManager />
      </details>
    </div>
  )
}
