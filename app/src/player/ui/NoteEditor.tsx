import type { PlayerStore } from '../core/PlayerStore'

// Correction editor. Appears only when a note is tapped in the score, so it
// stays out of the way during normal practice. Songsterr cannot do this at all.
export function NoteEditor({
  store,
  onSave,
  saving,
}: {
  store: PlayerStore
  onSave: () => void
  saving: boolean
}) {
  const note = store.selectedNote.value
  if (!note) return null

  const dirty = store.hasUnsavedCorrections.value

  return (
    <div class="note-editor">
      <div class="note-editor__row">
        <span class="note-editor__where">
          Bar {note.barNumber}, string {note.string}
        </span>
        <button
          type="button"
          class="btn note-editor__close"
          onClick={() => store.clearNoteSelection()}
        >
          Done
        </button>
      </div>

      <div class="note-editor__row">
        <span class="note-editor__label">Fret</span>
        <div class="note-editor__stepper">
          <button
            type="button"
            class="btn"
            aria-label="Lower fret"
            onClick={() => store.setSelectedNoteFret(note.fret - 1)}
          >
            &minus;
          </button>
          <span class="note-editor__value">{note.fret}</span>
          <button
            type="button"
            class="btn"
            aria-label="Raise fret"
            onClick={() => store.setSelectedNoteFret(note.fret + 1)}
          >
            +
          </button>
        </div>
      </div>

      <div class="note-editor__row">
        <span class="note-editor__label">String</span>
        <div class="note-editor__stepper">
          <button
            type="button"
            class="btn"
            aria-label="Previous string"
            onClick={() => store.setSelectedNoteString(note.string - 1)}
          >
            &minus;
          </button>
          <span class="note-editor__value">
            {note.string} of {note.stringCount}
          </span>
          <button
            type="button"
            class="btn"
            aria-label="Next string"
            onClick={() => store.setSelectedNoteString(note.string + 1)}
          >
            +
          </button>
        </div>
      </div>

      {dirty && (
        <div class="note-editor__row note-editor__save">
          <span class="note-editor__hint">
            Corrections are kept separately; the original file is never changed.
          </span>
          <button
            type="button"
            class="button button--primary"
            disabled={saving}
            onClick={onSave}
          >
            {saving ? 'Saving...' : 'Save corrections'}
          </button>
        </div>
      )}
    </div>
  )
}
