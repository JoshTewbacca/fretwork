// Module-level signals store for the desktop connectivity state (ADR-003).
// Screens bind to these signals directly, same pattern as search/searchStore.ts.

import { signal } from '@preact/signals'
import { getDb } from '../db/open.ts'
import { getDesktopConfig } from './config.ts'
import { resolveDesktop } from './client.ts'

export type LinkState = 'unknown' | 'checking' | 'reachable' | 'unreachable'

export const linkState = signal<LinkState>('unknown')
export const lastCheckedAt = signal<number | null>(null)
export const activeUrl = signal<string | null>(null)

/** Runs resolveDesktop against the saved config and updates the signals above. */
export async function probe(): Promise<void> {
  linkState.value = 'checking'
  try {
    const db = await getDb()
    const config = await getDesktopConfig(db)
    const url = await resolveDesktop(config)
    activeUrl.value = url
    linkState.value = url ? 'reachable' : 'unreachable'
  } catch {
    activeUrl.value = null
    linkState.value = 'unreachable'
  } finally {
    lastCheckedAt.value = Date.now()
  }
}
