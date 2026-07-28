// "Mark trouble spot" (ADR-001: passages are created either explicitly here, or
// implicitly from loop telemetry). Lives in the player sheet, prefilled from
// whatever you are currently looping, so the common case is one tap.

import { useEffect, useState } from 'preact/hooks'
import { practiceStore } from '../practiceStore'

export interface MarkPassageProps {
  songId: string
  trackIndex: number
  /** Zero-based bar under the playhead; used when nothing is looping. */
  currentBar: number
  /** Zero-based bars of the active loop, when there is one. */
  loop: { startBar: number; endBar: number } | null
  onMarked?: () => void
}

export function MarkPassage({
  songId,
  trackIndex,
  currentBar,
  loop,
  onMarked,
}: MarkPassageProps) {
  // The range you are working on is almost always the range you are looping,
  // so follow it until the user types a range of their own.
  const suggestedFrom = (loop ? loop.startBar : currentBar) + 1
  const suggestedTo = (loop ? loop.endBar : currentBar) + 1

  const [fromBar, setFromBar] = useState(suggestedFrom)
  const [toBar, setToBar] = useState(suggestedTo)
  const [label, setLabel] = useState('')
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setFromBar(suggestedFrom)
    setToBar(suggestedTo)
  }, [suggestedFrom, suggestedTo])

  const valid =
    Number.isFinite(fromBar) && Number.isFinite(toBar) && fromBar >= 1 && toBar >= fromBar

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
      setConfirmation(
        merged
          ? 'Merged into a trouble spot you already had.'
          : `Marked bars ${fromBar} to ${toBar}.`,
      )
      setLabel('')
      onMarked?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <h3 class="sheet__title">Mark a trouble spot</h3>
      <p class="sheet__sub">
        {loop
          ? 'Starts from the bars you are looping. It will come back in your practice queue.'
          : 'Starts from the bar you are on. It will come back in your practice queue.'}
      </p>

      <div class="sheet__field">
        <span class="legend">Bars</span>
        <div class="sheet__pair">
          <input
            type="number"
            class="input"
            min={1}
            aria-label="From bar"
            value={fromBar}
            onInput={(e) => setFromBar(Number(e.currentTarget.value))}
          />
          <input
            type="number"
            class="input"
            min={1}
            aria-label="To bar"
            value={toBar}
            onInput={(e) => setToBar(Number(e.currentTarget.value))}
          />
        </div>
      </div>

      <div class="sheet__field">
        <span class="legend">Name it (optional)</span>
        <input
          type="text"
          class="input"
          value={label}
          placeholder="Bridge run"
          onInput={(e) => setLabel(e.currentTarget.value)}
        />
      </div>

      <button
        type="button"
        class="btn btn--primary btn--block"
        disabled={!valid || saving}
        onClick={markSpot}
      >
        {valid ? `Mark bars ${fromBar}–${toBar}` : 'Mark trouble spot'}
      </button>

      {confirmation && <p class="sheet__note">{confirmation}</p>}
    </>
  )
}
