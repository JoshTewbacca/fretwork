import type { PlayerStore } from '../core/PlayerStore'

export function LoopControl({ store }: { store: PlayerStore }) {
  const loop = store.loop.value

  return (
    <>
      <h3 class="sheet__title">Loop</h3>
      <p class="sheet__sub">
        {loop
          ? `Repeating bars ${loop.startBar + 1} to ${loop.endBar + 1}.`
          : 'Nothing is looping. Pick a range to work on.'}
      </p>

      <div class="sheet__field">
        <button
          type="button"
          class="btn btn--block"
          onClick={() => store.loopCurrentBar()}
        >
          Loop the current bar
        </button>
      </div>

      <div class="sheet__field">
        <button
          type="button"
          class="btn btn--block"
          onClick={() => store.loopFromSelection()}
        >
          Loop the selected bars
        </button>
        <p class="sheet__note">Drag across the tab to select bars first.</p>
      </div>

      {loop && (
        <div class="sheet__field">
          <button type="button" class="btn btn--block" onClick={() => store.setLoop(null)}>
            Stop looping
          </button>
        </div>
      )}
    </>
  )
}
