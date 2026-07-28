// Integration layer between the practice core and storage. The UI binds to
// these signals and calls these methods; it never touches the scheduler maths
// or the event log directly.

import { signal, type ReadonlySignal } from '@preact/signals'
import type {
  Passage,
  PassageReviewState,
  PracticeEvent,
  ReviewGrade,
} from '../core/types'
import { getDb } from '../db/open'
import { ulid } from '../db/ulid'
import { listPassages, putPassage, getPassage } from '../db/passages'
import { listReviewStates, putReviewState } from '../db/reviewState'
import { append as appendEvent, listAll as listAllEvents } from '../db/events'
import { applyReview, createInitialState } from './core/scheduler'
import { propagateReview } from './core/propagation'
import { foldPracticeEvents } from './core/fold'
import { deriveGrade } from './core/grading'
import { findMergeTarget, mergeRanges } from './core/passageGeometry'
import { buildSession, type SessionPlan } from './core/sessionBuilder'

const passages = signal<Passage[]>([])
const states = signal<Map<string, PassageReviewState>>(new Map())
const loading = signal(false)

export const practiceStore: {
  passages: ReadonlySignal<Passage[]>
  states: ReadonlySignal<Map<string, PassageReviewState>>
  loading: ReadonlySignal<boolean>
  refresh: () => Promise<void>
  markPassage: (input: MarkPassageInput) => Promise<Passage>
  recordReview: (passageId: string, repResults: boolean[], tempoPct: number) => Promise<ReviewGrade>
  retirePassage: (passageId: string) => Promise<void>
  planSession: (minutes: number, songIds?: string[], titles?: Map<string, string>) => SessionPlan
  rebuildFromEvents: () => Promise<void>
} = {
  passages,
  states,
  loading,

  async refresh() {
    loading.value = true
    try {
      const db = await getDb()
      const [ps, ss] = await Promise.all([listPassages(db), listReviewStates(db)])
      passages.value = ps
      states.value = new Map(ss.map((s) => [s.passageId, s]))
    } finally {
      loading.value = false
    }
  },

  /**
   * Marks a trouble spot. A range that heavily overlaps an existing passage
   * extends it rather than creating a near-duplicate sibling (ADR-001).
   */
  async markPassage(input: MarkPassageInput): Promise<Passage> {
    const db = await getDb()
    const existing = await listPassages(db)
    const target = findMergeTarget(input, existing, input.songId, input.trackIndex)

    if (target) {
      const merged: Passage = { ...target, ...mergeRanges(target, input), status: 'active' }
      await putPassage(db, merged)
      await practiceStore.refresh()
      return merged
    }

    const passage: Passage = {
      id: ulid(),
      songId: input.songId,
      trackIndex: input.trackIndex,
      startBar: input.startBar,
      endBar: input.endBar,
      label: input.label,
      origin: input.origin ?? 'user',
      status: 'active',
      createdAt: Date.now(),
    }
    await putPassage(db, passage)
    await putReviewState(
      db,
      createInitialState(passage.id, input.startTempoPct ?? 60, Date.now()),
    )
    await appendPracticeEvent({ type: 'passage_marked', passageId: passage.id })
    await practiceStore.refresh()
    return passage
  },

  /**
   * Records a completed review block: appends the immutable event, then
   * updates the derived state for this passage and any nested relatives.
   */
  async recordReview(passageId, repResults, tempoPct) {
    const grade = deriveGrade(repResults)
    const now = Date.now()
    const db = await getDb()

    await appendPracticeEvent({ type: 'review_result', passageId, tempoPct, grade }, now)

    const passage = await getPassage(db, passageId)
    const current = states.value.get(passageId) ?? createInitialState(passageId, tempoPct, now)
    const next = applyReview(current, { grade, tempoPct, now })
    await putReviewState(db, next)

    if (passage) {
      const working = new Map(states.value)
      working.set(passageId, next)
      const propagated = propagateReview({
        reviewedPassage: passage,
        grade,
        tempoPct,
        now,
        allPassages: passages.value,
        states: working,
      })
      for (const state of propagated.values()) {
        await putReviewState(db, state)
      }
    }

    await practiceStore.refresh()
    return grade
  },

  async retirePassage(passageId) {
    const db = await getDb()
    const passage = await getPassage(db, passageId)
    if (!passage) return
    await putPassage(db, { ...passage, status: 'retired' })
    await appendPracticeEvent({ type: 'passage_retired', passageId })
    await practiceStore.refresh()
  },

  planSession(minutes, songIds, titles) {
    return buildSession({
      minutes,
      passages: passages.value,
      states: states.value,
      now: Date.now(),
      songIds,
      songTitles: titles,
    })
  },

  /**
   * Discards the derived cache and refolds every event. Scheduler bugs are
   * fixed by changing the fold and rebuilding - history is never rewritten.
   */
  async rebuildFromEvents() {
    const db = await getDb()
    const [events, ps] = await Promise.all([listAllEvents(db), listPassages(db)])
    const { states: rebuilt } = foldPracticeEvents(events, ps)
    for (const state of rebuilt.values()) {
      await putReviewState(db, state)
    }
    await practiceStore.refresh()
  },
}

export interface MarkPassageInput {
  songId: string
  trackIndex: number
  startBar: number
  endBar: number
  label?: string
  origin?: 'user' | 'suggested'
  startTempoPct?: number
}

type EventDraft =
  | { type: 'review_result'; passageId: string; tempoPct: number; grade: ReviewGrade }
  | { type: 'passage_marked' | 'passage_retired'; passageId: string }
  | {
      type: 'loop_block'
      songId: string
      passageId?: string
      startBar: number
      endBar: number
      tempoPct: number
      reps: number
      cleanReps: number
      durationMs: number
    }

export async function appendPracticeEvent(
  draft: EventDraft,
  ts = Date.now(),
): Promise<void> {
  const db = await getDb()
  await appendEvent(db, { id: ulid(), ts, ...draft } as PracticeEvent)
}
