// Playback speed as a detented rail rather than a plain slider: 50, 75 and 100
// are the settings actually used when working a passage up to tempo, so they
// get marks to land on. The native range input stays for keyboard and
// assistive tech and is rendered transparently over the drawn groove.

import type { PlayerStore } from '../core/PlayerStore'

const MIN = 25
const MAX = 125
const DETENTS = [50, 75, 100]

function ratio(pct: number): number {
  return (pct - MIN) / (MAX - MIN)
}

export function SpeedRail({ store }: { store: PlayerStore }) {
  const speedPct = store.speedPct.value
  const position = `${ratio(speedPct) * 100}%`

  return (
    <div class="speed-rail">
      <div class="speed-rail__head">
        <span class="legend">Speed</span>
        <span class="speed-rail__value">{speedPct}%</span>
      </div>

      <div class="speed-rail__track">
        <span class="speed-rail__groove" />
        <span class="speed-rail__fill" style={{ width: position }} />
        {DETENTS.map((detent) => (
          <span
            key={detent}
            class="speed-rail__detent"
            style={{ left: `${ratio(detent) * 100}%` }}
          />
        ))}
        <span class="speed-rail__thumb" style={{ left: position }} />
        <input
          type="range"
          class="speed-rail__input"
          min={MIN}
          max={MAX}
          step={5}
          value={speedPct}
          aria-label="Playback speed"
          onInput={(e) => store.setSpeedPct(Number(e.currentTarget.value))}
        />
      </div>

      <div class="speed-rail__scale">
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
        <span>125</span>
      </div>
    </div>
  )
}
