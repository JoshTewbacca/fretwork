// Builds a practice session for a chosen number of minutes (ADR-001 session
// builder): greedy-fills the most overdue passages first, then playthrough.

import { useState } from 'preact/hooks'
import { practiceStore } from '../practiceStore'
import { startReview } from '../activeReview'
import type { SessionPlan } from '../core/sessionBuilder'

const MINUTE_OPTIONS = [10, 20, 30, 45]

export function SessionBuilder() {
  const [minutes, setMinutes] = useState(20)
  const [plan, setPlan] = useState<SessionPlan | null>(null)

  return (
    <div class="session-builder">
      <div class="seg" role="group" aria-label="Session length">
        {MINUTE_OPTIONS.map((m) => (
          <button
            key={m}
            type="button"
            class={minutes === m ? 'seg__opt is-active' : 'seg__opt'}
            aria-pressed={minutes === m}
            onClick={() => {
              setMinutes(m)
              setPlan(null)
            }}
          >
            {m} min
          </button>
        ))}
      </div>

      <button
        type="button"
        class="btn btn--primary btn--block"
        onClick={() => setPlan(practiceStore.planSession(minutes))}
      >
        Build a {minutes} minute session
      </button>

      <p class="session-builder__hint">Favours the most overdue passages.</p>

      {plan && (
        <div class="session-builder__plan">
          <ol class="session-builder__items">
            {plan.items.map((item, index) => (
              <li
                class="session-builder__item"
                key={`${item.kind}-${item.passageId ?? item.songId}-${index}`}
              >
                <span class="session-builder__item-label">{item.label}</span>
                <span class="session-builder__item-minutes">{item.estimatedMinutes} min</span>
                {item.kind === 'review' && item.passageId && (
                  <button
                    type="button"
                    class="btn btn--small session-builder__item-start"
                    onClick={() => {
                      // The plan carries ids; the player needs the passage
                      // itself to know which bars to loop.
                      const passage = practiceStore.passages.value.find(
                        (p) => p.id === item.passageId,
                      )
                      if (passage) startReview(passage, item.tempoPct, item.label)
                    }}
                  >
                    Start
                  </button>
                )}
              </li>
            ))}
          </ol>

          <p class="session-builder__total">Total: {plan.totalMinutes} min</p>

          {plan.deferredCount > 0 && (
            <p class="session-builder__deferred">
              {plan.deferredCount} due passages did not fit
            </p>
          )}
        </div>
      )}
    </div>
  )
}
