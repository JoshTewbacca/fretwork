import type { PlayerStore, StaveProfileName } from '../core/PlayerStore'
import { Stepper } from './Stepper'

const STAVE_PROFILES: { value: StaveProfileName; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'scoreTab', label: 'Notation and tab' },
  { value: 'tab', label: 'Tab only' },
  { value: 'score', label: 'Notation only' },
]

export function DisplayControls({ store }: { store: PlayerStore }) {
  const staveProfile = store.staveProfile.value
  const zoomPct = store.zoomPct.value

  return (
    <div class="display-controls">
      <div class="display-controls__segmented" role="group" aria-label="Stave display">
        {STAVE_PROFILES.map((option) => (
          <button
            type="button"
            key={option.value}
            class={
              staveProfile === option.value ? 'segmented__option is-active' : 'segmented__option'
            }
            aria-pressed={staveProfile === option.value}
            onClick={() => store.setStaveProfile(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <Stepper
        label="Zoom"
        value={zoomPct}
        min={50}
        max={180}
        step={10}
        format={(v) => `${v}%`}
        onChange={(v) => store.setZoomPct(v)}
      />
    </div>
  )
}
