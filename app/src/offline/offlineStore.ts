// Startup checks and the state the shell renders a banner from.
// See docs/adr/ADR-003-offline-state-machine.md.

import { signal, type ReadonlySignal } from '@preact/signals'
import { sweepForEvictions, type IntegrityReport } from './integrity'
import { readStorageBudget, type StorageBudget } from './storageBudget'

const integrity = signal<IntegrityReport | null>(null)
const budget = signal<StorageBudget | null>(null)
const checking = signal(false)
const dismissed = signal(false)

export const offlineStore: {
  integrity: ReadonlySignal<IntegrityReport | null>
  budget: ReadonlySignal<StorageBudget | null>
  checking: ReadonlySignal<boolean>
  dismissed: ReadonlySignal<boolean>
  runStartupChecks: () => Promise<void>
  dismissBanner: () => void
} = {
  integrity,
  budget,
  checking,
  dismissed,

  async runStartupChecks() {
    if (checking.value) return
    checking.value = true
    try {
      const [report, b] = await Promise.all([sweepForEvictions(), readStorageBudget()])
      integrity.value = report
      budget.value = b
      if (report.evictedSongs.length > 0 || report.evictedBundles.length > 0) {
        dismissed.value = false
      }
    } catch (err) {
      // A failed sweep must never block the app; the library still renders.
      console.warn('[offline] startup checks failed:', err)
    } finally {
      checking.value = false
    }
  },

  dismissBanner() {
    dismissed.value = true
  },
}

/** One-line summary for the banner, or null when there is nothing to say. */
export function offlineBannerMessage(): string | null {
  if (dismissed.value) return null

  const report = integrity.value
  if (report) {
    const songs = report.evictedSongs.length
    const bundles = report.evictedBundles.length
    if (songs > 0) {
      return songs === 1
        ? `1 song's tab file was removed by the browser to free space. Add it again to restore it.`
        : `${songs} songs had their tab files removed by the browser to free space. Add them again to restore them.`
    }
    if (bundles > 0) {
      return bundles === 1
        ? '1 song lost its downloaded audio. Reconnect to your desktop to fetch it again.'
        : `${bundles} songs lost their downloaded audio. Reconnect to your desktop to fetch them again.`
    }
  }

  const b = budget.value
  if (b?.message) return b.message
  return null
}
