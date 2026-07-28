import { useEffect, useState } from 'preact/hooks'
import * as libraryStore from '../../library/libraryStore.ts'
import type { SortBy } from '../../library/libraryStore.ts'
import { LibraryList, type SongPractice } from '../../library/LibraryList.tsx'
import { openSong } from '../../library/openSong.ts'
import * as setlistStore from '../../setlists/setlistStore.ts'
import { SetlistsView } from '../../setlists/SetlistsView.tsx'
import { practiceStore } from '../../practice/practiceStore.ts'
import '../../library/library.css'

type Segment = 'songs' | 'setlists'

/**
 * Per-song practice standing for the list: how many trouble spots are open and
 * what share of them have reached maintenance. It is the practice data the app
 * already keeps, surfaced where you choose what to play next.
 */
function practiceBySong(): Map<string, SongPractice> {
  const states = practiceStore.states.value
  const totals = new Map<string, { spots: number; solid: number }>()
  for (const passage of practiceStore.passages.value) {
    if (passage.status !== 'active') continue
    const entry = totals.get(passage.songId) ?? { spots: 0, solid: 0 }
    entry.spots += 1
    if (states.get(passage.id)?.phase === 'maintenance') entry.solid += 1
    totals.set(passage.songId, entry)
  }
  return new Map(
    [...totals].map(([songId, { spots, solid }]) => [
      songId,
      { spots, solid: spots === 0 ? 0 : solid / spots },
    ]),
  )
}

export function LibraryScreen() {
  const [segment, setSegment] = useState<Segment>('songs')

  useEffect(() => {
    void libraryStore.refresh()
    void setlistStore.refresh()
    void practiceStore.refresh()
  }, [])

  const allSongs = libraryStore.songs.value
  const visible = libraryStore.visibleSongs.value

  return (
    <div class="library-screen">
      <div class="library-header">
        <h1 class="screen-title">Library</h1>
      </div>

      <div class="seg seg--plain" role="tablist" aria-label="Library view">
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'songs'}
          class={segment === 'songs' ? 'seg__opt is-active' : 'seg__opt'}
          onClick={() => setSegment('songs')}
        >
          Songs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'setlists'}
          class={segment === 'setlists' ? 'seg__opt is-active' : 'seg__opt'}
          onClick={() => setSegment('setlists')}
        >
          Setlists
        </button>
      </div>

      {segment === 'songs' && (
        <>
          <div class="library-controls">
            <input
              type="search"
              class="input"
              placeholder="Search title or artist"
              value={libraryStore.query.value}
              onInput={(e) => {
                libraryStore.query.value = (e.currentTarget as HTMLInputElement).value
              }}
            />
            <div class="library-controls__row">
              <select
                class="input library-sort"
                aria-label="Sort by"
                value={libraryStore.sortBy.value}
                onChange={(e) => {
                  libraryStore.sortBy.value = (e.currentTarget as HTMLSelectElement)
                    .value as SortBy
                }}
              >
                <option value="recent">Recently added</option>
                <option value="recent-played">Recently played</option>
                <option value="title">Title</option>
                <option value="artist">Artist</option>
              </select>
              <button
                type="button"
                class={
                  libraryStore.favouritesOnly.value
                    ? 'btn btn--small library-favourites is-active'
                    : 'btn btn--small library-favourites'
                }
                aria-pressed={libraryStore.favouritesOnly.value}
                onClick={() => {
                  libraryStore.favouritesOnly.value = !libraryStore.favouritesOnly.value
                }}
              >
                Favourites
              </button>
            </div>
          </div>

          {allSongs.length === 0 && (
            <div class="screen-placeholder">
              <p>Your library is empty. Import a tab from the player to add one.</p>
            </div>
          )}

          {allSongs.length > 0 && visible.length === 0 && (
            <div class="screen-placeholder">
              <p>No songs match this search.</p>
            </div>
          )}

          {visible.length > 0 && (
            <LibraryList
              songs={visible}
              practice={practiceBySong()}
              onOpen={openSong}
              onToggleFavourite={libraryStore.toggleFavourite}
              onRemove={libraryStore.removeSong}
            />
          )}
        </>
      )}

      {segment === 'setlists' && <SetlistsView />}
    </div>
  )
}
