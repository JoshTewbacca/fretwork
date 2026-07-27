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
