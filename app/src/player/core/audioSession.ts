// iOS audio session handling: unlock on first gesture, survive interruptions
// (calls, other apps taking the audio session) and route changes (headphones
// unplugged) without wedging the player. See brief section 7.3.
//
// alphaTab's web audio output exposes the underlying AudioContext through the
// player. We treat 'interrupted'/'suspended' states uniformly: playback is
// paused in the store, and the context is resumed on the next user gesture.

import type { PlayerStore } from './PlayerStore'

function findAudioContext(store: PlayerStore): AudioContext | null {
  // The web synth output holds the context; reach it defensively since this
  // is not a stable public API surface.
  const output = (store.api.player as unknown as { output?: { context?: AudioContext } })
    ?.output
  return output?.context ?? null
}

export function installAudioSessionHandling(store: PlayerStore): () => void {
  const onStateChange = () => {
    const ctx = findAudioContext(store)
    if (!ctx) return
    // iOS uses the non-standard 'interrupted' state for calls/other apps.
    const state = ctx.state as string
    if (state === 'interrupted' || state === 'suspended') {
      if (store.transport.value === 'playing') store.playPause()
    }
  }

  const onGesture = () => {
    const ctx = findAudioContext(store)
    if (ctx && ctx.state !== 'running') {
      void ctx.resume()
    }
  }

  const onPageHide = () => {
    if (store.transport.value === 'playing') store.playPause()
  }

  const ctx = findAudioContext(store)
  ctx?.addEventListener('statechange', onStateChange)
  document.addEventListener('touchend', onGesture, { passive: true })
  document.addEventListener('pointerup', onGesture, { passive: true })
  window.addEventListener('pagehide', onPageHide)

  return () => {
    ctx?.removeEventListener('statechange', onStateChange)
    document.removeEventListener('touchend', onGesture)
    document.removeEventListener('pointerup', onGesture)
    window.removeEventListener('pagehide', onPageHide)
  }
}
