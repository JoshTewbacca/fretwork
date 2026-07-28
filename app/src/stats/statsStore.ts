// Module-level stats store: loads the practice-event log and song titles
// once into signals, then exposes computed aggregates over them. Screens
// bind to the signals directly (no props threading needed), matching the
// pattern in src/library/libraryStore.ts.

import { signal, computed, type ReadonlySignal } from '@preact/signals'
import type { PracticeEvent, ReviewGrade } from '../core/types.ts'
import { getDb } from '../db/open.ts'
import { listAll as listAllEvents } from '../db/events.ts'
import { listSongs } from '../db/songs.ts'
import {
  currentStreakDays,
  longestStreakDays,
  mostPracticedPassages,
  practiceMsByDay,
  practiceMsBySong,
  reviewOutcomeCounts,
  sessionSummaries,
  totalPracticeMs,
  type DayBucket,
  type PassageReviewCount,
  type SessionSummary,
} from './aggregate.ts'

const SPARKLINE_DAYS = 14
const TOP_PASSAGES_LIMIT = 5

const events = signal<PracticeEvent[]>([])
const songTitles = signal<Map<string, string>>(new Map())
const loading = signal(false)

const totalMs: ReadonlySignal<number> = computed(() => totalPracticeMs(events.value))
const msBySong: ReadonlySignal<Map<string, number>> = computed(() => practiceMsBySong(events.value))
const msByDay: ReadonlySignal<DayBucket[]> = computed(() =>
  practiceMsByDay(events.value, SPARKLINE_DAYS, Date.now()),
)
const sessions: ReadonlySignal<SessionSummary[]> = computed(() => sessionSummaries(events.value))
const currentStreak: ReadonlySignal<number> = computed(() =>
  currentStreakDays(events.value, Date.now()),
)
const longestStreak: ReadonlySignal<number> = computed(() => longestStreakDays(events.value))
const reviewOutcomes: ReadonlySignal<Record<ReviewGrade, number>> = computed(() =>
  reviewOutcomeCounts(events.value),
)
const topPassages: ReadonlySignal<PassageReviewCount[]> = computed(() =>
  mostPracticedPassages(events.value, TOP_PASSAGES_LIMIT),
)

export const statsStore: {
  loading: ReadonlySignal<boolean>
  songTitles: ReadonlySignal<Map<string, string>>
  totalMs: ReadonlySignal<number>
  msBySong: ReadonlySignal<Map<string, number>>
  msByDay: ReadonlySignal<DayBucket[]>
  sessions: ReadonlySignal<SessionSummary[]>
  currentStreak: ReadonlySignal<number>
  longestStreak: ReadonlySignal<number>
  reviewOutcomes: ReadonlySignal<Record<ReviewGrade, number>>
  topPassages: ReadonlySignal<PassageReviewCount[]>
  refresh: () => Promise<void>
} = {
  loading,
  songTitles,
  totalMs,
  msBySong,
  msByDay,
  sessions,
  currentStreak,
  longestStreak,
  reviewOutcomes,
  topPassages,

  async refresh() {
    loading.value = true
    try {
      const db = await getDb()
      const [allEvents, songs] = await Promise.all([listAllEvents(db), listSongs(db)])
      events.value = allEvents
      songTitles.value = new Map(songs.map((song) => [song.id, song.title]))
    } finally {
      loading.value = false
    }
  },
}
