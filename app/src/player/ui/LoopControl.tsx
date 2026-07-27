import type { PlayerStore } from '../core/PlayerStore'
import { Switch } from './Switch'

export function LoopControl({ store }: { store: PlayerStore }) {
  const loop = store.loop.value
  const loopOn = loop !== null

  function toggleLoop() {
    store.setLoopEnabled(!loopOn)
  }

  return (
    <div class="loop-control">
      <div class="loop-control__row">
        <Switch label="Loop" on={loopOn} onToggle={toggleLoop} />
        <span class="loop-control__readout">
          {loop ? `Bars ${loop.startBar + 1} to ${loop.endBar + 1}` : 'No loop set'}
        </span>
      </div>
      <div class="loop-control__actions">
        <button type="button" class="btn" onClick={() => store.loopCurrentBar()}>
          Loop current bar
        </button>
        <button type="button" class="btn" onClick={() => store.loopFromSelection()}>
          Use selection
        </button>
      </div>
      <p class="loop-control__hint">
        Drag across the score to select bars, then use the selection.
      </p>
    </div>
  )
}
