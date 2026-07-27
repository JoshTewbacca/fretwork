// Integration contract between the library and the player: the library sets
// which song was requested and navigates to the player route; the player
// screen (owned elsewhere) is responsible for reading requestedSongId and
// loading it. Kept dependency-free of the router module by design.

import { signal } from '@preact/signals'

export const requestedSongId = signal<string | null>(null)

export function openSong(id: string): void {
  requestedSongId.value = id
  window.location.hash = '#/player'
}

export function clearRequestedSong(): void {
  requestedSongId.value = null
}
