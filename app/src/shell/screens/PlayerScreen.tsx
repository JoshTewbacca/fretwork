import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { createPlayerStore, type PlayerStore } from '../../player/core/PlayerStore'
import { installAudioSessionHandling } from '../../player/core/audioSession'
import { PlayerDock } from '../../player/ui/PlayerDock'
import { BarRail } from '../../player/ui/BarRail'
import { PlayerSheet, type SheetPanel } from '../../player/ui/PlayerSheet'
import { attachPinchZoom } from '../../player/ui/pinchZoom'
import { practiceStore } from '../../practice/practiceStore'
import { activeReview, endReview } from '../../practice/activeReview'
import { ReviewBlock } from '../../practice/ui/ReviewBlock'
import { navigate } from '../router'
import { prefs, prefsLoaded, loadPrefs } from '../../settings/prefs'
import { importTabFile } from '../../import/importFile'
import { ACCEPT_ATTRIBUTE } from '../../import/format'
import { requestedSongId, clearRequestedSong } from '../../library/openSong'
import { getDb } from '../../db/open'
import { getSong, putSong } from '../../db/songs'
import { getBlob, putBlob } from '../../db/blobs'
import { reportMissingAsset } from '../../offline/integrity'
import '../../player/ui/controls.css'
import './screens.css'

const SOUND_FONT_URL = '/soundfont/sonivox.sf3'

