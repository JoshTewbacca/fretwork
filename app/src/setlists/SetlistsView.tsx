// Setlists segment of the library screen: create/rename/delete setlists and
// practice groups, and manage the ordered song list within one at a time.

import { useEffect, useState } from 'preact/hooks'
import type { Setlist } from '../core/types.ts'
import * as libraryStore from '../library/libraryStore.ts'
import { openSong } from '../library/openSong.ts'
import * as setlistStore from './setlistStore.ts'
import './setlists.css'

const KIND_LABEL: Record<Setlist['kind'], string> = {
  setlist: 'Setlist',
  'practice-group': 'Practice group',
}

export function SetlistsView() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Setlist['kind']>('setlist')

  useEffect(() => {
    void setlistStore.refresh()
    void libraryStore.refresh()
  }, [])

  const allSetlists = setlistStore.setlists.value
  const selected = allSetlists.find((s) => s.id === selectedId) ?? null

  async function handleCreate(e: Event) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const id = await setlistStore.createSetlist(trimmed, kind)
    setName('')
    setKind('setlist')
    setSelectedId(id)
  }

  function handleRename(setlist: Setlist) {
    const next = window.prompt('Rename setlist', setlist.name)
    if (next == null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === setlist.name) return
    void setlistStore.renameSetlist(setlist.id, trimmed)
  }

  function handleDelete(setlist: Setlist) {
    if (!window.confirm(`Delete "${setlist.name}"? This cannot be undone.`)) return
    void setlistStore.deleteSetlist(setlist.id)
    if (selectedId === setlist.id) setSelectedId(null)
  }

  function moveSong(setlist: Setlist, index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= setlist.songIds.length) return
    const next = [...setlist.songIds]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    void setlistStore.reorderSetlist(setlist.id, next)
  }

  return (
    <div class="setlists-view">
      <form class="setlists-create" onSubmit={(e) => void handleCreate(e)}>
        <input
          type="text"
          class="setlists-create__name"
          placeholder="New setlist name"
          value={name}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        />
        <select
          class="setlists-create__kind"
          aria-label="Kind"
          value={kind}
          onChange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as Setlist['kind'])}
        >
          <option value="setlist">Setlist</option>
          <option value="practice-group">Practice group</option>
        </select>
        <button type="submit" class="setlists-create__button" disabled={!name.trim()}>
          Create
        </button>
      </form>

      {allSetlists.length === 0 && (
        <div class="setlists-empty-state">
          <p>No setlists yet. Create one above to start grouping songs.</p>
        </div>
      )}

      {allSetlists.length > 0 && (
        <ul class="setlists-list">
          {allSetlists.map((setlist) => (
            <li key={setlist.id} class="setlists-row">
              <div
                class="setlists-row__main"
                role="button"
                tabIndex={0}
                aria-pressed={selectedId === setlist.id}
                onClick={() =>
                  setSelectedId(selectedId === setlist.id ? null : setlist.id)
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelectedId(selectedId === setlist.id ? null : setlist.id)
                  }
                }}
              >
                <div class="setlists-row__text">
                  <span class="setlists-row__name">{setlist.name}</span>
                  <span class="setlists-row__meta">
                    {KIND_LABEL[setlist.kind]} · {setlist.songIds.length}{' '}
                    {setlist.songIds.length === 1 ? 'song' : 'songs'}
                  </span>
                </div>
              </div>
              <div class="setlists-row__actions">
                <button type="button" class="setlists-row__rename" onClick={() => handleRename(setlist)}>
                  Rename
                </button>
                <button type="button" class="setlists-row__delete" onClick={() => handleDelete(setlist)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div class="setlist-detail">
          <h2 class="setlist-detail__title">{selected.name}</h2>

          {selected.songIds.length === 0 && (
            <div class="setlists-empty-state">
              <p>No songs in this {KIND_LABEL[selected.kind].toLowerCase()} yet.</p>
            </div>
          )}

          {selected.songIds.length > 0 && (
            <ul class="setlist-detail__list">
              {selected.songIds.map((songId, index) => {
                const song = libraryStore.songs.value.find((s) => s.id === songId)
                return (
                  <li key={songId} class="setlist-song-row">
                    <div
                      class="setlist-song-row__main"
                      role="button"
                      tabIndex={0}
                      onClick={() => openSong(songId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openSong(songId)
                        }
                      }}
                    >
                      {song ? (
                        <div class="setlist-song-row__text">
                          <span class="setlist-song-row__title">{song.title}</span>
                          <span class="setlist-song-row__artist">{song.artist}</span>
                        </div>
                      ) : (
                        <span class="setlist-song-row__missing">Song no longer in library</span>
                      )}
                    </div>
                    <div class="setlist-song-row__actions">
                      <button
                        type="button"
                        class="setlist-song-row__move"
                        aria-label="Move up"
                        disabled={index === 0}
                        onClick={() => moveSong(selected, index, -1)}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        class="setlist-song-row__move"
                        aria-label="Move down"
                        disabled={index === selected.songIds.length - 1}
                        onClick={() => moveSong(selected, index, 1)}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        class="setlist-song-row__remove"
                        onClick={() => void setlistStore.removeSongFromSetlist(selected.id, songId)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
