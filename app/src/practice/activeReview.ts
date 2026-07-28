// Integration contract between the practice tab and the player.
//
// A review block used to live entirely inside the practice tab, where it could
// only state the tempo it wanted and count taps: it never loaded the song, set
// the loop or set the speed, and navigating to the player to do that by hand
// destroyed the block, because only the player screen survives a tab switch.
//
// So the practice tab now only chooses what to review. The player runs it: it
// loads the song, loops the passage, sets the tempo, and shows the block in
// its dock. Same split as library/openSong.ts, and openSong is reused here
// because "open this song in the player" is exactly what it means.

import { signal, type ReadonlySignal } from '@preact/signals'
import type { Passage } from '../core/types'
import { openSong } from '../library/openSong'

export interface ActiveReview {
  passageId: string
  songId: string
  trackIndex: number
  /** Zero-based, inclusive. */
  startBar: number
  endBar: number
  tempoPct: number
  label: string
}

const active = signal<ActiveReview | null>(null)

export const activeReview: ReadonlySignal<ActiveReview | null> = active

/** Start reviewing a passage: hands the player the song and the settings. */
export function startReview(passage: Passage, tempoPct: number, label: string): void {
  active.value = {
    passageId: passage.id,
    songId: passage.songId,
    trackIndex: passage.trackIndex,
    startBar: passage.startBar,
    endBar: passage.endBar,
    tempoPct,
    label,
  }
  openSong(passage.songId)
}

export function endReview(): void {
  active.value = null
}
