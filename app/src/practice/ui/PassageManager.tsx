// Lists every non-retired passage, grouped by song, with a retire action and
// a full rebuild of derived state from the event log (ADR-001: practice
// history is the source of truth, PassageReviewState is just a fold cache).

import { practiceStore } from '../practiceStore'
import { formatShortDate, groupBySong, passageLabel, phaseLabel } from './helpers'

export function PassageManager() {
  const passages = practiceStore.passages.value
  const states = practiceStore.states.value
  const groups = groupBySong(passages.filter((p) => p.status !== 'retired'))

  async function retire(passageId: string, label: string) {
    const ok = window.confirm(`Retire "${label}"? It stays playable but will no longer be scheduled.`)
    if (!ok) return
    await practiceStore.retirePassage(passageId)
  }

  async function rebuild() {
    await practiceStore.rebuildFromEvents()
  }

  return (
    <div class="passage-manager">
      <div class="passage-manager__rebuild">
        <button type="button" class="btn" onClick={rebuild}>
          Rebuild from history
        </button>
        <p class="passage-manager__hint">
          Practice history is the source of truth; derived scheduling can always be safely
          recomputed from it.
        </p>
      </div>

      {groups.length === 0 && <p class="passage-manager__empty">No passages yet.</p>}

      {groups.map(([songId, songPassages]) => (
        <section class="passage-manager__group" key={songId}>
          <h4 class="passage-manager__song">{songId}</h4>
          {songPassages.map((passage) => {
            const state = states.get(passage.id)
            return (
              <div class="passage-manager__row" key={passage.id}>
                <div class="passage-manager__info">
                  <span class="passage-manager__label">{passageLabel(passage)}</span>
                  <span class="passage-manager__meta">
                    {state
                      ? `${phaseLabel(state.phase)} - mastered ${state.masteredTempoPct}% - next due ${formatShortDate(state.dueAt)}`
                      : 'Not yet scheduled'}
                  </span>
                </div>
                <button
                  type="button"
                  class="btn btn--small passage-manager__retire"
                  onClick={() => retire(passage.id, passageLabel(passage))}
                >
                  Retire
                </button>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
