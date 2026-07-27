// Module-level search store: signals for the query/results/state plus the
// in-flight AbortController bookkeeping. Screens bind to the signals directly
// (no props threading needed), same pattern as library/libraryStore.ts.

import { signal } from '@preact/signals'
import type { TabSearchResult } from '../sources/types.ts'
import { TabSourceError } from '../sources/types.ts'
import { gprotabSource } from '../sources/gprotabSource.ts'

export type SearchState = 'idle' | 'searching' | 'done' | 'error'

const MIN_QUERY_LENGTH = 2

export const query = signal('')
export const results = signal<TabSearchResult[]>([])
export const state = signal<SearchState>('idle')
export const errorMessage = signal('')
/** Whether the current error's Retry button should be shown. Not in the
 * original signal list, but the screen needs it to know when to offer Retry. */
export const errorRetryable = signal(false)
/** externalId of the result row currently being added, or null. */
export const addingId = signal<string | null>(null)
/** Feedback for the last failed "Add" action; cleared on the next attempt. */
export const addErrorMessage = signal('')

let inFlight: AbortController | null = null

export function reset(): void {
  inFlight?.abort()
  inFlight = null
  query.value = ''
  results.value = []
  state.value = 'idle'
  errorMessage.value = ''
  errorRetryable.value = false
  addingId.value = null
  addErrorMessage.value = ''
}

export async function runSearch(): Promise<void> {
  const q = query.value.trim()

  // Cancel whatever search is still in flight before starting or bailing out.
  inFlight?.abort()
  inFlight = null

  if (q.length < MIN_QUERY_LENGTH) {
    results.value = []
    state.value = 'idle'
    return
  }

  const controller = new AbortController()
  inFlight = controller
  state.value = 'searching'
  errorMessage.value = ''
  errorRetryable.value = false

  try {
    const found = await gprotabSource.search(q, controller.signal)
    if (controller.signal.aborted) return
    results.value = found
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
