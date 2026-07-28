// App-wide display preferences, persisted in the kv store.
//
// These are deliberately global rather than per-song: they answer "how do I
// read tab", which does not change from one song to the next. The player's
// View sheet can override the notation and track choices for the song in hand
// without writing back here, so a one-off look at the notation does not become
// the new default.

import { signal, type ReadonlySignal } from '@preact/signals'
import { getDb } from '../db/open.ts'
import { getKv, putKv } from '../db/kv.ts'
import { DEFAULT_ZOOM_PCT, clampZoom } from '../player/core/zoom.ts'

const KV_KEY = 'display-prefs'

export interface DisplayPrefs {
  /** Draw the standard-notation stave above the tab. Off by default. */
  showNotation: boolean
  /** Draw every track rather than only the part being played. */
  showAllTracks: boolean
  /** Starting zoom for songs the user has not adjusted. */
  defaultZoomPct: number
}

export const DEFAULT_PREFS: DisplayPrefs = {
  showNotation: false,
  showAllTracks: false,
  defaultZoomPct: DEFAULT_ZOOM_PCT,
}

const prefsSignal = signal<DisplayPrefs>(DEFAULT_PREFS)
const loadedSignal = signal(false)

export const prefs: ReadonlySignal<DisplayPrefs> = prefsSignal
/** False until the stored values have been read back, so the UI can wait
 *  rather than flashing the defaults and then correcting itself. */
export const prefsLoaded: ReadonlySignal<boolean> = loadedSignal

/** Tolerate anything the store hands back: a bad or partial record should fall
 *  back to a default, not break the player. */
function coerce(stored: unknown): DisplayPrefs {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_PREFS
  const raw = stored as Partial<Record<keyof DisplayPrefs, unknown>>
  const zoom = typeof raw.defaultZoomPct === 'number' ? Math.round(raw.defaultZoomPct) : NaN
  return {
    showNotation: raw.showNotation === true,
    showAllTracks: raw.showAllTracks === true,
    defaultZoomPct: Number.isFinite(zoom) ? clampZoom(zoom) : DEFAULT_PREFS.defaultZoomPct,
  }
}

let loading: Promise<void> | null = null

/** Read the stored preferences once. Repeat calls share the first load. */
export function loadPrefs(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      try {
        const db = await getDb()
        prefsSignal.value = coerce(await getKv(db, KV_KEY))
      } finally {
        loadedSignal.value = true
      }
    })()
  }
  return loading
}

/** Update one or more preferences and persist the result. */
export async function setPrefs(patch: Partial<DisplayPrefs>): Promise<void> {
  const next = coerce({ ...prefsSignal.value, ...patch })
  prefsSignal.value = next
  const db = await getDb()
  await putKv(db, KV_KEY, next)
}

/** Test seam: drop the cached load so a fresh database is read again. */
export function resetPrefsForTests(): void {
  loading = null
  loadedSignal.value = false
  prefsSignal.value = DEFAULT_PREFS
}
