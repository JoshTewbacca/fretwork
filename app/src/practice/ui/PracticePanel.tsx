// Single entry point for the practice-intelligence UI (ADR-001). Composes the
// due list, session builder and passage manager.
//
// This panel only chooses what to review; the block itself runs in the player,
// which is the only place that can actually loop the passage at the tempo the
// scheduler asked for. See practice/activeReview.ts.
//
// Due work and the session builder are always visible: they are the reason to
// open this tab. Passage housekeeping is not, so it stays folded away.

import type { JSX } from 'preact'
import { DueList } from './DueList'
import { SessionBuilder } from './SessionBuilder'
import { PassageManager } from './PassageManager'
import '../practice.css'

export function PracticePanel(): JSX.Element {
  return (
    <div class="practice-panel">
      <h2 class="h-sec">Due now</h2>
      <DueList />

      <h2 class="h-sec">Build a session</h2>
      <SessionBuilder />

      <details class="practice-fold">
        <summary class="practice-fold__summary">Trouble spots</summary>
        <div class="practice-fold__body">
          <PassageManager />
        </div>
      </details>
    </div>
  )
}
