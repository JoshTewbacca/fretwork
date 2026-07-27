// Presentational song list: no store access, only props. Rows are tappable to
// open; favourite and remove are separate controls so they don't fight the
// row's own tap target.

import type { Song } from '../core/types.ts'

interface LibraryListProps {
  songs: Song[]
  onOpen: (id: string) => void
  onToggleFavourite: (id: string) => void
  onRemove: (id: string) => void
}

function openOnKey(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handler()
    }
  }
}

export function LibraryList({ songs, onOpen, onToggleFavourite, onRemove }: LibraryListProps) {
  return (
    <ul class="library-list">
      {songs.map((song) => (
        <li key={song.id} class="library-row">
          <div
            class="library-row__main"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(song.id)}
            onKeyDown={openOnKey(() => onOpen(song.id))}
          >
            <div class="library-row__text">
              <span class="library-row__title">{song.title}</span>
              <span class="library-row__artist">{song.artist}</span>
            </div>
            <span class="library-row__badge">{song.tabFormat.toUpperCase()}</span>
          </div>

          <div class="library-row__actions">
            <button
              type="button"
              class={
                song.favourite
                  ? 'library-row__favourite is-active'
                  : 'library-row__favourite'
              }
              aria-pressed={song.favourite}
              aria-label="Favourite"
              onClick={() => onToggleFavourite(song.id)}
            >
              Favourite
            </button>
            <button
              type="button"
              class="library-row__remove"
              onClick={() => {
                if (window.confirm(`Remove "${song.title}" from your library?`)) {
                  onRemove(song.id)
                }
              }}
            >
              Remove
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
