// The player sheet: everything that is not a mid-practice control.
//
// It replaces the stack of <details> accordions that used to sit above the
// score. Because the sheet is positioned out of the layout flow, opening it
// cannot resize the score - which is what used to make the player overlap.

import { useEffect } from 'preact/hooks'
import type { PlayerStore } from '../core/PlayerStore'
import { LoopControl } from './LoopControl'
import { TrackMixer } from './TrackMixer'
import { DisplayControls } from './DisplayControls'
import { NoteEditor } from './NoteEditor'
import { MarkPassage } from '../../practice/ui/MarkPassage'
import { Tuner } from '../../tuner/Tuner'
import { AudioControls } from '../../audio/AudioControls'

export type SheetPanel = 'audio' | 'loop' | 'tracks' | 'view' | 'mark' | 'tune' | 'note'

const TABS: { panel: SheetPanel; label: string }[] = [
  { panel: 'audio', label: 'Audio' },
  { panel: 'loop', label: 'Loop' },
  { panel: 'tracks', label: 'Tracks' },
  { panel: 'view', label: 'View' },
  { panel: 'mark', label: 'Mark' },
  { panel: 'tune', label: 'Tune' },
]

export interface PlayerSheetProps {
  store: PlayerStore
  panel: SheetPanel
  onPanelChange: (panel: SheetPanel) => void
  onClose: () => void
  /** Null when the loaded score is not a library song; Mark is unavailable. */
  songId: string | null
  onSaveCorrections: () => void
  savingCorrections: boolean
  /** Fetches this song's recording from the desktop; false if there is none. */
  onDownloadBundle: () => Promise<boolean>
}

export function PlayerSheet({
  store,
  panel,
  onPanelChange,
  onClose,
  songId,
  onSaveCorrections,
  savingCorrections,
  onDownloadBundle,
}: PlayerSheetProps) {
  // Escape closes, matching every other dismissible layer on the platform.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // You cannot tune over the synth, so opening the tuner stops playback.
  useEffect(() => {
    if (panel === 'tune') store.stop()
  }, [panel, store])

  // The note panel is not a tab: it appears because a note was tapped, and
  // clearing the selection is what dismisses it.
  const showTabs = panel !== 'note'
  const playerTrack = store.tracks.value.find(
    (track) => track.index === store.playerTrackIndex.value,
  )

  return (
    <>
      <button
        type="button"
        class="sheet-scrim"
        aria-label="Close"
        onClick={() => {
          if (panel === 'note') store.clearNoteSelection()
          onClose()
        }}
      />
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Player options">
        <span class="sheet__grip" />

        {showTabs && (
          <div class="seg seg--plain sheet__tabs" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.panel}
                type="button"
                role="tab"
                aria-selected={panel === tab.panel}
                class={panel === tab.panel ? 'seg__opt is-active' : 'seg__opt'}
                onClick={() => onPanelChange(tab.panel)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div class="sheet__body">
          {panel === 'audio' && (
            <AudioControls store={store} songId={songId} onDownload={onDownloadBundle} />
          )}
          {panel === 'loop' && <LoopControl store={store} />}
          {panel === 'tracks' && <TrackMixer store={store} />}
          {panel === 'view' && <DisplayControls store={store} />}
          {panel === 'tune' && (
            <Tuner
              tuning={playerTrack?.tuning ?? []}
              tuningName={playerTrack?.tuningName ?? ''}
            />
          )}
          {panel === 'note' && (
            <NoteEditor
              store={store}
              onSave={onSaveCorrections}
              saving={savingCorrections}
            />
          )}
          {panel === 'mark' &&
            (songId ? (
              <MarkPassage
                songId={songId}
                trackIndex={store.playerTrackIndex.value}
                currentBar={store.currentBarIndex.value}
                loop={store.loop.value}
                onMarked={onClose}
              />
            ) : (
              <>
                <h3 class="sheet__title">Mark a trouble spot</h3>
                <p class="sheet__sub">
                  Add this tab to your library first, then trouble spots can be tracked
                  against it.
                </p>
              </>
            ))}
        </div>
      </div>
    </>
  )
}
