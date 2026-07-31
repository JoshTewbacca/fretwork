// Module-level search store: signals for the query/results/state plus the
// in-flight AbortController bookkeeping. Screens bind to the signals directly
// (no props threading needed), same pattern as library/libraryStore.ts.
//
// Search fans out to every registered source in parallel and merges what
// comes back into one group per song (see grouping.ts). A source that fails
// while another succeeds is reported as a warning rather than an error: half
// a result list beats none, and the archives go down independently.

import { signal } from '@preact/signals'
import type { TabSearchResult } from '../sources/types.ts'
import { TabSourceError } from '../sources/types.ts'
import { tabSources } from '../sources/index.ts'
import { groupResults, type SongGroup } from './grouping.ts'

export type SearchState = 'idle' | 'searching' | 'done' | 'error'

const MIN_QUERY_LENGTH = 2

export const query = signal('')
export const results = signal<TabSearchResult[]>([])
/** `results` grouped by song, best version first. What the screen renders. */
export const groups = signal<SongGroup[]>([])
export const state = signal<SearchState>('idle')
export const errorMessage = signal('')
/** Whether the current error's Retry button should be shown. Not in the
 * original signal list, but the screen needs it to know when to offer Retry. */
export const errorRetryable = signal(false)
/** Set when some but not all sources failed; the results shown are partial. */
export const partialWarning = signal('')
/** externalId of the result row currently being added, or null. */
export const addingId = signal<string | null>(null)
/** Feedback for the last failed "Add" action; cleared on the next attempt. */
export const addErrorMessage = signal('')
/** Group keys the user has expanded to see every version. */
export const expandedGroups = signal<ReadonlySet<string>>(new Set())

let inFlight: AbortController | null = null

export function reset(): void {
  inFlight?.abort()
  inFlight = null
  query.value = ''
  results.value = []
  groups.value = []
  state.value = 'idle'
  errorMessage.value = ''
  errorRetryable.value = false
  partialWarning.value = ''
  addingId.value = null
  addErrorMessage.value = ''
  expandedGroups.value = new Set()
}

export function toggleGroup(key: string): void {
  const next = new Set(expandedGroups.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  expandedGroups.value = next
}

export async function runSearch(): Promise<void> {
  const q = query.value.trim()

  // Cancel whatever search is still in flight before starting or bailing out.
  inFlight?.abort()
  inFlight = null

  if (q.length < MIN_QUERY_LENGTH) {
    results.value = []
    groups.value = []
    state.value = 'idle'
    return
  }

  const controller = new AbortController()
  inFlight = controller
  state.value = 'searching'
  errorMessage.value = ''
  errorRetryable.value = false
  partialWarning.value = ''
  expandedGroups.value = new Set()

  try {
    const settled = await Promise.allSettled(
      tabSources.map((source) => source.search(q, controller.signal)),
    )
    if (controller.signal.aborted) return

    const found: TabSearchResult[] = []
    const failures: { label: string; error: unknown }[] = []

    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        found.push(...outcome.value)
      } else {
        failures.push({ label: tabSources[index].label, error: outcome.reason })
      }
    })

    if (failures.length === tabSources.length) {
      const first = failures[0]?.error
      if (first instanceof TabSourceError) {
        errorMessage.value = first.message
        errorRetryable.value = first.retryable
      } else {
        errorMessage.value = 'Something went wrong searching for tabs.'
        errorRetryable.value = false
      }
      state.value = 'error'
      return
    }

    if (failures.length > 0) {
      const names = failures.map((failure) => failure.label).join(' and ')
      partialWarning.value = `${names} did not respond, so some versions may be missing.`
    }

    results.value = found
    groups.value = groupResults(found)
    state.value = 'done'
  } catch (err) {
    if (controller.signal.aborted) return
    if (err instanceof TabSourceError) {
      errorMessage.value = err.message
      errorRetryable.value = err.retryable
    } else {
      errorMessage.value = 'Something went wrong searching for tabs.'
      errorRetryable.value = false
    }
    state.value = 'error'
  } finally {
    if (inFlight === controller) inFlight = null
  }
}
