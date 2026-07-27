// Presentational song list: no store access (aside from the setlist picker),
// only props. Rows are tappable to open; favourite and remove are separate
// controls so they don't fight the row's own tap target.

import type { Song } from '../core/types.ts'
import { AddToSetlist } from '../setlists/AddToSetlist.tsx'

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

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Renders a coarse relative time ("2 days ago", "Just now", "Never"). */
export function formatRelativeTime(ts?: number, now: number = Date.now()): string {
  if (ts == null) return 'Never'
  const diff = now - ts
  if (diff < MINUTE_MS) return 'Just now'
  if (diff < HOUR_MS) {
    const minutes = Math.floor(diff / MINUTE_MS)
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  }
  if (diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  }
  const days = Math.floor(diff / DAY_MS)
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`
  const years = Math.floor(months / 12)
  return `${years} ${years === 1 ? 'year' : 'years'} ago`
}

export function LibraryList({ songs, onOpen, onToggleFavourite, onRemove }: LibraryListProps) {
  return (
    <ul class="library-list">
      {songs.map((song) => (
        <li key={song.id} class="library-row">
          <div class="library-row__top">
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
                <span class="library-row__last-played">
                  Last played: {formatRelativeTime(song.lastPlayedAt)}
                </span>
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
          </div>

          <div class="library-row__footer">
            <AddToSetlist songId={song.id} />
          </div>
        </li>
      ))}
    </ul>
  )
}
