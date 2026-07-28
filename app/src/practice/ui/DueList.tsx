// Lists passages that are due for review right now, most overdue first
// (ADR-001 session builder uses the same weighting).

import { practiceStore } from '../practiceStore'
import { dueRows, passageLabel, phaseLabel } from './helpers'

export interface DueListProps {
  onStartReview: (passageId: string, tempoPct: number, label: string) => void
}

export function DueList({ onStartReview }: DueListProps) {
  const passages = practiceStore.passages.value
  const states = practiceStore.states.value
  const rows = dueRows(passages, states, Date.now())

  if (rows.length === 0) {
    return (
      <p class="due-list__empty">
        Nothing is due right now. Mark a trouble spot while you play to add one.
      </p>
    )
  }

  return (
    <ul class="due-list">
      {rows.map(({ passage, state }) => {
        const label = passageLabel(passage)
        return (
          <li class="card" key={passage.id}>
            <div class="card__top">
              <div class="card__text">
                <div class="card__title">{label}</div>
                <div class="card__sub">
                  {phaseLabel(state.phase)} · {state.reviewTempoPct}% tempo
                </div>
              </div>
              <button
                type="button"
                class="btn btn--small"
                onClick={() => onStartReview(passage.id, state.reviewTempoPct, label)}
              >
                Start
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
