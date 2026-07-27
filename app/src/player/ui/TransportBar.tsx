import type { PlayerStore } from '../core/PlayerStore'

// Cursor/position state always comes from the store's signals (audio-clock
// domain), never a wall-clock timer - see PlayerStore's playerPositionChanged
// handling.
function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function TransportBar({ store }: { store: PlayerStore }) {
  const transport = store.transport.value
  const isPlaying = transport === 'playing'
  const currentTimeMs = store.currentTimeMs.value
  const endTimeMs = store.endTimeMs.value
  const currentBarIndex = store.currentBarIndex.value
  const barCount = store.barCount.value

  return (
    <div class="transport-bar">
      <div class="transport-bar__primary">
        <button
          type="button"
          class="transport-bar__play"
          aria-pressed={isPlaying}
          onClick={() => store.playPause()}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" class="transport-bar__stop" onClick={() => store.stop()}>
          Stop
        </button>
      </div>
      <div class="transport-bar__readout">
        <span class="transport-bar__time">
          {formatTime(currentTimeMs)} / {formatTime(endTimeMs)}
        </span>
        <span class="transport-bar__bar">
          Bar {currentBarIndex + 1} of {barCount}
        </span>
      </div>
    </div>
  )
}
