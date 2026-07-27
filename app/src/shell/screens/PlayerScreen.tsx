import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { createPlayerStore, type PlayerStore } from '../../player/core/PlayerStore'
import { installAudioSessionHandling } from '../../player/core/audioSession'
import { PlayerControls } from '../../player/ui/PlayerControls'
import { importTabFile } from '../../import/importFile'
import { ACCEPT_ATTRIBUTE } from '../../import/format'
import { requestedSongId, clearRequestedSong } from '../../library/openSong'
import { getDb } from '../../db/open'
import { getSong } from '../../db/songs'
import { getBlob } from '../../db/blobs'
import './screens.css'

const SOUND_FONT_URL = '/soundfont/sonivox.sf3'

export function PlayerScreen() {
  const mountRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const storeRef = useRef<PlayerStore | null>(null)
  const storeVersion = useSignal(0)
  const status = useSignal<string | null>(null)
  // Library metadata for the loaded song. Many files embed no title of their
  // own, so the library's title is the better label when the score has none.
  const currentSong = useSignal<{ title: string; artist: string } | null>(null)

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
        const blob = await getBlob(db, song.tabBlobHash)
        if (!blob) {
          throw new Error(
            `The tab file for "${song.title}" is missing from local storage.`,
          )
        }
        const bytes = await blob.bytes.arrayBuffer()
        if (cancelled) return
        ensureStore().loadScore(bytes)
        currentSong.value = { title: song.title, artist: song.artist }
        status.value = null
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
      currentSong.value = { title: song.title, artist: song.artist }
      status.value = duplicate
        ? `"${song.title}" is already in your library. Opened the existing copy.`
        : `Added "${song.title}" to your library.`
    } catch (err) {
      status.value = err instanceof Error ? err.message : String(err)
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
            Import a Guitar Pro or MusicXML file to get started, or open something from your
            library.
          </p>
        </div>
      )}

      {loaded && store && <PlayerControls store={store} />}

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
