// The Audio panel of the player sheet: choose what you play along to.
//
// Before a bundle exists this is the one place that offers to fetch it, which is
// also the only moment the desktop is needed for a song.

import { useState } from 'preact/hooks'
import type { PlayerStore } from '../player/core/PlayerStore'
import type { AudioMode } from '../player/core/externalMedia'
import { syncQualityLabel } from '../player/core/syncMap'
import { activeDesktopUrl } from '../desktop/client'
import { downloadState } from './bundleStore'

const MODE_LABELS: Record<AudioMode, { label: string; hint: string }> = {
  synth: { label: 'Synth', hint: 'alphaTab plays the tab. Works with no recording.' },
  full: { label: 'Recording', hint: 'The whole record, guitar included.' },
  backing: { label: 'Backing', hint: 'The record with the guitar taken out. You play it.' },
  guitar: { label: 'Guitar only', hint: 'Just the part, to hear how it should sound.' },
}

export interface AudioControlsProps {
  store: PlayerStore
  /** Null when the loaded score is not a library song. */
  songId: string | null
  /** Fetches the bundle from the desktop; resolves false if there is none. */
  onDownload: () => Promise<boolean>
}

export function AudioControls({ store, songId, onDownload }: AudioControlsProps) {
  const [message, setMessage] = useState<string | null>(null)
  const modes = store.availableAudioModes.value
  const current = store.audioMode.value
  const syncMap = store.syncMap.value
  const download = downloadState.value
  const hasRecording = modes.length > 1

  async function download_() {
    setMessage(null)
    try {
      const found = await onDownload()
      if (!found) {
        setMessage(
          'The desktop has no audio for this song yet. Match it and build a bundle first.',
        )
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <h3 class="sheet__title">Play along to</h3>
      <p class="sheet__sub">
        {hasRecording
          ? syncQualityLabel(syncMap ?? undefined)
          : 'No recording on this phone for this song.'}
      </p>

      <div class="sheet__field">
        <div class="audio-modes">
          {(Object.keys(MODE_LABELS) as AudioMode[]).map((mode) => {
            const offered = modes.includes(mode)
            return (
              <button
                key={mode}
                type="button"
                class={
                  current === mode ? 'audio-mode is-active' : 'audio-mode'
                }
                aria-pressed={current === mode}
                disabled={!offered}
                onClick={() => store.setAudioMode(mode)}
              >
                <span class="audio-mode__label">{MODE_LABELS[mode].label}</span>
                <span class="audio-mode__hint">
                  {offered
                    ? MODE_LABELS[mode].hint
                    : mode === 'synth'
                      ? MODE_LABELS[mode].hint
                      : 'Needs the separated stems.'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {!hasRecording && songId && (
        <div class="sheet__field">
          <button
            type="button"
            class="btn btn--primary btn--block"
            disabled={download.status === 'checking' || download.status === 'downloading'}
            onClick={() => void download_()}
          >
            {download.status === 'checking'
              ? 'Checking the desktop…'
              : download.status === 'downloading'
                ? `Downloading the ${download.label}…`
                : 'Download from the desktop'}
          </button>
          <p class="sheet__note">
            {activeDesktopUrl.value
              ? 'Downloaded once, then it plays offline.'
              : 'The desktop is not connected. Check the connection in Settings.'}
          </p>
        </div>
      )}

      {!songId && (
        <p class="sheet__note">
          Add this tab to your library first, then audio can be matched to it.
        </p>
      )}

      {message && <p class="sheet__note sheet__note--warn">{message}</p>}

      {hasRecording && syncMap?.status === 'needs-review' && (
        <p class="sheet__note">
          The start is lined up but the tempo has not been checked against the tab. If the
          cursor drifts, the recording and the tab disagree on tempo.
        </p>
      )}
    </>
  )
}
