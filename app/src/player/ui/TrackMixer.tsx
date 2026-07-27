import type { PlayerStore } from '../core/PlayerStore'
import { Stepper } from './Stepper'

export function TrackMixer({ store }: { store: PlayerStore }) {
  const tracks = store.tracks.value
  const playerTrackIndex = store.playerTrackIndex.value

  return (
    <div class="track-mixer">
      {tracks.map((track) => (
        <div class="track-mixer__row" key={track.index}>
          <label class="track-mixer__part">
            <input
              type="radio"
              name="player-track"
              checked={playerTrackIndex === track.index}
              onChange={() => store.setPlayerTrack(track.index)}
            />
            <span class="track-mixer__name">{track.name}</span>
            {track.isGuitar && <span class="track-mixer__tag">Guitar</span>}
          </label>

          <div class="track-mixer__buttons">
            <button
              type="button"
              class={track.solo ? 'btn btn--small is-active' : 'btn btn--small'}
              aria-pressed={track.solo}
              onClick={() => store.setTrackSolo(track.index, !track.solo)}
            >
              Solo
            </button>
            <button
              type="button"
              class={track.mute ? 'btn btn--small is-active' : 'btn btn--small'}
              aria-pressed={track.mute}
              onClick={() => store.setTrackMute(track.index, !track.mute)}
            >
              Mute
            </button>
          </div>

          <label class="track-mixer__volume">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={track.volume}
              aria-label={`${track.name} volume`}
              onInput={(e) => store.setTrackVolume(track.index, Number(e.currentTarget.value))}
            />
          </label>

          <div class="track-mixer__steppers">
            <Stepper
              label="Capo"
              value={track.capo}
              min={0}
              max={12}
              onChange={(v) => store.setTrackCapo(track.index, v)}
            />
            <Stepper
              label="Transpose"
              value={track.transpositionPitch}
              min={-12}
              max={12}
              format={(v) => (v > 0 ? `+${v}` : String(v))}
              onChange={(v) => store.setTrackTransposition(track.index, v)}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
