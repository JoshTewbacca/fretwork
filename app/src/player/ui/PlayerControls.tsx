import type { PlayerStore } from '../core/PlayerStore'
import { TransportBar } from './TransportBar'
import { SpeedControl } from './SpeedControl'
import { LoopControl } from './LoopControl'
import { ToggleRow } from './ToggleRow'
import { TrackMixer } from './TrackMixer'
import { DisplayControls } from './DisplayControls'
import './controls.css'

export function PlayerControls({ store }: { store: PlayerStore }) {
  const scoreLoaded = store.scoreLoaded.value

  if (!scoreLoaded) {
    return (
      <div class="player-controls player-controls--empty">
        <p class="player-controls__hint">Import a tab to see playback controls.</p>
      </div>
    )
  }

  return (
    <div class="player-controls">
      {/* Transport and speed stay visible: they are the two controls reached
          mid-practice. Everything else collapses so the score keeps the screen. */}
      <TransportBar store={store} />
      <SpeedControl store={store} />

      <details class="player-controls__section">
        <summary>Loop</summary>
        <LoopControl store={store} />
      </details>

      <details class="player-controls__section">
        <summary>Tracks</summary>
        <TrackMixer store={store} />
      </details>

      <details class="player-controls__section">
        <summary>Display</summary>
        <DisplayControls store={store} />
      </details>

      <details class="player-controls__section">
        <summary>Options</summary>
        <ToggleRow store={store} />
      </details>
    </div>
  )
}
