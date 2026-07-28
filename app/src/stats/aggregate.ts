// Pure aggregation functions over the practice-event log. No database access,
// no Date.now() - every function that needs "now" takes it as a parameter so
// tests stay deterministic. Deleting any derived cache and recomputing these
// from the raw events must give identical output (ADR-004: the event log is
// the source of truth); that invariant is the reason nothing here is stateful.

import type { PracticeEvent, ReviewGrade } from '../core/types.ts'

export const DAY_MS = 24 * 60 * 60 * 1000

/** Start of the local calendar day containing `ts`, in epoch ms. */
function localDayStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function isDurationEvent(
  event: PracticeEvent,
): event is Extract<PracticeEvent, { type: 'playthrough' | 'loop_block' }> {
  return event.type === 'playthrough' || event.type === 'loop_block'
}

/** Sum of durationMs across playthrough and loop_block events. */
export function totalPracticeMs(events: readonly PracticeEvent[]): number {
  let total = 0
  for (const event of events) {
    if (isDurationEvent(event)) total += event.durationMs
  }
  return total
}

/** Milliseconds of practice per song, keyed by songId. */
export function practiceMsBySong(events: readonly PracticeEvent[]): Map<string, number> {
  const bySong = new Map<string, number>()
  for (const event of events) {
    if (!isDurationEvent(event)) continue
    bySong.set(event.songId, (bySong.get(event.songId) ?? 0) + event.durationMs)
  }
  return bySong
}

export interface DayBucket {
  dayStartMs: number
  ms: number
}

/**
 * Practice milliseconds per local day for the last `days` days, including
 * today, oldest first. Days with no practice are zero-filled.
 */
export function practiceMsByDay(
  events: readonly PracticeEvent[],
  days: number,
  now: number,
): DayBucket[] {
  const todayStart = localDayStart(now)
  const buckets = new Map<number, number>()
  for (let i = days - 1; i >= 0; i--) {
    buckets.set(todayStart - i * DAY_MS, 0)
  }

  for (const event of events) {
    if (!isDurationEvent(event)) continue
    const key = localDayStart(event.ts)
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + event.durationMs)
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayStartMs, ms]) => ({ dayStartMs, ms }))
}

export interface SessionSummary {
  startTs: number
  endTs: number | null
  /** null when the session has no session_end yet (still open). */
  durationMs: number | null
  reviewCount: number
  loopCount: number
}

/**
 * Pairs each session_start with the following session_end. A session_start
 * with no matching end (the last event in the log, mid-practice) is reported
 * open: endTs and durationMs are null. review_result / loop_block events are
 * attributed to whichever session is open when they occur; events outside
 * any open session are not counted against a summary.
 */
export function sessionSummaries(events: readonly PracticeEvent[]): SessionSummary[] {
  const sorted = [...events].sort((a, b) => a.ts - b.ts)
  const summaries: SessionSummary[] = []

  let open: { startTs: number; reviewCount: number; loopCount: number } | null = null

  const closeOpenAsUnfinished = () => {
    if (!open) return
    summaries.push({
      startTs: open.startTs,
      endTs: null,
      durationMs: null,
      reviewCount: open.reviewCount,
      loopCount: open.loopCount,
    })
    open = null
  }

  for (const event of sorted) {
    if (event.type === 'session_start') {
      // A prior session_start with no session_end is abandoned by this one;
      // report it as still open rather than silently dropping its counts.
      closeOpenAsUnfinished()
      open = { startTs: event.ts, reviewCount: 0, loopCount: 0 }
      continue
    }
    if (event.type === 'session_end') {
      if (open) {
        summaries.push({
          startTs: open.startTs,
          endTs: event.ts,
          durationMs: event.ts - open.startTs,
          reviewCount: open.reviewCount,
          loopCount: open.loopCount,
        })
        open = null
      }
      continue
    }
    if (!open) continue
    if (event.type === 'review_result') open.reviewCount++
    if (event.type === 'loop_block') open.loopCount++
  }

  closeOpenAsUnfinished()

  return summaries
}

/**
 * A day only counts toward a streak if the guitar was actually played on it.
 * Opening the app, starting a session or marking a trouble spot are not
 * practice: a streak the user did not earn is worse than no streak at all.
 */
function isPlayingEvent(event: PracticeEvent): boolean {
  return (
    event.type === 'playthrough' ||
    event.type === 'loop_block' ||
    event.type === 'review_result'
  )
}

function activeLocalDays(events: readonly PracticeEvent[]): Set<number> {
  const days = new Set<number>()
  for (const event of events) {
    if (!isPlayingEvent(event)) continue
    days.add(localDayStart(event.ts))
  }
  return days
}

/**
 * Consecutive local days (ending today or, if today has nothing recorded
 * yet, ending yesterday) that contain at least one practice event. Returns 0
 * once the most recent active day is two or more days in the past.
 */
export function currentStreakDays(events: readonly PracticeEvent[], now: number): number {
  const days = activeLocalDays(events)
  const today = localDayStart(now)

  let cursor = today
  if (!days.has(cursor)) {
    cursor -= DAY_MS
    if (!days.has(cursor)) return 0
  }

  let count = 0
  while (days.has(cursor)) {
    count++
    cursor -= DAY_MS
  }
  return count
}

/** Longest run of consecutive local days containing at least one practice event. */
export function longestStreakDays(events: readonly PracticeEvent[]): number {
  const days = [...activeLocalDays(events)].sort((a, b) => a - b)
  if (days.length === 0) return 0

  let longest = 1
  let current = 1
  for (let i = 1; i < days.length; i++) {
    current = days[i] === days[i - 1] + DAY_MS ? current + 1 : 1
    longest = Math.max(longest, current)
  }
  return longest
}

/** Counts of review_result events per grade. */
export function reviewOutcomeCounts(events: readonly PracticeEvent[]): Record<ReviewGrade, number> {
  const counts: Record<ReviewGrade, number> = { easy: 0, good: 0, hard: 0, fail: 0 }
  for (const event of events) {
    if (event.type === 'review_result') counts[event.grade]++
  }
  return counts
}

export interface PassageReviewCount {
  passageId: string
  reviewCount: number
}

/** Passage ids ranked by number of review_result events, most-reviewed first. */
export function mostPracticedPassages(
  events: readonly PracticeEvent[],
  limit: number,
): PassageReviewCount[] {
  const counts = new Map<string, number>()
  for (const event of events) {
    if (event.type !== 'review_result') continue
    counts.set(event.passageId, (counts.get(event.passageId) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([passageId, reviewCount]) => ({ passageId, reviewCount }))
}
