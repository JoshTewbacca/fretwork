// The dock: play, position, loop and the way into the sheet. These are the
// only controls reachable with a guitar in your hands, so they are the only
// ones that get permanent screen space.

import type { PlayerStore } from '../core/PlayerStore'
import { SpeedRail } from './SpeedRail'

// Position always comes from the store's signals (audio-clock domain), never a
// wall-clock timer - see PlayerStore's playerPositionChanged handling.
function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export interface PlayerDockProps {
  store: PlayerStore
  onOpenSheet: () => void
}

export function PlayerDock({ store, onOpenSheet }: PlayerDockProps) {
  const isPlaying = store.transport.value === 'playing'
  const loop = store.loop.value
  const currentBar = store.currentBarIndex.value

  const details = [
    `Bar ${currentBar + 1}`,
    loop ? `Loop ${loop.startBar + 1}–${loop.endBar + 1}` : null,
  ].filter(Boolean)

  return (
    <div class="player-dock">
      <div class="player-dock__row">
        <button
          type="button"
          class="player-dock__play"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          aria-pressed={isPlaying}
          onClick={() => store.playPause()}
        >
          {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
        </button>

        <div class="player-dock__readout">
          <span class="player-dock__time">
            {formatTime(store.currentTimeMs.value)}{' '}
            <span class="player-dock__total">/ {formatTime(store.endTimeMs.value)}</span>
          </span>
          <span class="player-dock__meta">{details.join(' · ')}</span>
        </div>

        <button
          type="button"
          class={loop ? 'player-dock__button is-active' : 'player-dock__button'}
          aria-pressed={loop !== null}
          onClick={() => store.setLoopEnabled(loop === null)}
        >
          <LoopGlyph />
          <span class="player-dock__button-label">LOOP</span>
        </button>

        <button type="button" class="player-dock__button" onClick={onOpenSheet}>
          <MoreGlyph />
          <span class="player-dock__button-label">MORE</span>
        </button>
      </div>

      <SpeedRail store={store} />
    </div>
  )
}

const STROKE = {
  viewBox: '0 0 24 24',
  width: 20,
  height: 20,
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.9,
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
  'aria-hidden': true,
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden>
      <path d="M8 5.4v13.2l10.6-6.6L8 5.4z" />
    </svg>
  )
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden>
      <rect x="7" y="5.5" width="3.6" height="13" rx="1.2" />
      <rect x="13.4" y="5.5" width="3.6" height="13" rx="1.2" />
    </svg>
  )
}

function LoopGlyph() {
  return (
    <svg {...STROKE}>
      <path d="M6.5 8.5h11a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3h-11" />
      <path d="M9 6 6.2 8.5 9 11" />
      <path d="M6.5 14.5h-1a3 3 0 0 1 0-6h1" />
    </svg>
  )
}

function MoreGlyph() {
  return (
    <svg {...STROKE}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}
