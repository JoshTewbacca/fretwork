// SyncMap logic: deciding which anchors are safe to hand to the player.
//
// Kept free of alphaTab so it can be unit tested without a DOM; the conversion
// to alphaTab's own objects lives in syncPoints.ts.
//
// Design per ADR-002: we never persist alphaTab objects and never read sync
// points back out. SyncMap is the one direction of truth, and alphaTab does all
// the interpolation from the anchors we give it - between two anchors it applies
// a piecewise-linear virtual tempo (its syncBpm mechanism), which is exactly the
// warp ADR-002 assumes. There is no interpolation code of ours to drift out of
// agreement with the player.

import type { SyncAnchor, SyncMap } from '../../core/types'

/**
 * Put anchors into a state the player can be trusted with: in time order, one
 * per (bar, occurrence) slot, nothing pointing outside the score or at a
 * negative audio position.
 *
 * A bad anchor is worse than a missing one, because alphaTab will happily warp
 * the whole time axis to reach it. So anything questionable is dropped rather
 * than repaired.
 */
export function normaliseAnchors(
  anchors: readonly SyncAnchor[],
  barCount: number,
): SyncAnchor[] {
  const bySlot = new Map<string, SyncAnchor>()

  for (const anchor of anchors) {
    if (!Number.isFinite(anchor.audioMs) || anchor.audioMs < 0) continue
    if (!Number.isInteger(anchor.masterBarIndex)) continue
    if (anchor.masterBarIndex < 0 || anchor.masterBarIndex >= barCount) continue
    if (!Number.isInteger(anchor.barOccurence) || anchor.barOccurence < 0) continue

    const slot = `${anchor.masterBarIndex}:${anchor.barOccurence}`
    const existing = bySlot.get(slot)
    // A user anchor is authoritative for its slot (ADR-002). Between two of the
    // same source, the later one in the list wins.
    if (existing && existing.source === 'user' && anchor.source !== 'user') continue
    bySlot.set(slot, anchor)
  }

  return [...bySlot.values()].sort(
    (a, b) =>
      a.masterBarIndex - b.masterBarIndex ||
      a.barOccurence - b.barOccurence ||
      a.audioMs - b.audioMs,
  )
}

/**
 * True when the map positions the audio at all. An empty map is not an error -
 * alphaTab maps the two time axes linearly from zero without any anchors - but
 * it is worth telling apart from a map that has located the start.
 */
export function hasAnchors(syncMap: SyncMap | undefined): boolean {
  return (syncMap?.points.length ?? 0) > 0
}

/**
 * What to tell the user about how well the cursor will track.
 *
 * 'needs-review' is not a failure: a full-mix bundle built without a beat
 * tracker knows where the music starts but has never checked that the tab's
 * tempo matches the recording, so it says so rather than implying the sync has
 * been verified.
 */
export function syncQualityLabel(syncMap: SyncMap | undefined): string {
  if (!syncMap || syncMap.points.length === 0) return 'Not aligned'
  switch (syncMap.status) {
    case 'user-verified':
      return 'Aligned by you'
    case 'auto':
      return 'Aligned automatically'
    case 'needs-review':
      return syncMap.points.length === 1 ? 'Start aligned, tempo unchecked' : 'Needs checking'
  }
}
