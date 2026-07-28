// Single entry point for Milestone 2's practice log and stats views. The
// lead wires this into a screen/route; this module only exports the
// component, per the M2 stats-agent brief.

import { useEffect } from 'preact/hooks'
import type { JSX } from 'preact'
import type { ReviewGrade } from '../core/types.ts'
import { statsStore } from './statsStore.ts'
import { Sparkline } from './Sparkline.tsx'
import { PracticeLog } from './PracticeLog.tsx'
import './stats.css'

const SPARKLINE_DAYS = 14

/** Plain-language grade name, local to the stats view (kept dependency-free
 * of app/src/practice/ui, which is outside this feature's ownership). */
function gradeWord(grade: ReviewGrade): string {
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

function formatHoursMinutes(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

function dayLabel(dayStartMs: number): string {
  return new Date(dayStartMs).toLocaleDateString(undefined, { weekday: 'short' })
}

export function StatsPanel(): JSX.Element {
  useEffect(() => {
    void statsStore.refresh()
  }, [])

  const totalMs = statsStore.totalMs.value
  const longestStreak = statsStore.longestStreak.value
  const msByDay = statsStore.msByDay.value
  const msBySong = statsStore.msBySong.value
  const titles = statsStore.songTitles.value
  const outcomes = statsStore.reviewOutcomes.value
  const sessions = statsStore.sessions.value

  const topSongs = [...msBySong.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return (
    <div class="stats-panel">
      {/* The current streak is shown by the screen above this panel, so it is
          not repeated here. */}
      <div class="stat">
        <div class="stat__item">
          <span class="stat__value">{formatHoursMinutes(totalMs)}</span>
          <span class="stat__label">Total practice</span>
        </div>
        <div class="stat__item">
          <span class="stat__value">{longestStreak}</span>
          <span class="stat__label">Longest streak</span>
        </div>
      </div>

      <div class="stats-sparkline">
        <Sparkline
          points={msByDay.map((bucket) => Math.round(bucket.ms / 60_000))}
          labels={msByDay.map((bucket) => dayLabel(bucket.dayStartMs))}
          ariaLabel="Practice minutes per day, last 14 days"
        />
        <p class="stats-sparkline__caption">Minutes practiced, last {SPARKLINE_DAYS} days</p>
      </div>

      <div class="stats-section">
        <h2 class="h-sec">By song</h2>
        {topSongs.length === 0 ? (
          <p class="stats-empty">No practice recorded yet.</p>
        ) : (
          <ul class="stats-song-list">
            {topSongs.map(([songId, ms]) => (
              <li key={songId} class="stats-song-list__row">
                <span class="stats-song-list__title">{titles.get(songId) ?? 'Unknown song'}</span>
                <span class="stats-song-list__value">{formatHoursMinutes(ms)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div class="stats-section">
        <h2 class="h-sec">Review outcomes</h2>
        <ul class="stats-outcomes">
          {(['easy', 'good', 'hard', 'fail'] as const).map((grade) => (
            <li key={grade} class="stats-outcomes__row">
              <span class="stats-outcomes__label">{gradeWord(grade)}</span>
              <span class="stats-outcomes__value">{outcomes[grade]}</span>
            </li>
          ))}
        </ul>
      </div>

      <details class="stats-section stats-section--collapsible">
        <summary>Practice log</summary>
        <PracticeLog sessions={sessions} />
      </details>
    </div>
  )
}
