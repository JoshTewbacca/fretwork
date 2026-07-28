import { PracticePanel } from '../../practice/ui/PracticePanel'
import { StatsPanel } from '../../stats/StatsPanel'

// The practice tab: what is due, what to work on, and the history behind it.
// This is the differentiator over Songsterr, so it gets a tab of its own
// rather than being buried inside the library.
export function PracticeScreen() {
  return (
    <div class="practice-screen">
      <PracticePanel />
      <StatsPanel />
    </div>
  )
}
