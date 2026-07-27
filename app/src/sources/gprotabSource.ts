// TabSource implementation backed by this app's own /api/tabs/* proxy (see
// types.ts for why a proxy is needed: gprotab.net has no CORS headers).

import type { FetchedTab, TabSearchResult, TabSource } from './types.ts'
import { TabSourceError } from './types.ts'

const SEARCH_ENDPOINT = '/api/tabs/search'
const DOWNLOAD_ENDPOINT = '/api/tabs/download'
const UNREACHABLE_MESSAGE = 'Could not reach GProTab. Check your connection and try again.'

interface ErrorBody {
  error?: unknown
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as ErrorBody
    if (typeof body.error === 'string' && body.error.trim()) return body.error
  } catch {
    // Body wasn't JSON (or was empty) - fall back to the generic message below.
  }
  return fallback
}

/** 5xx and network failures are worth retrying; 4xx (bad query, not found) are not. */
function isRetryableStatus(status: number): boolean {
  return status >= 500
}

function fallbackFilename(title: string): string {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${slug || 'tab'}.gp3`
}

async function requestJson<T>(url: string, signal: AbortSignal | undefined, action: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new TabSourceError(UNREACHABLE_MESSAGE, true)
  }

  if (!response.ok) {
    const message = await readErrorMessage(response, `GProTab ${action} failed (${response.status}).`)
    throw new TabSourceError(message, isRetryableStatus(response.status))
  }

  return (await response.json()) as T
}

export const gprotabSource: TabSource = {
  id: 'gprotab',
  label: 'GProTab',

  async search(query: string, signal?: AbortSignal): Promise<TabSearchResult[]> {
    const body = await requestJson<{ results: TabSearchResult[] }>(
      `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`,
      signal,
      'search',
    )
    return body.results
  },

  async fetchTab(result: TabSearchResult, signal?: AbortSignal): Promise<FetchedTab> {
    let response: Response
    try {
      response = await fetch(`${DOWNLOAD_ENDPOINT}?id=${encodeURIComponent(result.externalId)}`, {
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new TabSourceError(UNREACHABLE_MESSAGE, true)
    }

    if (!response.ok) {
      const message = await readErrorMessage(response, `GProTab download failed (${response.status}).`)
      throw new TabSourceError(message, isRetryableStatus(response.status))
    }

    const bytes = await response.arrayBuffer()
    const filename = response.headers.get('X-Tab-Filename') ?? fallbackFilename(result.title)
    return { bytes, filename }
  },
}
