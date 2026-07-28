// Session builder (ADR-001): "20 minutes, 3 songs, weighted toward what's
// overdue". The scheduler proposes; the human disposes - the output is a plain
// ordered list the user can reorder or skip.

import type { Passage, PassageReviewState } from '../../core/types'
import { overdueFactor } from './scheduler'
import { isKernelOf } from './passageGeometry'

/** A review block is roughly this long in practice. */
export const BLOCK_MINUTES = 4

export interface SessionItem {
  kind: 'review' | 'playthrough'
  passageId?: string
  songId: string
  label: string
  tempoPct: number
  estimatedMinutes: number
}

export interface SessionPlan {
  items: SessionItem[]
  totalMinutes: number
  /** Due passages that did not fit in the time available. */
  deferredCount: number
}

export interface BuildSessionInput {
  minutes: number
  passages: readonly Passage[]
  states: ReadonlyMap<string, PassageReviewState>
  now: number
  /** Restrict to these songs; empty means all. */
  songIds?: readonly string[]
  /** Titles for labelling, keyed by song id. */
  songTitles?: ReadonlyMap<string, string>
}

function passageLabel(p: Passage, title: string | undefined): string {
  const where = p.startBar === p.endBar
    ? `bar ${p.startBar + 1}`
    : `bars ${p.startBar + 1} to ${p.endBar + 1}`
  const name = p.label ?? where
  return title ? `${title}: ${name}` : name
}

/**
 * Orders kernels before the parents that contain them. A parent block played
 * cleanly then satisfies the kernel too (see propagation), so doing the hard
 * lick first is both better practice and less duplicated work.
 */
function kernelFirst(a: Passage, b: Passage): number {
  if (isKernelOf(a, b)) return -1
  if (isKernelOf(b, a)) return 1
  return 0
}

export function buildSession(input: BuildSessionInput): SessionPlan {
  const { minutes, passages, states, now } = input
  const songFilter = new Set(input.songIds ?? [])
  const titles = input.songTitles

  const eligible = passages.filter(
    (p) =>
      p.status === 'active' &&
      (songFilter.size === 0 || songFilter.has(p.songId)) &&
      states.has(p.id),
  )

  const due = eligible
    .filter((p) => (states.get(p.id) as PassageReviewState).dueAt <= now)
    .sort((a, b) => {
      const fa = overdueFactor(states.get(a.id) as PassageReviewState, now)
      const fb = overdueFactor(states.get(b.id) as PassageReviewState, now)
      if (fb !== fa) return fb - fa
      return kernelFirst(a, b)
    })

  // Stable pass to pull kernels ahead of their parents without disturbing the
  // overall overdue ordering more than necessary.
  for (let i = 0; i < due.length; i++) {
    for (let j = i + 1; j < due.length; j++) {
      if (isKernelOf(due[j], due[i])) {
        const [kernel] = due.splice(j, 1)
        due.splice(i, 0, kernel)
        break
      }
    }
  }

  const items: SessionItem[] = []
  let used = 0
  let deferredCount = 0

  for (const p of due) {
    const state = states.get(p.id) as PassageReviewState
    if (used + BLOCK_MINUTES > minutes) {
      deferredCount += 1
      continue
    }
    items.push({
      kind: 'review',
      passageId: p.id,
      songId: p.songId,
      label: passageLabel(p, titles?.get(p.songId)),
      tempoPct: state.reviewTempoPct,
      estimatedMinutes: BLOCK_MINUTES,
    })
    used += BLOCK_MINUTES
  }

  // Any time left over goes to playing the songs through, which is what makes
  // a session feel like music rather than drills.
  const songsInPlay = [...new Set(items.map((i) => i.songId))]
  const playthroughSongs =
    songsInPlay.length > 0 ? songsInPlay : [...new Set(eligible.map((p) => p.songId))]

  for (const songId of playthroughSongs) {
    if (used + 5 > minutes) break
    items.push({
      kind: 'playthrough',
      songId,
      label: titles?.get(songId) ? `Play through ${titles.get(songId)}` : 'Play through',
      tempoPct: 100,
      estimatedMinutes: 5,
    })
    used += 5
  }

  return { items, totalMinutes: used, deferredCount }
}
