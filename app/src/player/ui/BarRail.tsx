// The bar rail: one strip under the title showing where the playhead is, which
// bars are looped, and which bars are marked trouble spots. It is also the
// scrub control - tapping a bar seeks to it.
//
// Everything it draws is data the app already holds, which is the point: the
// three things you want to know mid-practice, in 26px of height.

import type { Passage } from '../../core/types'
import type { PlayerStore } from '../core/PlayerStore'

/** Below this many bars per pixel the per-bar hairlines stop being readable
 *  and only add noise, so the rail drops them. */
const MAX_TICKED_BARS = 160

export interface BarRailProps {
  store: PlayerStore
  /** Passages for the loaded song and track; drawn as marks. */
  passages: Passage[]
}

export function BarRail({ store, passages }: BarRailProps) {
  const barCount = store.barCount.value
  const currentBar = store.currentBarIndex.value
  const loop = store.loop.value

  if (barCount <= 0) return null

  const pct = (bars: number) => `${(bars / barCount) * 100}%`

  function seekFromEvent(e: MouseEvent) {
    const rail = e.currentTarget as HTMLElement
    const { left, width } = rail.getBoundingClientRect()
    if (width <= 0) return
    const ratio = Math.min(1, Math.max(0, (e.clientX - left) / width))
    store.seekToBar(Math.floor(ratio * barCount))
  }

  function seekFromKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      store.seekToBar(currentBar - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      store.seekToBar(currentBar + 1)
    }
  }

  return (
    <button
      type="button"
      class="bar-rail"
      role="slider"
      aria-label="Bar position"
      aria-valuemin={1}
      aria-valuemax={barCount}
      aria-valuenow={currentBar + 1}
      aria-valuetext={`Bar ${currentBar + 1} of ${barCount}`}
      onClick={seekFromEvent}
      onKeyDown={seekFromKey}
    >
      {barCount <= MAX_TICKED_BARS && (
        <span class="bar-rail__ticks" style={{ '--bar-width': pct(1) }} />
      )}

      {passages.map((passage) => (
        <span
          key={passage.id}
          class="bar-rail__mark"
          style={{
            left: pct(passage.startBar),
            width: pct(passage.endBar - passage.startBar + 1),
          }}
        />
      ))}

      {loop && (
        <span
          class="bar-rail__loop"
          style={{
            left: pct(loop.startBar),
            width: pct(loop.endBar - loop.startBar + 1),
          }}
        />
      )}

      <span class="bar-rail__head" style={{ left: pct(currentBar) }} />
      <span class="bar-rail__legend">
        Bar {currentBar + 1} / {barCount}
      </span>
    </button>
  )
}
