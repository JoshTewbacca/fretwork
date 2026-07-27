import type { PlayerStore } from '../core/PlayerStore'

const PRESETS = [50, 75, 100]

export function SpeedControl({ store }: { store: PlayerStore }) {
  const speedPct = store.speedPct.value

  return (
    <div class="speed-control">
      <div class="speed-control__header">
        <span>Speed</span>
        <span class="speed-control__value">{speedPct}%</span>
      </div>
      <input
        type="range"
        class="speed-control__range"
        min={25}
        max={125}
        step={5}
        value={speedPct}
        aria-label="Playback speed"
        onInput={(e) => store.setSpeedPct(Number(e.currentTarget.value))}
      />
      <div class="speed-control__presets">
        {PRESETS.map((preset) => (
          <button
            type="button"
            key={preset}
            class={speedPct === preset ? 'speed-control__preset is-active' : 'speed-control__preset'}
            aria-pressed={speedPct === preset}
            onClick={() => store.setSpeedPct(preset)}
          >
            {preset}%
          </button>
        ))}
      </div>
    </div>
  )
}
