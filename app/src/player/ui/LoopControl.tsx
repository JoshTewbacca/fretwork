import type { PlayerStore } from '../core/PlayerStore'

export function LoopControl({ store }: { store: PlayerStore }) {
  const loop = store.loop.value
  const sections = store.sections.value

  function loopSection(startBar: number, endBar: number) {
    store.setLoop({ startBar, endBar })
    store.seekToBar(startBar)
  }

  return (
    <>
      <h3 class="sheet__title">Loop</h3>
      <p class="sheet__sub">
        {loop
          ? `Repeating bars ${loop.startBar + 1} to ${loop.endBar + 1}.`
          : 'Nothing is looping. Pick a range to work on.'}
      </p>

      {/* The part you want is nearly always a named one, so offer those before
          asking anyone to think in bar numbers. */}
      {sections.length > 0 && (
        <div class="sheet__field">
          <span class="legend">Sections</span>
          <div class="loop-sections">
            {sections.map((section) => {
              const isLooping =
                loop?.startBar === section.startBar && loop?.endBar === section.endBar
              return (
                <button
                  key={section.startBar}
                  type="button"
                  class={isLooping ? 'btn btn--small is-active' : 'btn btn--small'}
                  aria-pressed={isLooping}
                  onClick={() => loopSection(section.startBar, section.endBar)}
                >
                  {section.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

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
