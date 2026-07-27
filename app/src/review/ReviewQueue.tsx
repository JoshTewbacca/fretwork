// Ingest review queue: pending fingerprint matches waiting for a
// confirm/reject decision, shown inside the Settings screen (not routed
// separately -- see AppShell's router, which this does not touch).

import { useEffect, useState } from 'preact/hooks'
import * as desktopStatus from '../desktop/status.ts'
import { fetchReviewQueue, postReview } from '../desktop/client.ts'
import type { ReviewQueueEntry } from '../desktop/client.ts'
import './review.css'

type LoadState = 'idle' | 'loading' | 'loaded' | 'error'

function confidencePct(confidence: number): number {
  return Math.round(confidence * 100)
}

export function ReviewQueue() {
  const [entries, setEntries] = useState<ReviewQueueEntry[]>([])
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const link = desktopStatus.linkState.value
  const baseUrl = desktopStatus.activeUrl.value

  async function load(url: string) {
    setLoadState('loading')
    setErrorMessage('')
    try {
      const result = await fetchReviewQueue(url)
      setEntries(result.entries)
      setLoadState('loaded')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not load the review queue.')
      setLoadState('error')
    }
  }

  useEffect(() => {
    if (link === 'reachable' && baseUrl) {
      void load(baseUrl)
    }
  }, [link, baseUrl])

  async function handleDecision(
    songId: string,
    fingerprint: string,
    decision: 'confirm' | 'reject',
  ) {
    if (!baseUrl) return
    const key = `${songId}:${fingerprint}`
    setPendingKey(key)
    try {
      await postReview(baseUrl, songId, { fingerprint, decision })
      setEntries((prev) =>
        prev
          .map((entry) =>
            entry.song_id === songId
              ? { ...entry, candidates: entry.candidates.filter((c) => c.fingerprint !== fingerprint) }
              : entry,
          )
          .filter((entry) => entry.candidates.length > 0),
      )
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not submit the review decision.')
    } finally {
      setPendingKey(null)
    }
  }

  if (link !== 'reachable' || !baseUrl) {
    return (
      <div class="review-queue__notice">
        <p>
          The desktop is not reachable, so there are no matches to review right now. Connect to
          the desktop from the section above, then retry.
        </p>
        <button type="button" class="button" onClick={() => void desktopStatus.probe()}>
          Retry
        </button>
      </div>
    )
  }

  if (loadState === 'idle' || loadState === 'loading') {
    return <p class="review-queue__notice">Loading the review queue...</p>
  }

  if (loadState === 'error') {
    return (
      <div class="review-queue__notice">
        <p>{errorMessage}</p>
        <button type="button" class="button" onClick={() => void load(baseUrl)}>
          Retry
        </button>
      </div>
    )
  }

  if (entries.length === 0) {
    return <p class="review-queue__notice">No matches waiting for review.</p>
  }

  return (
    <div class="review-queue">
      {errorMessage && <p class="review-queue__error">{errorMessage}</p>}
      {entries.map((entry) => (
        <div class="review-queue__song" key={entry.song_id}>
          <h4 class="review-queue__song-id">{entry.song_id}</h4>
          {entry.candidates.map((candidate) => {
            const key = `${entry.song_id}:${candidate.fingerprint}`
            const pending = pendingKey === key
            return (
              <div class="review-queue__candidate" key={candidate.fingerprint}>
                <div class="review-queue__candidate-info">
                  <span class="review-queue__candidate-title">
                    {candidate.source_audio?.title ?? candidate.source_audio?.path ?? 'Unknown source'}
                  </span>
                  {candidate.source_audio?.artist && (
                    <span class="review-queue__candidate-artist">{candidate.source_audio.artist}</span>
                  )}
                  <span class="review-queue__candidate-confidence">
                    {confidencePct(candidate.confidence)}% match
                  </span>
                </div>
                <div class="review-queue__candidate-actions">
                  <button
                    type="button"
                    class="button button--primary"
                    disabled={pending}
                    onClick={() => void handleDecision(entry.song_id, candidate.fingerprint, 'confirm')}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    class="button"
                    disabled={pending}
                    onClick={() => void handleDecision(entry.song_id, candidate.fingerprint, 'reject')}
                  >
                    Reject
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
