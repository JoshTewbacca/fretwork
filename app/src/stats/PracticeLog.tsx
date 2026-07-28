// Reverse-chronological list of practice sessions. Presentation-only: takes
// the already-derived summaries as a prop so it stays a pure function of its
// input, same as the aggregate functions it displays.

import type { JSX } from 'preact'
import type { SessionSummary } from './aggregate.ts'

function formatSessionDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatMinutes(ms: number): string {
  return `${Math.round(ms / 60_000)} min`
}

export function PracticeLog({ sessions }: { sessions: SessionSummary[] }): JSX.Element {
  if (sessions.length === 0) {
    return <p class="practice-log__empty">No practice recorded yet.</p>
  }

  const reversed = [...sessions].reverse()

  return (
    <ul class="practice-log">
      {reversed.map((session) => (
        <li key={session.startTs} class="practice-log__row">
          <div class="practice-log__date">{formatSessionDate(session.startTs)}</div>
          <div class="practice-log__stats">
            <span class="practice-log__duration">
              {session.durationMs == null ? 'In progress' : formatMinutes(session.durationMs)}
            </span>
            <span class="practice-log__count">{session.reviewCount} reviews</span>
            <span class="practice-log__count">{session.loopCount} loop blocks</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
