import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import {
  createPlayerStore,
  type PlayerStore,
} from '../../player/core/PlayerStore'
import { installAudioSessionHandling } from '../../player/core/audioSession'
import './screens.css'

const SOUND_FONT_URL = '/soundfont/sonivox.sf3'
const IMPORT_ACCEPT = '.gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.mxl,.xml'

// Minimal integration of the player core: import a file, render, transport.
// The full controls UI (mixer, loop, count-in, track switcher) is delegation
// task 0.4 and will replace the transport strip below.
export function PlayerScreen() {
  const mountRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const storeRef = useRef<PlayerStore | null>(null)
  const storeVersion = useSignal(0)

  useEffect(() => {
    // DEV-only smoke hook: loads a tiny original alphaTex score so the
    // render/playback pipeline can be tested without importing a file.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __loadDemo?: () => void }).__loadDemo = () => {
        ensureStore().api.tex(
          '\\title "Smoke Test" \\tempo 120 . ' +
            ':4 0.6 2.5 2.4 0.3 | :8 3.3 3.3 5.3 5.3 3.3 3.3 2.3 0.3 | ' +
            ':4 0.6{d} r 2.5 r | :1 (0.6 2.5 2.4)',
        )
      }
    }
    return () => {
      storeRef.current?.destroy()
      storeRef.current = null
    }
  }, [])

  function ensureStore(): PlayerStore {
    let store = storeRef.current
    if (!store) {
      store = createPlayerStore(mountRef.current!, { soundFontUrl: SOUND_FONT_URL })
      installAudioSessionHandling(store)
      storeRef.current = store
      if (import.meta.env.DEV) {
        ;(window as unknown as { __player?: PlayerStore }).__player = store
      }
      storeVersion.value++
    }
    return store
  }

  async function onFileChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const data = await file.arrayBuffer()
    ensureStore().loadScore(data)
  }

  // Touching storeVersion makes the transport strip re-render once the store
  // exists; the signals inside the store drive updates from then on.
  void storeVersion.value
  const store = storeRef.current
  const loaded = store?.scoreLoaded.value ?? false
  const err = store?.error.value ?? null

  return (
    <div class="player-screen">
      {!loaded && (
        <div class="screen-placeholder">
          <p>No tab loaded yet. Import a file to get started.</p>
          <button
            type="button"
            class="button button--primary"
            onClick={() => fileRef.current?.click()}
          >
            Import
          </button>
          {err && <p class="player-error">{err}</p>}
        </div>
      )}

      {loaded && store && (
        <div class="player-transport">
          <button type="button" class="button" onClick={() => store.playPause()}>
            {store.transport.value === 'playing' ? 'Pause' : 'Play'}
          </button>
          <button type="button" class="button" onClick={() => store.stop()}>
            Stop
          </button>
          <label class="player-speed">
            <span>{store.speedPct.value}%</span>
            <input
              type="range"
              min={25}
              max={125}
              step={5}
              value={store.speedPct.value}
              onInput={(e) =>
                store.setSpeedPct(Number((e.currentTarget as HTMLInputElement).value))
              }
            />
          </label>
          <button
            type="button"
            class="button"
            onClick={() => fileRef.current?.click()}
          >
            Import
          </button>
        </div>
      )}

      <div class="score-area" ref={mountRef} />

      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        onChange={onFileChosen}
      />
    </div>
  )
}
