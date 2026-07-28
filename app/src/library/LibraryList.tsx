// Presentational song list: no store access (aside from the setlist picker),
// only props. Cards are tappable to open; favourite and remove are separate
// controls so they don't fight the card's own tap target.

import type { Song } from '../core/types.ts'
import { AddToSetlist } from '../setlists/AddToSetlist.tsx'

/** Practice standing for one song, summarised for the list. */
export interface SongPractice {
  /** Active trouble spots marked against this song. */
  spots: number
  /** 0..1 share of those spots that have reached the maintenance phase. */
  solid: number
}

interface LibraryListProps {
  songs: Song[]
  /** Keyed by song id; songs with no marked passages are simply absent. */
  practice?: Map<string, SongPractice>
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

export function LibraryList({
  songs,
  practice,
  onOpen,
  onToggleFavourite,
  onRemove,
}: LibraryListProps) {
  return (
    <ul class="library-list">
      {songs.map((song) => {
        const standing = practice?.get(song.id)
        return (
          <li key={song.id} class="library-card">
            <div
              class="library-card__main"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(song.id)}
              onKeyDown={openOnKey(() => onOpen(song.id))}
            >
              <div class="card__top">
                <div class="card__text">
                  <div class="card__title">{song.title}</div>
                  <div class="card__sub">
                    {song.artist} · {formatRelativeTime(song.lastPlayedAt)}
                  </div>
                </div>
                {standing ? (
                  <span class="tag tag--teal">
                    {standing.spots} {standing.spots === 1 ? 'spot' : 'spots'}
                  </span>
                ) : (
                  <span class="tag">{song.tabFormat.toUpperCase()}</span>
                )}
              </div>

              {/* How much of what you flagged in this song is now solid. Only
                  meaningful once something has been marked. */}
              {standing && (
                <div class="meter">
                  <span
                    class="meter__fill"
                    style={{ width: `${Math.round(standing.solid * 100)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Two rows: the setlist picker needs the full width to itself,
                and three controls plus a select do not fit at 390px. */}
            <div class="library-card__actions">
              <button
                type="button"
                class={song.favourite ? 'btn btn--small is-active' : 'btn btn--small'}
                aria-pressed={song.favourite}
                onClick={() => onToggleFavourite(song.id)}
              >
                {song.favourite ? 'Favourited' : 'Favourite'}
              </button>
              <button
                type="button"
                class="btn btn--small library-card__remove"
                onClick={() => {
                  if (window.confirm(`Remove "${song.title}" from your library?`)) {
                    onRemove(song.id)
                  }
                }}
              >
                Remove
              </button>
            </div>
            <div class="library-card__actions library-card__actions--setlist">
              <AddToSetlist songId={song.id} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
