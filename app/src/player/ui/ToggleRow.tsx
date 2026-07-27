import type { PlayerStore } from '../core/PlayerStore'
import { Switch } from './Switch'

export function ToggleRow({ store }: { store: PlayerStore }) {
  const countInEnabled = store.countInEnabled.value
  const metronomeEnabled = store.metronomeEnabled.value
  const backingMode = store.backingMode.value

  return (
    <div class="toggle-row">
      <Switch
        label="Count-in"
        on={countInEnabled}
        onToggle={() => store.setCountIn(!countInEnabled)}
      />
      <Switch
        label="Metronome"
        on={metronomeEnabled}
        onToggle={() => store.setMetronome(!metronomeEnabled)}
      />
      <div class="toggle-row__item">
        <Switch
          label="Backing track"
          on={backingMode}
          onToggle={() => store.setBackingMode(!backingMode)}
        />
        <p class="toggle-row__hint">Mutes your part so the rest of the band plays.</p>
      </div>
    </div>
  )
}
