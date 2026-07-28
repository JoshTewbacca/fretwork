import type { PlayerStore } from '../core/PlayerStore'
import { Stepper } from './Stepper'

export function TrackMixer({ store }: { store: PlayerStore }) {
  const tracks = store.tracks.value
  const playerTrackIndex = store.playerTrackIndex.value
  const showAllTracks = store.showAllTracks.value

  return (
    <>
      <h3 class="sheet__title">Tracks</h3>
      <p class="sheet__sub">
        {showAllTracks
          ? 'Every track is drawn. Pick the part you play to follow it.'
          : 'Only the part you play is drawn, which keeps the tab large.'}
      </p>

      <div class="track-list">
        {tracks.map((track) => {
          const isPlayerTrack = playerTrackIndex === track.index
          return (
            <div
              class={isPlayerTrack ? 'track-list__row is-playing' : 'track-list__row'}
              key={track.index}
            >
              <label class="track-list__part">
                <input
                  type="radio"
                  name="player-track"
                  checked={isPlayerTrack}
                  onChange={() => store.setPlayerTrack(track.index)}
                />
                <span class="track-list__name">{track.name}</span>
                {track.isGuitar && <span class="tag">Guitar</span>}
                {isPlayerTrack && <span class="tag tag--amber">Your part</span>}
              </label>

              <div class="track-list__buttons">
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

              <label class="track-list__volume">
                <span class="legend">Volume</span>
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

              <div class="track-list__steppers">
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
          )
        })}
      </div>
    </>
  )
}
