// Pure, UI-facing helpers shared across the practice components: turning the
// core's raw vocabulary (phases, grades, bar ranges) into the plain words the
// ADR-001 UI is supposed to speak, plus the due-list filter/sort.
//
// Kept dependency-free of Preact so it can be unit tested without a DOM.

import type { Passage, PassageReviewState, PracticePhase, ReviewGrade } from '../../core/types'
import { overdueFactor } from '../core/scheduler'

/** Passage label as shown in the UI: its own label, else "Bars X to Y" (1-based). */
export function passageLabel(passage: Pick<Passage, 'label' | 'startBar' | 'endBar'>): string {
  if (passage.label) return passage.label
  if (passage.startBar === passage.endBar) return `Bar ${passage.startBar + 1}`
  return `Bars ${passage.startBar + 1} to ${passage.endBar + 1}`
}

/** Plain-language phase name (ADR-001: acquisition/consolidation/maintenance). */
export function phaseLabel(phase: PracticePhase): string {
  switch (phase) {
    case 'acquisition':
      return 'Learning'
    case 'consolidation':
      return 'Consolidating'
    case 'maintenance':
      return 'Maintaining'
  }
}

/** Plain-language grade name. */
export function gradeWord(grade: ReviewGrade): string {
  switch (grade) {
    case 'easy':
      return 'Easy'
    case 'good':
      return 'Good'
    case 'hard':
      return 'Hard'
    case 'fail':
      return 'Fail'
  }
}

/** One-line explanation of how a grade was derived, for the post-block screen. */
export function gradeExplanation(grade: ReviewGrade): string {
  switch (grade) {
    case 'easy':
      return 'Clean from the first repetition.'
    case 'good':
      return 'Clean within the first few repetitions.'
    case 'hard':
      return 'It took a while to get a clean run.'
    case 'fail':
      return 'No clean run this time; the tempo will step back.'
  }
}

export interface DueRow {
  passage: Passage
  state: PassageReviewState
  overdue: number
}

/**
 * Passages that are due now, most overdue first (ADR-001 session builder uses
 * the same overdueFactor weighting; DueList mirrors it for consistency).
 */
export function dueRows(
  passages: readonly Passage[],
  states: ReadonlyMap<string, PassageReviewState>,
  now: number,
): DueRow[] {
  const rows: DueRow[] = []
  for (const passage of passages) {
    if (passage.status !== 'active') continue
    const state = states.get(passage.id)
    if (!state) continue
    if (state.dueAt > now) continue
    rows.push({ passage, state, overdue: overdueFactor(state, now) })
  }
  return rows.sort((a, b) => b.overdue - a.overdue)
}

/** Groups passages by song id, preserving first-seen song order. */
export function groupBySong(passages: readonly Passage[]): Array<[string, Passage[]]> {
  const map = new Map<string, Passage[]>()
  for (const passage of passages) {
    const list = map.get(passage.songId)
    if (list) {
      list.push(passage)
    } else {
      map.set(passage.songId, [passage])
    }
  }
  return [...map.entries()]
}

/** Short local date string, e.g. "Jul 27, 2026", for next-due display. */
export function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
