// Builds a TabSource backed by this app's own /api/tabs/* proxy (see types.ts
// for why a proxy is needed: neither archive sends CORS headers).
//
// Both remote sources talk to the same two endpoints and differ only by the
// `source` parameter they pass, so they share one implementation here and the
// per-source scraping lives entirely in the Edge functions.

import type { FetchedTab, TabSearchResult, TabSource, TabSourceId } from './types.ts'
import { TabSourceError } from './types.ts'

const SEARCH_ENDPOINT = '/api/tabs/search'
const DOWNLOAD_ENDPOINT = '/api/tabs/download'

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

export function createArchiveSource(id: TabSourceId, label: string): TabSource {
  const unreachable = `Could not reach ${label}. Check your connection and try again.`

  return {
    id,
    label,

    async search(query: string, signal?: AbortSignal): Promise<TabSearchResult[]> {
      const url = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}&source=${encodeURIComponent(id)}`

      let response: Response
      try {
        response = await fetch(url, { signal })
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        throw new TabSourceError(unreachable, true)
      }

      if (!response.ok) {
        const message = await readErrorMessage(response, `${label} search failed (${response.status}).`)
        throw new TabSourceError(message, isRetryableStatus(response.status))
      }

      const body = (await response.json()) as { results: TabSearchResult[] }
      return body.results
    },

    async fetchTab(result: TabSearchResult, signal?: AbortSignal): Promise<FetchedTab> {
      const url =
        `${DOWNLOAD_ENDPOINT}?id=${encodeURIComponent(result.externalId)}` +
        `&source=${encodeURIComponent(id)}`

      let response: Response
      try {
        response = await fetch(url, { signal })
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        throw new TabSourceError(unreachable, true)
      }

      if (!response.ok) {
        const message = await readErrorMessage(response, `${label} download failed (${response.status}).`)
        throw new TabSourceError(message, isRetryableStatus(response.status))
      }

      const bytes = await response.arrayBuffer()
      const filename = response.headers.get('X-Tab-Filename') ?? fallbackFilename(result.title)
      return { bytes, filename }
    },
  }
}
