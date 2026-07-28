// Compact "mark trouble spot" control (ADR-001: passages are created either
// explicitly here, or implicitly from loop telemetry).

import { useEffect, useState } from 'preact/hooks'
import { practiceStore } from '../practiceStore'

export interface MarkPassageProps {
  songId: string
  trackIndex: number
  currentBar: number
  onMarked?: () => void
}

export function MarkPassage({ songId, trackIndex, currentBar, onMarked }: MarkPassageProps) {
  const [fromBar, setFromBar] = useState(currentBar + 1)
  const [toBar, setToBar] = useState(currentBar + 1)
  const [label, setLabel] = useState('')
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Follow the playhead until the user starts editing a range of their own.
  useEffect(() => {
    setFromBar(currentBar + 1)
    setToBar(currentBar + 1)
  }, [currentBar])

  const valid = Number.isFinite(fromBar) && Number.isFinite(toBar) && fromBar >= 1 && toBar >= fromBar

  async function markSpot() {
    if (!valid || saving) return
    setSaving(true)
    setConfirmation(null)
    try {
      const existingIds = new Set(practiceStore.passages.value.map((p) => p.id))
      const passage = await practiceStore.markPassage({
        songId,
        trackIndex,
        startBar: fromBar - 1,
        endBar: toBar - 1,
        label: label.trim() ? label.trim() : undefined,
      })
      const merged = existingIds.has(passage.id)
      setConfirmation(merged ? 'Merged into an existing passage.' : 'Trouble spot marked.')
      setLabel('')
      onMarked?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div class="mark-passage">
      <div class="mark-passage__bars">
        <label class="mark-passage__field">
          <span class="mark-passage__field-label">From bar</span>
          <input
            type="number"
            class="mark-passage__input"
            min={1}
            value={fromBar}
            onInput={(e) => setFromBar(Number(e.currentTarget.value))}
          />
        </label>
        <label class="mark-passage__field">
          <span class="mark-passage__field-label">To bar</span>
          <input
            type="number"
            class="mark-passage__input"
            min={1}
            value={toBar}
            onInput={(e) => setToBar(Number(e.currentTarget.value))}
          />
        </label>
      </div>

      <label class="mark-passage__field mark-passage__field--label">
        <span class="mark-passage__field-label">Label (optional)</span>
        <input
          type="text"
          class="mark-passage__input mark-passage__input--text"
          value={label}
          placeholder="e.g. bridge run"
          onInput={(e) => setLabel(e.currentTarget.value)}
        />
      </label>

      <button
        type="button"
        class="btn mark-passage__submit"
        disabled={!valid || saving}
        onClick={markSpot}
      >
        Mark trouble spot
      </button>

      {confirmation && <p class="mark-passage__confirmation">{confirmation}</p>}
    </div>
  )
}
