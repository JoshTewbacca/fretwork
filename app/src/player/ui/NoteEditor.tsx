import type { PlayerStore } from '../core/PlayerStore'
import { Stepper } from './Stepper'

// Correction editor. Reached by tapping a note in the score, which opens the
// sheet on this panel, so it stays out of the way during normal practice.
// Songsterr cannot do this at all.
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
    <>
      <h3 class="sheet__title">Correct this note</h3>
      <p class="sheet__sub">
        <span class="note-editor__where">
          Bar {note.barNumber}, string {note.string}
        </span>{' '}
        · corrections are kept separately, so the imported file is never changed.
      </p>

      <div class="sheet__field">
        <div class="row">
          <div class="row__text">
            <div class="row__label">Fret</div>
          </div>
          <Stepper
            label=""
            ariaLabel="fret"
            value={note.fret}
            min={0}
            max={36}
            onChange={(v) => store.setSelectedNoteFret(v)}
          />
        </div>
        <div class="row">
          <div class="row__text">
            <div class="row__label">String</div>
            <p class="row__hint">1 is the highest string.</p>
          </div>
          <Stepper
            label=""
            ariaLabel="string"
            value={note.string}
            min={1}
            max={note.stringCount}
            format={(v) => `${v} of ${note.stringCount}`}
            onChange={(v) => store.setSelectedNoteString(v)}
          />
        </div>
      </div>

      <div class="note-editor__actions">
        <button type="button" class="btn" onClick={() => store.clearNoteSelection()}>
          Done
        </button>
        <button
          type="button"
          class="btn btn--primary"
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save corrections'}
        </button>
      </div>
    </>
  )
}
