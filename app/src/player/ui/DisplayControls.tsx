// The View panel of the player sheet. Everything here overrides the app-wide
// preference for the song in hand only; the stored default lives in Settings,
// so looking at the notation once does not make it the new default.

import type { PlayerStore } from '../core/PlayerStore'
import { MAX_ZOOM_PCT, MIN_ZOOM_PCT } from '../core/zoom'
import { Stepper } from './Stepper'
import { Switch } from './Switch'

export function DisplayControls({ store }: { store: PlayerStore }) {
  const notationVisible = store.notationVisible.value

  return (
    <>
      <div class="sheet__field">
        <span class="legend">Tab size</span>
        <div class="row" style={{ paddingTop: 0 }}>
          <div class="row__text">
            <div class="row__label">Zoom</div>
            <p class="row__hint">Settings holds the size songs start at.</p>
          </div>
          <Stepper
            label=""
            ariaLabel="tab size"
            value={store.zoomPct.value}
            min={MIN_ZOOM_PCT}
            max={MAX_ZOOM_PCT}
            step={10}
            format={(v) => `${v}%`}
            onChange={(v) => store.setZoomPct(v)}
          />
        </div>
      </div>

      <div class="sheet__field">
        <span class="legend">Layout</span>
        <div class="seg" role="group" aria-label="Stave layout">
          <button
            type="button"
            class={notationVisible ? 'seg__opt' : 'seg__opt is-active'}
            aria-pressed={!notationVisible}
            onClick={() => store.setNotationVisible(false)}
          >
            Tab
          </button>
          <button
            type="button"
            class={notationVisible ? 'seg__opt is-active' : 'seg__opt'}
            aria-pressed={notationVisible}
            onClick={() => store.setNotationVisible(true)}
          >
            Tab + notation
          </button>
        </div>
        <p class="sheet__note">
          Standard notation is off by default. Turn it on for every song in Settings, under
          Notation.
        </p>
      </div>

      <div class="sheet__field">
        <span class="legend">Tracks</span>
        <div class="row">
          <div class="row__text">
            <div class="row__label">Draw every track</div>
            <p class="row__hint">Off draws only the part you play.</p>
          </div>
          <Switch
            label="Draw every track"
            hideLabel
            on={store.showAllTracks.value}
            onToggle={() => store.setShowAllTracks(!store.showAllTracks.value)}
          />
        </div>
      </div>

      <div class="sheet__field">
        <span class="legend">While playing</span>
        <div class="row">
          <div class="row__text">
            <div class="row__label">Count in</div>
          </div>
          <Switch
            label="Count in"
            hideLabel
            on={store.countInEnabled.value}
            onToggle={() => store.setCountIn(!store.countInEnabled.value)}
          />
        </div>
        <div class="row">
          <div class="row__text">
            <div class="row__label">Metronome</div>
          </div>
          <Switch
            label="Metronome"
            hideLabel
            on={store.metronomeEnabled.value}
            onToggle={() => store.setMetronome(!store.metronomeEnabled.value)}
          />
        </div>
        <div class="row">
          <div class="row__text">
            <div class="row__label">Backing track</div>
            <p class="row__hint">Mutes your part so the rest of the band plays.</p>
          </div>
          <Switch
            label="Backing track"
            hideLabel
            on={store.backingMode.value}
            onToggle={() => store.setBackingMode(!store.backingMode.value)}
          />
        </div>
      </div>
    </>
  )
}
