// Builds a practice session for a chosen number of minutes (ADR-001 session
// builder): greedy-fills the most overdue passages first, then playthrough.

import { useState } from 'preact/hooks'
import { practiceStore } from '../practiceStore'
import type { SessionPlan } from '../core/sessionBuilder'

export interface SessionBuilderProps {
  onStartReview: (passageId: string, tempoPct: number, label: string) => void
}

const MINUTE_OPTIONS = [10, 20, 30, 45]

export function SessionBuilder({ onStartReview }: SessionBuilderProps) {
  const [minutes, setMinutes] = useState(20)
  const [plan, setPlan] = useState<SessionPlan | null>(null)

  function build() {
    setPlan(practiceStore.planSession(minutes))
  }

  return (
    <div class="session-builder">
      <div class="session-builder__minutes">
        {MINUTE_OPTIONS.map((m) => (
          <button
            key={m}
            type="button"
            class={`session-builder__preset${minutes === m ? ' is-active' : ''}`}
            onClick={() => setMinutes(m)}
          >
            {m} min
          </button>
        ))}
      </div>

      <p class="session-builder__hint">Favours the most overdue passages.</p>

      <button type="button" class="btn session-builder__build" onClick={build}>
        Build session
      </button>

      {plan && (
        <div class="session-builder__plan">
          <ol class="session-builder__items">
            {plan.items.map((item, index) => (
              <li class="session-builder__item" key={`${item.kind}-${item.passageId ?? item.songId}-${index}`}>
                <span class="session-builder__item-label">{item.label}</span>
                <span class="session-builder__item-minutes">{item.estimatedMinutes} min</span>
                {item.kind === 'review' && item.passageId && (
                  <button
                    type="button"
                    class="btn btn--small session-builder__item-start"
                    onClick={() => onStartReview(item.passageId as string, item.tempoPct, item.label)}
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
