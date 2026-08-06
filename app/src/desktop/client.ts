// HTTP client for the desktop ingest service. Endpoint shapes here mirror
// ingest/src/fretwork_ingest/api.py exactly -- see that file for the source
// of truth.

import { signal } from '@preact/signals'
import { candidateUrls, normalizeUrl, type DesktopConfig } from './config.ts'

const HEALTH_TIMEOUT_MS = 3000

export interface HealthCheckResult {
  ok: boolean
  version?: string
  error?: string
}

/**
 * True when this page was loaded over https and the given desktop URL is
 * plain http -- the combination the browser blocks as mixed content before
 * the request is ever sent. Defaults to "page is https" when `window` isn't
 * available (e.g. under test), matching the deployed target (Vercel/HTTPS).
 */
export function isMixedContentBlocked(url: string): boolean {
  const pageIsHttps =
    typeof window !== 'undefined' && window.location ? window.location.protocol === 'https:' : true
  return pageIsHttps && /^http:\/\//i.test(url.trim())
}

/** GET /health with a 3 second timeout. Never throws. */
export async function checkHealth(baseUrl: string, signal?: AbortSignal): Promise<HealthCheckResult> {
  if (isMixedContentBlocked(baseUrl)) {
    return { ok: false, error: 'Blocked: this page is HTTPS and that address is http://.' }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)

  try {
    const response = await fetch(`${normalizeUrl(baseUrl)}/health`, { signal: controller.signal })
    if (!response.ok) {
      return { ok: false, error: `Desktop responded with ${response.status}.` }
    }
    const body = (await response.json()) as { status?: string; version?: string }
    if (body.status !== 'ok') {
      return { ok: false, error: 'Desktop health check returned an unexpected response.' }
    }
    return { ok: true, version: body.version }
  } catch {
    if (controller.signal.aborted) {
      return { ok: false, error: 'Timed out waiting for the desktop.' }
    }
    return { ok: false, error: 'Could not reach the desktop.' }
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

/** The desktop base URL that last answered a health check, or null if none has. */
export const activeDesktopUrl = signal<string | null>(null)

/**
 * Tries each candidate URL (Tailscale first, then LAN -- see
 * config.candidateUrls) and returns the first that answers /health, caching
 * the winner in `activeDesktopUrl`. Returns null if none answer.
 */
export async function resolveDesktop(config: DesktopConfig): Promise<string | null> {
  for (const url of candidateUrls(config)) {
    const result = await checkHealth(url)
    if (result.ok) {
      activeDesktopUrl.value = url
      return url
    }
  }
  activeDesktopUrl.value = null
  return null
}

export interface ReviewSourceAudio {
  path: string
  artist: string | null
  title: string | null
  album: string | null
}

export interface ReviewCandidate {
  fingerprint: string
  confidence: number
  source_audio: ReviewSourceAudio | null
}

export interface ReviewQueueEntry {
  song_id: string
  candidates: ReviewCandidate[]
}

export interface ReviewQueueResponse {
  entries: ReviewQueueEntry[]
}

/** GET /review-queue. */
export async function fetchReviewQueue(baseUrl: string): Promise<ReviewQueueResponse> {
  const response = await fetch(`${normalizeUrl(baseUrl)}/review-queue`)
  if (!response.ok) {
    throw new Error(`Failed to load the review queue (${response.status}).`)
  }
  return (await response.json()) as ReviewQueueResponse
}

// --- Manifest and blobs (Milestone 3: real-recording bundles) ---------------

/** One audio bundle as /manifest reports it. snake_case mirrors the API. */
export interface ManifestBundle {
  id: string
  backing_hash: string | null
  /** Null until stem separation has run for this bundle. */
  guitar_hash: string | null
  duration_ms: number | null
  sync_map: import('../core/types.ts').SyncMap | null
  created_at: number
}

export interface ManifestSong {
  song_id: string
  fingerprint: string
  match_status: string
  confidence: number
  bundles: ManifestBundle[]
}

export interface ManifestResponse {
  songs: ManifestSong[]
}

/** GET /manifest. */
export async function fetchManifest(baseUrl: string): Promise<ManifestResponse> {
  const response = await fetch(`${normalizeUrl(baseUrl)}/manifest`)
  if (!response.ok) {
    throw new Error(`Failed to load the desktop manifest (${response.status}).`)
  }
  return (await response.json()) as ManifestResponse
}

/**
 * GET /blob/{hash}. Returns the bytes so the caller can store them locally -
 * audio is played from IndexedDB, never streamed from the desktop, because the
 * whole point is that practice works with the desktop switched off.
 */
export async function fetchBlob(baseUrl: string, hash: string): Promise<Blob> {
  const response = await fetch(`${normalizeUrl(baseUrl)}/blob/${encodeURIComponent(hash)}`)
  if (!response.ok) {
    throw new Error(`Failed to download ${hash.slice(0, 8)} (${response.status}).`)
  }
  return await response.blob()
}

// --- The catalogue (ADR-006) ------------------------------------------------
// /library, not /manifest: the manifest reports one entry per matched
// recording, so a song without audio never appears in it, and a song without
// audio is the normal case.

/** One catalogue row as /library reports it. snake_case mirrors the API. */
export interface LibrarySong {
  id: string
  title: string
  artist: string
  album: string | null
  source: { source_id: string; external_id: string | null; url: string | null }
  tab_blob_hash: string
  tab_format: string
  default_track_index: number | null
  target_tempo_bpm: number | null
  archived: boolean
  added_at: number
  updated_at: number
  bundles: ManifestBundle[]
}

export interface LibraryResponse {
  version: number
  songs: LibrarySong[]
}

/** GET /library. */
export async function fetchLibrary(baseUrl: string): Promise<LibraryResponse> {
  const response = await fetch(`${normalizeUrl(baseUrl)}/library`)
  if (!response.ok) {
    throw new Error(`Failed to load the desktop library (${response.status}).`)
  }
  return (await response.json()) as LibraryResponse
}

/**
 * POST /blob. Returns the hash the desktop computed for the bytes it received,
 * which the caller should treat as authoritative rather than assuming it
 * matches a locally computed one.
 */
export async function uploadBlob(baseUrl: string, bytes: Blob): Promise<string> {
  const response = await fetch(`${normalizeUrl(baseUrl)}/blob`, {
    method: 'POST',
    body: bytes,
  })
  if (!response.ok) {
    throw new Error(`Failed to upload a file to the desktop (${response.status}).`)
  }
  return ((await response.json()) as { hash: string }).hash
}

/** The desktop-owned fields of a song, as POST /songs accepts them. */
export interface SongUploadBody {
  id: string
  title: string
  artist: string
  album: string | null
  source_id: string
  source_external_id: string | null
  source_url: string | null
  tab_blob_hash: string
  tab_format: string
  default_track_index: number | null
  target_tempo_bpm: number | null
  added_at: number
}

/** POST /songs. */
export async function pushSong(baseUrl: string, body: SongUploadBody): Promise<void> {
  const response = await fetch(`${normalizeUrl(baseUrl)}/songs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = `(${response.status})`
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // Keep the status code; a body we cannot parse is not worth a second error.
    }
    throw new Error(`The desktop rejected this song: ${detail}`)
  }
}

export interface ReviewDecisionBody {
  fingerprint: string
  decision: 'confirm' | 'reject'
}

export interface ReviewResult {
  song_id: string
  fingerprint: string
  status: 'confirmed' | 'rejected'
}

/** POST /review/{song_id}. */
export async function postReview(
  baseUrl: string,
  songId: string,
  body: ReviewDecisionBody,
): Promise<ReviewResult> {
  const response = await fetch(`${normalizeUrl(baseUrl)}/review/${encodeURIComponent(songId)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Failed to submit the review decision (${response.status}).`)
  }
  return (await response.json()) as ReviewResult
}
