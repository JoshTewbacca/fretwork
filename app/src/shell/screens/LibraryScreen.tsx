import { useEffect, useState } from 'preact/hooks'
import * as libraryStore from '../../library/libraryStore.ts'
import type { SortBy } from '../../library/libraryStore.ts'
import { LibraryList } from '../../library/LibraryList.tsx'
import { openSong } from '../../library/openSong.ts'
import * as setlistStore from '../../setlists/setlistStore.ts'
import { SetlistsView } from '../../setlists/SetlistsView.tsx'
import '../../library/library.css'

type Segment = 'songs' | 'setlists'

export function LibraryScreen() {
  const [segment, setSegment] = useState<Segment>('songs')

  useEffect(() => {
    void libraryStore.refresh()
    void setlistStore.refresh()
  }, [])

  const allSongs = libraryStore.songs.value
  const visible = libraryStore.visibleSongs.value

  return (
    <div class="library-screen">
      <div class="library-segmented" role="tablist" aria-label="Library view">
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'songs'}
          class={segment === 'songs' ? 'library-segmented__tab is-active' : 'library-segmented__tab'}
          onClick={() => setSegment('songs')}
        >
          Songs
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'setlists'}
          class={
            segment === 'setlists' ? 'library-segmented__tab is-active' : 'library-segmented__tab'
          }
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
              class="library-search"
              placeholder="Search title or artist"
              value={libraryStore.query.value}
              onInput={(e) => {
                libraryStore.query.value = (e.currentTarget as HTMLInputElement).value
              }}
            />
            <div class="library-controls__row">
              <select
                class="library-sort"
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
              <label class="library-favourites-toggle">
                <input
                  type="checkbox"
                  checked={libraryStore.favouritesOnly.value}
                  onChange={(e) => {
                    libraryStore.favouritesOnly.value = (
                      e.currentTarget as HTMLInputElement
                    ).checked
                  }}
                />
                Favourites only
              </label>
            </div>
          </div>

          {allSongs.length === 0 && (
            <div class="library-empty-state">
              <p>Your library is empty. Import a tab from the player to add one.</p>
            </div>
          )}

          {allSongs.length > 0 && visible.length === 0 && (
            <div class="library-empty-state">
              <p>No songs match this search.</p>
            </div>
          )}

          {visible.length > 0 && (
            <LibraryList
              songs={visible}
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
