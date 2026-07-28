// Passage overlap, merging and nesting (ADR-001).
//
// Scheduling individual bars produces musically meaningless reviews and an
// overlap explosion, so the scheduled unit is a contiguous bar range. These
// helpers keep the passage set sane as the user marks more trouble spots.

import type { Passage } from '../../core/types'

export interface BarRange {
  startBar: number
  endBar: number
}

export const MERGE_JACCARD = 0.6
export const KERNEL_MAX_BARS = 4
export const PARENT_MIN_RATIO = 2

export function barCount(range: BarRange): number {
  return Math.max(0, range.endBar - range.startBar + 1)
}

export function intersectionSize(a: BarRange, b: BarRange): number {
  const start = Math.max(a.startBar, b.startBar)
  const end = Math.min(a.endBar, b.endBar)
  return Math.max(0, end - start + 1)
}

/** Overlap as a fraction of the combined span. */
export function jaccard(a: BarRange, b: BarRange): number {
  const inter = intersectionSize(a, b)
  if (inter === 0) return 0
  const union = barCount(a) + barCount(b) - inter
  return union === 0 ? 0 : inter / union
}

/** Heavily overlapping ranges extend an existing passage instead of forking. */
export function shouldMerge(a: BarRange, b: BarRange): boolean {
  return jaccard(a, b) >= MERGE_JACCARD
}

export function mergeRanges(a: BarRange, b: BarRange): BarRange {
  return {
    startBar: Math.min(a.startBar, b.startBar),
    endBar: Math.max(a.endBar, b.endBar),
  }
}

/**
 * A short hard lick sitting inside a longer passage: the kernel is the jump
 * that fails, the parent is integrating it back into context. Both schedule
 * independently, but their results inform each other.
 */
export function isKernelOf(kernel: BarRange, parent: BarRange): boolean {
  if (barCount(kernel) > KERNEL_MAX_BARS) return false
  if (barCount(parent) < barCount(kernel) * PARENT_MIN_RATIO) return false
  return kernel.startBar >= parent.startBar && kernel.endBar <= parent.endBar
}

/**
 * Finds an existing passage to extend for a newly marked range, or null when
 * the range deserves a passage of its own.
 */
export function findMergeTarget(
  candidate: BarRange,
  existing: readonly Passage[],
  songId: string,
  trackIndex: number,
): Passage | null {
  for (const p of existing) {
    if (p.songId !== songId || p.trackIndex !== trackIndex) continue
    if (p.status === 'retired') continue
    if (shouldMerge(candidate, p)) return p
  }
  return null
}

/** All active passages that contain this one as a kernel. */
export function findParents(
  kernel: Passage,
  existing: readonly Passage[],
): Passage[] {
  return existing.filter(
    (p) =>
      p.id !== kernel.id &&
      p.songId === kernel.songId &&
      p.trackIndex === kernel.trackIndex &&
      p.status !== 'retired' &&
      isKernelOf(kernel, p),
  )
}

/** All active passages nested inside this one as kernels. */
export function findKernels(
  parent: Passage,
  existing: readonly Passage[],
): Passage[] {
  return existing.filter(
    (p) =>
      p.id !== parent.id &&
      p.songId === parent.songId &&
      p.trackIndex === parent.trackIndex &&
      p.status !== 'retired' &&
      isKernelOf(p, parent),
  )
}