export function PlayerScreen() {
  const mountRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const storeRef = useRef<PlayerStore | null>(null)
  const storeVersion = useSignal(0)
  const status = useSignal<string | null>(null)
  const saving = useSignal(false)
  const sheetPanel = useSignal<SheetPanel | null>(null)
  // Library metadata for the loaded song. Many files embed no title of their
  // own, so the library's title is the better label when the score has none.
  const currentSong = useSignal<{ id: string; title: string; artist: string } | null>(null)

  function ensureStore(): PlayerStore {
    let store = storeRef.current
    if (!store) {
      const { showNotation, showAllTracks, defaultZoomPct } = prefs.value
      store = createPlayerStore(mountRef.current!, {
        soundFontUrl: SOUND_FONT_URL,
        // Notation is opt-in: tab only unless the stored preference says
        // otherwise. See src/settings/prefs.ts.
        staveProfile: showNotation ? 'scoreTab' : 'tab',
        showAllTracks,
        zoomPct: defaultZoomPct,
      })
      installAudioSessionHandling(store)
      storeRef.current = store
      if (import.meta.env.DEV) {
        ;(window as unknown as { __player?: PlayerStore }).__player = store
      }
      storeVersion.value++
    }
    return store
  }

  // Pinch the score to zoom. Attached to the mount element for the lifetime of
  // the screen; it reads the store lazily so it works from the first score on.
  useEffect(() => {
    const element = mountRef.current
    if (!element) return
    return attachPinchZoom(element, {
      getZoomPct: () => storeRef.current?.zoomPct.value ?? 0,
      setZoomPct: (pct) => storeRef.current?.setZoomPct(pct),
    })
  }, [])

  useEffect(() => {
    void loadPrefs()
    void practiceStore.refresh()
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

  // Preferences arrive asynchronously and can change while a score is open, so
  // re-apply them rather than relying on the values held at construction.
  const { showNotation, showAllTracks } = prefs.value
  const loadedPrefs = prefsLoaded.value
  useEffect(() => {
    if (!loadedPrefs) return
    const store = storeRef.current
    if (!store) return
    store.setNotationVisible(showNotation)
    store.setShowAllTracks(showAllTracks)
  }, [loadedPrefs, showNotation, showAllTracks])

  // A review runs here rather than in the practice tab: put the player into
  // the state the scheduler asked for once the score is up. Keyed on
  // scoreLoaded too, because loading a score clears the loop.
  // playerReady is in the dependencies as well as scoreLoaded because setting a
  // loop needs alphaTab's tick cache, which is only populated once the MIDI has
  // been generated. Keyed on scoreLoaded alone the loop silently fails to take.
  const review = activeReview.value
  const scoreIsLoaded = storeRef.current?.scoreLoaded.value ?? false
  const playerIsReady = storeRef.current?.playerReady.value ?? false
  useEffect(() => {
    const store = storeRef.current
    if (!store || !review || !scoreIsLoaded) return
    store.setPlayerTrack(review.trackIndex)
    store.setSpeedPct(review.tempoPct)
    store.setLoop({ startBar: review.startBar, endBar: review.endBar })
    store.seekToBar(review.startBar)
  }, [review, scoreIsLoaded, playerIsReady])

  // Tapping a note in the score is a request to correct it, so surface the
  // editor without the user having to find it.
  const selectedNote = storeRef.current?.selectedNote.value ?? null
  useEffect(() => {
    if (selectedNote) sheetPanel.value = 'note'
    else if (sheetPanel.value === 'note') sheetPanel.value = null
  }, [selectedNote])

  // Opening a song from the Library sets this signal; load it and clear it so
  // returning to the player later does not reload the same score.
  const pendingSongId = requestedSongId.value
  useEffect(() => {
    if (!pendingSongId) return
    let cancelled = false
    void (async () => {
      try {
        const db = await getDb()
        const song = await getSong(db, pendingSongId)
        if (!song) throw new Error('That song is no longer in the library.')
        // Prefer a corrected revision when one exists, but only if it was made
        // against the tab file we still hold (see docs/01-data-model.md).
        const useCorrected =
          song.correctedTabBlobHash !== undefined &&
          song.correctionsBaseHash === song.tabBlobHash
        const hash = useCorrected ? song.correctedTabBlobHash! : song.tabBlobHash
        const blob = await getBlob(db, hash)
        if (!blob) {
          // Lazy verification path from ADR-003: a read miss is itself evidence
          // of eviction, so record it rather than only finding it next launch.
          await reportMissingAsset('tab', hash)
          throw new Error(
            `The tab file for "${song.title}" was removed by the browser to free space. Add it again to restore it.`,
          )
        }
        const bytes = await blob.bytes.arrayBuffer()
        if (cancelled) return
        ensureStore().loadScore(bytes)
        currentSong.value = { id: song.id, title: song.title, artist: song.artist }
        status.value =
          song.correctedTabBlobHash !== undefined && !useCorrected
            ? 'Your corrections were made against an older version of this tab, so the original is shown.'
            : null
        await putSong(db, { ...song, lastPlayedAt: Date.now() })
      } catch (e) {
        if (!cancelled) status.value = e instanceof Error ? e.message : String(e)
      } finally {
        clearRequestedSong()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pendingSongId])

  async function onFileChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      const { song, duplicate } = await importTabFile(file)
      const db = await getDb()
      const blob = await getBlob(db, song.tabBlobHash)
      if (!blob) throw new Error('The imported file could not be read back.')
      ensureStore().loadScore(await blob.bytes.arrayBuffer())
      currentSong.value = { id: song.id, title: song.title, artist: song.artist }
      status.value = duplicate
        ? `"${song.title}" is already in your library. Opened the existing copy.`
        : `Added "${song.title}" to your library.`
      await putSong(db, { ...song, lastPlayedAt: Date.now() })
    } catch (err) {
      status.value = err instanceof Error ? err.message : String(err)
    }
  }

  // Corrections are stored as a separate GP7 export; the imported original is
  // never overwritten, so re-fetching a source can't destroy local edits.
  async function saveCorrections() {
    const store = storeRef.current
    const song = currentSong.value
    if (!store || !song) return
    saving.value = true
    try {
      const bytes = store.exportCorrectedScore()
      if (!bytes) throw new Error('Nothing to save.')
      const db = await getDb()
      const record = await getSong(db, song.id)
      if (!record) throw new Error('That song is no longer in the library.')
      const hash = await putBlob(db, new Blob([bytes as BlobPart]), 'tab')
      await putSong(db, {
        ...record,
        correctedTabBlobHash: hash,
        correctionsBaseHash: record.tabBlobHash,
      })
      status.value = 'Corrections saved.'
    } catch (err) {
      status.value = err instanceof Error ? err.message : String(err)
    } finally {
      saving.value = false
    }
  }

  void storeVersion.value
  const store = storeRef.current
  const loaded = store?.scoreLoaded.value ?? false
  const err = store?.error.value ?? null
  const song = currentSong.value
  const panel = sheetPanel.value

  // Only this song's marks belong on the rail.
  const passages =
    loaded && song
      ? practiceStore.passages.value.filter(
          (p) => p.songId === song.id && p.status === 'active',
        )
      : []

  return (
    <div class="player-screen">
      <header class="player-bar">
        <div class="player-bar__meta">
          {loaded && store ? (
            <>
              <div class="player-bar__title">
                {store.scoreTitle.value || song?.title || 'Untitled'}
              </div>
              <div class="player-bar__sub">
                {[store.scoreArtist.value || song?.artist, currentPartName(store)]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </>
          ) : (
            <div class="player-bar__title">No tab loaded</div>
          )}
        </div>
        <button
          type="button"
          class="player-bar__action"
          aria-label="Import a tab file"
          onClick={() => fileRef.current?.click()}
        >
          <ImportGlyph />
        </button>
      </header>

      {(status.value || err) && (
        <p class={err ? 'player-message player-message--error' : 'player-message'}>
          {err ?? status.value}
        </p>
      )}

      {loaded && store && <BarRail store={store} passages={passages} />}

      {!loaded && (
        <div class="screen-placeholder">
          <p>
            Search for a song, import a Guitar Pro or MusicXML file, or open something from
            your library.
          </p>
        </div>
      )}

      <div class="score-area" ref={mountRef} />

      {loaded && store && (
        <PlayerDock
          store={store}
          onOpenSheet={() => (sheetPanel.value = 'view')}
          review={
            review ? (
              <ReviewBlock
                key={review.passageId}
                review={review}
                onFinished={() => {
                  endReview()
                  store.setLoop(null)
                  // Back to the practice tab, which is where the next thing to
                  // work on is listed.
                  navigate('practice')
                }}
              />
            ) : null
          }
        />
      )}

      {loaded && store && panel && (
        <PlayerSheet
          store={store}
          panel={panel}
          onPanelChange={(next) => (sheetPanel.value = next)}
          onClose={() => (sheetPanel.value = null)}
          songId={song?.id ?? null}
          onSaveCorrections={saveCorrections}
          savingCorrections={saving.value}
        />
      )}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        hidden
        onChange={onFileChosen}
      />
    </div>
  )
}

/** The part being played, shown in the subtitle so the tab on screen is never
 *  ambiguous when a score has several tracks. */
function currentPartName(store: PlayerStore): string {
  const track = store.tracks.value.find((t) => t.index === store.playerTrackIndex.value)
  return track?.name ?? ''
}

function ImportGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden
    >
      <path d="M12 4v11" />
      <path d="M8.2 11.2 12 15l3.8-3.8" />
      <path d="M4.5 17.5v1a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1" />
    </svg>
  )
}
