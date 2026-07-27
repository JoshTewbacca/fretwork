import { useEffect } from 'preact/hooks'
import * as libraryStore from '../../library/libraryStore.ts'
import type { SortBy } from '../../library/libraryStore.ts'
import { LibraryList } from '../../library/LibraryList.tsx'
import { openSong } from '../../library/openSong.ts'
import '../../library/library.css'

export function LibraryScreen() {
  useEffect(() => {
    void libraryStore.refresh()
  }, [])

  const allSongs = libraryStore.songs.value
  const visible = libraryStore.visibleSongs.value

  return (
    <div class="library-screen">
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
              libraryStore.sortBy.value = (e.currentTarget as HTMLSelectElement).value as SortBy
            }}
          >
            <option value="recent">Recently added</option>
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
    </div>
  )
}
