// The TabSource contract (brief section 5). Implementations differ by where
// the fetching happens - see docs/adr/ADR-005-tabsource-placement.md.
//
// Browsers cannot call the archives directly (no CORS headers), so remote
// sources are reached through this app's own serverless proxy at /api/tabs/*.

export type TabSourceId = 'gprotab' | 'guitarprotabs' | 'file'

/**
 * Everything a source tells us about a tab's quality before we download it.
 * All optional: sources expose different subsets, and a source that is up but
 * missing a field must not look like a source that is down.
 */
export interface TabQualitySignals {
  /** Times the file has been downloaded from that source. */
  downloads?: number
  /** Mean user rating, on the source's own scale (both current sources use 0-5). */
  ratingValue?: number
  /** Number of votes behind `ratingValue`. A 5/5 from 1 vote is not a 5/5. */
  ratingVotes?: number
  /** Declared file format, lowercased and without the dot: 'gp3', 'gp4', 'gp5'. */
  format?: string
  /** Declared file size. Sources quote kilobytes; we store bytes. */
  sizeBytes?: number
}

export interface TabSearchResult {
  sourceId: TabSourceId
  /** Stable identifier within the source. For both archives, the site path. */
  externalId: string
  title: string
  artist: string
  /** Absolute page URL, kept for attribution and manual checking. */
  url: string
  /**
   * The disambiguator this source appends to distinguish one transcription of
   * a song from another - "2", "S&M", "Live", "Solo". Empty for the version a
   * source treats as primary. Extracted by the source's parser rather than
   * left inside `title`, so that grouping can match versions of one song.
   */
  version?: string
  signals?: TabQualitySignals
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
