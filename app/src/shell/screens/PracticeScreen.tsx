import { useEffect } from 'preact/hooks'
import { PracticePanel } from '../../practice/ui/PracticePanel'
import { StatsPanel } from '../../stats/StatsPanel'
import { practiceStore } from '../../practice/practiceStore'
import { dueRows } from '../../practice/ui/helpers'
import { statsStore } from '../../stats/statsStore'
import '../../practice/practice.css'

const WEEK_DAYS = 7

function weekMinutes(): number {
  const recent = statsStore.msByDay.value.slice(-WEEK_DAYS)
  const ms = recent.reduce((total, bucket) => total + bucket.ms, 0)
  return Math.round(ms / 60_000)
}

// The practice tab: what is due, what to work on, and the history behind it.
// This is the differentiator over Songsterr, so it gets a tab of its own
// rather than being buried inside the library.
export function PracticeScreen() {
  useEffect(() => {
    void practiceStore.refresh()
    void statsStore.refresh()
  }, [])

  const due = dueRows(practiceStore.passages.value, practiceStore.states.value, Date.now())
  const minutes = weekMinutes()

  return (
    <div class="practice-screen">
      <h1 class="screen-title">Practice</h1>

      {/* Three numbers, in the order they matter: what is asking for attention,
          what you have built, what you have put in. */}
      <div class="stat practice-screen__stats">
        <div class="stat__item">
          <span class="stat__value stat__value--teal">{due.length}</span>
          <span class="stat__label">Due now</span>
        </div>
        <div class="stat__item">
          <span class="stat__value">{statsStore.currentStreak.value}</span>
          <span class="stat__label">Day streak</span>
        </div>
        <div class="stat__item">
          <span class="stat__value stat__value--amber">{minutes}m</span>
          <span class="stat__label">This week</span>
        </div>
      </div>

      <PracticePanel />
      <StatsPanel />
    </div>
  )
}
