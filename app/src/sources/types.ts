// The TabSource contract (brief section 5). Implementations differ by where
// the fetching happens - see docs/adr/ADR-005-tabsource-placement.md.
//
// Browsers cannot call the archives directly (no CORS headers), so remote
// sources are reached through this app's own serverless proxy at /api/tabs/*.

export type TabSourceId = 'gprotab' | 'file'

export interface TabSearchResult {
  sourceId: TabSourceId
  /** Stable identifier within the source. For gprotab, the site path. */
  externalId: string
  title: string
  artist: string
  /** Absolute page URL, kept for attribution and manual checking. */
  url: string
}

export interface FetchedTab {
  bytes: ArrayBuffer
  /** Filename as offered by the source, used to detect the tab format. */
  filename: string
}

export interface TabSource {
  readonly id: TabSourceId
  readonly label: string
  search(query: string, signal?: AbortSignal): Promise<TabSearchResult[]>
  fetchTab(result: TabSearchResult, signal?: AbortSignal): Promise<FetchedTab>
}

/** Thrown when a source is reachable but the query produced nothing usable. */
export class TabSourceError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable = false) {
    super(message)
    this.name = 'TabSourceError'
    this.retryable = retryable
  }
}
