// Compact control for a library row: pick an existing setlist and add the
// row's song to it. Assumes setlistStore.setlists is already populated (the
// hosting screen is responsible for calling setlistStore.refresh()).

import { useState } from 'preact/hooks'
import { setlists, addSongToSetlist } from './setlistStore.ts'

interface AddToSetlistProps {
  songId: string
}

export function AddToSetlist({ songId }: AddToSetlistProps) {
  const [selectedId, setSelectedId] = useState('')
  const [confirmation, setConfirmation] = useState('')

  const options = setlists.value

  if (options.length === 0) {
    return null
  }

  async function handleAdd() {
    if (!selectedId) return
    const target = options.find((s) => s.id === selectedId)
    if (!target) return
    await addSongToSetlist(selectedId, songId)
    setConfirmation(`Added to ${target.name}`)
    window.setTimeout(() => setConfirmation(''), 2000)
  }

  return (
    <div class="add-to-setlist">
      <select
        class="add-to-setlist__select"
        aria-label="Add to setlist"
        value={selectedId}
        onChange={(e) => setSelectedId((e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="">Add to...</option>
        {options.map((setlist) => (
          <option key={setlist.id} value={setlist.id}>
            {setlist.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        class="add-to-setlist__button"
        disabled={!selectedId}
        onClick={() => void handleAdd()}
      >
        Add
      </button>
      {confirmation && <span class="add-to-setlist__confirmation">{confirmation}</span>}
    </div>
  )
}
