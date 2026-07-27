import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { createPlayerStore, type PlayerStore } from '../../player/core/PlayerStore'
import { installAudioSessionHandling } from '../../player/core/audioSession'
import { PlayerControls } from '../../player/ui/PlayerControls'
import { NoteEditor } from '../../player/ui/NoteEditor'
import { importTabFile } from '../../import/importFile'
import { ACCEPT_ATTRIBUTE } from '../../import/format'
import { requestedSongId, clearRequestedSong } from '../../library/openSong'
import { getDb } from '../../db/open'
import { getSong, putSong } from '../../db/songs'
import { getBlob, putBlob } from '../../db/blobs'
import { reportMissingAsset } from '../../offline/integrity'
import './screens.css'

const SOUND_FONT_URL = '/soundfont/sonivox.sf3'

export function PlayerScreen() {
  const mountRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const storeRef = useRef<PlayerStore | null>(null)
  const storeVersion = useSignal(0)
  const status = useSignal<string | null>(null)
  const saving = useSignal(false)
  // Library metadata for the loaded song. Many files embed no title of their
  // own, so the library's title is the better label when the score has none.
  const currentSong = useSignal<{ id: string; title: string; artist: string } | null>(null)

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

  useEffect(() => {
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

  return (
    <div class="player-screen">
      <header class="player-header">
        <div class="player-header__meta">
          {loaded && store ? (
            <>
              <span class="player-header__title">
                {store.scoreTitle.value || currentSong.value?.title || 'Untitled'}
              </span>
              <span class="player-header__artist">
                {store.scoreArtist.value || currentSong.value?.artist || ''}
              </span>
            </>
          ) : (
            <span class="player-header__title">No tab loaded</span>
          )}
        </div>
        <button type="button" class="btn" onClick={() => fileRef.current?.click()}>
          Import
        </button>
      </header>

      {(status.value || err) && (
        <p class={err ? 'player-message player-message--error' : 'player-message'}>
          {err ?? status.value}
        </p>
      )}

      {!loaded && (
        <div class="screen-placeholder">
          <p>
            Search for a song, import a Guitar Pro or MusicXML file, or open something from
            your library.
          </p>
        </div>
      )}

      {loaded && store && (
        <>
          <PlayerControls store={store} />
          <NoteEditor store={store} onSave={saveCorrections} saving={saving.value} />
        </>
      )}

      <div class="score-area" ref={mountRef} />

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
